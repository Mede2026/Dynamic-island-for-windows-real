//! Presse-papiers : une alerte « Copié » quand son contenu change (comme l'exemple fourni).
//! Windows : GetClipboardSequenceNumber (compteur incrémenté à chaque copie) lu toutes les
//! 400 ms — un simple nombre, coût CPU négligeable. Le contenu n'est lu que s'il a changé.

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Copie {
    /// "texte" | "image" | "fichiers" | "autre"
    #[serde(rename = "type")]
    pub genre: &'static str,
    pub apercu: String,
}

/// Aperçu d'un texte copié : une ligne, 60 caractères au plus.
pub fn apercu_texte(t: &str) -> String {
    let ligne: String = t.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut s: String = ligne.chars().take(60).collect();
    if ligne.chars().count() > 60 {
        s.push('…');
    }
    s
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::evenements;
    use std::time::Duration;
    use tauri::Emitter;
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable, OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    const CF_BITMAP: u32 = 2;
    const CF_DIB: u32 = 8;
    const CF_UNICODETEXT: u32 = 13;
    const CF_HDROP: u32 = 15;

    fn lire() -> Option<Copie> {
        unsafe {
            if OpenClipboard(None).is_err() {
                return None; // une autre app le tient : on réessaiera
            }
            let resultat = if IsClipboardFormatAvailable(CF_UNICODETEXT).is_ok() {
                GetClipboardData(CF_UNICODETEXT).ok().map(|h| {
                    let g = HGLOBAL(h.0);
                    let p = GlobalLock(g) as *const u16;
                    let mut texte = String::new();
                    if !p.is_null() {
                        let mut n = 0;
                        while *p.add(n) != 0 && n < 4096 {
                            n += 1;
                        }
                        texte = String::from_utf16_lossy(std::slice::from_raw_parts(p, n));
                        let _ = GlobalUnlock(g);
                    }
                    Copie {
                        genre: "texte",
                        apercu: apercu_texte(&texte),
                    }
                })
            } else if IsClipboardFormatAvailable(CF_HDROP).is_ok() {
                Some(Copie {
                    genre: "fichiers",
                    apercu: String::new(),
                })
            } else if IsClipboardFormatAvailable(CF_DIB).is_ok() || IsClipboardFormatAvailable(CF_BITMAP).is_ok() {
                Some(Copie {
                    genre: "image",
                    apercu: String::new(),
                })
            } else {
                Some(Copie {
                    genre: "autre",
                    apercu: String::new(),
                })
            };
            let _ = CloseClipboard();
            resultat
        }
    }

    pub fn demarrer(app: AppHandle) {
        std::thread::Builder::new()
            .name("ile-presse-papiers".into())
            .spawn(move || {
                let mut sequence = unsafe { GetClipboardSequenceNumber() };
                loop {
                    std::thread::sleep(Duration::from_millis(400));
                    let s = unsafe { GetClipboardSequenceNumber() };
                    if s == sequence {
                        continue;
                    }
                    if let Some(c) = lire() {
                        sequence = s;
                        journal!("presse-papiers", "{} « {} »", c.genre, c.apercu);
                        let _ = app.emit(evenements::PRESSE_PAPIERS, &c);
                    }
                }
            })
            .expect("impossible de lancer le fil du presse-papiers");
    }
}

#[cfg(windows)]
pub use win::demarrer;

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("presse-papiers", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apercu() {
        assert_eq!(apercu_texte("  Bonjour\n  le   monde "), "Bonjour le monde");
        let long = "a".repeat(80);
        assert_eq!(apercu_texte(&long).chars().count(), 61);
        assert!(apercu_texte(&long).ends_with('…'));
    }
}
