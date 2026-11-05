//! Journal : messages dans la console (`npm run tauri dev`) ET dans un fichier, pour pouvoir
//! diagnostiquer la version installée (qui n'a pas de console) :
//!   Windows : %APPDATA%\com.mederic.dynamicisland\journal.txt
//! En cas d'erreur grave, une fenêtre affiche le message au lieu de quitter en silence.

use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

static FICHIER: Mutex<Option<std::fs::File>> = Mutex::new(None);

/// Dossier des données de l'app (même dossier que parametres.json).
pub fn dossier_app() -> Option<PathBuf> {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".config")))?;
    Some(base.join("com.mederic.dynamicisland"))
}

pub fn chemin_journal() -> Option<PathBuf> {
    dossier_app().map(|d| d.join("journal.txt"))
}

/// Ouvre le fichier journal (remis à zéro à chaque démarrage) et installe la gestion des plantages.
pub fn initialiser() {
    if let Some(chemin) = chemin_journal() {
        if let Some(d) = chemin.parent() {
            let _ = std::fs::create_dir_all(d);
        }
        *FICHIER.lock().unwrap() = std::fs::File::create(&chemin).ok();
    }
    std::panic::set_hook(Box::new(|info| {
        let message = format!("Plantage : {info}");
        ecrire("ERREUR", &message);
        afficher_erreur(&message);
    }));
}

/// Écrit une ligne dans la console et dans le fichier.
pub fn ecrire(module: &str, message: &str) {
    println!("[{module}] {message}");
    if let Some(f) = FICHIER.lock().unwrap().as_mut() {
        let _ = writeln!(f, "[{}] [{module}] {message}", maintenant_ms());
    }
}

/// Fenêtre d'erreur (Windows) ; ailleurs, simple message dans la console d'erreur.
pub fn afficher_erreur(message: &str) {
    let texte = format!(
        "Dynamic Island a rencontré une erreur.\n\n{message}\n\nJournal : {}",
        chemin_journal().map(|p| p.display().to_string()).unwrap_or_default()
    );
    #[cfg(windows)]
    unsafe {
        use windows::core::HSTRING;
        use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
        MessageBoxW(
            None,
            &HSTRING::from(texte),
            &HSTRING::from("Dynamic Island"),
            MB_OK | MB_ICONERROR,
        );
    }
    #[cfg(not(windows))]
    eprintln!("{texte}");
}

/// `journal!("media", "titre = {}", titre);` → `[media] titre = …` (console + fichier).
#[macro_export]
macro_rules! journal {
    ($module:expr, $($arg:tt)*) => {{
        $crate::journal::ecrire($module, &format!($($arg)*));
    }};
}

/// Le front-end écrit aussi ses erreurs dans le journal (sinon une erreur d'affichage
/// rendrait l'île invisible sans laisser de trace).
#[tauri::command]
pub fn journal_ecrire(module: String, message: String) {
    ecrire(&format!("page:{module}"), &message);
}

/// Heure actuelle en millisecondes depuis le 1er janvier 1970 (UTC).
pub fn maintenant_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}
