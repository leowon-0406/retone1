use super::*;

#[derive(Deserialize)]
pub(super) struct Typing {
    active: bool,
}

pub(super) async fn typing(
    State(app): State<App>,
    Path(room): Path<Uuid>,
    headers: HeaderMap,
    Json(input): Json<Typing>,
) -> Result<StatusCode, StatusCode> {
    let user = require_user(&app, &headers).await?;
    let result = sqlx::query("UPDATE retone_v2.room_members SET typing_until=CASE WHEN $3 THEN NOW()+INTERVAL '6 seconds' ELSE NULL END WHERE room_id=$1 AND user_id=$2")
        .bind(room).bind(user).bind(input.active).execute(&app.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    if result.rows_affected() == 0 {
        return Err(StatusCode::FORBIDDEN);
    }
    Ok(StatusCode::NO_CONTENT)
}
pub(super) async fn sync(
    State(app): State<App>,
    Path(room): Path<Uuid>,
    headers: HeaderMap,
) -> Result<Json<serde_json::Value>, StatusCode> {
    let user = require_user(&app, &headers).await?;
    let Json(messages) =
        super::messages(State(app.clone()), Path(room.to_string()), headers).await?;
    let typing = sqlx::query_scalar::<_, String>("SELECT u.name FROM retone_v2.room_members m JOIN retone_v2.users u ON u.id=m.user_id WHERE m.room_id=$1 AND m.user_id<>$2 AND m.typing_until>NOW() ORDER BY u.name,u.id")
        .bind(room).bind(user).fetch_all(&app.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    let data = app.data.read().await;
    let room = room.to_string();
    Ok(Json(
        serde_json::json!({"messages":messages,"typing":typing,
        "appointments":data.appointments.iter().filter(|a|a.room_id==room).collect::<Vec<_>>(),
        "agreements":data.agreements.iter().filter(|a|a.room_id==room).collect::<Vec<_>>(),
        "reflections":data.reflections.iter().filter(|a|a.room_id==room).collect::<Vec<_>>(),
        "insights":data.insights.iter().filter(|a|a.room_id==room).collect::<Vec<_>>() }),
    ))
}
