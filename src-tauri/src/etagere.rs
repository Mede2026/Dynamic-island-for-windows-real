//! Étagère : des fichiers déposés sur l'île, gardés sous la main (seulement leurs chemins :
//! rien n'est copié ni déplacé). Mémorisée dans `etagere.json`.

use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::journal;

pub const EVENEMENT: &str = "etagere";
const MAXIMUM: usize = 24;

static FICHIERS: Mutex<Vec<String>> = Mutex::new(Vec::new());

fn fichier() -> Option<std::path::PathBuf> {
    journal::dossier_app().map(|d| d.join("etagere.json"))
}

fn enregistrer(app: &AppHandle, liste: &[String]) {
    if let Some(f) = fichier() {
        let _ = std::fs::write(f, serde_json::to_string(liste).unwrap_or_default());
    }
    let _ = app.emit(EVENEMENT, liste);
}

/// Ajoute des chemins sans doublon (les plus récents en premier), garde ceux qui existent.
pub fn fusionner(liste: &[String], nouveaux: &[String], existe: impl Fn(&str) -> bool) -> Vec<String> {
    let mut r: Vec<String> = Vec::new();
    for c in nouveaux.iter().chain(liste.iter()) {
        if !r.contains(c) && existe(c) {
            r.push(c.clone());
        }
    }
    r.truncate(MAXIMUM);
    r
}

pub fn charger() {
    let liste: Vec<String> = fichier()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    *FICHIERS.lock().unwrap() = fusionner(&[], &liste, |c| std::path::Path::new(c).exists());
}

#[tauri::command]
pub fn etagere_lire() -> Vec<String> {
    FICHIERS.lock().unwrap().clone()
}

#[tauri::command]
pub fn etagere_ajouter(app: AppHandle, chemins: Vec<String>) -> Vec<String> {
    let mut f = FICHIERS.lock().unwrap();
    *f = fusionner(&f, &chemins, |c| std::path::Path::new(c).exists());
    journal!("etagere", "{} fichier(s)", f.len());
    enregistrer(&app, &f);
    f.clone()
}

#[tauri::command]
pub fn etagere_retirer(app: AppHandle, chemin: Option<String>) -> Vec<String> {
    let mut f = FICHIERS.lock().unwrap();
    match chemin {
        Some(c) => f.retain(|x| *x != c),
        None => f.clear(),
    }
    enregistrer(&app, &f);
    f.clone()
}

#[cfg(test)]
mod tests {
    #[test]
    fn fusion() {
        let l = vec!["a".to_string(), "b".to_string()];
        let r = super::fusionner(&l, &["b".into(), "c".into()], |c| c != "x");
        assert_eq!(r, vec!["b", "c", "a"]);
        let r = super::fusionner(&l, &["x".into()], |c| c != "x");
        assert_eq!(r, vec!["a", "b"]);
    }
}
