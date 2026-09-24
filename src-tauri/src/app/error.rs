use std::fmt;

/// Shared application-level error type for the `app` composition layer.
///
/// Command and service layers currently return `Result<T, String>`; this
/// type exists as the error surface for the `app` module itself and as a
/// stepping stone for later steps of the extraction to adopt.
#[derive(Debug, Clone, serde::Serialize)]
pub struct AppError(pub String);

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.0)
    }
}

impl std::error::Error for AppError {}

impl From<String> for AppError {
    fn from(value: String) -> Self {
        AppError(value)
    }
}

impl From<&str> for AppError {
    fn from(value: &str) -> Self {
        AppError(value.to_string())
    }
}
