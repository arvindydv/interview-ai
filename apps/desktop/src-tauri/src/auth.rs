//! Desktop sign-in (spec A1) and Supabase session management.
//!
//! The app never sees a password: it opens the website's /login page in the system browser, and the
//! website hands a fresh session back to a one-shot HTTP listener on 127.0.0.1 (RFC 8252 loopback
//! redirect, which works the same on Windows, macOS and every Linux distro without registering a
//! URL scheme). A random `state` ties the callback to the attempt that started it.

use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use anyhow::{anyhow, bail, Context, Result};
use serde::{Deserialize, Serialize};
use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Mutex, Notify},
};

use crate::{config, store::SecureStore};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct User {
    pub id: String,
    pub email: String,
}

#[derive(Clone, Debug)]
struct Session {
    access_token: String,
    refresh_token: String,
    expires_at: u64,
    user: User,
}

#[derive(Deserialize)]
struct TokenResponse {
    access_token: String,
    refresh_token: String,
    expires_at: Option<u64>,
    expires_in: Option<u64>,
    user: SupabaseUser,
}

#[derive(Deserialize)]
struct SupabaseUser {
    id: String,
    email: Option<String>,
}

impl From<SupabaseUser> for User {
    fn from(u: SupabaseUser) -> Self {
        Self { id: u.id, email: u.email.unwrap_or_default() }
    }
}

pub struct Auth {
    http: reqwest::Client,
    store: SecureStore,
    /// Also serialises refreshes: Supabase rotates refresh tokens, so two concurrent refreshes with
    /// the same token would revoke the session.
    session: Mutex<Option<Session>>,
    /// Signals an in-flight sign-in to give up when a new one starts.
    pending: Mutex<Option<Arc<Notify>>>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

impl Auth {
    pub fn new(http: reqwest::Client, store: SecureStore) -> Self {
        Self { http, store, session: Mutex::new(None), pending: Mutex::new(None) }
    }

    /// Current user, restoring the stored session on first use.
    pub async fn user(&self) -> Option<User> {
        self.access_token().await.ok()?;
        self.session.lock().await.as_ref().map(|s| s.user.clone())
    }

    /// A valid access token, refreshing it (or restoring from the credential store) when needed.
    pub async fn access_token(&self) -> Result<String> {
        let mut guard = self.session.lock().await;
        if let Some(s) = guard.as_ref() {
            if s.expires_at > now() + 60 {
                return Ok(s.access_token.clone());
            }
        }
        let refresh_token = match guard.as_ref() {
            Some(s) => s.refresh_token.clone(),
            None => self.store.load().ok_or_else(|| anyhow!("Not signed in"))?,
        };
        match self.refresh(&refresh_token).await {
            Ok(s) => {
                let token = s.access_token.clone();
                *guard = Some(s);
                Ok(token)
            }
            Err(RefreshError::Rejected(msg)) => {
                // Revoked or expired: forget it so the user is asked to sign in again.
                self.store.clear();
                *guard = None;
                bail!("Session expired, please sign in again ({msg})")
            }
            // Offline etc.: keep the stored token and try again later.
            Err(RefreshError::Network(e)) => Err(e.context("Could not reach the sign-in service")),
        }
    }

    async fn refresh(&self, refresh_token: &str) -> Result<Session, RefreshError> {
        let res = self
            .http
            .post(format!("{}/auth/v1/token?grant_type=refresh_token", config::SUPABASE_URL))
            .header("apikey", config::SUPABASE_KEY)
            .json(&serde_json::json!({ "refresh_token": refresh_token }))
            .send()
            .await
            .map_err(|e| RefreshError::Network(e.into()))?;
        let status = res.status();
        if status.is_client_error() {
            return Err(RefreshError::Rejected(res.text().await.unwrap_or_else(|_| status.to_string())));
        }
        let body: TokenResponse = res
            .error_for_status()
            .map_err(|e| RefreshError::Network(e.into()))?
            .json()
            .await
            .map_err(|e| RefreshError::Network(e.into()))?;
        self.store.save(&body.refresh_token);
        Ok(Session {
            expires_at: body.expires_at.unwrap_or_else(|| now() + body.expires_in.unwrap_or(3600)),
            access_token: body.access_token,
            refresh_token: body.refresh_token,
            user: body.user.into(),
        })
    }

    /// Opens the browser and waits (up to 10 minutes) for the website to hand back a session.
    pub async fn sign_in(&self, open_url: impl FnOnce(&str) -> Result<()>) -> Result<User> {
        let cancel = Arc::new(Notify::new());
        if let Some(previous) = self.pending.lock().await.replace(cancel.clone()) {
            previous.notify_one();
        }

        let listener = TcpListener::bind("127.0.0.1:0").await.context("Could not open a local port for sign-in")?;
        let redirect = format!("http://127.0.0.1:{}/callback", listener.local_addr()?.port());
        let state = format!("{}{}", uuid::Uuid::new_v4().simple(), uuid::Uuid::new_v4().simple());
        let mut login = url::Url::parse(&format!("{}/login", config::WEB_URL))?;
        login.query_pairs_mut().append_pair("redirect", &redirect).append_pair("state", &state);
        open_url(login.as_str())?;

        let params = tokio::select! {
            r = wait_for_callback(&listener, &state) => r?,
            _ = cancel.notified() => bail!("Superseded by a new sign-in attempt"),
            _ = tokio::time::sleep(Duration::from_secs(600)) => bail!("Sign-in timed out"),
        };
        drop(listener);

        let access_token = params.get("access_token").cloned().ok_or_else(|| anyhow!("Callback had no session"))?;
        let refresh_token = params.get("refresh_token").cloned().ok_or_else(|| anyhow!("Callback had no session"))?;
        // Validates the token with Supabase and tells us who it belongs to.
        let user: SupabaseUser = self
            .http
            .get(format!("{}/auth/v1/user", config::SUPABASE_URL))
            .header("apikey", config::SUPABASE_KEY)
            .bearer_auth(&access_token)
            .send()
            .await?
            .error_for_status()
            .context("Sign-in token was rejected")?
            .json()
            .await?;
        let expires_at = params.get("expires_at").and_then(|v| v.parse().ok()).unwrap_or_else(|| now() + 3600);

        self.store.save(&refresh_token);
        let user: User = user.into();
        *self.session.lock().await = Some(Session { access_token, refresh_token, expires_at, user: user.clone() });
        Ok(user)
    }

    pub async fn sign_out(&self) {
        let session = self.session.lock().await.take();
        if let Some(s) = session {
            // Revoke server-side; local sign-out still succeeds if this fails.
            let _ = self
                .http
                .post(format!("{}/auth/v1/logout?scope=local", config::SUPABASE_URL))
                .header("apikey", config::SUPABASE_KEY)
                .bearer_auth(&s.access_token)
                .send()
                .await;
        }
        self.store.clear();
    }
}

enum RefreshError {
    Rejected(String),
    Network(anyhow::Error),
}

/// Serves the loopback redirect until a request arrives with the expected `state`.
async fn wait_for_callback(listener: &TcpListener, state: &str) -> Result<HashMap<String, String>> {
    loop {
        let (mut stream, _) = listener.accept().await?;
        let Some(target) = read_request_target(&mut stream).await else { continue };
        let Ok(url) = url::Url::parse(&format!("http://127.0.0.1{target}")) else { continue };
        if url.path() != "/callback" {
            respond(&mut stream, 404, "Not found").await;
            continue;
        }
        let params: HashMap<String, String> = url.query_pairs().into_owned().collect();
        if params.get("state").map(String::as_str) != Some(state) {
            respond(&mut stream, 400, "This sign-in link has expired. Start again from the Friday AI app.").await;
            continue;
        }
        respond(&mut stream, 200, "Signed in. You can close this tab and return to Friday AI.").await;
        return Ok(params);
    }
}

async fn read_request_target(stream: &mut TcpStream) -> Option<String> {
    let mut buf = vec![0u8; 16 * 1024];
    let mut len = 0;
    while len < buf.len() {
        let n = tokio::time::timeout(Duration::from_secs(5), stream.read(&mut buf[len..])).await.ok()?.ok()?;
        if n == 0 {
            break;
        }
        len += n;
        if buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
            break;
        }
    }
    let head = String::from_utf8_lossy(&buf[..len]);
    let mut parts = head.lines().next()?.split_whitespace();
    (parts.next()? == "GET").then(|| parts.next().map(str::to_owned))?
}

async fn respond(stream: &mut TcpStream, status: u16, message: &str) {
    let reason = match status {
        200 => "OK",
        400 => "Bad Request",
        _ => "Not Found",
    };
    let body = format!(
        "<!doctype html><meta charset=utf-8><title>Friday AI</title>\
         <body style=\"margin:0;height:100vh;display:grid;place-items:center;background:#05070c;color:#eef1f7;\
         font-family:system-ui,sans-serif\"><p style=\"font-size:18px\">{message}</p>"
    );
    let res = format!(
        "HTTP/1.1 {status} {reason}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\n\
         connection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(res.as_bytes()).await;
    let _ = stream.shutdown().await;
}
