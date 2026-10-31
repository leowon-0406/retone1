use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{get, post},
};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{env, net::SocketAddr, sync::Arc};
use tokio::sync::RwLock;
use tower_http::services::ServeDir;
use uuid::Uuid;

#[derive(Clone, Serialize)]
struct Room {
    id: String,
    name: String,
    members: u8,
    unread: u8,
    pinned: bool,
    last: String,
    updated: i64,
}
#[derive(Clone, Serialize)]
struct Message {
    id: String,
    room_id: String,
    sender: String,
    mine: bool,
    body: String,
    created: i64,
    unread: u8,
}
#[derive(Clone, Serialize)]
struct Agreement {
    task: String,
    assignee: String,
    deadline: String,
}
#[derive(Clone, Serialize)]
struct Appointment {
    title: String,
    date: String,
    place: String,
}
#[derive(Clone)]
struct Data {
    rooms: Vec<Room>,
    messages: Vec<Message>,
    agreements: Vec<Agreement>,
    appointments: Vec<Appointment>,
}
#[derive(Clone)]
struct App {
    data: Arc<RwLock<Data>>,
}
#[derive(Deserialize)]
struct Send {
    sender: String,
    body: String,
}
#[derive(Deserialize)]
struct NewRoom {
    name: String,
}
#[derive(Deserialize)]
struct NewAgreement {
    task: String,
    assignee: String,
    deadline: String,
}
#[derive(Deserialize)]
struct NewAppointment {
    title: String,
    date: String,
    place: String,
}

async fn health() -> Json<serde_json::Value> {
    let storage = prepare_storage().await.is_some();
    Json(
        serde_json::json!({"ok":true,"runtime":"rust","storage":storage,"version":"v2-foundation"}),
    )
}
async fn bootstrap(State(app): State<App>) -> Json<DataOut> {
    let d = app.data.read().await;
    Json(DataOut {
        rooms: d.rooms.clone(),
        agreements: d.agreements.clone(),
        appointments: d.appointments.clone(),
    })
}
#[derive(Serialize)]
struct DataOut {
    rooms: Vec<Room>,
    agreements: Vec<Agreement>,
    appointments: Vec<Appointment>,
}
async fn messages(State(app): State<App>, Path(id): Path<String>) -> Json<Vec<Message>> {
    let d = app.data.read().await;
    Json(
        d.messages
            .iter()
            .filter(|m| m.room_id == id)
            .cloned()
            .collect(),
    )
}
async fn send(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(input): Json<Send>,
) -> Result<Json<Message>, StatusCode> {
    if input.body.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let mut d = app.data.write().await;
    let message = Message {
        id: Uuid::new_v4().to_string(),
        room_id: id.clone(),
        sender: input.sender,
        mine: true,
        body: input.body.trim().to_string(),
        created: Utc::now().timestamp_millis(),
        unread: 2,
    };
    d.messages.push(message.clone());
    if let Some(room) = d.rooms.iter_mut().find(|r| r.id == id) {
        room.last = message.body.clone();
        room.updated = message.created;
    }
    Ok(Json(message))
}
async fn create_room(
    State(app): State<App>,
    Json(input): Json<NewRoom>,
) -> Result<Json<Room>, StatusCode> {
    let name = input.name.trim();
    if name.is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let room = Room {
        id: Uuid::new_v4().to_string(),
        name: name.chars().take(30).collect(),
        members: 1,
        unread: 0,
        pinned: false,
        last: "새 대화를 시작해 보세요.".into(),
        updated: Utc::now().timestamp_millis(),
    };
    app.data.write().await.rooms.push(room.clone());
    Ok(Json(room))
}
async fn create_agreement(
    State(app): State<App>,
    Json(input): Json<NewAgreement>,
) -> Result<Json<Agreement>, StatusCode> {
    if input.task.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let agreement = Agreement {
        task: input.task.trim().chars().take(100).collect(),
        assignee: if input.assignee.trim().is_empty() {
            "미정".into()
        } else {
            input.assignee.trim().chars().take(24).collect()
        },
        deadline: if input.deadline.trim().is_empty() {
            "미정".into()
        } else {
            input.deadline.trim().chars().take(40).collect()
        },
    };
    app.data.write().await.agreements.push(agreement.clone());
    Ok(Json(agreement))
}
async fn create_appointment(
    State(app): State<App>,
    Json(input): Json<NewAppointment>,
) -> Result<Json<Appointment>, StatusCode> {
    if input.title.trim().is_empty() || input.date.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let appointment = Appointment {
        title: input.title.trim().chars().take(80).collect(),
        date: input.date.trim().chars().take(30).collect(),
        place: if input.place.trim().is_empty() {
            "장소 미정".into()
        } else {
            input.place.trim().chars().take(50).collect()
        },
    };
    app.data
        .write()
        .await
        .appointments
        .push(appointment.clone());
    Ok(Json(appointment))
}

async fn prepare_storage() -> Option<PgPool> {
    let url = env::var("DATABASE_URL").ok()?;
    let pool = PgPoolOptions::new()
        .max_connections(5)
        .connect(&url)
        .await
        .ok()?;
    let migration = include_str!("../migrations/0001_retone_v2.sql");
    if sqlx::raw_sql(migration).execute(&pool).await.is_err() {
        return None;
    }
    Some(pool)
}

#[tokio::main]
async fn main() {
    let now = Utc::now().timestamp_millis();
    let app_state = App {
        data: Arc::new(RwLock::new(Data {
            rooms: vec![],
            messages: vec![],
            agreements: vec![],
            appointments: vec![],
        })),
    };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/rooms", post(create_room))
        .route("/api/agreements", post(create_agreement))
        .route("/api/appointments", post(create_appointment))
        .route("/api/rooms/{id}/messages", get(messages).post(send))
        .with_state(app_state)
        .fallback_service(ServeDir::new("public"));
    let port = env::var("PORT")
        .unwrap_or_else(|_| "4000".into())
        .parse()
        .unwrap();
    let listener = tokio::net::TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], port)))
        .await
        .unwrap();
    println!("Re:Tone v2 on {port}");
    axum::serve(listener, router).await.unwrap();
}
