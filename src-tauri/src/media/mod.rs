//! Média : ce qui joue en ce moment (Spotify, Apple Music, navigateurs…),
//! via `GlobalSystemMediaTransportControlsSessionManager` (GSMTC) de Windows.
//!
//! - Événements : `media` (EtatMedia) et `media-pochette` (Pochette).
//! - Commandes : lecture/pause, suivant, précédent, aller à une position, choisir la source.

pub mod pochette;

#[cfg(not(windows))]
mod autre;
#[cfg(windows)]
mod win;

#[cfg(not(windows))]
use autre as plateforme;
#[cfg(windows)]
use win as plateforme;

pub use pochette::Pochette;

use serde::Serialize;
use std::sync::Mutex;
use tauri::AppHandle;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub enum StatutLecture {
    #[default]
    Aucun,
    Ferme,
    Ouverture,
    Changement,
    Arrete,
    Lecture,
    Pause,
}

/// Une application qui expose ses contrôles média à Windows.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SourceMedia {
    /// Identifiant Windows de l'app (AppUserModelID), ex. « Spotify.exe ».
    pub app_id: String,
    pub statut: StatutLecture,
}

#[derive(Clone, Debug, Serialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EtatMedia {
    pub sources: Vec<SourceMedia>,
    /// Source affichée par l'île (choisie automatiquement ou épinglée).
    pub source_active: Option<String>,
    /// Source épinglée par l'utilisateur (sinon choix automatique).
    pub source_epinglee: Option<String>,
    pub titre: String,
    pub artiste: String,
    pub album: String,
    pub statut: StatutLecture,
    pub position_ms: i64,
    pub duree_ms: i64,
    /// Moment (ms depuis 1970) où `position_ms` était exacte : le front-end extrapole à partir de là.
    pub position_maj_a_ms: i64,
    pub peut_lire_pause: bool,
    pub peut_suivant: bool,
    pub peut_precedent: bool,
    pub peut_aller_a: bool,
    /// Identifiant de la pochette (change quand l'image change).
    pub pochette_id: Option<String>,
}

/// Choix de la session à afficher :
/// 1. la source épinglée par l'utilisateur, si elle existe encore ;
/// 2. la session « courante » de Windows si elle joue ;
/// 3. sinon la première session qui joue ;
/// 4. sinon la session courante de Windows ;
/// 5. sinon la première session.
pub fn choisir_session(sources: &[SourceMedia], epinglee: Option<&str>, courante: Option<&str>) -> Option<usize> {
    let position = |id: &str| sources.iter().position(|s| s.app_id == id);
    let joue = |i: usize| sources[i].statut == StatutLecture::Lecture;

    epinglee
        .and_then(position)
        .or_else(|| courante.and_then(position).filter(|&i| joue(i)))
        .or_else(|| (0..sources.len()).find(|&i| joue(i)))
        .or_else(|| courante.and_then(position))
        .or_else(|| (!sources.is_empty()).then_some(0))
}

// ---------------------------------------------------------------------------
// État partagé et commandes
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct Partage {
    pub epinglee: Mutex<Option<String>>,
    pub dernier: Mutex<EtatMedia>,
    pub pochette: Mutex<Option<Pochette>>,
}

pub fn partage() -> &'static Partage {
    static P: std::sync::OnceLock<Partage> = std::sync::OnceLock::new();
    P.get_or_init(Partage::default)
}

pub fn demarrer(app: &AppHandle) {
    plateforme::demarrer(app.clone());
}

#[derive(Debug, Clone, Copy)]
pub enum Action {
    LecturePause,
    Suivant,
    Precedent,
    AllerA(i64),
}

#[tauri::command]
pub fn media_etat() -> EtatMedia {
    partage().dernier.lock().unwrap().clone()
}

#[tauri::command]
pub fn media_pochette() -> Option<Pochette> {
    partage().pochette.lock().unwrap().clone()
}

// Les commandes média sont `async` : elles tournent hors du fil principal (qui gère
// l'interface) car elles attendent une réponse de l'application qui joue.
#[tauri::command]
pub async fn media_lecture_pause() -> Result<(), String> {
    plateforme::agir(Action::LecturePause)
}

#[tauri::command]
pub async fn media_suivant() -> Result<(), String> {
    plateforme::agir(Action::Suivant)
}

#[tauri::command]
pub async fn media_precedent() -> Result<(), String> {
    plateforme::agir(Action::Precedent)
}

#[tauri::command]
pub async fn media_aller_a(position_ms: i64) -> Result<(), String> {
    plateforme::agir(Action::AllerA(position_ms.max(0)))
}

/// Met au premier plan l'application qui joue (clic court sur l'île).
#[tauri::command]
pub async fn media_ouvrir_source() -> Result<(), String> {
    plateforme::ouvrir_source()
}

/// `app_id = null` → choix automatique.
#[tauri::command]
pub async fn media_choisir_source(app_id: Option<String>) -> Result<(), String> {
    *partage().epinglee.lock().unwrap() = app_id;
    plateforme::rafraichir_maintenant();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn s(id: &str, statut: StatutLecture) -> SourceMedia {
        SourceMedia {
            app_id: id.into(),
            statut,
        }
    }

    #[test]
    fn choix_de_la_session() {
        use StatutLecture::*;
        let sources = vec![s("chrome", Pause), s("spotify", Lecture), s("edge", Lecture)];
        // Épinglée gagne toujours.
        assert_eq!(choisir_session(&sources, Some("chrome"), Some("edge")), Some(0));
        // Épinglée disparue → choix automatique.
        assert_eq!(choisir_session(&sources, Some("absent"), None), Some(1));
        // Courante qui joue gagne sur les autres qui jouent.
        assert_eq!(choisir_session(&sources, None, Some("edge")), Some(2));
        // Courante en pause → la première qui joue.
        assert_eq!(choisir_session(&sources, None, Some("chrome")), Some(1));
        // Personne ne joue → la courante.
        let pauses = vec![s("a", Pause), s("b", Pause)];
        assert_eq!(choisir_session(&pauses, None, Some("b")), Some(1));
        // Personne ne joue, pas de courante → la première.
        assert_eq!(choisir_session(&pauses, None, None), Some(0));
        assert_eq!(choisir_session(&[], None, Some("x")), None);
    }

    #[test]
    fn serialisation_camel_case() {
        let e = EtatMedia {
            position_maj_a_ms: 5,
            ..Default::default()
        };
        let json = serde_json::to_string(&e).unwrap();
        assert!(json.contains("\"positionMajAMs\":5"));
        assert!(json.contains("\"statut\":\"aucun\""));
    }
}
