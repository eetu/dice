//! Thin `AppError` → `IntoResponse`. Kept minimal: this app's only REST failure
//! is "unknown / expired game code" (404).

use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use axum::Json;
use serde_json::json;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("game not found")]
    NotFound,
    #[error("game is full")]
    RoomFull,
    #[error("server is at capacity")]
    Busy,
    #[error("too many requests")]
    TooMany,
}

impl IntoResponse for AppError {
    fn into_response(self) -> Response {
        let (code, msg) = match &self {
            AppError::NotFound => (StatusCode::NOT_FOUND, self.to_string()),
            AppError::RoomFull => (StatusCode::CONFLICT, self.to_string()),
            AppError::Busy => (StatusCode::SERVICE_UNAVAILABLE, self.to_string()),
            AppError::TooMany => (StatusCode::TOO_MANY_REQUESTS, self.to_string()),
        };
        (code, Json(json!({ "error": msg }))).into_response()
    }
}
