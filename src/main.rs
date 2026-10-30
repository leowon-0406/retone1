//! Re:Tone's Rust migration server.
//! It shares the existing `retone_state` JSONB record with Node, so it can be
//! verified in parallel without changing user accounts or chat history.

use axum::{extract::{Path, Query, State}, http::StatusCode, response::{IntoResponse, Response}, routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::{collections::HashMap, env, net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Clone)]
struct AppState { database: Arc<RwLock<Value>>, postgres: Option<PgPool> }

impl AppState {
    async fn load() -> Self {
        let empty = || json!({"users":[],"rooms":[],"messages":[],"agreements":[],"friendships":[],"notifications":[],"analysisCache":{}});
        let Some(url) = env::var("DATABASE_URL").ok() else {
            eprintln!("DATABASE_URL is not configured; Rust is in local migration mode.");
            return Self { database: Arc::new(RwLock::new(empty())), postgres: None };
        };
        match PgPoolOptions::new().max_connections(5).connect(&url).await {
            Ok(pool) => {
                let _ = sqlx::query("CREATE TABLE IF NOT EXISTS retone_state (id INTEGER PRIMARY KEY, payload JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())").execute(&pool).await;
                let mut value = sqlx::query_scalar::<_, Value>("SELECT payload FROM retone_state WHERE id = 1").fetch_optional(&pool).await.ok().flatten().unwrap_or_else(empty);
                for field in ["users","rooms","messages","agreements","friendships","notifications"] { if !value.get(field).map(Value::is_array).unwrap_or(false) { value[field] = json!([]); } }
                if !value.get("analysisCache").map(Value::is_object).unwrap_or(false) { value["analysisCache"] = json!({}); }
                println!("Re:Tone Rust migration server connected to persistent Postgres.");
                Self { database: Arc::new(RwLock::new(value)), postgres: Some(pool) }
            }
            Err(error) => { eprintln!("Postgres connection failed in Rust migration server: {error}"); Self { database: Arc::new(RwLock::new(empty())), postgres: None } }
        }
    }
    async fn save(&self) -> Result<(), sqlx::Error> {
        let Some(pool) = &self.postgres else { return Ok(()); };
        let snapshot = self.database.read().await.clone();
        sqlx::query("INSERT INTO retone_state (id,payload,updated_at) VALUES (1,$1,NOW()) ON CONFLICT (id) DO UPDATE SET payload=EXCLUDED.payload,updated_at=NOW()").bind(snapshot).execute(pool).await?;
        Ok(())
    }
}

async fn health(State(state): State<AppState>) -> impl IntoResponse {
    Json(json!({"ok":true,"runtime":"rust","storage":if state.postgres.is_some(){"postgres"}else{"memory"}}))
}
async fn migration_status(State(state): State<AppState>) -> impl IntoResponse {
    let db = state.database.read().await;
    Json(json!({"runtime":"rust","phase":"parallel-migration","persistentStorage":state.postgres.is_some(),"records":{"users":db["users"].as_array().map_or(0,Vec::len),"rooms":db["rooms"].as_array().map_or(0,Vec::len),"messages":db["messages"].as_array().map_or(0,Vec::len)}}))
}
async fn not_migrated() -> impl IntoResponse { (StatusCode::NOT_IMPLEMENTED, Json(json!({"error":"이 API는 Rust 이전 작업 중이에요.","migration":true}))) }

fn error(code: StatusCode, text: &str) -> Response { (code, Json(json!({"error":text}))).into_response() }
fn user_exists(db: &Value, id: &str) -> bool { db["users"].as_array().is_some_and(|users| users.iter().any(|user| user["id"] == id && !user["deleted"].as_bool().unwrap_or(false))) }
fn public_user(user: &Value) -> Value { json!({"id":user["id"],"nickname":user["nickname"],"avatar":user.get("avatar").cloned().unwrap_or(Value::Null),"createdAt":user["createdAt"]}) }
fn room_for_user(room: &Value, user_id: &str) -> Value {
    let mut item=room.clone();
    if let Some(object)=item.as_object_mut() { object.remove("mutedBy"); object.remove("readBy"); object.remove("pinnedBy"); object.insert("memberCount".into(),json!(room["memberIds"].as_array().map_or(0,Vec::len))); object.insert("joined".into(),json!(room["memberIds"].as_array().is_some_and(|ids|ids.iter().any(|id|id==user_id)))); object.insert("notificationsMuted".into(),json!(room["mutedBy"].as_array().is_some_and(|ids|ids.iter().any(|id|id==user_id)))); object.insert("pinned".into(),json!(room["pinnedBy"].as_array().is_some_and(|ids|ids.iter().any(|id|id==user_id)))); }
    item
}
async fn get_rooms(State(state): State<AppState>, Query(query): Query<HashMap<String,String>>) -> Response {
    let Some(user_id)=query.get("userId") else{return error(StatusCode::BAD_REQUEST,"사용자를 확인해 주세요.")};
    let db=state.database.read().await;
    if !user_exists(&db,user_id){return error(StatusCode::FORBIDDEN,"사용자를 확인할 수 없어요.")}
    Json(Value::Array(db["rooms"].as_array().into_iter().flatten().filter(|room|room["memberIds"].as_array().is_some_and(|ids|ids.iter().any(|id|id==user_id))).map(|room|room_for_user(room,user_id)).collect())).into_response()
}
async fn get_users(State(state): State<AppState>, Query(query): Query<HashMap<String,String>>) -> Response {
    let Some(user_id)=query.get("userId") else{return error(StatusCode::BAD_REQUEST,"사용자를 확인해 주세요.")}; let db=state.database.read().await;
    if !user_exists(&db,user_id){return error(StatusCode::FORBIDDEN,"사용자를 확인할 수 없어요.")}
    Json(Value::Array(db["users"].as_array().into_iter().flatten().filter(|user|user["id"]!=*user_id&&!user["deleted"].as_bool().unwrap_or(false)).map(public_user).collect())).into_response()
}
async fn create_room(State(state): State<AppState>, Json(body): Json<Value>) -> Response {
    let user_id=body["userId"].as_str().unwrap_or(""); let name=body["name"].as_str().unwrap_or("").trim();
    if name.is_empty(){return error(StatusCode::BAD_REQUEST,"채팅방 정보를 확인해 주세요.")}
    let room={let mut db=state.database.write().await; if !user_exists(&db,user_id){return error(StatusCode::FORBIDDEN,"사용자를 확인할 수 없어요.")}; let room=json!({"id":format!("room_{}",Uuid::new_v4()),"kind":"group","name":name.chars().take(30).collect::<String>(),"inviteCode":Uuid::new_v4().simple().to_string()[..6].to_uppercase(),"memberIds":[user_id],"createdAt":chrono::Utc::now().timestamp_millis()}); db["rooms"].as_array_mut().unwrap().push(room.clone()); room};
    if state.save().await.is_err(){return error(StatusCode::INTERNAL_SERVER_ERROR,"저장하지 못했어요.")}; Json(room_for_user(&room,user_id)).into_response()
}
async fn get_messages(State(state): State<AppState>, Path(room_id): Path<String>, Query(query): Query<HashMap<String,String>>) -> Response {
    let user_id=query.get("userId").map(String::as_str).unwrap_or(""); let db=state.database.read().await;
    let Some(room)=db["rooms"].as_array().and_then(|rooms|rooms.iter().find(|room|room["id"]==room_id)) else{return error(StatusCode::NOT_FOUND,"채팅방을 찾을 수 없어요.")};
    if !room["memberIds"].as_array().is_some_and(|ids|ids.iter().any(|id|id==user_id)){return error(StatusCode::FORBIDDEN,"채팅방에 접근할 수 없어요.")}
    let messages=db["messages"].as_array().into_iter().flatten().filter(|message|message["roomId"]==room_id).map(|message|{let mut item=message.clone();let sender=db["users"].as_array().and_then(|users|users.iter().find(|user|user["id"]==message["senderId"])).map(public_user).unwrap_or_else(||json!({"id":"deleted","nickname":"탈퇴한 사용자","deleted":true}));item["sender"]=sender;item}).collect();Json(Value::Array(messages)).into_response()
}

#[tokio::main]
async fn main() {
    let state = AppState::load().await;
    let api = Router::new().route("/health", get(health)).route("/rust-status", get(migration_status)).route("/rooms", get(get_rooms).post(create_room)).route("/users", get(get_users)).route("/rooms/{room_id}/messages", get(get_messages)).fallback(not_migrated).with_state(state);
    let app = Router::new().nest("/api", api).fallback_service(ServeDir::new("public"));
    let port = env::var("PORT").unwrap_or_else(|_| "3000".into()).parse().expect("valid PORT");
    let address = SocketAddr::from(([0,0,0,0],port));
    println!("Re:Tone Rust migration server is ready on {address}");
    let listener = tokio::net::TcpListener::bind(address).await.expect("bind listener");
    axum::serve(listener,app).await.expect("serve app");
}
