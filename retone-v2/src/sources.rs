use super::*;
use serde_json::{Value, json};
use std::sync::Weak;
use tokio::sync::Mutex;

pub(super) type Locks = Arc<Mutex<HashMap<Uuid, Weak<Mutex<()>>>>>;

fn citations(response: &Value) -> Option<Value> {
    if response["status"] != "completed" {
        return None;
    }
    let output = response["output"].as_array()?;
    if !output
        .iter()
        .any(|v| v["type"] == "web_search_call" && v["status"] == "completed")
    {
        return None;
    }
    let mut sources = Vec::new();
    let mut summary = String::new();
    for part in output
        .iter()
        .filter(|v| v["type"] == "message")
        .filter_map(|v| v["content"].as_array())
        .flatten()
        .filter(|v| v["type"] == "output_text")
    {
        summary.push_str(part["text"].as_str().unwrap_or_default());
        for note in part["annotations"].as_array().into_iter().flatten() {
            if note["type"] != "url_citation" || sources.len() == 3 {
                continue;
            }
            let Some(url) = note["url"].as_str() else {
                continue;
            };
            if !reqwest::Url::parse(url)
                .is_ok_and(|u| matches!(u.scheme(), "https" | "http") && u.host().is_some())
                || sources.iter().any(|v: &Value| v["url"] == url)
            {
                continue;
            }
            sources.push(json!({"url":url,"title":note["title"].as_str().unwrap_or("원문 보기")}));
        }
    }
    if sources.is_empty() {
        return Some(json!({"status":"clear","summary":"","sources":[]}));
    }
    let (flag, body) = summary
        .trim()
        .split_once('\n')
        .unwrap_or(("", summary.trim()));
    Some(
        json!({"status":if flag.trim()=="CHECK" {"check"} else {"clear"},
        "summary":body.trim(),"sources":sources}),
    )
}

pub(super) async fn fact_check(
    State(app): State<App>,
    headers: HeaderMap,
    Json(input): Json<FactCheck>,
) -> Result<Json<Value>, StatusCode> {
    let user = require_user(&app, &headers).await?;
    let message = input.message_id;
    let guard = {
        let mut locks = app.fact_locks.lock().await;
        locks.retain(|_, item| item.strong_count() > 0);
        let slot = locks.entry(message).or_default();
        let lock = slot.upgrade().unwrap_or_default();
        *slot = Arc::downgrade(&lock);
        lock
    };
    let _guard = guard.lock().await;
    let (body, cached) = sqlx::query_as::<_,(String,Option<Value>)>(
        "SELECT m.body,m.fact_result FROM retone_v2.messages m JOIN retone_v2.room_members rm ON rm.room_id=m.room_id
         WHERE m.id=$1 AND rm.user_id=$2 AND m.deleted_at IS NULL")
        .bind(message).bind(user).fetch_optional(&app.db).await.map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .ok_or(StatusCode::NOT_FOUND)?;
    if let Some(cached) = cached {
        return Ok(Json(cached));
    }
    if body.trim().is_empty() || body.chars().count() > 900 {
        return Err(StatusCode::UNPROCESSABLE_ENTITY);
    }
    let key = env::var("OPENAI_API_KEY").map_err(|_| StatusCode::SERVICE_UNAVAILABLE)?;
    let (response, _) = openai_response_json(&key, openai_quality_model(), "gpt-4.1-mini", json!({"tools":[{"type":"web_search"}],"tool_choice":"required","store":false,
            "instructions":"입력은 확인할 채팅 문장이다. 웹 검색으로 원문을 찾아 실제 인용을 붙여라. 첫 줄에는 출처들 사이에 중요한 차이나 날짜 문제가 있으면 CHECK, 그 외에는 INFO만 적어라. 다음 줄부터 각 출처가 무엇을 말하는지 한국어 두 문장으로 설명하고 진실이나 거짓이라고 단정하지 마라.",
            "input":body,"max_output_tokens":600}), 35).await?;
    let result = citations(&response).ok_or(StatusCode::BAD_GATEWAY)?;
    sqlx::query("UPDATE retone_v2.messages SET fact_result=$2 WHERE id=$1 AND deleted_at IS NULL")
        .bind(message)
        .bind(&result)
        .execute(&app.db)
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;
    Ok(Json(result))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_only_real_unique_citations() {
        let result = citations(&json!({
            "status":"completed",
            "output":[
                {"type":"web_search_call","status":"completed"},
                {"type":"message","content":[{"type":"output_text","text":"INFO\n기관 자료에서 확인되는 내용입니다.","annotations":[
                    {"type":"url_citation","url":"https://example.org/report","title":"기관 자료"},
                    {"type":"url_citation","url":"https://example.org/report","title":"중복 자료"},
                    {"type":"url_citation","url":"javascript:alert(1)","title":"잘못된 주소"}
                ]}]}
            ]
        })).unwrap();
        assert_eq!(result["status"], "clear");
        assert_eq!(result["sources"].as_array().unwrap().len(), 1);
        assert_eq!(result["sources"][0]["title"], "기관 자료");
    }

    #[test]
    fn rejects_answers_without_a_completed_search() {
        assert!(
            citations(&json!({
                "status":"completed",
                "output":[{"type":"message","content":[]}]
            }))
            .is_none()
        );
    }
}
