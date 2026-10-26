//! Edge API client. Every authenticated call goes through Rust, so tokens never reach the webview.

use std::{fs, path::{Path, PathBuf}};

use anyhow::{anyhow, Result};
use serde_json::{json, Value};

use crate::{auth::Auth, config};

pub struct Api {
    http: reqwest::Client,
    device_file: PathBuf,
}

impl Api {
    pub fn new(http: reqwest::Client, data_dir: &Path) -> Self {
        Self { http, device_file: data_dir.join("device.json") }
    }

    async fn parse(res: reqwest::Response) -> Result<Value> {
        let status = res.status();
        let body: Value = res.json().await.unwrap_or(Value::Null);
        if status.is_success() {
            Ok(body)
        } else {
            Err(anyhow!(body["message"].as_str().map(str::to_owned).unwrap_or_else(|| format!("HTTP {status}"))))
        }
    }

    pub async fn health(&self) -> Result<Value> {
        let res = self.http.get(format!("{}/health", config::API_URL)).send().await?;
        // 503 still carries per-check details worth showing.
        Ok(res.json().await?)
    }

    pub async fn me(&self, auth: &Auth) -> Result<Value> {
        let token = auth.access_token().await?;
        Self::parse(self.http.get(format!("{}/v1/me", config::API_URL)).bearer_auth(token).send().await?).await
    }

    /// Authenticated JSON request to the Edge API.
    async fn send(&self, auth: &Auth, method: reqwest::Method, path: &str, body: Option<Value>) -> Result<Value> {
        let token = auth.access_token().await?;
        let mut req = self.http.request(method, format!("{}{path}", config::API_URL)).bearer_auth(token);
        if let Some(body) = body {
            req = req.json(&body);
        }
        Self::parse(req.send().await?).await
    }

    // Interview context (spec A2/A3): the resume and the interview being prepared for.

    pub async fn resume(&self, auth: &Auth) -> Result<Value> {
        self.send(auth, reqwest::Method::GET, "/v1/resume", None).await
    }

    pub async fn upload_resume(&self, auth: &Auth, file_name: &str, mime_type: &str, data: &str) -> Result<Value> {
        let body = json!({ "fileName": file_name, "mimeType": mime_type, "data": data });
        self.send(auth, reqwest::Method::POST, "/v1/resume", Some(body)).await
    }

    pub async fn delete_resume(&self, auth: &Auth) -> Result<Value> {
        self.send(auth, reqwest::Method::DELETE, "/v1/resume", None).await
    }

    pub async fn interview(&self, auth: &Auth) -> Result<Value> {
        self.send(auth, reqwest::Method::GET, "/v1/interview", None).await
    }

    pub async fn save_interview(&self, auth: &Auth, interview: Value) -> Result<Value> {
        self.send(auth, reqwest::Method::PUT, "/v1/interview", Some(interview)).await
    }

    /// Reports an AI-generated answer for review (Microsoft Store policy 11.16).
    pub async fn report_answer(&self, auth: &Auth, report: &Report) -> Result<Value> {
        self.send(auth, reqwest::Method::POST, "/v1/reports", Some(report.body())).await
    }

    /// Registers this install for device limits and compatibility analytics (spec A1/I6).
    pub async fn register_device(&self, auth: &Auth, app_version: &str) -> Result<()> {
        let token = auth.access_token().await?;
        let info = os_info::get();
        let body = json!({
            "deviceKey": self.device_key(),
            "os": std::env::consts::OS,
            "osVersion": format!("{} {}", info.os_type(), info.version()),
            "appVersion": app_version,
        });
        Self::parse(
            self.http.post(format!("{}/v1/devices", config::API_URL)).bearer_auth(token).json(&body).send().await?,
        )
        .await?;
        Ok(())
    }

    /// Stable random identifier for this install.
    fn device_key(&self) -> String {
        if let Some(key) = fs::read_to_string(&self.device_file)
            .ok()
            .and_then(|s| serde_json::from_str::<Value>(&s).ok())
            .and_then(|v| v["deviceKey"].as_str().map(str::to_owned))
        {
            return key;
        }
        let key = uuid::Uuid::new_v4().to_string();
        if let Some(dir) = self.device_file.parent() {
            let _ = fs::create_dir_all(dir);
        }
        let _ = fs::write(&self.device_file, json!({ "deviceKey": key }).to_string());
        key
    }
}

/// A report about one answer, as sent by the webview (see `ReportInput` in @parakeet/shared).
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub turn_id: String,
    pub reason: String,
    #[serde(default)]
    pub details: String,
    #[serde(default)]
    pub question: String,
    #[serde(default)]
    pub answer: String,
}

impl Report {
    /// JSON body for POST /v1/reports.
    fn body(&self) -> Value {
        json!({
            "turnId": self.turn_id,
            "reason": self.reason,
            "details": self.details,
            "question": self.question,
            "answer": self.answer,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn report_round_trips_to_the_api_contract() {
        let report: Report = serde_json::from_value(json!({
            "turnId": "t-1",
            "reason": "harmful",
            "details": "Encourages lying",
            "question": "Q?",
            "answer": "A.",
        }))
        .unwrap();
        assert_eq!(
            report.body(),
            json!({ "turnId": "t-1", "reason": "harmful", "details": "Encourages lying", "question": "Q?", "answer": "A." })
        );
    }

    #[test]
    fn report_optional_fields_default_to_empty() {
        let report: Report = serde_json::from_value(json!({ "turnId": "t-1", "reason": "other" })).unwrap();
        assert_eq!(report.body()["details"], "");
        assert_eq!(report.body()["answer"], "");
    }
}
