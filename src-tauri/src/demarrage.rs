//! Démarrage automatique avec Windows (option).
//!
//! Fonctionnement : le plugin officiel `tauri-plugin-autostart` ajoute une entrée dans
//! `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`. Windows lance alors l'île
//! dès l'ouverture de la session, sans droits administrateur.
//! L'argument `--demarrage-auto` permet de savoir que le lancement vient de Windows.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::journal;

/// Argument ajouté à la commande enregistrée dans Windows.
pub const ARGUMENT: &str = "--demarrage-auto";

/// Vrai si l'app a été lancée par Windows à l'ouverture de session.
pub fn lance_par_windows() -> bool {
    std::env::args().any(|a| a == ARGUMENT)
}

pub fn plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec![ARGUMENT]))
}

#[tauri::command]
pub fn demarrage_auto_etat(app: AppHandle) -> Result<bool, String> {
    app.autolaunch().is_enabled().map_err(|e| e.to_string())
}

/// Active ou désactive le démarrage automatique. Renvoie l'état réel après le changement.
#[tauri::command]
pub fn demarrage_auto_definir(app: AppHandle, actif: bool) -> Result<bool, String> {
    let gestion = app.autolaunch();
    let r = if actif { gestion.enable() } else { gestion.disable() };
    r.map_err(|e| e.to_string())?;
    let etat = gestion.is_enabled().map_err(|e| e.to_string())?;
    journal!("demarrage", "démarrage automatique avec Windows : {}", etat);
    Ok(etat)
}
