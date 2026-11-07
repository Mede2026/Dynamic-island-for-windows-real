//! Historique du presse-papiers : les 10 derniers TEXTES copiés, gardés en mémoire
//! seulement (rien sur le disque ; tout disparaît quand l'île se ferme). Les mots de passe
//! signalés par leur gestionnaire n'y entrent pas (voir presse_papiers.rs).

use std::sync::Mutex;

pub const NOMBRE: usize = 10;
/// Au-delà, le texte est coupé (en unités UTF-16).
pub const LONGUEUR_MAX: usize = 20_000;

static TEXTES: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Le plus récent en premier, sans doublon.
pub fn inserer(liste: &mut Vec<String>, texte: &str) {
    if texte.trim().is_empty() {
        return;
    }
    liste.retain(|t| t != texte);
    liste.insert(0, texte.to_owned());
    liste.truncate(NOMBRE);
}

pub fn ajouter(texte: &str) {
    inserer(&mut TEXTES.lock().unwrap(), texte);
}

#[tauri::command]
pub fn historique_lire() -> Vec<String> {
    TEXTES.lock().unwrap().clone()
}

/// Recopie un texte de l'historique (il remonte en premier).
#[tauri::command]
pub fn historique_copier(indice: usize) -> Result<(), String> {
    let texte = TEXTES.lock().unwrap().get(indice).cloned().ok_or("introuvable")?;
    super::ecrire::copier_texte(texte)
}

/// Recopie le texte, ferme la fenêtre de l'historique et le colle (Ctrl+V) dans l'app
/// qui avait la main, comme Windows + V.
#[tauri::command]
pub fn historique_coller(app: tauri::AppHandle, indice: usize) -> Result<(), String> {
    use tauri::Manager;
    historique_copier(indice)?;
    if let Some(f) = app.get_webview_window(crate::plateau::LABEL_HISTORIQUE) {
        let _ = f.close();
    }
    #[cfg(windows)]
    std::thread::spawn(|| {
        use windows::Win32::UI::Input::KeyboardAndMouse::{
            SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY,
            VK_CONTROL,
        };
        // Laisser la fenêtre précédente reprendre la main.
        std::thread::sleep(std::time::Duration::from_millis(220));
        let t = |vk: VIRTUAL_KEY, haut: bool| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if haut { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        };
        let v = VIRTUAL_KEY(b'V' as u16);
        unsafe {
            let _ = SendInput(
                &[t(VK_CONTROL, false), t(v, false), t(v, true), t(VK_CONTROL, true)],
                std::mem::size_of::<INPUT>() as i32,
            );
        }
    });
    Ok(())
}

#[tauri::command]
pub fn historique_vider() {
    TEXTES.lock().unwrap().clear();
}

#[cfg(test)]
mod tests {
    #[test]
    fn ordre_et_limite() {
        let mut l = Vec::new();
        for i in 0..12 {
            super::inserer(&mut l, &format!("t{i}"));
        }
        assert_eq!(l.len(), 10);
        assert_eq!(l[0], "t11");
        super::inserer(&mut l, "t5");
        assert_eq!(l[0], "t5");
        assert_eq!(l.iter().filter(|t| *t == "t5").count(), 1);
        super::inserer(&mut l, "   ");
        assert_eq!(l[0], "t5");
    }
}
