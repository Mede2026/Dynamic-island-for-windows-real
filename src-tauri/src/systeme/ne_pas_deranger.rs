//! « Ne pas déranger » / sessions de concentration (Focus) de Windows 11.
//!
//! Windows n'offre PAS d'API publique simple pour l'état « Ne pas déranger ».
//! On combine deux sources (voir docs/limites.md) :
//!  1. le registre : `HKCU\...\Notifications\Settings\NOC_GLOBAL_SETTING_TOASTS_ENABLED`
//!     vaut 0 quand « Ne pas déranger » est activé (Windows 11) ;
//!  2. `Windows.UI.Shell.FocusSessionManager` : session de concentration (app Horloge).
//!
//! Aucune scrutation : on attend les changements du registre (RegNotifyChangeKeyValue)
//! et l'événement IsFocusActiveChanged.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::{evenements, journal};

#[derive(Clone, Debug, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EtatNePasDeranger {
    /// Vrai si au moins une des sources dit « actif ».
    pub actif: bool,
    /// « Ne pas déranger » (notifications coupées) — None si illisible.
    pub notifications_coupees: Option<bool>,
    /// Session de concentration — None si non prise en charge.
    pub session_concentration: Option<bool>,
}

pub fn combiner(notifications_coupees: Option<bool>, session: Option<bool>) -> EtatNePasDeranger {
    EtatNePasDeranger {
        actif: notifications_coupees.unwrap_or(false) || session.unwrap_or(false),
        notifications_coupees,
        session_concentration: session,
    }
}

static DERNIER: Mutex<Option<EtatNePasDeranger>> = Mutex::new(None);

pub fn dernier() -> EtatNePasDeranger {
    DERNIER.lock().unwrap().clone().unwrap_or_default()
}

#[cfg_attr(not(windows), allow(dead_code))]
fn publier(app: &AppHandle, etat: EtatNePasDeranger) {
    let mut d = DERNIER.lock().unwrap();
    if d.as_ref() != Some(&etat) {
        journal!(
            "ne-pas-deranger",
            "actif={} (notifications coupées={:?}, concentration={:?})",
            etat.actif,
            etat.notifications_coupees,
            etat.session_concentration
        );
        *d = Some(etat.clone());
        let _ = app.emit(evenements::NE_PAS_DERANGER, &etat);
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use windows::core::{w, IInspectable};
    use windows::Foundation::TypedEventHandler;
    use windows::Win32::Foundation::{CloseHandle, HANDLE};
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegNotifyChangeKeyValue, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER, KEY_NOTIFY,
        KEY_READ, REG_NOTIFY_CHANGE_LAST_SET,
    };
    use windows::Win32::System::Threading::{CreateEventW, SetEvent, WaitForSingleObject, INFINITE};
    use windows::UI::Shell::FocusSessionManager;

    const CLE: windows::core::PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings");
    const VALEUR: windows::core::PCWSTR = w!("NOC_GLOBAL_SETTING_TOASTS_ENABLED");

    /// Valeur absente = notifications actives = « Ne pas déranger » désactivé.
    fn lire_registre(cle: HKEY) -> Option<bool> {
        let mut valeur: u32 = 1;
        let mut taille = std::mem::size_of::<u32>() as u32;
        let r = unsafe {
            RegQueryValueExW(
                cle,
                VALEUR,
                None,
                None,
                Some(&mut valeur as *mut u32 as *mut u8),
                Some(&mut taille),
            )
        };
        if r.is_ok() {
            Some(valeur == 0)
        } else {
            Some(false)
        }
    }

    pub fn demarrer(app: AppHandle) {
        std::thread::Builder::new()
            .name("ile-ne-pas-deranger".into())
            .spawn(move || unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                let evenement = match CreateEventW(None, false, false, None) {
                    Ok(h) => h,
                    Err(e) => return journal!("ne-pas-deranger", "indisponible : {e}"),
                };
                // Pointeur brut pour le rappel WinRT (HANDLE n'est pas Send).
                let ev_brut = evenement.0 as usize;

                // Session de concentration (Windows 11 22H2+).
                let focus = FocusSessionManager::IsSupported()
                    .unwrap_or(false)
                    .then(|| FocusSessionManager::GetDefault().ok())
                    .flatten();
                if let Some(f) = &focus {
                    let _ = f.IsFocusActiveChanged(&TypedEventHandler::<FocusSessionManager, IInspectable>::new(
                        move |_, _| {
                            let _ = SetEvent(HANDLE(ev_brut as *mut _));
                            Ok(())
                        },
                    ));
                } else {
                    journal!(
                        "ne-pas-deranger",
                        "sessions de concentration non prises en charge sur ce Windows"
                    );
                }

                let mut cle = HKEY::default();
                let cle_ok = RegOpenKeyExW(HKEY_CURRENT_USER, CLE, None, KEY_READ | KEY_NOTIFY, &mut cle).is_ok();
                if !cle_ok {
                    journal!("ne-pas-deranger", "clé de registre introuvable");
                }

                loop {
                    if cle_ok {
                        // Réarmer AVANT de lire pour ne rater aucun changement.
                        let _ = RegNotifyChangeKeyValue(cle, false, REG_NOTIFY_CHANGE_LAST_SET, Some(evenement), true);
                    }
                    let registre = cle_ok.then(|| lire_registre(cle)).flatten();
                    let session = focus.as_ref().and_then(|f| f.IsFocusActive().ok());
                    publier(&app, combiner(registre, session));
                    if !cle_ok && focus.is_none() {
                        break;
                    }
                    WaitForSingleObject(evenement, INFINITE);
                }
                if cle_ok {
                    let _ = RegCloseKey(cle);
                }
                let _ = CloseHandle(evenement);
            })
            .expect("impossible de lancer le fil « ne pas déranger »");
    }
}

#[cfg(windows)]
pub use win::demarrer;

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("ne-pas-deranger", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combinaison() {
        assert!(!combiner(None, None).actif);
        assert!(combiner(Some(true), None).actif);
        assert!(combiner(Some(false), Some(true)).actif);
        assert!(!combiner(Some(false), Some(false)).actif);
    }
}
