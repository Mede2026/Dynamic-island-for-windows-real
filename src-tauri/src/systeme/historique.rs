//! Historique du presse-papiers : les 10 derniers TEXTES copiés, gardés en mémoire
//! seulement (rien sur le disque ; tout disparaît quand l'île se ferme). Les mots de passe
//! signalés par leur gestionnaire n'y entrent pas (voir presse_papiers.rs).

use std::sync::Mutex;

pub const NOMBRE: usize = 10;
/// Au-delà, le texte est coupé (en unités UTF-16).
pub const LONGUEUR_MAX: usize = 20_000;

static TEXTES: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// Images copiées (captures comprises), en mémoire seulement : 6 au plus.
pub const NOMBRE_IMAGES: usize = 6;
struct ImageCopiee {
    id: u64,
    png: Vec<u8>,
    /// Miniature PNG base64 (sert aussi à reconnaître la même image).
    mini: String,
}
static IMAGES: Mutex<Vec<ImageCopiee>> = Mutex::new(Vec::new());
static PROCHAIN_ID: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

pub fn ajouter_image(png: Vec<u8>, mini: String) {
    let mut l = IMAGES.lock().unwrap();
    if let Some(i) = l.iter().position(|x| x.mini == mini) {
        let deja = l.remove(i);
        l.insert(0, deja);
        return;
    }
    let id = PROCHAIN_ID.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    l.insert(0, ImageCopiee { id, png, mini });
    l.truncate(NOMBRE_IMAGES);
}

#[derive(serde::Serialize)]
pub struct ImageResume {
    pub id: u64,
    pub miniature: String,
}

/// Images récentes (plus récente d'abord), avec leur miniature.
#[tauri::command]
pub fn historique_images() -> Vec<ImageResume> {
    IMAGES.lock().unwrap().iter().map(|i| ImageResume { id: i.id, miniature: i.mini.clone() }).collect()
}

/// Dernière image copiée (ou celle d'`id`), en PNG base64 : pour la montrer à Claude.
#[tauri::command]
pub fn presse_papiers_image(id: Option<u64>) -> Option<String> {
    use base64::Engine;
    let l = IMAGES.lock().unwrap();
    let i = match id {
        Some(id) => l.iter().find(|x| x.id == id),
        None => l.first(),
    }?;
    Some(base64::engine::general_purpose::STANDARD.encode(&i.png))
}

/// Recopie une image de l'historique et la colle (Ctrl+V) dans l'app d'avant.
#[tauri::command]
pub async fn historique_image_coller(app: tauri::AppHandle, id: u64) -> Result<(), String> {
    let png = IMAGES.lock().unwrap().iter().find(|x| x.id == id).map(|x| x.png.clone()).ok_or("introuvable")?;
    super::ecrire::image(&png)?;
    crate::fenetre::clavier(&app, false);
    coller_ctrl_v();
    Ok(())
}

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

/// Recopie le texte, rend la main à l'app d'avant et le colle (Ctrl+V) dans l'app
/// qui avait la main, comme Windows + V.
#[tauri::command]
pub async fn historique_coller(app: tauri::AppHandle, indice: usize) -> Result<(), String> {
    historique_copier(indice)?;
    // L'île rend la main (et le clavier) à l'app d'avant, puis Ctrl+V y colle le texte.
    crate::fenetre::clavier(&app, false);
    coller_ctrl_v();
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

/// Ctrl+V envoyé à l'app d'avant (après lui avoir laissé reprendre la main).
fn coller_ctrl_v() {
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
}
