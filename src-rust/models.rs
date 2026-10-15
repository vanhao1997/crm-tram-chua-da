use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CareNoteItem {
    pub col: Option<String>,
    pub text: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LeadRecord {
    pub id: String,
    pub sheet_key: String,
    pub sheet_row_index: usize,
    pub stt: String,
    pub data_date: String,
    pub data_date_iso: String,
    pub month_key: String,
    pub section: String,
    pub name: String,
    pub raw_phone: String,
    pub phone: String,
    pub phone_display: String,
    pub has_valid_phone: bool,
    pub service: String,
    pub source: String,
    pub customer_info: String,
    pub status: String,
    pub canonical_status: String,
    pub status_label: String,
    pub status_group: String,
    pub badge_color: String,
    pub appt_time: String,
    pub appt_date: String,
    pub appt_date_iso: String,
    pub telesale: String,
    pub note_m: String,
    pub care_history: Vec<CareNoteItem>,
    pub day_of_week: String,
    pub updated_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SheetData {
    pub key: String,
    pub name: String,
    pub short_name: String,
    pub records: Vec<LeadRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusOption {
    pub value: String,
    pub label: String,
    pub group: String,
    pub color: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrmPayload {
    pub ok: bool,
    pub engine: String,
    pub fetched_at: String,
    pub telesale_list: Vec<String>,
    pub status_options: Vec<StatusOption>,
    pub quick_note_templates: Vec<String>,
    pub sheets: HashMap<String, SheetData>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub current_user: Option<ClientUser>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UserPermissions {
    #[serde(default = "default_true")]
    pub access_crm: bool,
    #[serde(default = "default_true")]
    pub can_edit: bool,
    #[serde(default = "default_true")]
    pub can_send_telegram: bool,
    #[serde(default = "default_scope")]
    pub data_scope: String, // "all" | "own_and_unassigned" | "own_only"
}

fn default_true() -> bool {
    true
}

fn default_scope() -> String {
    "all".to_string()
}

impl Default for UserPermissions {
    fn default() -> Self {
        Self {
            access_crm: true,
            can_edit: true,
            can_send_telegram: true,
            data_scope: "all".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredUser {
    pub id: String,
    pub username: String,
    pub password_hash: String,
    #[serde(default)]
    pub password_display: String,
    pub telesale_name: String,
    #[serde(default)]
    pub full_name: String,
    pub role: String, // "admin" | "telesale"
    pub active: bool,
    #[serde(default)]
    pub permissions: UserPermissions,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default)]
    pub last_login_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClientUser {
    pub id: String,
    pub username: String,
    pub telesale_name: String,
    pub full_name: String,
    pub role: String,
    pub active: bool,
    pub permissions: UserPermissions,
    pub created_at: String,
    pub updated_at: String,
    pub last_login_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password_display: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoginRequest {
    pub username: String,
    pub password: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminUserMutationRequest {
    pub id: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
    pub telesale_name: Option<String>,
    pub full_name: Option<String>,
    pub role: Option<String>,
    pub active: Option<bool>,
    pub permissions: Option<UserPermissions>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionFields {
    pub customer_info: Option<String>,
    pub status: Option<String>,
    pub appt_time: Option<String>,
    pub appt_date: Option<String>,
    pub telesale: Option<String>,
    pub note_m: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InteractionUpdateRequest {
    #[serde(default = "default_mkt")]
    pub sheet_key: String,
    pub sheet_row_index: usize,
    pub phone: Option<String>,
    pub name: Option<String>,
    #[serde(default)]
    pub updates: InteractionFields,
}

fn default_mkt() -> String {
    "mkt".to_string()
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramReminderRequest {
    pub range: Option<String>,
    pub custom_date: Option<String>,
}
