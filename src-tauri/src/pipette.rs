//! Pipette : le prochain clic (n'importe où à l'écran) donne la couleur du pixel, copiée en
//! « #RRGGBB ». Pendant l'attente, la couleur sous la souris est envoyée en direct
//! (« pipette », `fini` faux). Le clic est avalé (rien n'est cliqué dessous) ; clic droit ou
//! 20 s sans clic = annulé.

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Couleur {
    pub hex: String,
    pub fini: bool,
    pub annule: bool,
}

pub fn hex(r: u8, g: u8, b: u8) -> String {
    format!("#{r:02X}{g:02X}{b:02X}")
}

#[tauri::command]
pub async fn pipette(app: tauri::AppHandle) -> Result<(), String> {
    plateforme::lancer(app)
}

#[tauri::command]
pub fn copier_image(png_base64: String) -> Result<(), String> {
    use base64::Engine;
    let png = base64::engine::general_purpose::STANDARD
        .decode(png_base64.trim_start_matches("data:image/png;base64,"))
        .map_err(|e| e.to_string())?;
    crate::systeme::ecrire::image(&png)
}

/// Enregistre un dessin (PNG base64) dans Images › Dynamic Island ; renvoie le chemin.
#[tauri::command]
pub fn enregistrer_image(png_base64: String) -> Result<String, String> {
    use base64::Engine;
    let png = base64::engine::general_purpose::STANDARD.decode(png_base64).map_err(|e| e.to_string())?;
    if !png.starts_with(&[0x89, b'P', b'N', b'G']) {
        return Err("Ce n'est pas une image PNG.".into());
    }
    let base = std::env::var("USERPROFILE").map(std::path::PathBuf::from).unwrap_or_else(|_| std::env::temp_dir());
    let dossier = base.join("Pictures").join("Dynamic Island");
    std::fs::create_dir_all(&dossier).map_err(|e| e.to_string())?;
    let secondes = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let chemin = dossier.join(format!("dessin-{secondes}.png"));
    std::fs::write(&chemin, png).map_err(|e| e.to_string())?;
    Ok(chemin.display().to_string())
}

#[cfg(windows)]
mod plateforme {
    use super::{hex, Couleur};
    use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
    use tauri::Emitter;
    use windows::Win32::Foundation::{LPARAM, LRESULT, POINT, WPARAM};
    use windows::Win32::Graphics::Gdi::{GetDC, GetPixel, ReleaseDC};
    use windows::Win32::UI::WindowsAndMessaging::*;

    static ACTIVE: AtomicBool = AtomicBool::new(false);
    /// 0 = attente, 1 = choisi, 2 = annulé.
    static ETAT: AtomicU32 = AtomicU32::new(0);
    static CHOIX: AtomicU32 = AtomicU32::new(0);

    fn pixel(x: i32, y: i32) -> (u8, u8, u8) {
        unsafe {
            let dc = GetDC(None);
            let c = GetPixel(dc, x, y).0;
            ReleaseDC(None, dc);
            ((c & 0xFF) as u8, ((c >> 8) & 0xFF) as u8, ((c >> 16) & 0xFF) as u8)
        }
    }

    unsafe extern "system" fn souris(code: i32, w: WPARAM, l: LPARAM) -> LRESULT {
        if code >= 0 && ACTIVE.load(Ordering::SeqCst) {
            let info = &*(l.0 as *const MSLLHOOKSTRUCT);
            match w.0 as u32 {
                WM_LBUTTONDOWN => {
                    let (r, g, b) = pixel(info.pt.x, info.pt.y);
                    CHOIX.store(((r as u32) << 16) | ((g as u32) << 8) | b as u32, Ordering::SeqCst);
                    ETAT.store(1, Ordering::SeqCst);
                    return LRESULT(1); // avalé : rien n'est cliqué dessous
                }
                WM_LBUTTONUP => return LRESULT(1),
                WM_RBUTTONDOWN | WM_RBUTTONUP => {
                    ETAT.store(2, Ordering::SeqCst);
                    return LRESULT(1);
                }
                _ => {}
            }
        }
        CallNextHookEx(None, code, w, l)
    }

    pub fn lancer(app: tauri::AppHandle) -> Result<(), String> {
        if ACTIVE.swap(true, Ordering::SeqCst) {
            return Ok(()); // déjà en cours
        }
        ETAT.store(0, Ordering::SeqCst);
        std::thread::Builder::new()
            .name("ile-pipette".into())
            .spawn(move || unsafe {
                let crochet = SetWindowsHookExW(WH_MOUSE_LL, Some(souris), None, 0);
                let Ok(crochet) = crochet else {
                    ACTIVE.store(false, Ordering::SeqCst);
                    return;
                };
                let debut = std::time::Instant::now();
                let mut derniere = String::new();
                let mut msg = MSG::default();
                loop {
                    // Les messages du crochet doivent être traités sur ce fil.
                    while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                    let etat = ETAT.load(Ordering::SeqCst);
                    if etat != 0 || debut.elapsed().as_secs() >= 20 {
                        // Laisser passer le relâchement du bouton avant de retirer le crochet.
                        std::thread::sleep(std::time::Duration::from_millis(150));
                        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                            let _ = TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }
                        let _ = UnhookWindowsHookEx(crochet);
                        ACTIVE.store(false, Ordering::SeqCst);
                        let c = CHOIX.load(Ordering::SeqCst);
                        let h = hex((c >> 16) as u8, (c >> 8) as u8, c as u8);
                        if etat == 1 {
                            let _ = crate::systeme::ecrire::copier_texte(h.clone());
                            let _ = app.emit("pipette", Couleur { hex: h, fini: true, annule: false });
                        } else {
                            let _ = app.emit("pipette", Couleur { hex: derniere, fini: true, annule: true });
                        }
                        return;
                    }
                    let mut p = POINT::default();
                    if GetCursorPos(&mut p).is_ok() {
                        let (r, g, b) = pixel(p.x, p.y);
                        let h = hex(r, g, b);
                        if h != derniere {
                            derniere = h.clone();
                            let _ = app.emit("pipette", Couleur { hex: h, fini: false, annule: false });
                        }
                    }
                    std::thread::sleep(std::time::Duration::from_millis(40));
                }
            })
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(not(windows))]
mod plateforme {
    pub fn lancer(_app: tauri::AppHandle) -> Result<(), String> {
        Err("Windows seulement".into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn hexadecimal() {
        assert_eq!(super::hex(255, 159, 10), "#FF9F0A");
        assert_eq!(super::hex(0, 0, 0), "#000000");
    }
}
