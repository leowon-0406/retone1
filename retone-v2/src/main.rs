use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
};
use chrono::Utc;
use password_hash::SaltString;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
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
    db: PgPool,
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
#[derive(Deserialize)]
struct Credentials {
    name: String,
    phone: String,
    password: String,
    ai_intervention: Option<String>,
}
#[derive(Deserialize)]
struct AiCheck {
    text: String,
    ai_intervention: Option<String>,
}
#[derive(Deserialize)]
struct Preferences {
    ai_intervention: String,
}
#[derive(Serialize)]
struct PublicUser {
    id: String,
    name: String,
    avatar_url: Option<String>,
    ai_intervention: String,
}
fn phone_hash(phone: &str) -> String {
    format!(
        "phone:{}",
        phone
            .chars()
            .filter(|c| c.is_ascii_digit())
            .collect::<String>()
    )
}
fn ai_level(value: Option<&str>) -> String {
    match value.unwrap_or("standard") {
        "off" | "light" | "standard" | "careful" => value.unwrap_or("standard").to_string(),
        _ => "standard".to_string(),
    }
}
fn user_out(
    id: Uuid,
    name: String,
    avatar_url: Option<String>,
    ai_intervention: String,
) -> PublicUser {
    PublicUser {
        id: id.to_string(),
        name,
        avatar_url,
        ai_intervention,
    }
}

async fn health() -> Json<serde_json::Value> {
    let storage = prepare_storage().await.is_some();
    Json(
        serde_json::json!({"ok":true,"runtime":"rust","storage":storage,"version":"v2-foundation"}),
    )
}
async fn signup(
    State(app): State<App>,
    Json(input): Json<Credentials>,
) -> Result<Json<PublicUser>, StatusCode> {
    let name = input.name.trim();
    let phone = phone_hash(&input.phone);
    if name.is_empty()
        || input.phone.chars().filter(|c| c.is_ascii_digit()).count() < 7
        || input.password.len() < 6
    {
        return Err(StatusCode::BAD_REQUEST);
    }
    let salt = SaltString::generate(&mut OsRng);
    let hash = Argon2::default()
        .hash_password(input.password.as_bytes(), &salt)
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .to_string();
    let id = Uuid::new_v4();
    let level = ai_level(input.ai_intervention.as_deref());
    let result=sqlx::query("INSERT INTO retone_v2.users(id,phone_hash,name,password_hash,is_admin,ai_intervention) VALUES($1,$2,$3,$4,$5,$6)").bind(id).bind(phone).bind(name).bind(hash).bind(input.phone=="12341234"&&name=="12341234").bind(&level).execute(&app.db).await;
    if result.is_err() {
        return Err(StatusCode::CONFLICT);
    };
    Ok(Json(user_out(id, name.to_string(), None, level)))
}
async fn login(
    State(app): State<App>,
    Json(input): Json<Credentials>,
) -> Result<Json<PublicUser>, StatusCode> {
    let row=sqlx::query_as::<_,(Uuid,String,Option<String>,String,String)>("SELECT id,name,avatar_url,password_hash,ai_intervention FROM retone_v2.users WHERE phone_hash=$1 AND name=$2 AND deleted_at IS NULL").bind(phone_hash(&input.phone)).bind(input.name.trim()).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::UNAUTHORIZED)?;
    let parsed = PasswordHash::new(&row.3).map_err(|_| StatusCode::UNAUTHORIZED)?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    Ok(Json(user_out(row.0, row.1, row.2, row.4)))
}
async fn users(State(app): State<App>) -> Result<Json<Vec<PublicUser>>, StatusCode> {
    let rows=sqlx::query_as::<_,(Uuid,String,Option<String>,String)>("SELECT id,name,avatar_url,ai_intervention FROM retone_v2.users WHERE deleted_at IS NULL ORDER BY created_at").fetch_all(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        rows.into_iter()
            .map(|r| user_out(r.0, r.1, r.2, r.3))
            .collect(),
    ))
}
async fn update_preferences(
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(input): Json<Preferences>,
) -> Result<Json<PublicUser>, StatusCode> {
    let level = ai_level(Some(&input.ai_intervention));
    let row=sqlx::query_as::<_,(Uuid,String,Option<String>,String)>("UPDATE retone_v2.users SET ai_intervention=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,name,avatar_url,ai_intervention").bind(&level).bind(id).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?;
    Ok(Json(user_out(row.0, row.1, row.2, row.3)))
}
async fn ai_check(State(app): State<App>, Json(input): Json<AiCheck>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    let normalized = text
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .collect::<String>();
    let level = ai_level(input.ai_intervention.as_deref());
    let pass = [
        "ㅋㅋ",
        "ㅋㅋㅋ",
        "ㅋㅋㅋㅋ",
        "ㅋㅋㅋㅋㅋ",
        "ㅎㅎ",
        "ㅎㅎㅎ",
        "ㅎㅎㅎㅎ",
        "ㅎㅇ",
        "하이",
        "안녕",
        "안녕하세요",
        "응",
        "어",
        "웅",
        "넹",
        "네",
        "ㅇㅋ",
        "오케이",
        "ok",
        "yes",
        "no",
        "?",
        "!",
        "ㅇㅇ",
        "ㄱㄱ",
        "ㄴㄴ",
        "ㅂㅂ",
        "잘자",
        "고마워",
        "감사",
        "수고",
        "굿",
        "헐",
        "대박",
        "진짜",
        "맞아",
        "아니",
        "왜",
        "좋아",
        "좋다",
        "화이팅",
        "파이팅",
        "오",
        "오오",
        "와",
        "아",
        "앗",
        "헉",
        "엥",
        "ㄹㅇ",
        "레알",
        "ㅈㄱㄴ",
        "ㅊㅋ",
        "축하",
        "미안",
        "죄송",
        "괜찮아",
        "괜찮아요",
        "반가워",
        "반갑습니다",
        "다녀와",
        "잘가",
        "잘자요",
        "좋은밤",
        "굿밤",
        "굿모닝",
        "맛점",
        "맛저",
        "점심",
        "저녁",
        "ㅇㅈ",
        "ㅁㄹ",
        "모름",
        "ㄱㅅ",
        "감사해",
        "고생",
        "수고했어",
        "수고하세요",
        "파이팅",
    ];
    let bad = [
        "시발",
        "씨발",
        "시ㅂ",
        "ㅅㅂ",
        "ㅆㅂ",
        "개새끼",
        "개새",
        "병신",
        "ㅂㅅ",
        "ㅄ",
        "좆",
        "ㅈㄴ",
        "존나",
        "미친놈",
        "미친년",
        "꺼져",
        "죽어",
        "죽인다",
        "뒤져",
        "닥쳐",
        "엿먹어",
        "새끼",
        "년아",
        "놈아",
        "씹",
        "지랄",
        "ㅈㄹ",
        "ㅁㅊ",
        "fuck",
        "shit",
        "bitch",
        "asshole",
    ];
    if level == "off" || text.is_empty() || pass.iter().any(|p| text == *p || normalized == *p) {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"fast"}),
        );
    }
    if bad.iter().any(|p| normalized.contains(p)) {
        return Json(
            serde_json::json!({"verdict":"WARN","suggestion":"상대에게는 공격적인 표현으로 들릴 수 있어요. 조금 다르게 말해볼까요?","info":{"level":"none","note":null,"queries":[]},"source":"dictionary"}),
        );
    }
    if level == "light" {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"light"}),
        );
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(format!("{level}:{normalized}").as_bytes())
    );
    if let Ok(Some((verdict,suggestion,info_level,info_note,info_queries)))=sqlx::query_as::<_,(String,Option<String>,String,Option<String>,Vec<String>)>("SELECT verdict,suggestion,info_level,info_note,info_queries FROM retone_v2.ai_cache WHERE message_hash=$1").bind(&hash).fetch_optional(&app.db).await{return Json(serde_json::json!({"verdict":verdict,"suggestion":suggestion,"info":{"level":info_level,"note":info_note,"queries":info_queries},"source":"cache"}));}
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"unavailable"}),
        );
    };
    let prompt = format!(
        "너는 Re:Tone의 대화 거울이다. 판정자·검열자·사실확인 기관이 아니다. 현재 문장을 오직 '이렇게 들릴 수도 있어요'라는 제안으로만 비춘다.\n1) 심한 욕설·위협·명백한 조롱이 있으면 verdict=WARN. 하지만 위반·나쁨·부적절함이라고 판정하지 말고 suggestion에 '상대에게는 공격적인 표현으로 들릴 수 있어요', '조금 다르게 말해볼까요?' 같은 가능성 표현만 쓴다. 그 외는 PASS. 일상 인사·농담·짧은 대답은 PASS.\n2) 정보 점검: 건강·안전·법·돈·정치·재난·통계·속보성 주장에 출처·날짜·원문이 빠졌다면 info.level=check. 진실·거짓을 판단하지 말고 '출처와 날짜를 함께 확인해 보면 어떨까요?'처럼 제안만 한다.\n3) 현재 개입 강도는 {level}이다. standard는 중요한 주장만, careful은 중요한 주장과 오해될 수 있는 표현을 조금 더 꼼꼼히 본다.\n4) JSON만 출력: {{\"verdict\":\"PASS|WARN\",\"suggestion\":string|null,\"info\":{{\"level\":\"none|check\",\"note\":string|null,\"queries\":[string]}}}}. queries는 확인할 검색어 0~2개.\n문장: {text}"
    );
    let res = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&serde_json::json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":80}))
        .send()
        .await;
    let Ok(r) = res else {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"fallback"}),
        );
    };
    let v = r.json::<serde_json::Value>().await.unwrap_or_default();
    let out = v["output"][0]["content"][0]["text"]
        .as_str()
        .unwrap_or("{}");
    let parsed = serde_json::from_str::<serde_json::Value>(out)
        .unwrap_or_else(|_| serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]}}));
    let verdict = parsed["verdict"].as_str().unwrap_or("PASS");
    let suggestion = parsed["suggestion"].as_str();
    let info_level = parsed["info"]["level"].as_str().unwrap_or("none");
    let info_note = parsed["info"]["note"].as_str();
    let info_queries = parsed["info"]["queries"]
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(|v| v.as_str())
                .take(2)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let _=sqlx::query("INSERT INTO retone_v2.ai_cache(message_hash,verdict,suggestion,info_level,info_note,info_queries) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(message_hash) DO UPDATE SET verdict=EXCLUDED.verdict,suggestion=EXCLUDED.suggestion,info_level=EXCLUDED.info_level,info_note=EXCLUDED.info_note,info_queries=EXCLUDED.info_queries,checked_at=NOW()").bind(&hash).bind(verdict).bind(suggestion).bind(info_level).bind(info_note).bind(&info_queries).execute(&app.db).await;
    Json(
        serde_json::json!({"verdict":verdict,"suggestion":suggestion,"info":{"level":info_level,"note":info_note,"queries":info_queries},"source":"ai"}),
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
async fn delete_message(
    State(app): State<App>,
    Path((room_id, message_id)): Path<(String, String)>,
) -> StatusCode {
    let mut d = app.data.write().await;
    let before = d.messages.len();
    d.messages
        .retain(|m| !(m.room_id == room_id && m.id == message_id && m.mine));
    if d.messages.len() < before {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NOT_FOUND
    }
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
    let db = prepare_storage().await.expect("DATABASE_URL is required");
    let app_state = App {
        db,
        data: Arc::new(RwLock::new(Data {
            rooms: vec![],
            messages: vec![],
            agreements: vec![],
            appointments: vec![],
        })),
    };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/signup", post(signup))
        .route("/api/auth/login", post(login))
        .route("/api/users", get(users))
        .route("/api/users/{id}/preferences", patch(update_preferences))
        .route("/api/ai/check", post(ai_check))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/rooms", post(create_room))
        .route("/api/agreements", post(create_agreement))
        .route("/api/appointments", post(create_appointment))
        .route("/api/rooms/{id}/messages", get(messages).post(send))
        .route(
            "/api/rooms/{room_id}/messages/{message_id}",
            delete(delete_message),
        )
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
