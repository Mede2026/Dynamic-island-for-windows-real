//! Windows Update : « Redémarrage requis ». Windows crée la clé
//! `HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired`
//! quand une mise à jour attend un redémarrage. Vérifié au démarrage puis toutes les 15 min.

use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "redemarrage-requis";

#[cfg(windows)]
pub fn redemarrage_requis() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegCloseKey, RegOpenKeyExW, HKEY, HKEY_LOCAL_MACHINE, KEY_READ};
    unsafe {
        let mut cle = HKEY::default();
        let ok = RegOpenKeyExW(
            HKEY_LOCAL_MACHINE,
            w!(r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired"),
            None,
            KEY_READ,
            &mut cle,
        )
        .is_ok();
        if ok {
            let _ = RegCloseKey(cle);
        }
        ok
    }
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use tauri::Emitter;
    std::thread::Builder::new()
        .name("ile-mise-a-jour".into())
        .spawn(move || {
            // Laisser l'île démarrer avant la première vérification.
            std::thread::sleep(std::time::Duration::from_secs(20));
            let mut avant = false;
            loop {
                let requis = redemarrage_requis();
                if requis != avant {
                    journal!("mise-a-jour", "redémarrage requis : {requis}");
                    let _ = app.emit(EVENEMENT, requis);
                    avant = requis;
                }
                std::thread::sleep(std::time::Duration::from_secs(15 * 60));
            }
        })
        .ok();
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("mise-a-jour", "non disponible sur ce système (Windows seulement)");
}
