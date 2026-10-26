mod api;
mod audio;
mod auth;
mod config;
mod live;
mod protection;
mod screenshot;
mod store;

use std::sync::atomic::{AtomicBool, Ordering};

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_opener::OpenerExt;

use api::Api;
use auth::{Auth, User};
use live::{AudioStatus, Live, LiveStatus};
use screenshot::{Screenshots, Shot};

#[derive(Clone, Serialize)]
struct AuthState {
    user: Option<User>,
}

type CmdResult<T> = Result<T, String>;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

// ---- commands (called from src/bridge.ts) -------------------------------------------------------

#[tauri::command]
async fn auth_get(auth: State<'_, Auth>) -> CmdResult<AuthState> {
    Ok(AuthState { user: auth.user().await })
}

#[tauri::command]
async fn auth_sign_in(app: AppHandle, auth: State<'_, Auth>, api: State<'_, Api>) -> CmdResult<AuthState> {
    let opener = app.clone();
    let user = auth
        .sign_in(|url| opener.opener().open_url(url, None::<&str>).map_err(Into::into))
        .await
        .map_err(err)?;
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    if let Err(e) = api.register_device(&auth, &app.package_info().version.to_string()).await {
        log::warn!("device registration failed: {e}");
    }
    let state = AuthState { user: Some(user) };
    let _ = app.emit("auth:changed", state.clone());
    Ok(state)
}

#[tauri::command]
async fn auth_sign_out(app: AppHandle, auth: State<'_, Auth>, live: State<'_, Live>) -> CmdResult<()> {
    live.disconnect(&app);
    auth.sign_out().await;
    let _ = app.emit("auth:changed", AuthState { user: None });
    Ok(())
}

#[tauri::command]
async fn api_me(auth: State<'_, Auth>, api: State<'_, Api>) -> CmdResult<Value> {
    api.me(&auth).await.map_err(err)
}

#[tauri::command]
async fn api_health(api: State<'_, Api>) -> CmdResult<Value> {
    api.health().await.map_err(err)
}

#[tauri::command]
async fn profile_resume(auth: State<'_, Auth>, api: State<'_, Api>) -> CmdResult<Value> {
    api.resume(&auth).await.map_err(err)
}

#[tauri::command]
async fn profile_resume_upload(
    auth: State<'_, Auth>,
    api: State<'_, Api>,
    file_name: String,
    mime_type: String,
    data: String,
) -> CmdResult<Value> {
    api.upload_resume(&auth, &file_name, &mime_type, &data).await.map_err(err)
}

#[tauri::command]
async fn profile_resume_delete(auth: State<'_, Auth>, api: State<'_, Api>) -> CmdResult<Value> {
    api.delete_resume(&auth).await.map_err(err)
}

#[tauri::command]
async fn profile_interview(auth: State<'_, Auth>, api: State<'_, Api>) -> CmdResult<Value> {
    api.interview(&auth).await.map_err(err)
}

#[tauri::command]
async fn profile_interview_save(auth: State<'_, Auth>, api: State<'_, Api>, interview: Value) -> CmdResult<Value> {
    api.save_interview(&auth, interview).await.map_err(err)
}

/// Reports an AI-generated answer for review (Microsoft Store policy 11.16).
#[tauri::command]
async fn report_answer(auth: State<'_, Auth>, api: State<'_, Api>, report: api::Report) -> CmdResult<Value> {
    api.report_answer(&auth, &report).await.map_err(err)
}

#[tauri::command]
fn live_connect(app: AppHandle, live: State<'_, Live>) {
    live.connect(app);
}

#[tauri::command]
fn live_disconnect(app: AppHandle, live: State<'_, Live>) {
    live.disconnect(&app);
}

#[tauri::command]
fn live_ask(
    app: AppHandle,
    live: State<'_, Live>,
    shots: State<'_, Screenshots>,
    text: String,
    image_ids: Option<Vec<String>>,
) -> CmdResult<String> {
    show_overlay(&app, false);
    let images = shots.take(&image_ids.unwrap_or_default()).map_err(err)?;
    live.ask(&app, &text, images)
}

/// Captures the screen the overlay is on (spec D1). Where the OS already keeps the overlay out of
/// captures (Windows 10 2004+, macOS ≤14), it stays on screen, so nothing blinks. Elsewhere it is
/// hidden only for the instant of the capture, then restored, even if the capture fails.
#[tauri::command]
async fn screenshot_capture(app: AppHandle) -> CmdResult<Shot> {
    use screenshot::Rect;
    let rect = |m: &tauri::Monitor| Rect {
        x: m.position().x,
        y: m.position().y,
        width: m.size().width,
        height: m.size().height,
    };
    let overlay = app.get_webview_window("overlay");
    let target = overlay
        .as_ref()
        .and_then(|w| w.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten())
        .map(|m| rect(&m));
    let all: Vec<Rect> = app.available_monitors().map(|ms| ms.iter().map(rect).collect()).unwrap_or_default();
    let data_dir = app.path().app_data_dir().map_err(err)?;

    // Opening may show the desktop's screen picker the first time, so do it before hiding anything.
    let source = screenshot::Source::open(target, all, data_dir).await;
    let hide = protection::status().level != "hidden"
        && overlay.as_ref().is_some_and(|w| w.is_visible().unwrap_or(false));
    if hide {
        if let Some(w) = &overlay {
            let _ = w.hide();
        }
        // Give the compositor a frame or two to remove the window before capturing.
        tokio::time::sleep(std::time::Duration::from_millis(120)).await;
    }
    let captured = source.capture().await;
    if hide {
        if let Some(w) = &overlay {
            let _ = w.show();
        }
    }
    let raw = captured.map_err(err)?;
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || handle.state::<Screenshots>().store(raw))
        .await
        .map_err(err)?
        .map_err(err)
}

#[tauri::command]
fn screenshot_discard(shots: State<'_, Screenshots>, id: String) {
    shots.discard(&id);
}

#[tauri::command]
fn live_cancel(live: State<'_, Live>, turn_id: String) -> CmdResult<()> {
    live.cancel(&turn_id)
}

#[tauri::command]
fn live_status(live: State<'_, Live>) -> LiveStatus {
    live.status()
}

#[tauri::command]
fn audio_status(live: State<'_, Live>) -> AudioStatus {
    live.audio_status()
}

/// Overlay toggles: which audio sources to capture, and whether to answer heard questions automatically.
#[tauri::command]
fn audio_set(app: AppHandle, live: State<'_, Live>, interviewer: bool, you: bool, auto_answer: bool) {
    live.set_audio(&app, interviewer, you, auto_answer);
}

#[tauri::command]
fn screen_share_protection() -> protection::Protection {
    protection::status()
}

/// Ends the interview from the overlay: stops the live session and closes the overlay. Brings the
/// main window back, or quits if the user had closed it.
#[tauri::command]
fn overlay_close(app: AppHandle, live: State<'_, Live>) {
    close_overlay(&app, &live);
}

/// Shows the overlay and brings it to the front (unlike toggle, never hides it). The main window
/// steps aside for the interview.
#[tauri::command]
fn overlay_show(app: AppHandle) {
    present_overlay(&app, true);
}

#[tauri::command]
fn overlay_toggle(app: AppHandle) {
    toggle_overlay(&app);
}

#[tauri::command]
fn main_window_show(app: AppHandle) {
    show_main(&app);
}

// ---- main window --------------------------------------------------------------------------------

/// Why the main window is hidden: auto-hidden for the overlay (ending the interview brings it back)
/// or closed by the user (ending the interview quits).
#[derive(Default)]
struct MainWindow {
    closed_by_user: AtomicBool,
}

fn show_main(app: &AppHandle) {
    app.state::<MainWindow>().closed_by_user.store(false, Ordering::Relaxed);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.unminimize();
        let _ = main.show();
        let _ = main.set_focus();
    }
}

#[tauri::command]
fn app_quit(app: AppHandle) {
    app.exit(0);
}

// ---- overlay window (spec E1/E4) ------------------------------------------------------------------

/// Created hidden at startup so it is subscribed before the first answer streams.
fn create_overlay(app: &AppHandle) -> tauri::Result<()> {
    let (width, height) = (960.0, 640.0);
    let mut builder = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("overlay.html".into()))
        .title("Friday AI Overlay")
        .inner_size(width, height)
        .min_inner_size(520.0, 60.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .visible_on_all_workspaces(true)
        .skip_taskbar(true)
        // Excluded from screen capture where the OS supports it (Windows 10 2004+, macOS ≤14).
        .content_protected(true)
        .focused(false)
        .visible(false);
    if let Some(monitor) = app.primary_monitor()? {
        let scale = monitor.scale_factor();
        let size = monitor.size().to_logical::<f64>(scale);
        let pos = monitor.position().to_logical::<f64>(scale);
        // Top-centre, close to where the interviewer's video usually is, so eyes barely move.
        builder = builder.position(pos.x + (size.width - width) / 2.0, pos.y + 24.0);
    }
    builder.build()?;
    Ok(())
}

fn show_overlay(app: &AppHandle, focus: bool) {
    if let Some(w) = app.get_webview_window("overlay") {
        if !w.is_visible().unwrap_or(false) {
            let _ = w.show();
        }
        if focus {
            let _ = w.set_focus();
        }
    }
}

/// Shows the overlay for the interview and hides the main window so only the overlay is on screen.
/// (Asking a warm-up question from the main window uses `show_overlay` and keeps it open.)
fn present_overlay(app: &AppHandle, focus: bool) {
    show_overlay(app, focus);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
}

/// Global shortcut → overlay command ("answer", "screenshot", "chat").
fn overlay_command(app: &AppHandle, command: &str) {
    present_overlay(app, command == "chat" || command == "screenshot");
    let _ = app.emit_to("overlay", "overlay:command", command);
}

fn close_overlay(app: &AppHandle, live: &Live) {
    live.disconnect(app);
    if let Some(w) = app.get_webview_window("overlay") {
        let _ = w.hide();
    }
    if app.state::<MainWindow>().closed_by_user.load(Ordering::Relaxed) {
        app.exit(0);
    } else {
        show_main(app);
    }
}

/// Closing the main window during an interview only hides it, so the overlay keeps working (and
/// "Open Friday AI" can bring the window back). With no interview running, closing it quits, so no
/// invisible process is left behind. Closing the overlay itself (e.g. Alt+F4) ends the interview.
fn on_close_requested(window: &tauri::Window, api: &tauri::CloseRequestApi) {
    let app = window.app_handle();
    match window.label() {
        "main" => {
            let overlay_visible = app
                .get_webview_window("overlay")
                .is_some_and(|w| w.is_visible().unwrap_or(false));
            let in_session = app.state::<Live>().status().state != "disconnected";
            if overlay_visible || in_session {
                api.prevent_close();
                app.state::<MainWindow>().closed_by_user.store(true, Ordering::Relaxed);
                let _ = window.hide();
            } else {
                app.exit(0);
            }
        }
        "overlay" => {
            api.prevent_close();
            close_overlay(app, &app.state::<Live>());
        }
        _ => {}
    }
}

fn toggle_overlay(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("overlay") {
        if w.is_visible().unwrap_or(false) {
            let _ = w.hide();
        } else {
            present_overlay(app, false);
        }
    }
}

// ---- app --------------------------------------------------------------------------------------------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default()
        // Must be first: a second launch focuses the running app instead of starting another.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| show_main(app)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(
            tauri_plugin_log::Builder::new()
                .level(if cfg!(debug_assertions) { log::LevelFilter::Info } else { log::LevelFilter::Warn })
                .build(),
        );

    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};
        let parse = |s: &str| s.parse::<Shortcut>().expect("valid shortcut");
        let (toggle, answer, screenshot, chat) = (
            parse(config::SHORTCUT_TOGGLE),
            parse(config::SHORTCUT_ANSWER),
            parse(config::SHORTCUT_SCREENSHOT),
            parse(config::SHORTCUT_CHAT),
        );
        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state != ShortcutState::Pressed {
                        return;
                    }
                    if *shortcut == toggle {
                        toggle_overlay(app);
                    } else if *shortcut == answer {
                        overlay_command(app, "answer");
                    } else if *shortcut == screenshot {
                        overlay_command(app, "screenshot");
                    } else if *shortcut == chat {
                        overlay_command(app, "chat");
                    }
                })
                .build(),
        );
    }

    builder
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                on_close_requested(window, api);
            }
        })
        .setup(|app| {
            // No Dock icon or menu bar on macOS: the app lives only in its windows and hotkeys.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let http = reqwest::Client::builder()
                .user_agent(format!("Friday AI/{}", app.package_info().version))
                .connect_timeout(std::time::Duration::from_secs(5))
                .timeout(std::time::Duration::from_secs(15))
                .build()?;
            app.manage(Auth::new(http.clone(), store::SecureStore::new(&data_dir)));
            app.manage(Api::new(http, &data_dir));
            app.manage(Live::default());
            app.manage(Screenshots::default());
            app.manage(MainWindow::default());

            create_overlay(app.handle())?;

            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                // Global hotkeys are unavailable on some Linux Wayland sessions; the buttons still work.
                for key in [
                    config::SHORTCUT_TOGGLE,
                    config::SHORTCUT_ANSWER,
                    config::SHORTCUT_SCREENSHOT,
                    config::SHORTCUT_CHAT,
                ] {
                    if let Err(e) = app.global_shortcut().register(key) {
                        log::warn!("could not register {key}: {e}");
                    }
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_get,
            auth_sign_in,
            auth_sign_out,
            api_me,
            api_health,
            profile_resume,
            profile_resume_upload,
            profile_resume_delete,
            profile_interview,
            profile_interview_save,
            report_answer,
            live_connect,
            live_disconnect,
            live_ask,
            live_cancel,
            live_status,
            audio_status,
            audio_set,
            screenshot_capture,
            screen_share_protection,
            screenshot_discard,
            overlay_toggle,
            overlay_show,
            overlay_close,
            main_window_show,
            app_quit,
        ])
        .build(tauri::generate_context!())
        .expect("error while building Friday AI")
        .run(|_app, _event| {
            // macOS: launching the app again while the main window is hidden (closed during an
            // interview) brings it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                show_main(_app);
            }
        });
}
