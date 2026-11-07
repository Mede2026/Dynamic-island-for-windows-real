//! Système : batterie, volume, « Ne pas déranger », notifications, presse-papiers, caméra/micro.
//!
//! Chaque sous-module :
//!  - garde son dernier état dans une variable partagée (lue par les commandes) ;
//!  - envoie un événement au front-end à chaque changement ;
//!  - a une version Windows (`#[cfg(windows)]`) et un repli vide pour les autres systèmes.

pub mod appel_entrant;
pub mod batterie;
pub mod bluetooth;
pub mod bureaux;
pub mod clavier;
pub mod confidentialite;
pub mod ecrire;
pub mod historique;
pub mod impression;
pub mod internet;
pub mod luminosite;
pub mod micro;
pub mod mise_a_jour;
pub mod ne_pas_deranger;
pub mod niveau_audio;
pub mod notifications;
pub mod osd;
pub mod presse_papiers;
pub mod telechargements;
pub mod usb;
pub mod volume;

use tauri::AppHandle;

pub fn demarrer(app: &AppHandle) {
    batterie::demarrer(app.clone());
    volume::demarrer(app.clone());
    ne_pas_deranger::demarrer(app.clone());
    notifications::demarrer(app.clone());
    presse_papiers::demarrer(app.clone());
    confidentialite::demarrer(app.clone());
    niveau_audio::demarrer(app.clone());
    luminosite::demarrer(app.clone());
    clavier::demarrer(app.clone());
    usb::demarrer(app.clone());
    bluetooth::demarrer(app.clone());
    telechargements::demarrer(app.clone());
    internet::demarrer(app.clone());
    impression::demarrer(app.clone());
    micro::demarrer(app.clone());
    bureaux::demarrer(app.clone());
    mise_a_jour::demarrer(app.clone());
}

#[tauri::command]
pub fn systeme_batterie() -> batterie::EtatBatterie {
    batterie::dernier()
}

#[tauri::command]
pub fn systeme_volume() -> Option<volume::EtatVolume> {
    volume::dernier()
}

#[tauri::command]
pub fn systeme_ne_pas_deranger() -> ne_pas_deranger::EtatNePasDeranger {
    ne_pas_deranger::dernier()
}

#[tauri::command]
pub fn systeme_confidentialite() -> Option<confidentialite::Confidentialite> {
    confidentialite::dernier()
}

#[tauri::command]
pub fn notifications_etat() -> notifications::EtatNotifications {
    notifications::dernier()
}
