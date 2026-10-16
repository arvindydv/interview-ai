//! Compile-time configuration (see build.rs and apps/desktop/.env).

macro_rules! env_or {
    ($key:literal, $default:literal) => {
        match option_env!($key) {
            Some(v) => v,
            None => $default,
        }
    };
}

pub const WEB_URL: &str = env_or!("PARAKEET_WEB_URL", "http://localhost:3100");
pub const API_URL: &str = env_or!("PARAKEET_API_URL", "http://localhost:4000");
pub const SUPABASE_URL: &str = env_or!("PARAKEET_SUPABASE_URL", "http://127.0.0.1:54321");
pub const SUPABASE_KEY: &str = env_or!("PARAKEET_SUPABASE_PUBLISHABLE_KEY", "");

/// Global shortcuts. They work while another app (the meeting) is focused.
pub const SHORTCUT_TOGGLE: &str = "CommandOrControl+Backslash";
pub const SHORTCUT_ANSWER: &str = "CommandOrControl+Enter";
pub const SHORTCUT_SCREENSHOT: &str = "CommandOrControl+Shift+Enter";
pub const SHORTCUT_CHAT: &str = "CommandOrControl+Shift+Space";
