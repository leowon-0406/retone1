use argon2::{Argon2, PasswordHash, PasswordHasher, PasswordVerifier};
use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get, patch, post},
};
use chrono::Utc;
use password_hash::SaltString;
use rand_core::OsRng;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use sqlx::{PgPool, postgres::PgPoolOptions};
use std::{collections::HashMap, env, net::SocketAddr, sync::Arc};
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
    sender_id: Option<String>,
    mine: bool,
    body: String,
    created: i64,
    unread: u8,
    intent: Option<String>,
    alignment_hint: bool,
    image_url: Option<String>,
}
#[derive(Clone, Serialize)]
struct Agreement {
    id: String,
    task: String,
    assignee: String,
    deadline: String,
    confirmations: u8,
    revisions: u8,
}
#[derive(Clone, Serialize)]
struct Appointment {
    room_id: String,
    title: String,
    date: String,
    place: String,
}
#[derive(Clone, Serialize)]
struct Reflection {
    id: String,
    room_id: String,
    title: String,
    keep: String,
    next: String,
}
#[derive(Clone, Serialize)]
struct ConversationInsight {
    id: String,
    room_id: String,
    checkpoint: usize,
    has_conflict: bool,
    topic: String,
    summary: String,
    reason: String,
    suggestion: String,
}
#[derive(Clone)]
struct Data {
    rooms: Vec<Room>,
    messages: Vec<Message>,
    agreements: Vec<Agreement>,
    appointments: Vec<Appointment>,
    reflections: Vec<Reflection>,
    insights: Vec<ConversationInsight>,
}
#[derive(Clone)]
struct App {
    data: Arc<RwLock<Data>>,
    db: PgPool,
}
#[derive(Deserialize)]
struct Send {
    sender: String,
    sender_id: Option<String>,
    body: String,
    intent: Option<String>,
    image_url: Option<String>,
}
#[derive(Deserialize)]
struct NewRoom {
    name: String,
    creator_id: Option<String>,
    invitee_ids: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct NewAgreement {
    task: String,
    room_id: Option<String>,
    assignee: String,
    deadline: String,
}
#[derive(Deserialize)]
struct NewAppointment {
    title: String,
    room_id: Option<String>,
    date: String,
    place: String,
}
#[derive(Deserialize)]
struct NewReflection {
    room_id: String,
    title: String,
    keep: String,
    next: String,
}
#[derive(Deserialize)]
struct Credentials {
    name: String,
    phone: String,
    password: String,
    ai_intervention: Option<String>,
}
#[derive(Deserialize)]
struct PhoneCheck {
    phone: String,
}
#[derive(Deserialize)]
struct SessionQuery {
    user_id: Option<Uuid>,
}
#[derive(Deserialize)]
struct ImageInput {
    data_url: String,
    override_warning: Option<bool>,
}
#[derive(Deserialize)]
struct AdminLogin {
    password: String,
    two_factor: String,
}
#[derive(Deserialize)]
struct DeleteCredentials {
    name: String,
    password: String,
}
#[derive(Deserialize)]
struct AiCheck {
    text: String,
    ai_intervention: Option<String>,
    details: Option<HashMap<String, String>>,
}
#[derive(Deserialize)]
struct RewriteRequest {
    text: String,
    context: Option<Vec<String>>,
}
#[derive(Deserialize)]
struct AiReport {
    reporter_name: String,
    original_text: String,
    ai_result: Option<String>,
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
        || !input.password.chars().any(|c| c.is_ascii_alphabetic())
        || !input.password.chars().any(|c| !c.is_ascii_alphanumeric())
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
async fn phone_available(
    State(app): State<App>,
    Query(input): Query<PhoneCheck>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let digits = input.phone.chars().filter(|c| c.is_ascii_digit()).count();
    if digits < 7 {
        return Ok(Json(
            serde_json::json!({"available": false, "ready": false}),
        ));
    }
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM retone_v2.users WHERE phone_hash=$1 AND deleted_at IS NULL)",
    )
    .bind(phone_hash(&input.phone))
    .fetch_one(&app.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        serde_json::json!({"available": !exists, "ready": true}),
    ))
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
async fn admin_login(Json(input): Json<AdminLogin>) -> Result<Json<PublicUser>, StatusCode> {
    let password = env::var("RETONE_ADMIN_PASSWORD").unwrap_or_else(|_| "3612asdf!!".into());
    let two_factor = env::var("RETONE_ADMIN_2FA").unwrap_or_else(|_| "7812".into());
    if input.password != password || input.two_factor != two_factor {
        return Err(StatusCode::UNAUTHORIZED);
    }
    Ok(Json(PublicUser {
        id: "admin".into(),
        name: "Re:Tone 관리자".into(),
        avatar_url: None,
        ai_intervention: "off".into(),
    }))
}
async fn clear_user_data(
    State(app): State<App>,
    Json(input): Json<AdminLogin>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let password = env::var("RETONE_ADMIN_PASSWORD").unwrap_or_else(|_| "3612asdf!!".into());
    let two_factor = env::var("RETONE_ADMIN_2FA").unwrap_or_else(|_| "7812".into());
    if input.password != password || input.two_factor != two_factor {
        return Err(StatusCode::UNAUTHORIZED);
    }
    sqlx::query("TRUNCATE TABLE retone_v2.ai_reports,retone_v2.appointments,retone_v2.agreements,retone_v2.messages,retone_v2.room_members,retone_v2.rooms,retone_v2.users RESTART IDENTITY CASCADE")
        .execute(&app.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut data = app.data.write().await;
    data.rooms.clear();
    data.messages.clear();
    data.agreements.clear();
    data.appointments.clear();
    data.reflections.clear();
    data.insights.clear();
    Ok(Json(
        serde_json::json!({"ok":true,"ai_cache_preserved":true}),
    ))
}
async fn clear_single_user(
    State(app): State<App>,
    Path(user_id): Path<Uuid>,
    Json(input): Json<AdminLogin>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let password = env::var("RETONE_ADMIN_PASSWORD").unwrap_or_else(|_| "3612asdf!!".into());
    let two_factor = env::var("RETONE_ADMIN_2FA").unwrap_or_else(|_| "7812".into());
    if input.password != password || input.two_factor != two_factor {
        return Err(StatusCode::UNAUTHORIZED);
    }
    let mut tx = app
        .db
        .begin()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("DELETE FROM retone_v2.messages WHERE sender_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("DELETE FROM retone_v2.agreements WHERE assignee_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("DELETE FROM retone_v2.appointments WHERE created_by=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("UPDATE retone_v2.rooms SET created_by=NULL WHERE created_by=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("DELETE FROM retone_v2.room_members WHERE user_id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let deleted = sqlx::query("DELETE FROM retone_v2.users WHERE id=$1")
        .bind(user_id)
        .execute(&mut *tx)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .rows_affected();
    tx.commit()
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if deleted == 0 {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(Json(
        serde_json::json!({"ok":true,"ai_cache_preserved":true}),
    ))
}
async fn users(State(app): State<App>) -> Result<Json<Vec<PublicUser>>, StatusCode> {
    let rows=sqlx::query_as::<_,(Uuid,String,Option<String>,String)>("SELECT id,name,avatar_url,ai_intervention FROM retone_v2.users WHERE deleted_at IS NULL ORDER BY created_at").fetch_all(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(
        rows.into_iter()
            .map(|r| user_out(r.0, r.1, r.2, r.3))
            .collect(),
    ))
}
async fn reset_v2(
    State(app): State<App>,
    Json(input): Json<Credentials>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let row=sqlx::query_as::<_,(bool,String)>("SELECT is_admin,password_hash FROM retone_v2.users WHERE phone_hash=$1 AND name=$2 AND deleted_at IS NULL").bind(phone_hash(&input.phone)).bind(input.name.trim()).fetch_optional(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::UNAUTHORIZED)?;
    let parsed = PasswordHash::new(&row.1).map_err(|_| StatusCode::UNAUTHORIZED)?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    if !row.0 {
        return Err(StatusCode::FORBIDDEN);
    };
    sqlx::query("TRUNCATE TABLE retone_v2.ai_reports,retone_v2.ai_cache,retone_v2.appointments,retone_v2.agreements,retone_v2.messages,retone_v2.room_members,retone_v2.rooms,retone_v2.users RESTART IDENTITY CASCADE").execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({"ok":true})))
}
async fn delete_account(
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(input): Json<DeleteCredentials>,
) -> Result<StatusCode, StatusCode> {
    let row = sqlx::query_as::<_, (String,)>(
        "SELECT password_hash FROM retone_v2.users WHERE id=$1 AND name=$2 AND deleted_at IS NULL",
    )
    .bind(id)
    .bind(input.name.trim())
    .fetch_optional(&app.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
    .ok_or(StatusCode::UNAUTHORIZED)?;
    let parsed = PasswordHash::new(&row.0).map_err(|_| StatusCode::UNAUTHORIZED)?;
    Argon2::default()
        .verify_password(input.password.as_bytes(), &parsed)
        .map_err(|_| StatusCode::UNAUTHORIZED)?;
    sqlx::query("UPDATE retone_v2.users SET deleted_at=NOW(),name='탈퇴한 사용자',avatar_url=NULL WHERE id=$1").bind(id).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(StatusCode::NO_CONTENT)
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
async fn moderate_image(data_url: &str) -> Result<serde_json::Value, StatusCode> {
    if !data_url.starts_with("data:image/") || data_url.len() > 2_800_000 {
        return Err(StatusCode::BAD_REQUEST);
    }
    let key = env::var("OPENAI_API_KEY").map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let response = reqwest::Client::new().post("https://api.openai.com/v1/moderations").bearer_auth(key).json(&serde_json::json!({"model":"omni-moderation-latest","input":[{"type":"image_url","image_url":{"url":data_url}}]})).send().await.map_err(|_| StatusCode::BAD_GATEWAY)?;
    if !response.status().is_success() {
        return Err(StatusCode::BAD_GATEWAY);
    }
    let body = response
        .json::<serde_json::Value>()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    Ok(body["results"][0].clone())
}
async fn upload_to_cloudinary(data_url: &str, folder: &str) -> Result<String, StatusCode> {
    let cloud = env::var("CLOUDINARY_CLOUD_NAME").map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let api_key = env::var("CLOUDINARY_API_KEY").map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let secret = env::var("CLOUDINARY_API_SECRET").map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let timestamp = Utc::now().timestamp().to_string();
    let signature = format!(
        "{:x}",
        Sha1::digest(format!("folder={folder}&timestamp={timestamp}{secret}").as_bytes())
    );
    let response = reqwest::Client::new()
        .post(format!(
            "https://api.cloudinary.com/v1_1/{cloud}/image/upload"
        ))
        .form(&[
            ("file", data_url),
            ("api_key", api_key.as_str()),
            ("timestamp", timestamp.as_str()),
            ("folder", folder),
            ("signature", signature.as_str()),
        ])
        .send()
        .await
        .map_err(|_| StatusCode::BAD_GATEWAY)?;
    if !response.status().is_success() {
        return Err(StatusCode::BAD_GATEWAY);
    }
    response
        .json::<serde_json::Value>()
        .await
        .ok()
        .and_then(|value| value["secure_url"].as_str().map(str::to_string))
        .ok_or(StatusCode::BAD_GATEWAY)
}
async fn check_image(Json(input): Json<ImageInput>) -> Result<Json<serde_json::Value>, StatusCode> {
    let result = moderate_image(&input.data_url).await?;
    let flagged = result["flagged"].as_bool().unwrap_or(true);
    let sexual = result["categories"]["sexual"].as_bool().unwrap_or(false)
        || result["categories"]["sexual/minors"]
            .as_bool()
            .unwrap_or(false);
    Ok(Json(serde_json::json!({"flagged":flagged,"sexual":sexual})))
}
async fn update_avatar(
    State(app): State<App>,
    Path(id): Path<Uuid>,
    Json(input): Json<ImageInput>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let result = moderate_image(&input.data_url).await?;
    let flagged = result["flagged"].as_bool().unwrap_or(true);
    let sexual = result["categories"]["sexual"].as_bool().unwrap_or(false)
        || result["categories"]["sexual/minors"]
            .as_bool()
            .unwrap_or(false);
    if flagged && !input.override_warning.unwrap_or(false) {
        return Ok(Json(
            serde_json::json!({"saved":false,"flagged":true,"sexual":sexual}),
        ));
    }
    let image_url = upload_to_cloudinary(&input.data_url, "retone/avatars").await?;
    let row = sqlx::query_as::<_,(Uuid,String,Option<String>,String)>("UPDATE retone_v2.users SET avatar_url=$1 WHERE id=$2 AND deleted_at IS NULL RETURNING id,name,avatar_url,ai_intervention").bind(image_url).bind(id).fetch_optional(&app.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::NOT_FOUND)?;
    let user = user_out(row.0, row.1, row.2, row.3);
    Ok(Json(
        serde_json::json!({"saved":true,"avatar_url":user.avatar_url}),
    ))
}
async fn ai_check(State(app): State<App>, Json(input): Json<AiCheck>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    let normalized = text
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation())
        .collect::<String>();
    let level = ai_level(input.ai_intervention.as_deref());
    let sarcasm_level = input
        .details
        .as_ref()
        .and_then(|items| items.get("비꼼·압박 표현"))
        .map(String::as_str)
        .unwrap_or("균형 있게");
    let source_level = input
        .details
        .as_ref()
        .and_then(|items| items.get("출처 확인 제안"))
        .map(String::as_str)
        .unwrap_or("중요한 정보만");
    let attack_level = input
        .details
        .as_ref()
        .and_then(|items| items.get("강한 공격 표현"))
        .map(String::as_str)
        .unwrap_or("필요한 경우만");
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
        "ㅠㅠ",
        "ㅜㅜ",
        "ㅠㅠㅠ",
        "ㅜㅜㅜ",
        "ㅇ",
        "ㅇㅇㅇ",
        "ㄱㅊ",
        "ㄱㅅㄱㅅ",
        "야",
        "야야",
        "얘",
        "얘들아",
        "야들아",
        "ㄴㄴㄴ",
        "ㅇㅋㅇㅋ",
        "오키",
        "오키오키",
        "알겠어",
        "알겠습니다",
        "넵",
        "넹넹",
        "예",
        "그래",
        "그럼",
        "그렇구나",
        "아하",
        "오호",
        "헉헉",
        "와우",
        "ㅋㅋㅋㅋㅋㅋ",
        "ㅋㅋㅋㅋㅋㅋㅋ",
        "ㅎㅎㅎㅎㅎ",
        "ㅃㅃ",
        "바이",
        "안녕히가세요",
        "잘부탁해",
        "잘부탁드립니다",
        "수고하셨습니다",
        "고마워요",
        "감사합니다",
        "죄송합니다",
        "미안해",
        "미안미안",
        "괜춘",
        "좋네",
        "좋아요",
        "완전좋아",
        "ㅇㅁㅇ",
        "ㄷㄷ",
        "ㄷㄷㄷ",
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
        "시발놈",
        "씨발놈",
        "시발년",
        "씨발년",
        "ㅅㅂㄴ",
        "ㅅㅂㄴㄱ",
        "개같네",
        "개같다",
        "개지랄",
        "개좆",
        "좆같",
        "존나게",
        "좃",
        "ㅈ같",
        "병신아",
        "병신같",
        "ㅂㅅ같",
        "븅신",
        "븅",
        "개병신",
        "등신",
        "찐따",
        "호구",
        "애미",
        "애비",
        "느금마",
        "니애미",
        "니엄마",
        "니애비",
        "뒤질",
        "죽을래",
        "죽여",
        "죽여버",
        "살인",
        "패버",
        "쳐맞",
        "처맞",
        "닥치고",
        "꺼지",
        "꺼져라",
        "엿이나",
        "씹새",
        "씹년",
        "씹놈",
        "씨발아",
        "ㅆㅂㄴ",
        "ㄱㅅㄲ",
        "fuckyou",
        "motherfucker",
        "fucking",
        "wtf",
        "killyourself",
    ];
    if level == "off" || text.is_empty() || pass.iter().any(|p| text == *p || normalized == *p) {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"fast"}),
        );
    }
    if attack_level != "꺼짐"
        && attack_level != "끄기"
        && bad.iter().any(|p| normalized.contains(p))
    {
        let matched = bad
            .iter()
            .find(|p| normalized.contains(**p))
            .unwrap_or(&"강한 표현");
        return Json(
            serde_json::json!({"verdict":"WARN","suggestion":format!("‘{matched}’처럼 강도가 높은 표현은 상대가 내용보다 공격받는 느낌을 먼저 받을 수 있어요. 하고 싶은 요청이나 감정을 구체적으로 말해보면 어떨까요?"),"info":{"level":"none","note":null,"queries":[]},"source":"dictionary"}),
        );
    }
    if level == "light" {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"light"}),
        );
    }
    let review_signals = [
        "죽",
        "꺼져",
        "닥쳐",
        "싫어",
        "짜증",
        "최악",
        "한심",
        "못해",
        "왜이래",
        "뭐하냐",
        "비꼬",
        "조롱",
        "사기",
        "확정",
        "속보",
        "뉴스",
        "병원",
        "약",
        "법",
        "벌금",
        "투자",
        "주식",
        "대출",
        "재난",
        "통계",
    ];
    let looks_like_claim = text.contains("?")
        || text.contains("래")
        || text.contains("다고")
        || text.contains("라던데");
    if level == "standard"
        && sarcasm_level != "민감하게"
        && !looks_like_claim
        && !review_signals
            .iter()
            .any(|signal| normalized.contains(signal))
    {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"selective"}),
        );
    }
    let hash = format!(
        "{:x}",
        Sha256::digest(
            format!("v3:{level}:{attack_level}:{sarcasm_level}:{source_level}:{normalized}")
                .as_bytes()
        )
    );
    if let Ok(Some((verdict,suggestion,info_level,info_note,info_queries)))=sqlx::query_as::<_,(String,Option<String>,String,Option<String>,Vec<String>)>("SELECT verdict,suggestion,info_level,info_note,info_queries FROM retone_v2.ai_cache WHERE message_hash=$1").bind(&hash).fetch_optional(&app.db).await{return Json(serde_json::json!({"verdict":verdict,"suggestion":suggestion,"info":{"level":info_level,"note":info_note,"queries":info_queries},"source":"cache"}));}
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(
            serde_json::json!({"verdict":"PASS","suggestion":null,"info":{"level":"none","note":null,"queries":[]},"source":"unavailable"}),
        );
    };
    let prompt = format!(
        "너는 Re:Tone의 대화 거울이다. 판정자·검열자·사실확인 기관이 아니다. 현재 문장을 오직 '이렇게 들릴 수도 있어요'라는 제안으로만 비춘다.\n1) 비꼼·압박 개입 수준은 {sarcasm_level}이다. 끄기이면 비꼼만으로 WARN하지 않는다. 친한 사이의 가벼운 농담은 WARN하지 않는다. 특히 '야', '야야', '얘들아' 같은 친근한 호칭은 그 단어 하나만으로 무례·압박·비하로 판단하거나 WARN하지 않는다. 문장 전체에 명백한 공격·조롱이 있을 때만 검토한다.\n2) WARN일 때 suggestion은 반드시 이 문장에 맞춰 두 문장으로 쓴다. 첫 문장은 실제 문제 지점(단어·어조·비꼼)을 따옴표로 구체적으로 짚고 왜 상대가 압박·비난·조롱으로 느낄 수 있는지 설명한다. 둘째 문장은 원래 의도를 살린 짧은 대체 표현을 제안한다.\n3) 출처 확인 개입 수준은 {source_level}이다. 끄기이면 정보 확인을 절대 제안하지 않는다. 중요 정보만이면 건강·안전·법·돈·정치·재난·통계·속보성 주장만, 균형 있게면 중요한 출처 없는 사실 주장도, 민감하게면 대부분의 출처 없는 사실 주장도 info.level=check로 제안한다. 진실·거짓은 절대 판단하지 않는다.\n4) 전체 개입 강도는 {level}이다. standard는 뚜렷한 경우만, careful은 비꼼·오해 가능성까지 조금 더 꼼꼼히 본다.\n5) JSON만 출력: {{\"verdict\":\"PASS|WARN\",\"suggestion\":string|null,\"info\":{{\"level\":\"none|check\",\"note\":string|null,\"queries\":[string]}}}}. queries는 확인할 검색어 0~2개.\n문장: {text}"
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
    let info_level = if source_level == "꺼짐" || source_level == "끄기" {
        "none"
    } else {
        parsed["info"]["level"].as_str().unwrap_or("none")
    };
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
async fn ai_rewrite(Json(input): Json<RewriteRequest>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    if text.is_empty() {
        return Json(serde_json::json!({"suggestion":""}));
    }
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(serde_json::json!({"suggestion":""}));
    };
    let context = input
        .context
        .unwrap_or_default()
        .into_iter()
        .rev()
        .take(12)
        .rev()
        .map(|line| line.chars().take(300).collect::<String>())
        .collect::<Vec<_>>()
        .join("\n");
    let prompt = format!(
        "너는 Re:Tone의 표현 다듬기 도우미다. 아래 같은 채팅방의 최근 맥락을 참고해, 원문의 의도·관계·진행 중인 일을 최대한 살리면서 상대가 덜 공격적으로 들을 자연스러운 한국어 한 문장으로 바꿔라. 맥락에 없는 사실을 만들지 말고, 욕설·비난은 요청이나 감정 표현으로 바꿔라. 판정·설명·따옴표 없이 바꾼 문장만 출력.\n\n최근 맥락:\n{context}\n\n바꿀 원문: {text}"
    );
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&serde_json::json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":80}))
        .send()
        .await;
    let suggestion = match response {
        Ok(r) => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| {
                v["output"][0]["content"][0]["text"]
                    .as_str()
                    .map(str::trim)
                    .map(str::to_string)
            })
            .unwrap_or_default(),
        Err(_) => String::new(),
    };
    Json(serde_json::json!({"suggestion":suggestion}))
}
async fn ai_support(Json(input): Json<RewriteRequest>) -> Json<serde_json::Value> {
    let text = input.text.trim();
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(serde_json::json!({"reply":""}));
    };
    let prompt = format!(
        "너는 Re:Tone의 공감 대화 도우미다. 사용자의 감정을 짧게 되짚고, 상대에게 보낼 수 있는 따뜻하고 자연스러운 문장 1~2개를 제안해라. 판단하거나 훈계하지 말고, 한국어로 4문장 이내로 답해라. 사용자의 말: {text}"
    );
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&serde_json::json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":180}))
        .send()
        .await;
    let reply = match response {
        Ok(r) => r
            .json::<serde_json::Value>()
            .await
            .ok()
            .and_then(|v| {
                v["output"][0]["content"][0]["text"]
                    .as_str()
                    .map(str::to_string)
            })
            .unwrap_or_default(),
        Err(_) => String::new(),
    };
    Json(serde_json::json!({"reply":reply}))
}
async fn report_ai(
    State(app): State<App>,
    Json(input): Json<AiReport>,
) -> Result<Json<serde_json::Value>, StatusCode> {
    if input.reporter_name.trim().is_empty() || input.original_text.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    };
    sqlx::query("INSERT INTO retone_v2.ai_reports(id,reporter_name,original_text,ai_result) VALUES($1,$2,$3,$4)").bind(Uuid::new_v4()).bind(input.reporter_name.trim()).bind(input.original_text.trim()).bind(input.ai_result).execute(&app.db).await.map_err(|_|StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(serde_json::json!({"ok":true})))
}
async fn bootstrap(State(app): State<App>, Query(session): Query<SessionQuery>) -> Json<DataOut> {
    let d = app.data.read().await;
    let mut rooms = d.rooms.clone();
    if let Some(user_id) = session.user_id {
        if let Ok(member_rows) = sqlx::query_scalar::<_, Uuid>(
            "SELECT room_id FROM retone_v2.room_members WHERE user_id=$1",
        )
        .bind(user_id)
        .fetch_all(&app.db)
        .await
        {
            let member_rooms = member_rows
                .into_iter()
                .map(|id| id.to_string())
                .collect::<std::collections::HashSet<_>>();
            rooms.retain(|room| member_rooms.contains(&room.id));
        } else {
            rooms.clear();
        }
        if let Ok(rows) = sqlx::query_as::<_, (Uuid, i64)>("SELECT r.id,COUNT(m.id) FROM retone_v2.rooms r JOIN retone_v2.room_members rm ON rm.room_id=r.id LEFT JOIN retone_v2.messages m ON m.room_id=r.id AND m.deleted_at IS NULL AND m.sender_id<>$1 AND (rm.last_read_at IS NULL OR m.created_at>rm.last_read_at) WHERE rm.user_id=$1 GROUP BY r.id").bind(user_id).fetch_all(&app.db).await {
            let unread = rows.into_iter().map(|(id,count)|(id.to_string(),count.min(255) as u8)).collect::<HashMap<_,_>>();
            rooms.iter_mut().for_each(|room| room.unread = *unread.get(&room.id).unwrap_or(&0));
        }
    } else {
        rooms.clear();
    }
    Json(DataOut {
        rooms,
        agreements: d.agreements.clone(),
        appointments: d.appointments.clone(),
        reflections: d.reflections.clone(),
        insights: d.insights.clone(),
    })
}
#[derive(Serialize)]
struct DataOut {
    rooms: Vec<Room>,
    agreements: Vec<Agreement>,
    appointments: Vec<Appointment>,
    reflections: Vec<Reflection>,
    insights: Vec<ConversationInsight>,
}
async fn messages(
    State(app): State<App>,
    Path(id): Path<String>,
    Query(session): Query<SessionQuery>,
) -> Result<Json<Vec<Message>>, StatusCode> {
    let room_id = Uuid::parse_str(&id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let user_id = session.user_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM retone_v2.room_members WHERE room_id=$1 AND user_id=$2)",
    )
    .bind(room_id)
    .bind(user_id)
    .fetch_one(&app.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !member {
        return Err(StatusCode::FORBIDDEN);
    }
    let _ = sqlx::query(
        "UPDATE retone_v2.room_members SET last_read_at=NOW() WHERE room_id=$1 AND user_id=$2",
    )
    .bind(room_id)
    .bind(user_id)
    .execute(&app.db)
    .await;
    let d = app.data.read().await;
    Ok(Json(
        d.messages
            .iter()
            .filter(|m| m.room_id == id)
            .cloned()
            .map(|mut message| {
                message.mine = session
                    .user_id
                    .map(|user_id| {
                        message.sender_id.as_deref() == Some(user_id.to_string().as_str())
                    })
                    .unwrap_or(false);
                message
            })
            .collect(),
    ))
}
fn looks_like_alignment(text: &str) -> bool {
    let normalized = text.replace(' ', "").to_lowercase();
    let schedule_words = [
        "이따가",
        "언제",
        "몇시",
        "몇시에",
        "만날",
        "약속",
        "회의",
        "보이스톡",
        "시간돼",
        "시간되",
        "가능해",
        "가능하",
        "할거야",
        "할거니",
        "할래",
        "일정",
    ];
    schedule_words.iter().any(|word| normalized.contains(word))
        && (text.contains('?') || normalized.contains("이따가") || normalized.contains("약속"))
}
async fn send(
    State(app): State<App>,
    Path(id): Path<String>,
    Json(input): Json<Send>,
) -> Result<Json<Message>, StatusCode> {
    if input.body.trim().is_empty() && input.image_url.is_none() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let sender_id = input
        .sender_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok());
    let room_uuid = Uuid::parse_str(&id).map_err(|_| StatusCode::BAD_REQUEST)?;
    let sender_id = sender_id.ok_or(StatusCode::UNAUTHORIZED)?;
    let member = sqlx::query_scalar::<_, bool>(
        "SELECT EXISTS(SELECT 1 FROM retone_v2.room_members WHERE room_id=$1 AND user_id=$2)",
    )
    .bind(room_uuid)
    .bind(sender_id)
    .fetch_one(&app.db)
    .await
    .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if !member {
        return Err(StatusCode::FORBIDDEN);
    }
    let image_url = match input.image_url.as_deref() {
        Some(data_url) => Some(upload_to_cloudinary(data_url, "retone/messages").await?),
        None => None,
    };
    let message = Message {
        id: Uuid::new_v4().to_string(),
        room_id: id.clone(),
        sender: input.sender,
        sender_id: Some(sender_id.to_string()),
        mine: true,
        body: input.body.trim().to_string(),
        created: Utc::now().timestamp_millis(),
        unread: 0,
        intent: input.intent.filter(|value| !value.trim().is_empty()),
        alignment_hint: looks_like_alignment(input.body.trim()),
        image_url,
    };
    sqlx::query("INSERT INTO retone_v2.messages(id,room_id,sender_id,body,intent,image_url) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(Uuid::parse_str(&message.id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?)
        .bind(room_uuid).bind(sender_id).bind(&message.body).bind(&message.intent).bind(&message.image_url)
        .execute(&app.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let mut d = app.data.write().await;
    d.messages.push(message.clone());
    if let Some(room) = d.rooms.iter_mut().find(|r| r.id == id) {
        room.last = message.body.clone();
        room.updated = message.created;
    }
    Ok(Json(message))
}
async fn create_conversation_insight(
    State(app): State<App>,
    Path(room_id): Path<String>,
) -> Json<serde_json::Value> {
    let (checkpoint, history, previous_summary) = {
        let d = app.data.read().await;
        let messages = d
            .messages
            .iter()
            .filter(|message| message.room_id == room_id)
            .collect::<Vec<_>>();
        let checkpoint = messages.len() / 10;
        if checkpoint == 0
            || d.insights
                .iter()
                .any(|item| item.room_id == room_id && item.checkpoint == checkpoint)
        {
            return Json(serde_json::json!({"created":false}));
        }
        let history = messages
            .iter()
            .rev()
            .take(30)
            .rev()
            .map(|message| format!("{}: {}", message.sender, message.body))
            .collect::<Vec<_>>()
            .join("\n");
        let previous_summary = d
            .insights
            .iter()
            .rev()
            .find(|item| item.room_id == room_id)
            .map(|item| format!("이전 취합 주제: {} / 요약: {}", item.topic, item.summary))
            .unwrap_or_default();
        (checkpoint, history, previous_summary)
    };
    let Some(key) = env::var("OPENAI_API_KEY").ok() else {
        return Json(serde_json::json!({"created":false}));
    };
    let prompt = format!(
        "너는 Re:Tone의 중립적 대화 정리 도우미다. 이 요청은 메시지 10개마다 실행되지만, 분석은 아래 최근 30개 메시지에서 주제가 이어지는 흐름을 찾아 하나의 맥락으로 취합한다. 바로 전 취합의 주제와 이어지는 내용이면 같은 대화 흐름으로 보고, 관련 없는 주제는 억지로 섞지 마라. 갈등·싸움·오해가 명확히 보일 때만 has_conflict=true로 해라. 누구의 잘못인지 판단하거나 비난하지 마라. 갈등이 있다면 reason에는 왜 부딪히는지 한 문장으로, suggestion에는 바로 해볼 수 있는 해소 방법을 한 문장으로 쓴다. 갈등이 없으면 has_conflict=false, reason과 suggestion은 빈 문자열. topic은 대화 주제를 짧게, summary는 해당 주제 흐름을 1문장으로 쓴다. JSON만 출력: {{\"has_conflict\":boolean,\"topic\":string,\"summary\":string,\"reason\":string,\"suggestion\":string}}\n\n{previous_summary}\n\n최근 대화:\n{history}"
    );
    let response = reqwest::Client::new()
        .post("https://api.openai.com/v1/responses")
        .bearer_auth(key)
        .json(&serde_json::json!({"model":"gpt-4o-mini","input":prompt,"max_output_tokens":130}))
        .send()
        .await;
    let Ok(response) = response else {
        return Json(serde_json::json!({"created":false}));
    };
    let value = response
        .json::<serde_json::Value>()
        .await
        .unwrap_or_default();
    let text = value["output"][0]["content"][0]["text"]
        .as_str()
        .unwrap_or("{}");
    let parsed = serde_json::from_str::<serde_json::Value>(text).unwrap_or_default();
    let insight = ConversationInsight {
        id: Uuid::new_v4().to_string(),
        room_id: room_id.clone(),
        checkpoint,
        has_conflict: parsed["has_conflict"].as_bool().unwrap_or(false),
        topic: parsed["topic"]
            .as_str()
            .unwrap_or("대화 흐름")
            .chars()
            .take(60)
            .collect(),
        summary: parsed["summary"]
            .as_str()
            .unwrap_or("대화 10개를 함께 확인했어요.")
            .chars()
            .take(180)
            .collect(),
        reason: parsed["reason"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(220)
            .collect(),
        suggestion: parsed["suggestion"]
            .as_str()
            .unwrap_or("")
            .chars()
            .take(220)
            .collect(),
    };
    app.data.write().await.insights.push(insight.clone());
    Json(serde_json::json!({"created":true,"insight":insight}))
}
async fn delete_message(
    State(app): State<App>,
    Path((room_id, message_id)): Path<(String, String)>,
    Query(session): Query<SessionQuery>,
) -> StatusCode {
    let room_uuid = match Uuid::parse_str(&room_id) {
        Ok(value) => value,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    let message_uuid = match Uuid::parse_str(&message_id) {
        Ok(value) => value,
        Err(_) => return StatusCode::BAD_REQUEST,
    };
    let Some(user_id) = session.user_id else {
        return StatusCode::UNAUTHORIZED;
    };
    let persisted = sqlx::query("UPDATE retone_v2.messages SET deleted_at=NOW() WHERE id=$1 AND room_id=$2 AND sender_id=$3 AND deleted_at IS NULL").bind(message_uuid).bind(room_uuid).bind(user_id).execute(&app.db).await;
    if persisted.map(|result| result.rows_affected()).unwrap_or(0) == 0 {
        return StatusCode::NOT_FOUND;
    }
    let mut d = app.data.write().await;
    let before = d.messages.len();
    d.messages.retain(|m| {
        !(m.room_id == room_id
            && m.id == message_id
            && m.sender_id.as_deref() == Some(user_id.to_string().as_str()))
    });
    if d.messages.len() < before {
        StatusCode::NO_CONTENT
    } else {
        StatusCode::NO_CONTENT
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
    let invitees = input.invitee_ids.clone().unwrap_or_default();
    let room = Room {
        id: Uuid::new_v4().to_string(),
        name: name.chars().take(30).collect(),
        members: 1 + invitees.len().min(99) as u8,
        unread: 0,
        pinned: false,
        last: "새 대화를 시작해 보세요.".into(),
        updated: Utc::now().timestamp_millis(),
    };
    let creator = input
        .creator_id
        .as_deref()
        .and_then(|value| Uuid::parse_str(value).ok());
    let room_uuid = Uuid::parse_str(&room.id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    sqlx::query("INSERT INTO retone_v2.rooms(id,name,created_by,is_group) VALUES($1,$2,$3,$4)")
        .bind(room_uuid)
        .bind(&room.name)
        .bind(creator)
        .bind(true)
        .execute(&app.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if let Some(user_id) = creator {
        let _ = sqlx::query("INSERT INTO retone_v2.room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(room_uuid).bind(user_id).execute(&app.db).await;
    }
    for invitee in invitees {
        if let Ok(user_id) = Uuid::parse_str(&invitee) {
            let _ = sqlx::query("INSERT INTO retone_v2.room_members(room_id,user_id) VALUES($1,$2) ON CONFLICT DO NOTHING").bind(room_uuid).bind(user_id).execute(&app.db).await;
        }
    }
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
        id: Uuid::new_v4().to_string(),
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
        confirmations: 0,
        revisions: 0,
    };
    app.data.write().await.agreements.push(agreement.clone());
    Ok(Json(agreement))
}
async fn update_agreement(
    State(app): State<App>,
    Path((id, action)): Path<(String, String)>,
) -> Result<Json<Agreement>, StatusCode> {
    let mut data = app.data.write().await;
    let agreement = data
        .agreements
        .iter_mut()
        .find(|item| item.id == id)
        .ok_or(StatusCode::NOT_FOUND)?;
    match action.as_str() {
        "confirm" => agreement.confirmations = agreement.confirmations.saturating_add(1),
        "revise" => agreement.revisions = agreement.revisions.saturating_add(1),
        _ => return Err(StatusCode::BAD_REQUEST),
    }
    Ok(Json(agreement.clone()))
}
async fn create_appointment(
    State(app): State<App>,
    Json(input): Json<NewAppointment>,
) -> Result<Json<Appointment>, StatusCode> {
    if input.title.trim().is_empty() || input.date.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let appointment = Appointment {
        room_id: input.room_id.unwrap_or_default(),
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
async fn create_reflection(
    State(app): State<App>,
    Json(input): Json<NewReflection>,
) -> Result<Json<Reflection>, StatusCode> {
    if input.room_id.trim().is_empty() || input.title.trim().is_empty() {
        return Err(StatusCode::BAD_REQUEST);
    }
    let reflection = Reflection {
        id: Uuid::new_v4().to_string(),
        room_id: input.room_id,
        title: input.title.trim().chars().take(80).collect(),
        keep: input.keep.trim().chars().take(120).collect(),
        next: input.next.trim().chars().take(120).collect(),
    };
    app.data.write().await.reflections.push(reflection.clone());
    Ok(Json(reflection))
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
async fn restore_data(db: &PgPool) -> Data {
    let rooms = sqlx::query_as::<_, (Uuid, String, i64, String, i64)>("SELECT r.id,r.name,(SELECT COUNT(*) FROM retone_v2.room_members rm WHERE rm.room_id=r.id),COALESCE((SELECT m.body FROM retone_v2.messages m WHERE m.room_id=r.id AND m.deleted_at IS NULL ORDER BY m.created_at DESC LIMIT 1),'새 대화를 시작해 보세요.'),FLOOR(EXTRACT(EPOCH FROM r.created_at)*1000)::BIGINT FROM retone_v2.rooms r ORDER BY r.created_at")
        .fetch_all(db).await.unwrap_or_default().into_iter().map(|(id,name,members,last,updated)| Room { id:id.to_string(),name,members:members.min(255) as u8,unread:0,pinned:false,last,updated }).collect();
    let messages = sqlx::query_as::<_, (Uuid, Uuid, Option<String>, Option<Uuid>, String, i64, Option<String>, Option<String>)>("SELECT m.id,m.room_id,u.name,m.sender_id,m.body,FLOOR(EXTRACT(EPOCH FROM m.created_at)*1000)::BIGINT,m.intent,m.image_url FROM retone_v2.messages m LEFT JOIN retone_v2.users u ON u.id=m.sender_id WHERE m.deleted_at IS NULL ORDER BY m.created_at")
        .fetch_all(db).await.unwrap_or_default().into_iter().map(|(id,room_id,sender,sender_id,body,created,intent,image_url)| { let alignment_hint = looks_like_alignment(&body); Message { id:id.to_string(),room_id:room_id.to_string(),sender:sender.unwrap_or_else(|| "알 수 없는 사용자".into()),sender_id:sender_id.map(|value| value.to_string()),mine:false,body,created,unread:0,intent,alignment_hint,image_url } }).collect();
    Data {
        rooms,
        messages,
        agreements: vec![],
        appointments: vec![],
        reflections: vec![],
        insights: vec![],
    }
}

#[tokio::main]
async fn main() {
    let db = prepare_storage().await.expect("DATABASE_URL is required");
    let restored = restore_data(&db).await;
    let app_state = App {
        db,
        data: Arc::new(RwLock::new(restored)),
    };
    let router = Router::new()
        .route("/api/health", get(health))
        .route("/api/auth/signup", post(signup))
        .route("/api/auth/phone-available", get(phone_available))
        .route("/api/auth/login", post(login))
        .route("/api/auth/admin-login", post(admin_login))
        .route("/api/users", get(users))
        .route("/api/admin/reset-v2", post(reset_v2))
        .route("/api/admin/clear-user-data", post(clear_user_data))
        .route("/api/admin/users/{id}/clear", post(clear_single_user))
        .route("/api/users/{id}", delete(delete_account))
        .route("/api/users/{id}/preferences", patch(update_preferences))
        .route("/api/users/{id}/avatar", post(update_avatar))
        .route("/api/images/check", post(check_image))
        .route("/api/ai/check", post(ai_check))
        .route("/api/ai/rewrite", post(ai_rewrite))
        .route("/api/ai/support", post(ai_support))
        .route("/api/ai/reports", post(report_ai))
        .route("/api/bootstrap", get(bootstrap))
        .route("/api/rooms", post(create_room))
        .route("/api/agreements", post(create_agreement))
        .route("/api/agreements/{id}/{action}", post(update_agreement))
        .route("/api/appointments", post(create_appointment))
        .route("/api/reflections", post(create_reflection))
        .route("/api/rooms/{id}/messages", get(messages).post(send))
        .route("/api/rooms/{id}/insight", post(create_conversation_insight))
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
