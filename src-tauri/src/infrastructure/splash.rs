use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

const MAIN_LABEL: &str = "main";
const SPLASH_LABEL: &str = "splash";
const SPLASH_PAGE: &str = "splash.html";
const SPLASH_WIDTH: f64 = 720.0;
const SPLASH_HEIGHT: f64 = 420.0;
/// Safety net: the main window is revealed even if the frontend never reports it is ready.
const SPLASH_MAX_DURATION: Duration = Duration::from_secs(30);

/// Hides the main window and opens a small, centered, fixed-size splash window in its place.
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        main.hide()?;
    }
    WebviewWindowBuilder::new(app, SPLASH_LABEL, WebviewUrl::App(SPLASH_PAGE.into()))
        .title("GasiPro")
        .inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .center()
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .build()?;
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(SPLASH_MAX_DURATION);
        if handle.get_webview_window(SPLASH_LABEL).is_some() {
            if let Err(err) = close(&handle) {
                log::error!("Échec de la fermeture de l'écran de démarrage : {err}");
            }
        }
    });
    Ok(())
}

/// Shows the main window, then closes the splash window (if still open).
pub fn close(app: &AppHandle) -> tauri::Result<()> {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        main.show()?;
        main.set_focus()?;
    }
    if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
        splash.close()?;
    }
    Ok(())
}
