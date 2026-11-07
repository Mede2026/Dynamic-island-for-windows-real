//! Point d'entrée du backend Rust de l'île.
//!
//! Modules :
//!  - `fenetre`  : fenêtre transparente, écrans, DPI, clics traversants, plein écran
//!  - `media`    : musique / vidéo en cours (GSMTC)
//!  - `systeme`  : batterie, volume, ne pas déranger, notifications
//!  - `minuteur` : minuteur interne
//!  - `demarrage`: démarrage automatique avec Windows
//!  - `plateau`  : icône de notification, panneau de réglages (Ctrl+Alt+D)

use tauri::Manager;

pub mod chanson;
pub mod demarrage;
pub mod etagere;
pub mod evenements;
pub mod fenetre;
pub mod horloge;
pub mod integration;
pub mod journal;
pub mod media;
pub mod minuteur;
pub mod mise_a_jour_app;
pub mod parametres;
pub mod paroles;
pub mod plateau;
pub mod recherche;
pub mod systeme;
pub mod web;

/// Arrêter les tests du panneau : l'île efface les activités factices.
#[tauri::command]
fn ile_reinitialiser(app: tauri::AppHandle) {
    plateau::reinitialiser(&app);
}

/// Quitter complètement l'application.
#[tauri::command]
fn app_quitter(app: tauri::AppHandle) {
    journal!("app", "fermeture demandée");
    app.exit(0);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Processus gardien de l'indicateur de volume (voir systeme/osd.rs) : rien d'autre.
    let args: Vec<String> = std::env::args().collect();
    if let Some(i) = args.iter().position(|a| a == systeme::osd::ARGUMENT_GARDIEN) {
        systeme::osd::gardien(args.get(i + 1).map(String::as_str).unwrap_or(""));
        return;
    }
    journal::initialiser();
    journal!("app", "version {}", env!("CARGO_PKG_VERSION"));
    // Même identité que les raccourcis de l'installateur (icône épinglée, notifications).
    integration::definir_identite();
    let resultat = tauri::Builder::default()
        // Une seule île à la fois (ex. démarrage auto + double-clic).
        // Une 2e instance transmet ses arguments (ex. --minuteur 5m) à la 1re, puis se ferme.
        .plugin(tauri_plugin_single_instance::init(|app, args, _dossier| {
            journal!("app", "déjà lancée : arguments transmis {:?}", &args[1..]);
            integration::executer(app, &args, true);
        }))
        .plugin(demarrage::plugin())
        .plugin(
            // Les raccourcis sont enregistrés plus bas, un par un : un raccourci déjà pris par
            // un autre programme ne doit JAMAIS empêcher l'île de démarrer.
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(plateau::gestion_raccourci)
                .build(),
        )
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
            media::media_ouvrir_source,
            systeme::systeme_batterie,
            systeme::systeme_volume,
            systeme::systeme_ne_pas_deranger,
            systeme::notifications_etat,
            paroles::paroles_chercher,
            chanson::chanson_reconnaitre,
            systeme::ecrire::copier_texte,
            systeme::ecrire::copier_fichiers,
            systeme::ecrire::ouvrir_fichier,
            etagere::etagere_lire,
            etagere::etagere_coller,
            plateau::ile_menu,
            plateau::ile_action,
            mise_a_jour_app::app_verifier_maj,
            mise_a_jour_app::app_installer_maj,
            systeme::appel_entrant::appel_entrant_repondre,
            systeme::historique::historique_lire,
            systeme::historique::historique_copier,
            systeme::historique::historique_vider,
            systeme::historique::historique_coller,
            systeme::internet::systeme_inactivite_ms,
            systeme::internet::fenetre_cacher_au_partage,
            etagere::etagere_ajouter,
            etagere::etagere_retirer,
            recherche::recherche_rapide,
            recherche::ouvrir_lien,
            minuteur::minuteur_demarrer,
            minuteur::minuteur_pause,
            minuteur::minuteur_reprendre,
            minuteur::minuteur_annuler,
            minuteur::minuteur_etat,
            systeme::systeme_confidentialite,
            systeme::niveau_audio::audio_niveau_actif,
            systeme::micro::micro_muet,
            parametres::parametres_lire,
            parametres::parametres_definir_taille,
            parametres::parametres_definir_affichage,
            parametres::parametres_definir_clics_region,
            ile_reinitialiser,
            journal::journal_ecrire,
            app_quitter,
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
            // Préférences mémorisées (taille, écran, plein écran) AVANT de placer la fenêtre.
            let prefs = parametres::charger(handle);
            {
                let etat = handle.state::<fenetre::EtatFenetre>();
                *etat.ecran_choisi.lock().unwrap() = prefs.ecran.clone();
                etat.cacher_en_plein_ecran
                    .store(prefs.cacher_en_plein_ecran, std::sync::atomic::Ordering::Relaxed);
            }
            if let Err(e) = fenetre::initialiser(handle, !prefs.clics_region) {
                journal!("fenetre", "initialisation impossible : {e}");
            }
            // Mode développement : `ILE_DEVTOOLS=1` ouvre la console de la page (journal du front-end).
            #[cfg(debug_assertions)]
            if std::env::var_os("ILE_DEVTOOLS").is_some() {
                if let Some(f) = tauri::Manager::get_webview_window(app, fenetre::LABEL) {
                    f.open_devtools();
                }
            }
            plateau::enregistrer_raccourcis(handle);
            if let Err(e) = plateau::installer(handle) {
                journal!("plateau", "icône de notification impossible : {e}");
            }
            media::demarrer(handle);
            etagere::charger();
            mise_a_jour_app::demarrer(handle.clone());
            systeme::demarrer(handle);
            // Indicateur de Windows : remettre d'abord (fin brutale précédente), puis remplacer.
            systeme::osd::restaurer();
            systeme::osd::configurer(systeme::osd::voulu(&parametres::lire(handle).affichage));
            horloge::demarrer(handle.clone());
            integration::installer();
            integration::executer(handle, &std::env::args().collect::<Vec<_>>(), false);
            Ok(())
        })
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|_, evenement| {
                if let tauri::RunEvent::Exit = evenement {
                    systeme::osd::configurer(false);
                }
            })
        });
    if let Err(e) = resultat {
        journal!("app", "erreur au lancement : {e}");
        journal::afficher_erreur(&e.to_string());
    }
}
