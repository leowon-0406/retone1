use super::*;
use axum::http::{header, HeaderValue};
use axum::response::{IntoResponse, Response};

fn cookie(token: &str, age: u32) -> HeaderValue {
    let secure = if env::var("RETONE_INSECURE_COOKIES").as_deref() == Ok("true") { "" } else { "; Secure" };
    HeaderValue::from_str(&format!("retone_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{secure}")).unwrap()
}
pub(super) fn token(headers: &HeaderMap) -> Result<Uuid, StatusCode> {
    let raw = headers.get(header::COOKIE).and_then(|v| v.to_str().ok())
        .and_then(|s| s.split(';').find_map(|v| v.trim().strip_prefix("retone_session=")))
        .or_else(|| headers.get(header::AUTHORIZATION)?.to_str().ok()?.strip_prefix("Bearer "))
        .ok_or(StatusCode::UNAUTHORIZED)?;
    Uuid::parse_str(raw).map_err(|_| StatusCode::UNAUTHORIZED)
}
pub(super) async fn complete(db: &PgPool, user: PublicUser) -> Result<Response, StatusCode> {
    let id = Uuid::parse_str(&user.id).map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let token = create_session(db, id).await?;
    let mut response = Json(serde_json::json!({"user":user})).into_response();
    response.headers_mut().insert(header::SET_COOKIE, cookie(&token, 30*86400));
    Ok(response)
}
pub(super) async fn me(State(app): State<App>, headers: HeaderMap) -> Result<Response, StatusCode> {
    let id = require_user(&app, &headers).await?;
    let (name,avatar,level) = sqlx::query_as::<_,(String,Option<String>,String)>(
        "SELECT name,avatar_url,ai_intervention FROM retone_v2.users WHERE id=$1 AND deleted_at IS NULL")
        .bind(id).fetch_optional(&app.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?.ok_or(StatusCode::UNAUTHORIZED)?;
    let mut response = Json(user_out(id,name,avatar,level)).into_response();
    if headers.contains_key(header::AUTHORIZATION) {
        response.headers_mut().insert(header::SET_COOKIE, cookie(&token(&headers)?.to_string(),30*86400));
    }
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}
pub(super) async fn logout(State(app): State<App>, headers: HeaderMap) -> Result<Response, StatusCode> {
    if let Ok(token) = token(&headers) {
        sqlx::query("DELETE FROM retone_v2.auth_sessions WHERE token=$1").bind(token)
            .execute(&app.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    }
    let mut response = StatusCode::NO_CONTENT.into_response();
    response.headers_mut().insert(header::SET_COOKIE, cookie("",0));
    Ok(response)
}
