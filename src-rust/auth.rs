use crate::models::{
    AdminUserMutationRequest, ClientUser, CrmPayload, StoredUser, UserPermissions,
};
use axum::http::HeaderMap;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use chrono::Utc;
use hmac::{Hmac, Mac};
use scrypt::{scrypt, Params};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use std::fs;
use std::path::PathBuf;
use unicode_normalization::UnicodeNormalization;

type HmacSha256 = Hmac<Sha256>;

const USERS_FILE: &str = "server/data/users.json";
const TOKEN_TTL_MS: i64 = 7 * 24 * 60 * 60 * 1000;

#[derive(Debug, Serialize, Deserialize)]
struct TokenClaims {
    sub: String,
    username: String,
    role: String,
    iat: i64,
    exp: i64,
}

pub fn nfc_trim(val: &str) -> String {
    val.nfc().collect::<String>().trim().to_string()
}

fn get_auth_secret() -> String {
    std::env::var("CRM_AUTH_SECRET")
        .unwrap_or_else(|_| "crm-bsn-secret-key-2026-tram-chua-da".to_string())
}

pub fn hash_password(password: &str, salt: &str) -> String {
    // Node crypto.scryptSync default parameters: N=16384 (log_n=14), r=8, p=1, keylen=64
    let params = Params::new(14, 8, 1, 64).expect("Valid scrypt params");
    let mut output = [0u8; 64];
    scrypt(password.as_bytes(), salt.as_bytes(), &params, &mut output)
        .expect("scrypt hashing succeeded");
    format!("{}:{}", salt, hex::encode(output))
}

pub fn verify_password(password: &str, stored_hash: &str) -> bool {
    let parts: Vec<&str> = stored_hash.split(':').collect();
    if parts.len() != 2 {
        return false;
    }
    let salt = parts[0];
    let computed = hash_password(password, salt);
    computed == stored_hash
}

pub fn load_users() -> Vec<StoredUser> {
    let path = PathBuf::from(USERS_FILE);
    if let Ok(raw) = fs::read_to_string(&path) {
        if let Ok(users) = serde_json::from_str::<Vec<StoredUser>>(&raw) {
            if !users.is_empty() {
                return users;
            }
        }
    }
    let defaults = build_default_users();
    save_users(&defaults);
    defaults
}

pub fn save_users(users: &[StoredUser]) {
    let path = PathBuf::from(USERS_FILE);
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(users) {
        let _ = fs::write(path, json);
    }
}

fn build_default_users() -> Vec<StoredUser> {
    let now = Utc::now().to_rfc3339();
    let admin_user = std::env::var("ADMIN_USERNAME").unwrap_or_else(|_| "admin".to_string());
    let admin_pass = std::env::var("ADMIN_PASSWORD").unwrap_or_else(|_| "bsn@2026".to_string());

    let mut users = vec![StoredUser {
        id: "usr-admin".to_string(),
        username: nfc_trim(&admin_user).to_lowercase(),
        password_hash: hash_password(&admin_pass, "bsnsalt2026admin"),
        password_display: admin_pass,
        telesale_name: "ADMIN".to_string(),
        full_name: "Quản trị viên CRM".to_string(),
        role: "admin".to_string(),
        active: true,
        permissions: UserPermissions::default(),
        created_at: now.clone(),
        updated_at: now.clone(),
        last_login_at: None,
    }];

    let default_sales = [
        ("thinh", "THỊNH"),
        ("phu", "PHÚ"),
        ("sale3", "TELESALE 3"),
        ("sale4", "TELESALE 4"),
        ("sale5", "TELESALE 5"),
    ];

    for (idx, (uname, tname)) in default_sales.iter().enumerate() {
        users.push(StoredUser {
            id: format!("usr-sale-{}", idx + 1),
            username: uname.to_string(),
            password_hash: hash_password("123456", &format!("bsnsalt2026sale{}", idx + 1)),
            password_display: "123456".to_string(),
            telesale_name: nfc_trim(tname),
            full_name: format!("Telesale {}", nfc_trim(tname)),
            role: "telesale".to_string(),
            active: true,
            permissions: UserPermissions::default(),
            created_at: now.clone(),
            updated_at: now.clone(),
            last_login_at: None,
        });
    }

    users
}

pub fn to_client_user(u: &StoredUser, include_password: bool) -> ClientUser {
    ClientUser {
        id: u.id.clone(),
        username: nfc_trim(&u.username),
        telesale_name: nfc_trim(&u.telesale_name).to_uppercase(),
        full_name: nfc_trim(&u.full_name),
        role: if u.role == "admin" {
            "admin".to_string()
        } else {
            "telesale".to_string()
        },
        active: u.active,
        permissions: u.permissions.clone(),
        created_at: u.created_at.clone(),
        updated_at: u.updated_at.clone(),
        last_login_at: u.last_login_at.clone(),
        password_display: if include_password {
            Some(if u.password_display.is_empty() {
                "••••••".to_string()
            } else {
                u.password_display.clone()
            })
        } else {
            None
        },
    }
}

pub fn create_auth_token(user: &StoredUser) -> String {
    let now_ms = Utc::now().timestamp_millis();
    let claims = TokenClaims {
        sub: user.id.clone(),
        username: user.username.clone(),
        role: user.role.clone(),
        iat: now_ms,
        exp: now_ms + TOKEN_TTL_MS,
    };
    let payload_json = serde_json::to_string(&claims).unwrap_or_default();
    let payload_b64 = URL_SAFE_NO_PAD.encode(payload_json.as_bytes());

    let mut mac =
        HmacSha256::new_from_slice(get_auth_secret().as_bytes()).expect("HMAC accepts any key size");
    mac.update(payload_b64.as_bytes());
    let sig_b64 = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());

    format!("{}.{}", payload_b64, sig_b64)
}

pub fn verify_auth_token(token: &str) -> Option<ClientUser> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 2 {
        return None;
    }
    let payload_b64 = parts[0];
    let sig_b64 = parts[1];

    let mut mac =
        HmacSha256::new_from_slice(get_auth_secret().as_bytes()).expect("HMAC accepts any key size");
    mac.update(payload_b64.as_bytes());
    let expected_sig = URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes());
    if sig_b64 != expected_sig {
        return None;
    }

    let decoded_bytes = URL_SAFE_NO_PAD.decode(payload_b64).ok()?;
    let claims: TokenClaims = serde_json::from_slice(&decoded_bytes).ok()?;
    if Utc::now().timestamp_millis() > claims.exp {
        return None;
    }

    let users = load_users();
    let live_user = users.iter().find(|u| u.id == claims.sub)?;
    if !live_user.active || !live_user.permissions.access_crm {
        return None;
    }

    Some(to_client_user(live_user, false))
}

pub fn extract_request_user(headers: &HeaderMap) -> Option<ClientUser> {
    if let Some(auth_val) = headers.get("authorization").and_then(|v| v.to_str().ok()) {
        if let Some(token) = auth_val.strip_prefix("Bearer ") {
            return verify_auth_token(token.trim());
        }
    }

    if let Some(cookie_val) = headers.get("cookie").and_then(|v| v.to_str().ok()) {
        for part in cookie_val.split(';') {
            let trimmed = part.trim();
            if let Some(tok) = trimmed.strip_prefix("crm_bsn_token=") {
                return verify_auth_token(tok);
            }
        }
    }
    None
}

pub fn authenticate_user(username: &str, password: &str) -> Result<(String, ClientUser), String> {
    let clean_u = nfc_trim(username).to_lowercase();
    if clean_u.is_empty() || password.is_empty() {
        return Err("Vui lòng nhập đầy đủ Tên đăng nhập và Mật khẩu".to_string());
    }

    let mut users = load_users();
    let user_idx = users
        .iter()
        .position(|u| nfc_trim(&u.username).to_lowercase() == clean_u)
        .ok_or_else(|| "Tên đăng nhập hoặc mật khẩu không chính xác".to_string())?;

    let valid = verify_password(password, &users[user_idx].password_hash)
        || (!users[user_idx].password_display.is_empty()
            && users[user_idx].password_display == password);
    if !valid {
        return Err("Tên đăng nhập hoặc mật khẩu không chính xác".to_string());
    }

    if !users[user_idx].active || !users[user_idx].permissions.access_crm {
        return Err(
            "Tài khoản của bạn đã bị khóa hoặc chưa được cấp quyền vào CRM".to_string(),
        );
    }

    users[user_idx].last_login_at = Some(Utc::now().to_rfc3339());
    let token = create_auth_token(&users[user_idx]);
    let client_user = to_client_user(&users[user_idx], false);
    save_users(&users);

    Ok((token, client_user))
}

pub fn get_active_telesale_names() -> Vec<String> {
    let users = load_users();
    let mut names = Vec::new();
    for u in users {
        if !u.active || !u.permissions.access_crm {
            continue;
        }
        let tname = nfc_trim(&u.telesale_name).to_uppercase();
        if tname.is_empty() || tname == "ADMIN" || tname == "QUẢN TRỊ VIÊN" {
            continue;
        }
        if !names.contains(&tname) {
            names.push(tname);
        }
    }
    if names.is_empty() {
        vec![
            "THỊNH".to_string(),
            "PHÚ".to_string(),
            "TELESALE 3".to_string(),
            "TELESALE 4".to_string(),
            "TELESALE 5".to_string(),
        ]
    } else {
        names
    }
}

pub fn create_user(req: AdminUserMutationRequest) -> Result<ClientUser, String> {
    let username = nfc_trim(&req.username.unwrap_or_default())
        .to_lowercase()
        .replace(' ', "");
    let password = nfc_trim(&req.password.unwrap_or_default());
    let role = if req.role.as_deref() == Some("admin") {
        "admin".to_string()
    } else {
        "telesale".to_string()
    };
    let telesale_name = nfc_trim(
        &req.telesale_name
            .unwrap_or_else(|| if role == "admin" { "ADMIN".to_string() } else { username.clone() }),
    )
    .to_uppercase();

    if username.len() < 2 {
        return Err("Tên đăng nhập (User) phải có ít nhất 2 ký tự".to_string());
    }
    if password.len() < 4 {
        return Err("Mật khẩu (Pass) phải có ít nhất 4 ký tự".to_string());
    }

    let mut users = load_users();
    if users
        .iter()
        .any(|u| nfc_trim(&u.username).to_lowercase() == username)
    {
        return Err(format!("Tên đăng nhập \"{}\" đã tồn tại", username));
    }

    let now = Utc::now().to_rfc3339();
    let active = req.active.unwrap_or(true);
    let mut perms = req.permissions.unwrap_or_default();
    perms.access_crm = active;

    let salt = format!("salt{}", Utc::now().timestamp_millis());
    let new_user = StoredUser {
        id: format!("usr-{}", Utc::now().timestamp_millis()),
        username,
        password_hash: hash_password(&password, &salt),
        password_display: password,
        telesale_name: telesale_name.clone(),
        full_name: req.full_name.unwrap_or(telesale_name),
        role,
        active,
        permissions: perms,
        created_at: now.clone(),
        updated_at: now,
        last_login_at: None,
    };

    let client = to_client_user(&new_user, true);
    users.push(new_user);
    save_users(&users);
    Ok(client)
}

pub fn update_user(user_id: &str, req: AdminUserMutationRequest) -> Result<ClientUser, String> {
    let mut users = load_users();
    let idx = users
        .iter()
        .position(|u| u.id == user_id)
        .ok_or_else(|| "Không tìm thấy tài khoản cần cập nhật".to_string())?;

    if let Some(uname) = req.username {
        let next_u = nfc_trim(&uname).to_lowercase().replace(' ', "");
        if next_u.len() < 2 {
            return Err("Tên đăng nhập phải có ít nhất 2 ký tự".to_string());
        }
        if users
            .iter()
            .any(|u| u.id != user_id && nfc_trim(&u.username).to_lowercase() == next_u)
        {
            return Err(format!("Tên đăng nhập \"{}\" đã được sử dụng", next_u));
        }
        users[idx].username = next_u;
    }

    if let Some(pass) = req.password {
        let next_p = nfc_trim(&pass);
        if !next_p.is_empty() {
            if next_p.len() < 4 {
                return Err("Mật khẩu mới phải có ít nhất 4 ký tự".to_string());
            }
            let salt = format!("salt{}", Utc::now().timestamp_millis());
            users[idx].password_hash = hash_password(&next_p, &salt);
            users[idx].password_display = next_p;
        }
    }

    if let Some(tname) = req.telesale_name {
        users[idx].telesale_name = nfc_trim(&tname).to_uppercase();
    }

    if let Some(role) = req.role {
        users[idx].role = if role == "admin" {
            "admin".to_string()
        } else {
            "telesale".to_string()
        };
    }

    if let Some(active) = req.active {
        users[idx].active = active;
        users[idx].permissions.access_crm = active;
    }

    if let Some(perms) = req.permissions {
        users[idx].permissions = perms;
        users[idx].active = users[idx].permissions.access_crm;
    }

    users[idx].updated_at = Utc::now().to_rfc3339();
    let updated_client = to_client_user(&users[idx], true);
    save_users(&users);
    Ok(updated_client)
}

pub fn delete_user(user_id: &str, acting_admin_id: &str) -> Result<(), String> {
    if user_id == acting_admin_id {
        return Err("Không thể tự xóa tài khoản Admin đang đăng nhập".to_string());
    }
    let mut users = load_users();
    let initial_len = users.len();
    users.retain(|u| u.id != user_id);
    if users.len() == initial_len {
        return Err("Không tìm thấy tài khoản cần xóa".to_string());
    }
    save_users(&users);
    Ok(())
}

pub fn filter_crm_data_for_user(mut data: CrmPayload, user: &ClientUser) -> CrmPayload {
    data.telesale_list = get_active_telesale_names();
    data.current_user = Some(user.clone());

    if user.role == "admin" || user.permissions.data_scope == "all" {
        return data;
    }

    let my_name = nfc_trim(&user.telesale_name).to_uppercase();
    let scope = user.permissions.data_scope.as_str();

    for sheet in data.sheets.values_mut() {
        sheet.records.retain(|rec| {
            let assigned = nfc_trim(&rec.telesale).to_uppercase();
            if scope == "own_only" {
                !assigned.is_empty() && assigned == my_name
            } else {
                assigned.is_empty() || assigned == my_name
            }
        });
    }

    data
}
