//! Écrire dans le presse-papiers (bouton « Copier le code », fichiers de l'étagère) et
//! ouvrir des fichiers.

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::{HANDLE, HWND};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;
    const CF_HDROP: u32 = 15;

    /// Met `octets` dans le presse-papiers au format donné (mémoire globale, cédée à Windows).
    unsafe fn poser(format: u32, octets: &[u8]) -> Result<(), String> {
        let memoire = GlobalAlloc(GMEM_MOVEABLE, octets.len()).map_err(|e| e.to_string())?;
        let p = GlobalLock(memoire) as *mut u8;
        if p.is_null() {
            return Err("mémoire indisponible".into());
        }
        std::ptr::copy_nonoverlapping(octets.as_ptr(), p, octets.len());
        let _ = GlobalUnlock(memoire);
        // Plusieurs essais : une autre app peut avoir le presse-papiers ouvert un instant.
        let mut ouvert = false;
        for _ in 0..10 {
            if OpenClipboard(Some(HWND::default())).is_ok() {
                ouvert = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        if !ouvert {
            return Err("presse-papiers occupé".into());
        }
        let _ = EmptyClipboard();
        let r = SetClipboardData(format, Some(HANDLE(memoire.0)))
            .map(|_| ())
            .map_err(|e| e.to_string());
        let _ = CloseClipboard();
        r
    }

    /// Image (PNG) → presse-papiers en CF_DIB (32 bits, de bas en haut).
    pub fn image(png: &[u8]) -> Result<(), String> {
        let img = image::load_from_memory(png).map_err(|e| e.to_string())?.to_rgba8();
        let (l, h) = img.dimensions();
        let mut dib = Vec::with_capacity(40 + (l * h * 4) as usize);
        for v in [40u32, l, h] {
            dib.extend_from_slice(&v.to_le_bytes());
        }
        dib.extend_from_slice(&1u16.to_le_bytes()); // plans
        dib.extend_from_slice(&32u16.to_le_bytes()); // bits par pixel
        for v in [0u32, l * h * 4, 2835, 2835, 0, 0] {
            dib.extend_from_slice(&v.to_le_bytes()); // BI_RGB, taille, 72 ppp, couleurs
        }
        for y in (0..h).rev() {
            for x in 0..l {
                let p = img.get_pixel(x, y).0;
                dib.extend_from_slice(&[p[2], p[1], p[0], p[3]]);
            }
        }
        unsafe { poser(8, &dib) } // CF_DIB
    }

    pub fn texte(t: &str) -> Result<(), String> {
        let octets: Vec<u8> = t.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
        unsafe { poser(CF_UNICODETEXT, &octets) }
    }

    /// Fichiers (CF_HDROP) : « Coller » dans l'Explorateur, Discord, un courriel…
    pub fn fichiers(chemins: &[String]) -> Result<(), String> {
        // DROPFILES : 20 octets (pFiles, pt.x, pt.y, fNC, fWide), puis les chemins UTF-16
        // séparés par des zéros, terminés par un double zéro.
        let mut octets = Vec::new();
        octets.extend_from_slice(&20u32.to_le_bytes());
        octets.extend_from_slice(&0i32.to_le_bytes());
        octets.extend_from_slice(&0i32.to_le_bytes());
        octets.extend_from_slice(&0u32.to_le_bytes());
        octets.extend_from_slice(&1u32.to_le_bytes());
        for c in chemins {
            octets.extend(c.encode_utf16().chain([0]).flat_map(u16::to_le_bytes));
        }
        octets.extend_from_slice(&[0, 0]);
        unsafe { poser(CF_HDROP, &octets) }
    }

    pub fn ouvrir(chemin: &str, dans_explorateur: bool) -> Result<(), String> {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        unsafe {
            if dans_explorateur {
                ShellExecuteW(
                    None,
                    &HSTRING::from("open"),
                    &HSTRING::from("explorer.exe"),
                    &HSTRING::from(format!("/select,\"{chemin}\"")),
                    None,
                    SW_SHOWNORMAL,
                );
            } else {
                ShellExecuteW(
                    None,
                    &HSTRING::from("open"),
                    &HSTRING::from(chemin),
                    None,
                    None,
                    SW_SHOWNORMAL,
                );
            }
        }
        Ok(())
    }
}

#[cfg(not(windows))]
mod win {
    pub fn image(_png: &[u8]) -> Result<(), String> {
        Err("Windows seulement".into())
    }
    pub fn texte(_t: &str) -> Result<(), String> {
        Err("Windows seulement".into())
    }
    pub fn fichiers(_c: &[String]) -> Result<(), String> {
        Err("Windows seulement".into())
    }
    pub fn ouvrir(_c: &str, _e: bool) -> Result<(), String> {
        Err("Windows seulement".into())
    }
}

/// Image PNG → presse-papiers.
pub fn image(png: &[u8]) -> Result<(), String> {
    win::image(png)
}

#[tauri::command]
pub fn copier_texte(texte: String) -> Result<(), String> {
    win::texte(&texte)
}

#[tauri::command]
pub fn copier_fichiers(chemins: Vec<String>) -> Result<(), String> {
    win::fichiers(&chemins)
}

/// Ouvre un fichier (ou le montre dans l'Explorateur). Seulement un fichier qui existe.
#[tauri::command]
pub fn ouvrir_fichier(chemin: String, dans_explorateur: bool) -> Result<(), String> {
    if !std::path::Path::new(&chemin).exists() {
        return Err("fichier introuvable".into());
    }
    win::ouvrir(&chemin, dans_explorateur)
}
