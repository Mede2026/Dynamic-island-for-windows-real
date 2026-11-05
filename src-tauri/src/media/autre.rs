//! Repli hors Windows : aucune source média (GSMTC n'existe que sous Windows).

use super::Action;
use crate::journal;
use tauri::AppHandle;

pub fn demarrer(_app: AppHandle) {
    journal!("media", "non disponible sur ce système (Windows seulement)");
}

pub fn rafraichir_maintenant() {}

pub fn agir(_action: Action) -> Result<(), String> {
    Err("média non disponible sur ce système".into())
}

pub fn ouvrir_source() -> Result<(), String> {
    Err("non disponible sur ce système".into())
}
