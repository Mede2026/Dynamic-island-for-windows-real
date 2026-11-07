//! Bureaux virtuels (Win+Ctrl+flèches) : « Bureau 2 » dans l'île quand on change de bureau.
//! Windows garde le bureau actuel et la liste dans le registre
//! (HKCU\…\Explorer\VirtualDesktops) : on attend ses changements, sans scruter.

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "bureau";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Bureau {
    /// 1 pour le premier bureau.
    pub numero: usize,
    pub total: usize,
    /// Nom donné par l'utilisateur (« Travail »), sinon None.
    pub nom: Option<String>,
}

/// Position (1…) de `actuel` dans la liste des identifiants (16 octets chacun).
pub fn position(liste: &[u8], actuel: &[u8]) -> Option<(usize, usize)> {
    if actuel.len() != 16 || liste.is_empty() || !liste.len().is_multiple_of(16) {
        return None;
    }
    let total = liste.len() / 16;
    liste.chunks(16).position(|g| g == actuel).map(|i| (i + 1, total))
}

/// GUID binaire (ordre de Windows) → « {XXXXXXXX-XXXX-…} ».
pub fn guid_texte(o: &[u8]) -> String {
    format!(
        "{{{:08X}-{:04X}-{:04X}-{:02X}{:02X}-{:02X}{:02X}{:02X}{:02X}{:02X}{:02X}}}",
        u32::from_le_bytes([o[0], o[1], o[2], o[3]]),
        u16::from_le_bytes([o[4], o[5]]),
        u16::from_le_bytes([o[6], o[7]]),
        o[8],
        o[9],
        o[10],
        o[11],
        o[12],
        o[13],
        o[14],
        o[15]
    )
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use tauri::Emitter;
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{
        RegGetValueW, RegNotifyChangeKeyValue, RegOpenKeyExW, HKEY, HKEY_CURRENT_USER, KEY_NOTIFY, KEY_READ,
        REG_NOTIFY_CHANGE_LAST_SET, RRF_RT_REG_BINARY, RRF_RT_REG_SZ,
    };
    use windows::Win32::System::Threading::{CreateEventW, WaitForSingleObject, INFINITE};

    const CLE: &str = r"Software\Microsoft\Windows\CurrentVersion\Explorer\VirtualDesktops";

    fn binaire(cle: &str, nom: &str) -> Vec<u8> {
        unsafe {
            let mut taille = 0u32;
            let (c, n) = (HSTRING::from(cle), HSTRING::from(nom));
            if RegGetValueW(
                HKEY_CURRENT_USER,
                &c,
                &n,
                RRF_RT_REG_BINARY,
                None,
                None,
                Some(&mut taille),
            )
            .is_err()
            {
                return Vec::new();
            }
            let mut o = vec![0u8; taille as usize];
            let _ = RegGetValueW(
                HKEY_CURRENT_USER,
                &c,
                &n,
                RRF_RT_REG_BINARY,
                None,
                Some(o.as_mut_ptr() as *mut _),
                Some(&mut taille),
            );
            o.truncate(taille as usize);
            o
        }
    }

    fn texte(cle: &str, nom: &str) -> Option<String> {
        unsafe {
            let mut t = [0u16; 128];
            let mut taille = (t.len() * 2) as u32;
            RegGetValueW(
                HKEY_CURRENT_USER,
                &HSTRING::from(cle),
                &HSTRING::from(nom),
                RRF_RT_REG_SZ,
                None,
                Some(t.as_mut_ptr() as *mut _),
                Some(&mut taille),
            )
            .ok()
            .ok()?;
            let n = t.iter().position(|&c| c == 0).unwrap_or(t.len());
            Some(String::from_utf16_lossy(&t[..n])).filter(|s| !s.is_empty())
        }
    }

    fn lire() -> Option<Bureau> {
        let actuel = binaire(CLE, "CurrentVirtualDesktop");
        let (numero, total) = position(&binaire(CLE, "VirtualDesktopIDs"), &actuel)?;
        let nom = texte(&format!(r"{CLE}\Desktops\{}", guid_texte(&actuel)), "Name");
        Some(Bureau { numero, total, nom })
    }

    std::thread::Builder::new()
        .name("ile-bureaux".into())
        .spawn(move || unsafe {
            let mut cle = HKEY::default();
            if RegOpenKeyExW(
                HKEY_CURRENT_USER,
                &HSTRING::from(CLE),
                None,
                KEY_READ | KEY_NOTIFY,
                &mut cle,
            )
            .is_err()
            {
                return journal!("bureaux", "clé du registre introuvable");
            }
            let Ok(evenement) = CreateEventW(None, false, false, None) else {
                return;
            };
            let mut avant = lire();
            journal!("bureaux", "prêt ({:?})", avant);
            loop {
                let _ = RegNotifyChangeKeyValue(cle, true, REG_NOTIFY_CHANGE_LAST_SET, Some(evenement), true);
                WaitForSingleObject(evenement, INFINITE);
                let maintenant = lire();
                if maintenant.as_ref().map(|b| b.numero) != avant.as_ref().map(|b| b.numero) {
                    if let Some(b) = &maintenant {
                        journal!("bureaux", "bureau {} / {}", b.numero, b.total);
                        super::osd::signaler(); // cacher l'indicateur de Windows
                        let _ = app.emit(EVENEMENT, b);
                    }
                }
                avant = maintenant;
            }
        })
        .ok();
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("bureaux", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn positions() {
        let a = [1u8; 16];
        let b = [2u8; 16];
        let liste: Vec<u8> = a.iter().chain(b.iter()).copied().collect();
        assert_eq!(position(&liste, &b), Some((2, 2)));
        assert_eq!(position(&liste, &[3u8; 16]), None);
        assert_eq!(position(&[], &a), None);
    }

    #[test]
    fn guid() {
        let o = [0x78, 0x56, 0x34, 0x12, 0xBC, 0x9A, 0xF0, 0xDE, 1, 2, 3, 4, 5, 6, 7, 8];
        assert_eq!(guid_texte(&o), "{12345678-9ABC-DEF0-0102-030405060708}");
    }
}
