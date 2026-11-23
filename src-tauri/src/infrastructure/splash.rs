use std::sync::Mutex;
use std::time::Duration;
use tauri::{
    AppHandle, LogicalSize, Manager, PhysicalSize, Size, WebviewUrl, WebviewWindowBuilder, WindowEvent,
};
const MAIN_LABEL: &str = "main";
const SPLASH_LABEL: &str = "splash";
const SPLASH_PAGE: &str = "splash.html";
const SPLASH_WIDTH: f64 = 800.0;
const SPLASH_HEIGHT: f64 = 500.0;
const SPLASH_MAX_DURATION: Duration = Duration::from_secs(30);
struct SavedWindow {
    size: PhysicalSize<u32>,
    maximized: bool,
}
static SAVED_MAIN_WINDOW: Mutex<Option<SavedWindow>> = Mutex::new(None);
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
pub fn begin_setup(app: &AppHandle) -> tauri::Result<()> {
    let Some(main) = app.get_webview_window(MAIN_LABEL) else {
        return Ok(());
    };
    let mut saved = SAVED_MAIN_WINDOW.lock().unwrap_or_else(|e| e.into_inner());
    if saved.is_some() {
        return Ok(());
    }
    *saved = Some(SavedWindow {
        size: main.inner_size()?,
        maximized: main.is_maximized()?,
    });
    let size = Size::Logical(LogicalSize::new(SPLASH_WIDTH, SPLASH_HEIGHT));
    main.unmaximize()?;
    main.set_min_size(Some(size.clone()))?;
    main.set_max_size(Some(size.clone()))?;
    main.set_size(size)?;
    main.set_resizable(false)?;
    main.set_maximizable(false)?;
    main.center()
}
pub fn end_setup(app: &AppHandle) -> tauri::Result<()> {
    let saved = SAVED_MAIN_WINDOW.lock().unwrap_or_else(|e| e.into_inner()).take();
    let (Some(saved), Some(main)) = (saved, app.get_webview_window(MAIN_LABEL)) else {
        return Ok(());
    };
    main.set_resizable(true)?;
    main.set_maximizable(true)?;
    main.set_min_size(None::<Size>)?;
    main.set_max_size(None::<Size>)?;
    if saved.maximized {
        main.maximize()
    } else {
        if saved.size.width > 0 && saved.size.height > 0 {
            main.set_size(Size::Physical(saved.size))?;
        }
        main.center()
    }
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
