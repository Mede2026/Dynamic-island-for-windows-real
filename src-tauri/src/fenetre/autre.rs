//! Repli pour les autres systèmes (Linux/macOS) : permet de compiler et de tester
//! la logique, mais les fonctions propres à Windows ne font rien.

use tauri::{AppHandle, WebviewWindow};

pub fn appliquer_styles(_fen: &WebviewWindow) {}

pub fn frequence_ecran(_id: &str) -> Option<u32> {
    None
}

pub fn curseur_ecran(app: &AppHandle) -> Option<(i32, i32)> {
    let p = app.cursor_position().ok()?;
    Some((p.x as i32, p.y as i32))
}

pub fn bouton_gauche_enfonce() -> Option<bool> {
    None
}

pub fn remettre_devant(_fen: &WebviewWindow) {}

pub fn suivre_session(_fen: &WebviewWindow, _app: &tauri::AppHandle) {}

pub fn plein_ecran_actif(_fen: &WebviewWindow) -> bool {
    false
}

pub fn definir_region(_fen: &WebviewWindow, _r: Option<(i32, i32, i32, i32)>) {}
