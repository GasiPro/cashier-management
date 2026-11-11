use crate::models::report::Report;
use crate::repositories::report_repository;
use chrono::Utc;
use std::sync::{Arc, Mutex as SyncMutex};
use tauri::AppHandle;

pub type ReportStore = Arc<SyncMutex<Vec<Report>>>;

pub fn load(app: &AppHandle) -> Vec<Report> {
    report_repository::load(app)
}

pub fn list_reports(reports: &ReportStore) -> Vec<Report> {
    reports.lock().unwrap().iter().rev().cloned().collect()
}

pub fn submit_report(
    app: &AppHandle,
    reports: &ReportStore,
    cashier_username: String,
    payload: serde_json::Value,
) -> Result<(), String> {
    let cashier_username = cashier_username.trim().to_string();
    if cashier_username.is_empty() {
        return Err("Le caissier à l'origine du rapport est inconnu.".to_string());
    }
    if !payload.is_object() {
        return Err("Contenu du rapport invalide.".to_string());
    }
    let mut guard = reports.lock().unwrap();
    let id = guard.iter().map(|report| report.id).max().unwrap_or(0) + 1;
    guard.push(Report {
        id,
        cashier_username,
        created_at: Utc::now().to_rfc3339(),
        payload,
    });
    if let Err(err) = report_repository::save(app, &guard) {
        guard.pop();
        return Err(format!("Échec de l'enregistrement du rapport : {err}"));
    }
    Ok(())
}
