mod auth;
mod models;
mod sheets;

use crate::auth::{
    authenticate_user, create_user, delete_user, extract_request_user, filter_crm_data_for_user,
    load_users, to_client_user, update_user,
};
use crate::models::{
    AdminUserMutationRequest, InteractionUpdateRequest, LoginRequest, TelegramReminderRequest,
};
use crate::sheets::{get_all_sheets_data, update_customer_interaction};
use axum::{
    extract::Query,
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
    routing::{delete, get, post, put},
    Json, Router,
};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::net::SocketAddr;
use tower_http::cors::CorsLayer;
use tower_http::services::ServeDir;

async fn health_handler() -> Json<Value> {
    Json(json!({
        "ok": true,
        "engine": "rust-axum-2.0"
    }))
}

async fn login_handler(Json(payload): Json<LoginRequest>) -> Response {
    match authenticate_user(&payload.username, &payload.password) {
        Ok((token, user)) => {
            let cookie = format!(
                "crm_bsn_token={}; Path=/; HttpOnly; SameSite=Lax; Max-Age={}",
                token,
                7 * 24 * 3600
            );
            (
                StatusCode::OK,
                [(header::SET_COOKIE, cookie)],
                Json(json!({
                    "ok": true,
                    "token": token,
                    "user": user
                })),
            )
                .into_response()
        }
        Err(msg) => (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "ok": false,
                "error": msg
            })),
        )
            .into_response(),
    }
}

async fn logout_handler() -> Response {
    let cookie = "crm_bsn_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0".to_string();
    (
        StatusCode::OK,
        [(header::SET_COOKIE, cookie)],
        Json(json!({ "ok": true })),
    )
        .into_response()
}

async fn me_handler(headers: HeaderMap) -> Response {
    match extract_request_user(&headers) {
        Some(user) => (
            StatusCode::OK,
            Json(json!({
                "ok": true,
                "authenticated": true,
                "user": user
            })),
        )
            .into_response(),
        None => (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "ok": false,
                "authenticated": false,
                "error": "Phiên đăng nhập đã hết hạn hoặc chưa đăng nhập"
            })),
        )
            .into_response(),
    }
}

async fn admin_list_users(headers: HeaderMap) -> Response {
    let Some(user) = extract_request_user(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "error": "Vui lòng đăng nhập" })),
        )
            .into_response();
    };
    if user.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "ok": false,
                "error": "Tài khoản Telesale không có quyền truy cập trang Quản lý Admin"
            })),
        )
            .into_response();
    }

    let users: Vec<_> = load_users()
        .iter()
        .map(|u| to_client_user(u, true))
        .collect();
    (StatusCode::OK, Json(json!({ "ok": true, "users": users }))).into_response()
}

async fn admin_create_user(
    headers: HeaderMap,
    Json(req): Json<AdminUserMutationRequest>,
) -> Response {
    let Some(user) = extract_request_user(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "error": "Vui lòng đăng nhập" })),
        )
            .into_response();
    };
    if user.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "ok": false, "error": "Chỉ Admin mới có quyền tạo tài khoản" })),
        )
            .into_response();
    }

    match create_user(req) {
        Ok(created) => {
            let users: Vec<_> = load_users()
                .iter()
                .map(|u| to_client_user(u, true))
                .collect();
            (
                StatusCode::CREATED,
                Json(json!({ "ok": true, "user": created, "users": users })),
            )
                .into_response()
        }
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": msg })),
        )
            .into_response(),
    }
}

async fn admin_update_user(
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
    Json(req): Json<AdminUserMutationRequest>,
) -> Response {
    let Some(user) = extract_request_user(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "error": "Vui lòng đăng nhập" })),
        )
            .into_response();
    };
    if user.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "ok": false, "error": "Chỉ Admin mới có quyền cập nhật tài khoản" })),
        )
            .into_response();
    }

    let target_id = req
        .id
        .clone()
        .or_else(|| params.get("id").cloned())
        .unwrap_or_default();

    match update_user(&target_id, req) {
        Ok(updated) => {
            let users: Vec<_> = load_users()
                .iter()
                .map(|u| to_client_user(u, true))
                .collect();
            (
                StatusCode::OK,
                Json(json!({ "ok": true, "user": updated, "users": users })),
            )
                .into_response()
        }
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": msg })),
        )
            .into_response(),
    }
}

async fn admin_delete_user(
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(user) = extract_request_user(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "error": "Vui lòng đăng nhập" })),
        )
            .into_response();
    };
    if user.role != "admin" {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({ "ok": false, "error": "Chỉ Admin mới có quyền xóa tài khoản" })),
        )
            .into_response();
    }

    let target_id = params.get("id").cloned().unwrap_or_default();
    match delete_user(&target_id, &user.id) {
        Ok(()) => {
            let users: Vec<_> = load_users()
                .iter()
                .map(|u| to_client_user(u, true))
                .collect();
            (StatusCode::OK, Json(json!({ "ok": true, "users": users }))).into_response()
        }
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": msg })),
        )
            .into_response(),
    }
}

async fn crm_data_handler(
    headers: HeaderMap,
    Query(params): Query<HashMap<String, String>>,
) -> Response {
    let Some(user) = extract_request_user(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({
                "ok": false,
                "requireAuth": true,
                "error": "Hệ thống CRM nội bộ — Vui lòng đăng nhập tài khoản được cấp quyền"
            })),
        )
            .into_response();
    };

    let force = params
        .get("refresh")
        .map(|v| v == "1" || v == "true")
        .unwrap_or(false);
    let data = get_all_sheets_data(force).await;
    let scoped = filter_crm_data_for_user(data, &user);
    (StatusCode::OK, Json(scoped)).into_response()
}

async fn crm_interaction_handler(
    headers: HeaderMap,
    Json(req): Json<InteractionUpdateRequest>,
) -> Response {
    let Some(user) = extract_request_user(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "requireAuth": true, "error": "Vui lòng đăng nhập" })),
        )
            .into_response();
    };

    if user.role != "admin" && !user.permissions.can_edit {
        return (
            StatusCode::FORBIDDEN,
            Json(json!({
                "ok": false,
                "error": "Tài khoản của bạn đang ở chế độ Chỉ xem"
            })),
        )
            .into_response();
    }

    match update_customer_interaction(req).await {
        Ok(res) => {
            let data = get_all_sheets_data(false).await;
            let scoped = filter_crm_data_for_user(data, &user);
            (
                StatusCode::OK,
                Json(json!({
                    "ok": true,
                    "engine": "rust-axum-2.0",
                    "applied": res["applied"],
                    "crmData": scoped
                })),
            )
                .into_response()
        }
        Err(msg) => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "ok": false, "error": msg })),
        )
            .into_response(),
    }
}

async fn crm_telegram_handler(
    headers: HeaderMap,
    Json(_req): Json<TelegramReminderRequest>,
) -> Response {
    let Some(_user) = extract_request_user(&headers) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "ok": false, "requireAuth": true, "error": "Vui lòng đăng nhập" })),
        )
            .into_response();
    };

    (
        StatusCode::OK,
        Json(json!({
            "ok": true,
            "engine": "rust-axum-2.0",
            "count": 0
        })),
    )
        .into_response()
}

#[tokio::main]
async fn main() {
    let _ = dotenvy::dotenv();
    let port: u16 = std::env::var("PORT")
        .ok()
        .and_then(|s| s.parse().ok())
        .unwrap_or(3001);

    let app = Router::new()
        .route("/api/health", get(health_handler))
        .route("/api/auth/login", post(login_handler))
        .route("/api/auth/logout", post(logout_handler))
        .route("/api/auth/me", get(me_handler))
        .route("/api/admin/users", get(admin_list_users))
        .route("/api/admin/users", post(admin_create_user))
        .route("/api/admin/users", put(admin_update_user))
        .route("/api/admin/users", delete(admin_delete_user))
        .route("/api/crm/data", get(crm_data_handler))
        .route(
            "/api/crm/interaction",
            post(crm_interaction_handler).put(crm_interaction_handler),
        )
        .route("/api/crm/telegram-reminder", post(crm_telegram_handler))
        .fallback_service(ServeDir::new("."))
        .layer(CorsLayer::permissive());

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    println!("🦀 CRM BSN Rust Server (Axum) đang chạy tại http://localhost:{}", port);

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .expect("Failed to bind port");
    axum::serve(listener, app).await.expect("Server error");
}
