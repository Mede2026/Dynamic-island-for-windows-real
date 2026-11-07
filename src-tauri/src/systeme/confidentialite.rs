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
    /// Une app enregistre ou capture l'écran (Outil Capture en vidéo, Xbox Game Bar…) :
    /// Windows le note dans « graphicsCaptureProgrammatic » comme la caméra.
    pub ecran: bool,
}

static DERNIER: std::sync::Mutex<Option<Confidentialite>> = std::sync::Mutex::new(None);

pub fn dernier() -> Option<Confidentialite> {
    *DERNIER.lock().unwrap()
}

pub const EVENEMENT_APPEL: &str = "appel";

/// Appel en cours (Teams, Discord, Zoom…) détecté par l'utilisation du micro.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Appel {
    pub actif: bool,
    pub application: Option<String>,
}

/// Applications d'appel reconnues (fragment du nom dans le registre → nom affiché).
const APPS_APPEL: [(&str, &str); 12] = [
    // « Lien avec Windows » (Phone Link) : appel du téléphone pris sur le PC.
    ("yourphone", "Téléphone"),
    ("phonelink", "Téléphone"),
    ("teams", "Teams"),
    ("discord", "Discord"),
    ("zoom", "Zoom"),
    ("skype", "Skype"),
    ("slack", "Slack"),
    ("whatsapp", "WhatsApp"),
    ("webex", "Webex"),
    ("signal", "Signal"),
    ("telegram", "Telegram"),
    ("facetime", "FaceTime"),
];

/// Nom de clé du registre (ex. « MSTeams_8wekyb3d8bbwe » ou « C:#…#Discord.exe ») → app d'appel.
pub fn app_d_appel(cle: &str) -> Option<String> {
    let c = cle.to_lowercase();
    APPS_APPEL
        .iter()
        .find(|(f, _)| c.contains(f))
        .map(|(_, n)| n.to_string())
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

    /// Noms (clés du registre) des apps qui utilisent le périphérique en ce moment.
    fn utilisateurs(k: HKEY, profondeur: u32, sortie: &mut Vec<String>) {
        for nom in sous_cles(k) {
            if let Some(sk) = ouvrir(k, &nom) {
                if en_cours(qword(sk, w!("LastUsedTimeStart")), qword(sk, w!("LastUsedTimeStop"))) {
                    sortie.push(nom.clone());
                } else if profondeur < 2 {
                    utilisateurs(sk, profondeur + 1, sortie);
                }
                unsafe {
                    let _ = RegCloseKey(sk);
                }
            }
        }
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
                // Capture d'écran : la clé n'existe qu'après une première capture.
                let ecr = ouvrir(HKEY_CURRENT_USER, &format!("{RACINE}graphicsCaptureProgrammatic"));
                let ecr2 = ouvrir(HKEY_CURRENT_USER, &format!("{RACINE}graphicsCaptureWithoutBorder"));
                let (Ok(e1), Ok(e2), Ok(e3)) = (
                    CreateEventW(None, false, false, None),
                    CreateEventW(None, false, false, None),
                    CreateEventW(None, false, false, None),
                ) else {
                    return;
                };
                let mut dernier: Option<Confidentialite> = None;
                let mut dernier_appel: Option<String> = None;
                loop {
                    let _ = RegNotifyChangeKeyValue(cam, true, REG_NOTIFY_CHANGE_LAST_SET, Some(e1), true);
                    let _ = RegNotifyChangeKeyValue(mic, true, REG_NOTIFY_CHANGE_LAST_SET, Some(e2), true);
                    let mut apps_ecran = Vec::new();
                    for k in [ecr, ecr2].into_iter().flatten() {
                        let _ = RegNotifyChangeKeyValue(k, true, REG_NOTIFY_CHANGE_LAST_SET, Some(e3), true);
                        utilisateurs(k, 0, &mut apps_ecran);
                    }
                    let (mut apps_cam, mut apps_mic) = (Vec::new(), Vec::new());
                    utilisateurs(cam, 0, &mut apps_cam);
                    utilisateurs(mic, 0, &mut apps_mic);
                    let etat = Confidentialite {
                        camera: !apps_cam.is_empty(),
                        micro: !apps_mic.is_empty(),
                        ecran: !apps_ecran.is_empty(),
                    };
                    // Appel en cours : une app d'appel utilise le micro.
                    let appel = apps_mic.iter().find_map(|n| app_d_appel(n));
                    if appel != dernier_appel {
                        journal!("appel", "{:?}", appel);
                        let _ = app.emit(
                            EVENEMENT_APPEL,
                            Appel {
                                actif: appel.is_some(),
                                application: appel.clone(),
                            },
                        );
                        dernier_appel = appel;
                    }
                    if dernier != Some(etat) {
                        journal!(
                            "confidentialite",
                            "caméra={} micro={} écran={}",
                            etat.camera,
                            etat.micro,
                            etat.ecran
                        );
                        let _ = app.emit(evenements::CONFIDENTIALITE, etat);
                        *DERNIER.lock().unwrap() = Some(etat);
                        dernier = Some(etat);
                    }
                    let evts: [HANDLE; 3] = [e1, e2, e3];
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
    fn apps_d_appel() {
        assert_eq!(app_d_appel("MSTeams_8wekyb3d8bbwe").as_deref(), Some("Teams"));
        assert_eq!(
            app_d_appel(r"C:#Users#mede#AppData#Local#Discord#app-1.0.9#Discord.exe").as_deref(),
            Some("Discord")
        );
        assert_eq!(app_d_appel(r"C:#Program Files#Google#Chrome#chrome.exe"), None);
    }

    #[test]
    fn regle() {
        assert!(en_cours(133_000_000, 0));
        assert!(!en_cours(133_000_000, 133_000_100));
        assert!(!en_cours(0, 0));
    }
}
