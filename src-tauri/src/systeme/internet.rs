//! Connexion Internet perdue / retrouvée : alerte (comme un iPhone qui perd le réseau).
//! Événement de Windows `NetworkStatusChanged` ; seul un CHANGEMENT déclenche l'alerte.

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "internet";
pub const EVENEMENT_WIFI: &str = "wifi-faible";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct WifiFaible {
    /// Barres de signal (0 à 5).
    pub barres: u8,
    pub nom: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EtatInternet {
    pub connecte: bool,
    /// Nom du réseau (Wi-Fi « Maison », « Ethernet »…).
    pub nom: Option<String>,
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use std::sync::Mutex;
    use tauri::Emitter;
    use windows::Networking::Connectivity::{
        NetworkConnectivityLevel, NetworkInformation, NetworkStatusChangedEventHandler,
    };

    fn lire() -> EtatInternet {
        let profil = NetworkInformation::GetInternetConnectionProfile().ok();
        let connecte = profil
            .as_ref()
            .and_then(|p| p.GetNetworkConnectivityLevel().ok())
            .is_some_and(|n| n == NetworkConnectivityLevel::InternetAccess);
        let nom = profil
            .and_then(|p| p.ProfileName().ok())
            .map(|n| n.to_string())
            .filter(|n| !n.is_empty());
        EtatInternet { connecte, nom }
    }

    static DERNIER: Mutex<Option<bool>> = Mutex::new(None);
    let app2 = app.clone();
    *DERNIER.lock().unwrap() = Some(lire().connecte);
    let gestionnaire = NetworkStatusChangedEventHandler::new(move |_| {
        // Windows envoie souvent plusieurs changements d'affilée : attendre que ça se stabilise.
        std::thread::sleep(std::time::Duration::from_millis(1500));
        let etat = lire();
        let mut d = DERNIER.lock().unwrap();
        if *d != Some(etat.connecte) {
            *d = Some(etat.connecte);
            journal!("internet", "connecté={} ({:?})", etat.connecte, etat.nom);
            let _ = app.emit(EVENEMENT, etat);
        }
        Ok(())
    });
    match NetworkInformation::NetworkStatusChanged(&gestionnaire) {
        Ok(_) => journal!("internet", "prêt"),
        Err(e) => journal!("internet", "indisponible : {e}"),
    }

    // Wi-Fi faible : nombre de barres (0 à 5) relevé toutes les 20 s ; alerte quand il tombe
    // à 1 barre ou moins (au plus une fois toutes les 10 minutes).
    std::thread::Builder::new()
        .name("ile-wifi".into())
        .spawn(move || {
            let mut avant: Option<u8> = None;
            let mut derniere_alerte: Option<std::time::Instant> = None;
            loop {
                std::thread::sleep(std::time::Duration::from_secs(20));
                let Ok(profil) = NetworkInformation::GetInternetConnectionProfile() else {
                    continue;
                };
                if !profil.IsWlanConnectionProfile().unwrap_or(false) {
                    avant = None;
                    continue;
                }
                let barres = profil.GetSignalBars().ok().and_then(|r| r.Value().ok());
                let nom = profil
                    .ProfileName()
                    .ok()
                    .map(|n| n.to_string())
                    .filter(|n| !n.is_empty());
                if let (Some(b), Some(a)) = (barres, avant) {
                    let recente = derniere_alerte.is_some_and(|t| t.elapsed() < std::time::Duration::from_secs(600));
                    if b <= 1 && a >= 2 && !recente {
                        journal!("internet", "Wi-Fi faible : {b} barre(s)");
                        let _ = app2.emit(
                            EVENEMENT_WIFI,
                            WifiFaible {
                                barres: b,
                                nom: nom.clone(),
                            },
                        );
                        derniere_alerte = Some(std::time::Instant::now());
                    }
                }
                avant = barres;
            }
        })
        .ok();
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("internet", "non disponible sur ce système (Windows seulement)");
}

/// Temps depuis la dernière action au clavier ou à la souris (ms) : pour les rappels de pause.
#[tauri::command]
pub fn systeme_inactivite_ms() -> u64 {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::System::SystemInformation::GetTickCount;
        use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
        let mut info = LASTINPUTINFO {
            cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
            dwTime: 0,
        };
        if GetLastInputInfo(&mut info).as_bool() {
            return GetTickCount().wrapping_sub(info.dwTime) as u64;
        }
    }
    0
}

/// Cacher l'île (et ses fenêtres) dans les partages d'écran et les enregistrements
/// (Teams, Discord, OBS…). Attention : aussi dans les captures d'écran.
#[tauri::command]
pub fn fenetre_cacher_au_partage(app: AppHandle, actif: bool) {
    #[cfg(windows)]
    {
        use tauri::Manager;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::WindowsAndMessaging::{SetWindowDisplayAffinity, WDA_EXCLUDEFROMCAPTURE, WDA_NONE};
        for (_, f) in app.webview_windows() {
            if let Ok(h) = f.hwnd() {
                let _ = unsafe {
                    SetWindowDisplayAffinity(HWND(h.0), if actif { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE })
                };
            }
        }
        journal!("fenetre", "cachée au partage d'écran : {actif}");
    }
    #[cfg(not(windows))]
    let _ = (app, actif);
}
