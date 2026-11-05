//! Caméra / micro en cours d'utilisation → point vert ou orange, comme sur iPhone :
//!  - orange = micro seul ; vert = caméra (avec ou sans micro) — voir Apple, HT211876.
//!
//! Windows enregistre l'utilisation dans le registre :
//!   HKCU\Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore\{webcam,microphone}
//!   (sous-clés par app, et NonPackaged\<chemin de l'exe>), valeurs LastUsedTimeStart / LastUsedTimeStop.
//! Une app utilise le périphérique si LastUsedTimeStart > 0 et LastUsedTimeStop == 0.
//! Aucune scrutation : on attend les changements du registre (RegNotifyChangeKeyValue).

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq, Default)]
pub struct Confidentialite {
    pub camera: bool,
    pub micro: bool,
}

/// Règle d'utilisation (fonction pure, testée).
pub fn en_cours(debut: u64, fin: u64) -> bool {
    debut > 0 && fin == 0
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::evenements;
    use tauri::Emitter;
    use windows::core::{w, PCWSTR, PWSTR};
    use windows::Win32::Foundation::{ERROR_SUCCESS, HANDLE};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegNotifyChangeKeyValue, RegOpenKeyExW, RegQueryValueExW, HKEY, HKEY_CURRENT_USER,
        KEY_NOTIFY, KEY_READ, REG_NOTIFY_CHANGE_LAST_SET,
    };
    use windows::Win32::System::Threading::{CreateEventW, WaitForMultipleObjects, INFINITE};

    const RACINE: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\";

    fn ouvrir(parent: HKEY, chemin: &str) -> Option<HKEY> {
        let c: Vec<u16> = chemin.encode_utf16().chain(Some(0)).collect();
        let mut k = HKEY::default();
        unsafe { RegOpenKeyExW(parent, PCWSTR(c.as_ptr()), None, KEY_READ | KEY_NOTIFY, &mut k) }
            .is_ok()
            .then_some(k)
    }

    fn qword(k: HKEY, nom: PCWSTR) -> u64 {
        let mut v: u64 = 0;
        let mut taille = 8u32;
        let r = unsafe {
            RegQueryValueExW(
                k,
                nom,
                None,
                None,
                Some(&mut v as *mut u64 as *mut u8),
                Some(&mut taille),
            )
        };
        if r == ERROR_SUCCESS {
            v
        } else {
            0
        }
    }

    fn sous_cles(k: HKEY) -> Vec<String> {
        let mut noms = Vec::new();
        for i in 0.. {
            let mut tampon = [0u16; 512];
            let mut n = tampon.len() as u32;
            let r = unsafe { RegEnumKeyExW(k, i, Some(PWSTR(tampon.as_mut_ptr())), &mut n, None, None, None, None) };
            if r != ERROR_SUCCESS {
                break;
            }
            noms.push(String::from_utf16_lossy(&tampon[..n as usize]));
        }
        noms
    }

    /// Une app (à n'importe quelle profondeur ≤ 2) utilise-t-elle le périphérique ?
    fn utilise(k: HKEY, profondeur: u32) -> bool {
        for nom in sous_cles(k) {
            if let Some(sk) = ouvrir(k, &nom) {
                let actif = en_cours(qword(sk, w!("LastUsedTimeStart")), qword(sk, w!("LastUsedTimeStop")))
                    || (profondeur < 2 && utilise(sk, profondeur + 1));
                unsafe {
                    let _ = RegCloseKey(sk);
                }
                if actif {
                    return true;
                }
            }
        }
        false
    }

    pub fn demarrer(app: AppHandle) {
        std::thread::Builder::new()
            .name("ile-confidentialite".into())
            .spawn(move || unsafe {
                let (Some(cam), Some(mic)) = (
                    ouvrir(HKEY_CURRENT_USER, &format!("{RACINE}webcam")),
                    ouvrir(HKEY_CURRENT_USER, &format!("{RACINE}microphone")),
                ) else {
                    return journal!("confidentialite", "clés du registre introuvables");
                };
                let (Ok(e1), Ok(e2)) = (
                    CreateEventW(None, false, false, None),
                    CreateEventW(None, false, false, None),
                ) else {
                    return;
                };
                let mut dernier: Option<Confidentialite> = None;
                loop {
                    let _ = RegNotifyChangeKeyValue(cam, true, REG_NOTIFY_CHANGE_LAST_SET, Some(e1), true);
                    let _ = RegNotifyChangeKeyValue(mic, true, REG_NOTIFY_CHANGE_LAST_SET, Some(e2), true);
                    let etat = Confidentialite {
                        camera: utilise(cam, 0),
                        micro: utilise(mic, 0),
                    };
                    if dernier != Some(etat) {
                        journal!("confidentialite", "caméra={} micro={}", etat.camera, etat.micro);
                        let _ = app.emit(evenements::CONFIDENTIALITE, etat);
                        dernier = Some(etat);
                    }
                    let evts: [HANDLE; 2] = [e1, e2];
                    WaitForMultipleObjects(&evts, false, INFINITE);
                }
            })
            .expect("impossible de lancer le fil caméra/micro");
    }
}

#[cfg(windows)]
pub use win::demarrer;

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("confidentialite", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn regle() {
        assert!(en_cours(133_000_000, 0));
        assert!(!en_cours(133_000_000, 133_000_100));
        assert!(!en_cours(0, 0));
    }
}
