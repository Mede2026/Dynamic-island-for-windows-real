//! Préférences de l'utilisateur, mémorisées entre deux démarrages dans
//! `%APPDATA%\com.mederic.dynamicisland\parametres.json` (Windows).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

use crate::journal;

pub const EVENEMENT: &str = "parametres";

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Parametres {
    /// Taille de l'île : DIP Windows par point iPhone (ISLAND_SCALE). 1,0 = taille mesurée.
    pub taille: f64,
    /// Écran choisi (None = écran principal).
    pub ecran: Option<String>,
    pub cacher_en_plein_ecran: bool,
    /// Mode de compatibilité : clics traversants « classiques » (si la région pose problème).
    pub clics_classiques: bool,
    /// Préférences d'affichage gérées par l'interface (vitesse, onde, alertes…), stockées telles quelles.
    pub affichage: serde_json::Map<String, serde_json::Value>,
}

impl Default for Parametres {
    fn default() -> Self {
        Self {
            taille: 1.0,
            ecran: None,
            cacher_en_plein_ecran: false,
            clics_classiques: false,
            affichage: Default::default(),
        }
    }
}

/// Taille autorisée : 50 % à 250 % de la taille mesurée.
pub fn borner_taille(t: f64) -> f64 {
    if t.is_finite() {
        t.clamp(0.5, 2.5)
    } else {
        1.0
    }
}

pub struct EtatParametres {
    valeurs: Mutex<Parametres>,
    fichier: Option<PathBuf>,
}

/// Lit le fichier (ou les valeurs par défaut) et l'enregistre dans l'état de l'app.
pub fn charger(app: &AppHandle) -> Parametres {
    let fichier = app.path().app_config_dir().ok().map(|d| d.join("parametres.json"));
    let valeurs = fichier
        .as_ref()
        .and_then(|f| std::fs::read_to_string(f).ok())
        .and_then(|t| serde_json::from_str::<Parametres>(&t).ok())
        .unwrap_or_default();
    let valeurs = Parametres {
        taille: borner_taille(valeurs.taille),
        ..valeurs
    };
    journal!("parametres", "{:?} ({:?})", valeurs, fichier);
    app.manage(EtatParametres {
        valeurs: Mutex::new(valeurs.clone()),
        fichier,
    });
    valeurs
}

pub fn lire(app: &AppHandle) -> Parametres {
    app.state::<EtatParametres>().valeurs.lock().unwrap().clone()
}

/// Modifie, enregistre sur le disque et prévient toutes les fenêtres.
pub fn modifier(app: &AppHandle, f: impl FnOnce(&mut Parametres)) -> Parametres {
    let etat = app.state::<EtatParametres>();
    let copie = {
        let mut p = etat.valeurs.lock().unwrap();
        f(&mut p);
        p.taille = borner_taille(p.taille);
        p.clone()
    };
    if let Some(fichier) = &etat.fichier {
        if let Some(dossier) = fichier.parent() {
            let _ = std::fs::create_dir_all(dossier);
        }
        if let Err(e) = std::fs::write(fichier, serde_json::to_string_pretty(&copie).unwrap_or_default()) {
            journal!("parametres", "enregistrement impossible : {e}");
        }
    }
    let _ = app.emit(EVENEMENT, &copie);
    copie
}

#[tauri::command]
pub fn parametres_lire(app: AppHandle) -> Parametres {
    lire(&app)
}

#[tauri::command]
pub fn parametres_definir_taille(app: AppHandle, taille: f64) -> Parametres {
    modifier(&app, |p| p.taille = taille)
}

/// Préférences d'affichage (fusionnées avec les précédentes).
#[tauri::command]
pub fn parametres_definir_affichage(
    app: AppHandle,
    affichage: serde_json::Map<String, serde_json::Value>,
) -> Parametres {
    modifier(&app, |p| p.affichage.extend(affichage))
}

/// Prend effet au prochain démarrage.
#[tauri::command]
pub fn parametres_definir_clics_classiques(app: AppHandle, actif: bool) -> Parametres {
    modifier(&app, |p| p.clics_classiques = actif)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bornes() {
        assert_eq!(borner_taille(1.25), 1.25);
        assert_eq!(borner_taille(9.0), 2.5);
        assert_eq!(borner_taille(0.1), 0.5);
        assert_eq!(borner_taille(f64::NAN), 1.0);
    }

    #[test]
    fn fichier_incomplet_ou_ancien() {
        let p: Parametres = serde_json::from_str(r#"{"taille": 1.5}"#).unwrap();
        assert_eq!(
            p,
            Parametres {
                taille: 1.5,
                ..Default::default()
            }
        );
        let json = serde_json::to_string(&p).unwrap();
        assert!(json.contains("\"cacherEnPleinEcran\":false"));
    }
}
