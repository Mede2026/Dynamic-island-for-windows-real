//! Clés USB et disques externes : alerte quand un lecteur apparaît ou disparaît.
//!
//! Relevé des lettres de lecteur toutes les 1,5 s (`GetLogicalDrives`, quasi gratuit) :
//! pas besoin de fenêtre cachée pour recevoir les messages de Windows. Les lecteurs déjà
//! là au démarrage de l'île ne déclenchent rien.

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "usb";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct LecteurUsb {
    pub branche: bool,
    /// « E: »
    pub lettre: String,
    /// Nom du volume (« KINGSTON »), ou vide.
    pub nom: String,
    /// Clé (amovible) ou disque externe.
    pub amovible: bool,
}

/// Lettres présentes dans un masque `GetLogicalDrives` (bit 0 = A:).
pub fn lettres(masque: u32) -> Vec<char> {
    (0..26u8)
        .filter(|i| masque & (1 << i) != 0)
        .map(|i| (b'A' + i) as char)
        .collect()
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use std::collections::HashMap;
    use std::time::Duration;
    use tauri::Emitter;
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDriveTypeW, GetLogicalDrives, GetVolumeInformationW};

    const AMOVIBLE: u32 = 2; // DRIVE_REMOVABLE
    const FIXE: u32 = 3; // DRIVE_FIXED

    fn decrire(lettre: char) -> Option<(String, bool)> {
        unsafe {
            let racine = HSTRING::from(format!("{lettre}:\\"));
            let type_ = GetDriveTypeW(&racine);
            if type_ != AMOVIBLE && type_ != FIXE {
                return None;
            }
            let mut nom = [0u16; 64];
            let _ = GetVolumeInformationW(&racine, Some(&mut nom), None, None, None, None);
            let fin = nom.iter().position(|&c| c == 0).unwrap_or(nom.len());
            Some((String::from_utf16_lossy(&nom[..fin]), type_ == AMOVIBLE))
        }
    }

    std::thread::Builder::new()
        .name("ile-usb".into())
        .spawn(move || {
            let mut connus: HashMap<char, (String, bool)> = HashMap::new();
            let mut premier = true;
            loop {
                let presentes = lettres(unsafe { GetLogicalDrives() });
                for &l in &presentes {
                    if connus.contains_key(&l) {
                        continue;
                    }
                    let Some(info) = decrire(l) else { continue };
                    // Au démarrage : on mémorise seulement. Ensuite, un disque « fixe » qui
                    // apparaît est forcément externe (USB).
                    if !premier {
                        journal!("usb", "branché : {l}: « {} »", info.0);
                        let _ = app.emit(
                            EVENEMENT,
                            LecteurUsb {
                                branche: true,
                                lettre: format!("{l}:"),
                                nom: info.0.clone(),
                                amovible: info.1,
                            },
                        );
                    }
                    connus.insert(l, info);
                }
                let partis: Vec<char> = connus.keys().filter(|l| !presentes.contains(l)).copied().collect();
                for l in partis {
                    if let Some((nom, amovible)) = connus.remove(&l) {
                        journal!("usb", "retiré : {l}:");
                        let _ = app.emit(
                            EVENEMENT,
                            LecteurUsb {
                                branche: false,
                                lettre: format!("{l}:"),
                                nom,
                                amovible,
                            },
                        );
                    }
                }
                premier = false;
                std::thread::sleep(Duration::from_millis(1500));
            }
        })
        .ok();
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("usb", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    #[test]
    fn lettres() {
        assert_eq!(super::lettres(0b1100), vec!['C', 'D']);
        assert_eq!(super::lettres(1 | (1 << 25)), vec!['A', 'Z']);
        assert!(super::lettres(0).is_empty());
    }
}
