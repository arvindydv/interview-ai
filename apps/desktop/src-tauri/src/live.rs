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

use crate::{
    audio::{self, Capture, Source},
    auth::Auth,
    config,
};

#[derive(Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct LiveStatus {
    pub state: &'static str,
    pub session_id: Option<String>,
    pub rtt_ms: Option<u64>,
    pub error: Option<String>,
}

/// Capture state of one audio source, as shown on the overlay.
#[derive(Clone, Serialize)]
pub struct SourceStatus {
    /// The user wants this source (toggled on the overlay).
    pub enabled: bool,
    /// "off", "starting", "on" (capturing) or "error".
    pub state: &'static str,
    pub error: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStatus {
    pub interviewer: SourceStatus,
    pub you: SourceStatus,
    /// Answer finished interviewer questions without a key press.
    pub auto_answer: bool,
}

impl Default for AudioStatus {
    fn default() -> Self {
        let on = || SourceStatus { enabled: true, state: "off", error: None };
        Self { interviewer: on(), you: on(), auto_answer: true }
    }
}

impl AudioStatus {
    fn source(&mut self, source: Source) -> &mut SourceStatus {
        match source {
            Source::Interviewer => &mut self.interviewer,
            Source::You => &mut self.you,
        }
    }

    /// The `listen` message: transcribe the sources that are actually capturing.
    fn listen_message(&self) -> String {
        let sources: Vec<&str> = Source::ALL
            .into_iter()
            .filter(|s| match s {
                Source::Interviewer => self.interviewer.state == "on",
                Source::You => self.you.state == "on",
            })
            .map(Source::name)
            .collect();
        json!({ "type": "listen", "sources": sources, "autoAnswer": self.auto_answer }).to_string()
    }
}

enum Outgoing {
    Text(String),
    Audio(Vec<u8>),
}

#[derive(Default)]
struct Inner {
    status: LiveStatus,
    tx: Option<mpsc::UnboundedSender<Outgoing>>,
    task: Option<JoinHandle<()>>,
    asked_at: HashMap<String, Instant>,
    audio: AudioStatus,
    captures: HashMap<Source, Capture>,
    /// Bumped on every connect/disconnect, so a capture that finishes opening late can tell it is stale.
    generation: u64,
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
        let task = tauri::async_runtime::spawn({
            let app = app.clone();
            async move { this.run(app, session_id, rx).await }
        });
        {
            let mut inner = self.0.lock().unwrap();
            inner.tx = Some(tx);
            inner.task = Some(task);
            inner.generation += 1;
        }
        // The interview is live: start listening.
        self.sync_audio(&app);
    }

    pub fn disconnect(&self, app: &AppHandle) {
        let (task, captures) = {
            let mut inner = self.0.lock().unwrap();
            inner.tx = None;
            inner.asked_at.clear();
            inner.generation += 1;
            for s in Source::ALL {
                let status = inner.audio.source(s);
                status.state = "off";
                status.error = None;
            }
            (inner.task.take(), std::mem::take(&mut inner.captures))
        };
        if let Some(t) = task {
            t.abort();
        }
        drop(captures);
        self.emit_audio(app);
        self.set_status(app, LiveStatus { state: "disconnected", ..Default::default() });
    }

    // ---- audio ----------------------------------------------------------------------------------

    pub fn audio_status(&self) -> AudioStatus {
        self.0.lock().unwrap().audio.clone()
    }

    fn emit_audio(&self, app: &AppHandle) {
        let _ = app.emit("audio:status", self.audio_status());
    }

    /// Turns sources on or off and sets auto-answer (overlay toggles).
    pub fn set_audio(&self, app: &AppHandle, interviewer: bool, you: bool, auto_answer: bool) {
        {
            let mut inner = self.0.lock().unwrap();
            inner.audio.interviewer.enabled = interviewer;
            inner.audio.you.enabled = you;
            inner.audio.auto_answer = auto_answer;
        }
        self.sync_audio(app);
    }

    /// Starts or stops captures to match what's enabled, while a session is running. Device opening
    /// can block, so it happens on a blocking thread.
    fn sync_audio(&self, app: &AppHandle) {
        let (start, stop, generation) = {
            let mut inner = self.0.lock().unwrap();
            let in_session = inner.tx.is_some();
            let mut start = Vec::new();
            let mut stop = Vec::new();
            for s in Source::ALL {
                let wanted = in_session && inner.audio.source(s).enabled;
                let running = inner.captures.contains_key(&s);
                if wanted && !running && inner.audio.source(s).state != "starting" {
                    inner.audio.source(s).state = "starting";
                    inner.audio.source(s).error = None;
                    start.push(s);
                } else if !wanted && running {
                    stop.extend(inner.captures.remove(&s));
                    inner.audio.source(s).state = "off";
                } else if !wanted {
                    inner.audio.source(s).state = "off";
                    inner.audio.source(s).error = None;
                }
            }
            (start, stop, inner.generation)
        };
        drop(stop);
        self.emit_audio(app);
        self.send_listen();
        for source in start {
            let (this, app) = (self.clone(), app.clone());
            tauri::async_runtime::spawn_blocking(move || this.start_capture(&app, source, generation));
        }
    }

    fn start_capture(&self, app: &AppHandle, source: Source, generation: u64) {
        let sink: audio::Sink = {
            let this = self.clone();
            std::sync::Arc::new(move |frame| this.send_audio(frame))
        };
        let on_fail: audio::OnFail = {
            let (this, app) = (self.clone(), app.clone());
            Box::new(move |error| this.capture_failed(&app, source, generation, error))
        };
        let result = audio::start(source, sink, on_fail);
        {
            let mut inner = self.0.lock().unwrap();
            if inner.generation != generation || !inner.audio.source(source).enabled {
                return; // the session ended (or the source was turned off) meanwhile; drops the capture
            }
            match result {
                Ok(capture) => {
                    inner.captures.insert(source, capture);
                    inner.audio.source(source).state = "on";
                }
                Err(error) => {
                    log::warn!("audio {}: {error}", source.name());
                    let status = inner.audio.source(source);
                    status.state = "error";
                    status.error = Some(error);
                }
            }
        }
        self.emit_audio(app);
        self.send_listen();
    }

    fn capture_failed(&self, app: &AppHandle, source: Source, generation: u64, error: String) {
        log::warn!("audio {}: {error}", source.name());
        let capture = {
            let mut inner = self.0.lock().unwrap();
            if inner.generation != generation {
                return;
            }
            let status = inner.audio.source(source);
            status.state = "error";
            status.error = Some(error);
            inner.captures.remove(&source)
        };
        // Dropped from another thread: a capture can't join its own thread.
        if let Some(capture) = capture {
            std::thread::spawn(move || drop(capture));
        }
        self.emit_audio(app);
        self.send_listen();
    }

    fn send_audio(&self, frame: Vec<u8>) {
        let inner = self.0.lock().unwrap();
        if inner.status.state == "connected" {
            if let Some(tx) = &inner.tx {
                let _ = tx.send(Outgoing::Audio(frame));
            }
        }
    }

    /// Tells the server which sources to transcribe (also re-sent on every reconnect).
    fn send_listen(&self) {
        let inner = self.0.lock().unwrap();
        if inner.status.state == "connected" {
            if let Some(tx) = &inner.tx {
                let _ = tx.send(Outgoing::Text(inner.audio.listen_message()));
            }
        }
    }

    fn send(&self, msg: Value) -> Result<(), String> {
        let inner = self.0.lock().unwrap();
        if inner.status.state != "connected" {
            return Err("Live channel is not connected".into());
        }
        inner
            .tx
            .as_ref()
            .ok_or("Live channel is not connected")?
            .send(Outgoing::Text(msg.to_string()))
            .map_err(|e| e.to_string())
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

    async fn run(self, app: AppHandle, session_id: String, mut rx: mpsc::UnboundedReceiver<Outgoing>) {
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
        rx: &mut mpsc::UnboundedReceiver<Outgoing>,
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
        // Audio queued before the connection dropped is stale by now; keep anything else.
        let mut pending = Vec::new();
        while let Ok(out) = rx.try_recv() {
            if let Outgoing::Text(text) = out {
                pending.push(text);
            }
        }
        let listen = self.0.lock().unwrap().audio.listen_message();
        for text in std::iter::once(listen).chain(pending) {
            write.send(Message::text(text)).await.map_err(|e| e.to_string())?;
        }
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
                    let msg = match out {
                        Outgoing::Text(text) => Message::text(text),
                        Outgoing::Audio(frame) => Message::binary(frame),
                    };
                    write.send(msg).await.map_err(|e| e.to_string())?;
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
            // A question the server heard and is answering on its own (auto-answer): label it like
            // a question asked from this app.
            Some("question") => {
                let _ = app.emit(
                    "live:asked",
                    json!({ "turnId": msg["turnId"], "text": msg["text"], "imageCount": 0, "auto": true }),
                );
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
