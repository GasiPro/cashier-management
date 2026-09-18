use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AccountStatus {
    Active,
    Suspended,
}

impl Default for AccountStatus {
    fn default() -> Self {
        AccountStatus::Active
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum UserType {
    Admin,
    Caissier,
    Comptoir,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ActivityKind {
    Created,
    Suspended,
    Reactivated,
    Modified,
}

impl ActivityKind {
    pub fn label(self) -> &'static str {
        match self {
            ActivityKind::Created => "Création",
            ActivityKind::Suspended => "Suspension",
            ActivityKind::Reactivated => "Réactivation",
            ActivityKind::Modified => "Modification",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AccountActivityEntry {
    pub kind: ActivityKind,
    pub timestamp: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

/// Command-boundary view of an history entry: the UI binds `at`, the file
/// format keeps `timestamp`.
#[derive(Debug, Clone, Serialize)]
pub struct AccountHistoryView {
    pub kind: ActivityKind,
    pub at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
}

impl From<&AccountActivityEntry> for AccountHistoryView {
    fn from(entry: &AccountActivityEntry) -> Self {
        Self {
            kind: entry.kind,
            at: entry.timestamp.clone(),
            reason: entry.reason.clone(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StoredAccount {
    pub id: String,
    pub username: String,
    #[serde(default)]
    pub display_name: String,
    pub password_hash: String,
    pub user_type: UserType,
    #[serde(default)]
    pub status: AccountStatus,
    pub created_at: String,
    #[serde(default)]
    pub last_sign_in_at: Option<String>,
    #[serde(default)]
    pub history: Vec<AccountActivityEntry>,
}

/// Command-boundary view of an account. Storage keeps the opaque string id
/// (`StoredAccount.id`); the UI binds a number, so the string is folded into a
/// stable positive integer via `numeric_id`.
#[derive(Debug, Clone, Serialize)]
pub struct Account {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub user_type: UserType,
    pub status: AccountStatus,
    pub created_at: String,
    pub last_sign_in_at: Option<String>,
    pub history: Vec<AccountHistoryView>,
}

#[derive(Debug, Clone, Serialize)]
pub struct AccountActivity {
    pub id: i64,
    pub account_username: String,
    pub action: String,
    pub detail: String,
    pub at: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct AuthResult {
    pub success: bool,
    pub account: Option<Account>,
    pub error: Option<String>,
    pub session_token: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SessionRole {
    Admin,
    Cashier,
    Counter,
}

#[derive(Debug, Clone)]
pub struct SessionInfo {
    pub username: String,
    pub role: SessionRole,
    pub expires_at: i64,
}
