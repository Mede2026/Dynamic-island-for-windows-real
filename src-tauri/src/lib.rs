//! Point d'entrée du backend Rust de l'île.
//!
//! Modules :
//!  - `fenetre`  : fenêtre transparente, écrans, DPI, clics traversants, plein écran
//!  - `media`    : musique / vidéo en cours (GSMTC)
//!  - `systeme`  : batterie, volume, ne pas déranger, notifications
//!  - `minuteur` : minuteur interne
//!  - `demarrage`: démarrage automatique avec Windows

pub mod demarrage;
pub mod evenements;
pub mod fenetre;
pub mod journal;
pub mod media;
pub mod minuteur;
pub mod systeme;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Une seule île à la fois (ex. démarrage auto + double-clic).
        // Une 2e instance transmet ses arguments (ex. --minuteur 5m) à la 1re, puis se ferme.
        .plugin(tauri_plugin_single_instance::init(|app, args, _dossier| {
            journal!("app", "déjà lancée : arguments transmis {:?}", &args[1..]);
            minuteur::executer_arguments(app, &args);
        }))
        .plugin(demarrage::plugin())
        .manage(fenetre::EtatFenetre::default())
        .manage(minuteur::EtatMinuteurApp::default())
        .invoke_handler(tauri::generate_handler![
            fenetre::fenetre_ecrans,
            fenetre::fenetre_info,
            fenetre::fenetre_choisir_ecran,
            fenetre::fenetre_definir_canevas,
            fenetre::fenetre_zones_touchables,
            fenetre::fenetre_ecouter_clic_exterieur,
            fenetre::fenetre_cacher_en_plein_ecran,
            media::media_etat,
            media::media_pochette,
            media::media_lecture_pause,
            media::media_suivant,
            media::media_precedent,
            media::media_aller_a,
            media::media_choisir_source,
            systeme::systeme_batterie,
            systeme::systeme_volume,
            systeme::systeme_ne_pas_deranger,
            systeme::notifications_etat,
            minuteur::minuteur_demarrer,
            minuteur::minuteur_pause,
            minuteur::minuteur_reprendre,
            minuteur::minuteur_annuler,
            minuteur::minuteur_etat,
            demarrage::demarrage_auto_etat,
            demarrage::demarrage_auto_definir,
        ])
        .setup(|app| {
            let handle = app.handle();
            journal!(
                "app",
                "démarrage{}",
                if demarrage::lance_par_windows() {
                    " (lancée par Windows à l'ouverture de session)"
                } else {
                    ""
                }
            );
            if let Err(e) = fenetre::initialiser(handle) {
                journal!("fenetre", "initialisation impossible : {e}");
            }
            // Mode développement : `ILE_DEVTOOLS=1` ouvre la console de la page (journal du front-end).
            #[cfg(debug_assertions)]
            if std::env::var_os("ILE_DEVTOOLS").is_some() {
                if let Some(f) = tauri::Manager::get_webview_window(app, fenetre::LABEL) {
                    f.open_devtools();
                }
            }
            media::demarrer(handle);
            systeme::demarrer(handle);
            minuteur::executer_arguments(handle, &std::env::args().collect::<Vec<_>>());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de l'application Tauri");
}
