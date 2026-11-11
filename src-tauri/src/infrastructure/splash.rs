use std::time::Duration;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
const MAIN_LABEL: &str = "main";
const SPLASH_LABEL: &str = "splash";
const SPLASH_PAGE: &str = "splash.html";
const SPLASH_WIDTH: f64 = 800.0;
const SPLASH_HEIGHT: f64 = 500.0;
const SPLASH_MAX_DURATION: Duration = Duration::from_secs(30);
pub fn open(app: &AppHandle) -> tauri::Result<()> {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        main.hide()?;
    }
    let splash = WebviewWindowBuilder::new(app, SPLASH_LABEL, WebviewUrl::App(SPLASH_PAGE.into()))
        .title("GasiPro")
        .inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .min_inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .max_inner_size(SPLASH_WIDTH, SPLASH_HEIGHT)
        .center()
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .decorations(false)
        .skip_taskbar(true)
        .always_on_top(true)
        .focused(true)
        .build()?;
    splash.on_window_event(|event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
        }
    });
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
pub fn close(app: &AppHandle) -> tauri::Result<()> {
    if let Some(main) = app.get_webview_window(MAIN_LABEL) {
        main.show()?;
        main.set_focus()?;
    }
    if let Some(splash) = app.get_webview_window(SPLASH_LABEL) {
        splash.destroy()?;
    }
    Ok(())
}
