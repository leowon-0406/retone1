//! Re:Tone's Rust migration server.
//! It shares the existing `retone_state` JSONB record with Node, so it can be
//! verified in parallel without changing user accounts or chat history.

use axum::{extract::State, http::StatusCode, response::IntoResponse, routing::get, Json, Router};
use serde_json::{json, Value};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::{env, net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;
use tower_http::services::ServeDir;

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

#[tokio::main]
async fn main() {
    let state = AppState::load().await;
    let api = Router::new().route("/health", get(health)).route("/rust-status", get(migration_status)).fallback(not_migrated).with_state(state);
    let app = Router::new().nest("/api", api).fallback_service(ServeDir::new("public"));
    let port = env::var("PORT").unwrap_or_else(|_| "3000".into()).parse().expect("valid PORT");
    let address = SocketAddr::from(([0,0,0,0],port));
    println!("Re:Tone Rust migration server is ready on {address}");
    let listener = tokio::net::TcpListener::bind(address).await.expect("bind listener");
    axum::serve(listener,app).await.expect("serve app");
}
