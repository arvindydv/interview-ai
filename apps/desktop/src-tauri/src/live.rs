//! Client side of WS /v1/live/:sessionId (spec §3.5): heartbeat RTT (E6), reconnect with backoff
//! (B4), and time-to-first-token measured here, where the orchestrator will send questions from.

use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

use futures_util::{SinkExt, StreamExt};
use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use tauri::async_runtime::JoinHandle;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::{client::IntoClientRequest, http::header, Message};

use crate::{auth::Auth, config};

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub state: &'static str,
    pub session_id: Option<String>,
    pub rtt_ms: Option<u64>,
    pub error: Option<String>,
}

#[derive(Default)]
struct Inner {
    status: LiveStatus,
    tx: Option<mpsc::UnboundedSender<String>>,
    task: Option<JoinHandle<()>>,
    asked_at: HashMap<String, Instant>,
}

#[derive(Clone, Default)]
pub struct Live(Arc<Mutex<Inner>>);

impl Live {
    pub fn status(&self) -> LiveStatus {
        let s = self.0.lock().unwrap().status.clone();
        if s.state.is_empty() { LiveStatus { state: "disconnected", ..s } } else { s }
    }

    fn set_status(&self, app: &AppHandle, status: LiveStatus) {
        self.0.lock().unwrap().status = status.clone();
        let _ = app.emit("live:status", status);
    }

    fn patch_status(&self, app: &AppHandle, f: impl FnOnce(&mut LiveStatus)) {
        let mut s = self.status();
        f(&mut s);
        self.set_status(app, s);
    }

    pub fn connect(&self, app: AppHandle) {
        self.disconnect(&app);
        let session_id = format!("dev-{}", &uuid::Uuid::new_v4().simple().to_string()[..8]);
        let (tx, rx) = mpsc::unbounded_channel();
        let this = self.clone();
        let task = tauri::async_runtime::spawn(async move { this.run(app, session_id, rx).await });
        let mut inner = self.0.lock().unwrap();
        inner.tx = Some(tx);
        inner.task = Some(task);
    }

    pub fn disconnect(&self, app: &AppHandle) {
        let task = {
            let mut inner = self.0.lock().unwrap();
            inner.tx = None;
            inner.asked_at.clear();
            inner.task.take()
        };
        if let Some(t) = task {
            t.abort();
        }
        self.set_status(app, LiveStatus { state: "disconnected", ..Default::default() });
    }

    fn send(&self, msg: Value) -> Result<(), String> {
        let inner = self.0.lock().unwrap();
        if inner.status.state != "connected" {
            return Err("Live channel is not connected".into());
        }
        inner.tx.as_ref().ok_or("Live channel is not connected")?.send(msg.to_string()).map_err(|e| e.to_string())
    }

    /// Sends a question, optionally with screenshots (base64 JPEGs, spec D3/D4).
    pub fn ask(&self, app: &AppHandle, text: &str, images: Vec<String>) -> Result<String, String> {
        let turn_id = uuid::Uuid::new_v4().to_string();
        let text: String = text.chars().take(4000).collect();
        let image_count = images.len();
        let images: Vec<Value> = images
            .into_iter()
            .map(|data| json!({ "mediaType": "image/jpeg", "data": data }))
            .collect();
        let mut msg = json!({ "type": "ask", "turnId": turn_id, "text": text });
        if !images.is_empty() {
            msg["images"] = Value::Array(images);
        }
        self.send(msg)?;
        self.0.lock().unwrap().asked_at.insert(turn_id.clone(), Instant::now());
        // Lets every window label the answer with its question (and show it in the transcript strip).
        let _ = app.emit("live:asked", json!({ "turnId": turn_id, "text": text, "imageCount": image_count }));
        Ok(turn_id)
    }

    pub fn cancel(&self, turn_id: &str) -> Result<(), String> {
        self.0.lock().unwrap().asked_at.remove(turn_id);
        self.send(json!({ "type": "cancel", "turnId": turn_id }))
    }

    async fn run(self, app: AppHandle, session_id: String, mut rx: mpsc::UnboundedReceiver<String>) {
        let mut attempts: u32 = 0;
        loop {
            let state = if attempts == 0 { "connecting" } else { "reconnecting" };
            self.set_status(&app, LiveStatus { state, session_id: Some(session_id.clone()), ..Default::default() });

            if let Err(error) = self.session(&app, &session_id, &mut rx, &mut attempts).await {
                log::warn!("live channel: {error}");
                self.patch_status(&app, |s| s.error = Some(error));
            }
            // Exponential backoff capped at 10 s.
            let delay = Duration::from_millis((500u64 << attempts.min(5)).min(10_000));
            attempts += 1;
            self.patch_status(&app, |s| {
                s.state = "reconnecting";
                s.rtt_ms = None;
            });
            tokio::time::sleep(delay).await;
        }
    }

    /// One connection lifetime. Returns when the socket closes or fails.
    async fn session(
        &self,
        app: &AppHandle,
        session_id: &str,
        rx: &mut mpsc::UnboundedReceiver<String>,
        attempts: &mut u32,
    ) -> Result<(), String> {
        let token = app.state::<Auth>().access_token().await.map_err(|e| e.to_string())?;
        let url = format!("{}/v1/live/{session_id}", config::API_URL.replacen("http", "ws", 1));
        let mut req = url.into_client_request().map_err(|e| e.to_string())?;
        req.headers_mut().insert(
            header::AUTHORIZATION,
            format!("Bearer {token}").parse().map_err(|_| "bad token".to_string())?,
        );
        let (ws, _) = tokio_tungstenite::connect_async(req).await.map_err(|e| e.to_string())?;
        let (mut write, mut read) = ws.split();
        *attempts = 0;
        self.set_status(app, LiveStatus { state: "connected", session_id: Some(session_id.into()), ..Default::default() });

        let started = Instant::now();
        let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
        loop {
            tokio::select! {
                incoming = read.next() => match incoming {
                    Some(Ok(Message::Text(text))) => self.on_message(app, text.as_str(), started),
                    Some(Ok(Message::Close(_))) | None => return Err("Connection closed".into()),
                    Some(Err(e)) => return Err(e.to_string()),
                    Some(Ok(_)) => {}
                },
                Some(out) = rx.recv() => {
                    write.send(Message::text(out)).await.map_err(|e| e.to_string())?;
                }
                _ = heartbeat.tick() => {
                    let t = started.elapsed().as_millis() as u64;
                    let ping = json!({ "type": "ping", "t": t }).to_string();
                    write.send(Message::text(ping)).await.map_err(|e| e.to_string())?;
                }
            }
        }
    }

    fn on_message(&self, app: &AppHandle, text: &str, started: Instant) {
        let Ok(mut msg) = serde_json::from_str::<Value>(text) else { return };
        match msg["type"].as_str() {
            Some("pong") => {
                // `t` is our own monotonic timestamp echoed back, so no clock skew.
                if let Some(t) = msg["t"].as_u64() {
                    let rtt = (started.elapsed().as_millis() as u64).saturating_sub(t);
                    self.patch_status(app, |s| s.rtt_ms = Some(rtt));
                }
            }
            Some("token") => {
                let turn = msg["turnId"].as_str().unwrap_or_default().to_owned();
                if let Some(at) = self.0.lock().unwrap().asked_at.remove(&turn) {
                    msg["ttftMs"] = json!(at.elapsed().as_millis() as u64);
                }
            }
            Some("done") | Some("error") => {
                if let Some(turn) = msg["turnId"].as_str() {
                    self.0.lock().unwrap().asked_at.remove(turn);
                }
            }
            _ => {}
        }
        let _ = app.emit("live:message", msg);
    }
}
