//! Presse-papiers : une alerte « Copié » quand son contenu change (comme l'exemple fourni).
//! Windows : GetClipboardSequenceNumber (compteur incrémenté à chaque copie) lu toutes les
//! 400 ms — un simple nombre, coût CPU négligeable. Le contenu n'est lu que s'il a changé.

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Copie {
    /// "texte" | "image" | "capture" (Win+Maj+S) | "fichiers" | "autre"
    #[serde(rename = "type")]
    pub genre: &'static str,
    pub apercu: String,
    /// Miniature PNG (base64) pour une image ou une capture d'écran.
    pub miniature: Option<String>,
}

/// L'image vient-elle de l'outil de capture (Win+Maj+S, Outil Capture d'écran) ?
pub fn est_outil_capture(exe: &str) -> bool {
    let e = exe.to_lowercase();
    e.contains("screenclippinghost") || e.contains("snippingtool")
}

/// DIB du presse-papiers (CF_DIB) → fichier BMP complet (ajout de l'en-tête de 14 octets).
pub fn dib_vers_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let u32_a = |i: usize| u32::from_le_bytes([dib[i], dib[i + 1], dib[i + 2], dib[i + 3]]);
    let taille_entete = u32_a(0) as usize;
    let bits = u16::from_le_bytes([dib[14], dib[15]]);
    let compression = u32_a(16);
    let couleurs = u32_a(32) as usize;
    let masques = if taille_entete == 40 && compression == 3 { 12 } else { 0 };
    let palette = if couleurs > 0 {
        couleurs * 4
    } else if bits <= 8 {
        (1usize << bits) * 4
    } else {
        0
    };
    let decalage = 14 + taille_entete + masques + palette;
    let mut bmp = Vec::with_capacity(14 + dib.len());
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&((14 + dib.len()) as u32).to_le_bytes());
    bmp.extend_from_slice(&[0, 0, 0, 0]);
    bmp.extend_from_slice(&(decalage as u32).to_le_bytes());
    bmp.extend_from_slice(dib);
    Some(bmp)
}

/// Image BMP → miniature PNG en base64 (200 px au plus).
pub fn miniature(octets_bmp: &[u8]) -> Option<String> {
    use base64::Engine;
    let img = image::load_from_memory_with_format(octets_bmp, image::ImageFormat::Bmp).ok()?;
    let petite = img.thumbnail(200, 200);
    let mut png = Vec::new();
    petite
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    Some(base64::engine::general_purpose::STANDARD.encode(png))
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
    use windows::Win32::Foundation::{CloseHandle, HGLOBAL};
    use windows::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, GetClipboardOwner, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
        OpenClipboard,
    };
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;

    const CF_BITMAP: u32 = 2;
    const CF_DIB: u32 = 8;
    const CF_UNICODETEXT: u32 = 13;
    const CF_HDROP: u32 = 15;

    /// Nom de l'exécutable qui a rempli le presse-papiers.
    unsafe fn exe_proprietaire() -> String {
        let Ok(hwnd) = GetClipboardOwner() else {
            return String::new();
        };
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
            return String::new();
        };
        let mut tampon = [0u16; 512];
        let mut n = tampon.len() as u32;
        let ok = QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, windows::core::PWSTR(tampon.as_mut_ptr()), &mut n)
            .is_ok();
        let _ = CloseHandle(p);
        if ok {
            String::from_utf16_lossy(&tampon[..n as usize])
        } else {
            String::new()
        }
    }

    /// Octets bruts d'un format du presse-papiers (déjà ouvert).
    unsafe fn octets(format: u32) -> Option<Vec<u8>> {
        let h = GetClipboardData(format).ok()?;
        let g = HGLOBAL(h.0);
        let taille = GlobalSize(g);
        let p = GlobalLock(g) as *const u8;
        if p.is_null() || taille == 0 {
            return None;
        }
        let v = std::slice::from_raw_parts(p, taille).to_vec();
        let _ = GlobalUnlock(g);
        Some(v)
    }

    /// Le contenu est-il marqué « à ne pas surveiller / pas d'historique » (mots de passe) ?
    unsafe fn sensible() -> bool {
        use windows::core::w;
        use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
        let exclu = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
        let ignore = RegisterClipboardFormatW(w!("Clipboard Viewer Ignore"));
        if (exclu != 0 && IsClipboardFormatAvailable(exclu).is_ok())
            || (ignore != 0 && IsClipboardFormatAvailable(ignore).is_ok())
        {
            return true;
        }
        // « CanIncludeInClipboardHistory » = 0 : l'app refuse l'historique.
        let historique = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
        historique != 0
            && IsClipboardFormatAvailable(historique).is_ok()
            && octets(historique).is_some_and(|o| o.len() >= 4 && u32::from_le_bytes([o[0], o[1], o[2], o[3]]) == 0)
    }

    fn copie(genre: &'static str, apercu: String, miniature: Option<String>) -> Option<Copie> {
        Some(Copie {
            genre,
            apercu,
            miniature,
        })
    }

    fn lire() -> Option<Copie> {
        unsafe {
            if OpenClipboard(None).is_err() {
                return None; // une autre app le tient : on réessaiera
            }
            let resultat = if IsClipboardFormatAvailable(CF_UNICODETEXT).is_ok() {
                let texte = octets(CF_UNICODETEXT)
                    .map(|o| {
                        let u: Vec<u16> = o
                            .chunks_exact(2)
                            .map(|c| u16::from_le_bytes([c[0], c[1]]))
                            .take(crate::systeme::historique::LONGUEUR_MAX)
                            .collect();
                        let fin = u.iter().position(|&c| c == 0).unwrap_or(u.len());
                        String::from_utf16_lossy(&u[..fin])
                    })
                    .unwrap_or_default();
                // Mot de passe copié depuis un gestionnaire (il le signale à Windows) : ni
                // aperçu, ni historique.
                if sensible() {
                    copie("texte", String::new(), None)
                } else {
                    crate::systeme::historique::ajouter(&texte);
                    copie("texte", apercu_texte(&texte), None)
                }
            } else if IsClipboardFormatAvailable(CF_HDROP).is_ok() {
                copie("fichiers", String::new(), None)
            } else if IsClipboardFormatAvailable(CF_DIB).is_ok() || IsClipboardFormatAvailable(CF_BITMAP).is_ok() {
                let genre = if est_outil_capture(&exe_proprietaire()) {
                    "capture"
                } else {
                    "image"
                };
                let mini = octets(CF_DIB)
                    .and_then(|d| dib_vers_bmp(&d))
                    .and_then(|b| miniature(&b));
                copie(genre, String::new(), mini)
            } else {
                copie("autre", String::new(), None)
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
    fn capture_et_miniature() {
        assert!(est_outil_capture(r"C:\Windows\SystemApps\ScreenClippingHost.exe"));
        assert!(est_outil_capture(r"C:\Program Files\WindowsApps\SnippingTool.exe"));
        assert!(!est_outil_capture(r"C:\Paint.exe"));
        // DIB 24 bits de 4×2 px (rouge) → BMP → miniature PNG.
        let (l, h) = (4u32, 2u32);
        let ligne = (l * 3).div_ceil(4) * 4;
        let mut dib = Vec::new();
        for v in [40u32, l, h] {
            dib.extend_from_slice(&v.to_le_bytes());
        }
        dib.extend_from_slice(&1u16.to_le_bytes());
        dib.extend_from_slice(&24u16.to_le_bytes());
        for v in [0u32, ligne * h, 2835, 2835, 0, 0] {
            dib.extend_from_slice(&v.to_le_bytes());
        }
        for _ in 0..h {
            for _ in 0..l {
                dib.extend_from_slice(&[0, 0, 255]);
            }
            dib.extend(std::iter::repeat_n(0, (ligne - l * 3) as usize));
        }
        let bmp = dib_vers_bmp(&dib).unwrap();
        assert!(miniature(&bmp).is_some());
        assert!(dib_vers_bmp(&[0; 10]).is_none());
    }

    #[test]
    fn apercu() {
        assert_eq!(apercu_texte("  Bonjour\n  le   monde "), "Bonjour le monde");
        let long = "a".repeat(80);
        assert_eq!(apercu_texte(&long).chars().count(), 61);
        assert!(apercu_texte(&long).ends_with('…'));
    }
}
