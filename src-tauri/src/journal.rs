//! Petit journal de débogage : affiche les messages dans la console (`npm run tauri dev`).

/// `journal!("media", "titre = {}", titre);` → `[media] titre = …`
#[macro_export]
macro_rules! journal {
    ($module:expr, $($arg:tt)*) => {{
        println!("[{}] {}", $module, format!($($arg)*));
    }};
}

/// Heure actuelle en millisecondes depuis le 1er janvier 1970 (UTC).
pub fn maintenant_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
