//! Icône dans la zone de notification (quitter, réglages, écran, options) et
//! panneau de réglages (fenêtre « reglages », aussi ouverte par Ctrl+Alt+D).

use std::sync::atomic::Ordering;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Shortcut, ShortcutEvent, ShortcutState};

use crate::{fenetre, journal, parametres};

/// Tailles proposées dans le menu (DIP par point iPhone).
const TAILLES: [(&str, f64); 4] = [
    ("Petite", 0.85),
    ("Normale", 1.0),
    ("Grande", 1.25),
    ("Très grande", 1.5),
];

/// Arrêter les tests : l'île efface les activités factices et revient aux vraies données.
pub fn reinitialiser(app: &AppHandle) {
    journal!("plateau", "arrêt des tests : réinitialisation de l'île");
    let _ = app.emit("reinitialiser", ());
}

pub const RACCOURCI_PANNEAU: &str = "ctrl+alt+d";
/// Lanceur rapide (minuteur…).
pub const RACCOURCI_LANCEUR: &str = "ctrl+alt+m";
const LABEL_LANCEUR: &str = "lanceur";

/// Enregistre les raccourcis un par un ; en cas de refus (déjà pris par un autre programme),
/// essaie un raccourci de secours et le note dans le journal — sans jamais bloquer le démarrage.
pub fn enregistrer_raccourcis(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let essais: [(&str, &[&str]); 2] = [
        ("réglages", &[RACCOURCI_PANNEAU, "ctrl+alt+shift+d"]),
        ("lanceur", &[RACCOURCI_LANCEUR, "ctrl+alt+shift+m"]),
    ];
    for (nom, raccourcis) in essais {
        let ok = raccourcis.iter().find(|r| match app.global_shortcut().register(**r) {
            Ok(()) => true,
            Err(e) => {
                journal!("plateau", "raccourci {r} refusé ({nom}) : {e}");
                false
            }
        });
        match ok {
            Some(r) => journal!("plateau", "raccourci {nom} : {r}"),
            None => journal!(
                "plateau",
                "aucun raccourci pour {nom} (menu de l'icône toujours disponible)"
            ),
        }
    }
}

/// Ctrl+Alt+M : petit panneau « Minuteur » (durées prêtes, durée libre), ou le ferme.
pub fn basculer_lanceur(app: &AppHandle) {
    if let Some(f) = app.get_webview_window(LABEL_LANCEUR) {
        let _ = f.close();
        return;
    }
    let r = WebviewWindowBuilder::new(app, LABEL_LANCEUR, WebviewUrl::App("index.html?lanceur".into()))
        .title("Lancer — Dynamic Island")
        .inner_size(380.0, 250.0)
        .resizable(false)
        .always_on_top(true)
        .center()
        .build();
    if let Err(e) = r {
        journal!("plateau", "lanceur impossible à ouvrir : {e}");
    }
}
const LABEL_PANNEAU: &str = "reglages";

/// Ouvre (ou ramène devant) le panneau de réglages.
pub fn ouvrir_panneau(app: &AppHandle) {
    if let Some(f) = app.get_webview_window(LABEL_PANNEAU) {
        let _ = f.show();
        let _ = f.unminimize();
        let _ = f.set_focus();
        return;
    }
    let r = WebviewWindowBuilder::new(app, LABEL_PANNEAU, WebviewUrl::App("index.html?panneau".into()))
        .title("Réglages — Dynamic Island")
        .inner_size(480.0, 780.0)
        .resizable(true)
        .build();
    match r {
        Ok(f) => {
            // Fermer le panneau arrête les tests : l'île revient à ce qui se passe vraiment.
            let app2 = app.clone();
            f.on_window_event(move |ev| {
                if let tauri::WindowEvent::Destroyed = ev {
                    reinitialiser(&app2);
                }
            });
        }
        Err(e) => journal!("plateau", "panneau impossible à ouvrir : {e}"),
    }
}

/// Ctrl+Alt+D : ouvre le panneau, ou le ferme s'il est déjà ouvert.
pub fn basculer_panneau(app: &AppHandle) {
    match app.get_webview_window(LABEL_PANNEAU) {
        Some(f) => {
            let _ = f.close();
        }
        None => ouvrir_panneau(app),
    }
}

pub fn gestion_raccourci(app: &AppHandle, raccourci: &Shortcut, evenement: ShortcutEvent) {
    if evenement.state() != ShortcutState::Pressed {
        return;
    }
    let est = |texte: &str| {
        texte
            .parse::<Shortcut>()
            .map(|l| l.id() == raccourci.id())
            .unwrap_or(false)
    };
    if est(RACCOURCI_LANCEUR) || est("ctrl+alt+shift+m") {
        basculer_lanceur(app);
    } else {
        basculer_panneau(app);
    }
}

pub fn installer(app: &AppHandle) -> tauri::Result<()> {
    let reglages = MenuItem::with_id(app, "reglages", "Réglages (Ctrl+Alt+D)", true, None::<&str>)?;
    let lanceur = MenuItem::with_id(app, "lanceur", "Lancer un minuteur (Ctrl+Alt+M)", true, None::<&str>)?;
    let auto = CheckMenuItem::with_id(
        app,
        "auto",
        "Démarrer avec Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let prefs = parametres::lire(app);
    let cacher = CheckMenuItem::with_id(
        app,
        "plein-ecran",
        "Cacher en plein écran",
        true,
        prefs.cacher_en_plein_ecran,
        None::<&str>,
    )?;
    let tailles = Submenu::with_id(app, "tailles", "Taille de l'île", true)?;
    let mut cases_tailles = Vec::new();
    for (nom, t) in TAILLES {
        let c = CheckMenuItem::with_id(
            app,
            format!("taille:{t}"),
            nom,
            true,
            (prefs.taille - t).abs() < 1e-3,
            None::<&str>,
        )?;
        tailles.append(&c)?;
        cases_tailles.push((t, c));
    }
    let arreter = MenuItem::with_id(
        app,
        "arreter-tests",
        "Arrêter les tests (réinitialiser l'île)",
        true,
        None::<&str>,
    )?;
    let ecrans = Submenu::with_id(app, "ecrans", "Écran", true)?;
    ecrans.append(&MenuItem::with_id(
        app,
        "ecran:",
        "Écran principal",
        true,
        None::<&str>,
    )?)?;
    for e in fenetre::lister_ecrans(app) {
        let texte = format!(
            "{} — {}×{} ({} %)",
            e.id,
            e.rect.largeur,
            e.rect.hauteur,
            (e.facteur_echelle * 100.0).round()
        );
        ecrans.append(&MenuItem::with_id(
            app,
            format!("ecran:{}", e.id),
            texte,
            true,
            None::<&str>,
        )?)?;
    }
    let quitter = MenuItem::with_id(app, "quitter", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &reglages,
            &lanceur,
            &arreter,
            &PredefinedMenuItem::separator(app)?,
            &tailles,
            &ecrans,
            &auto,
            &cacher,
            &PredefinedMenuItem::separator(app)?,
            &quitter,
        ],
    )?;

    let auto2 = auto.clone();
    let cacher2 = cacher.clone();
    let mut constructeur = TrayIconBuilder::with_id("ile")
        .tooltip("Dynamic Island")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(move |app, ev| match ev.id().as_ref() {
            "reglages" => ouvrir_panneau(app),
            "lanceur" => basculer_lanceur(app),
            "arreter-tests" => reinitialiser(app),
            id if id.starts_with("taille:") => {
                if let Ok(t) = id.trim_start_matches("taille:").parse::<f64>() {
                    parametres::modifier(app, |p| p.taille = t);
                    for (v, c) in &cases_tailles {
                        let _ = c.set_checked((v - t).abs() < 1e-3);
                    }
                }
            }
            "quitter" => app.exit(0),
            "auto" => {
                let gestion = app.autolaunch();
                let voulu = !gestion.is_enabled().unwrap_or(false);
                let _ = if voulu { gestion.enable() } else { gestion.disable() };
                let _ = auto2.set_checked(gestion.is_enabled().unwrap_or(false));
            }
            "plein-ecran" => {
                let etat = app.state::<fenetre::EtatFenetre>();
                let voulu = !etat.cacher_en_plein_ecran.load(Ordering::Relaxed);
                fenetre::fenetre_cacher_en_plein_ecran(app.clone(), voulu);
                let _ = cacher2.set_checked(voulu);
            }
            id if id.starts_with("ecran:") => {
                let ecran = id.trim_start_matches("ecran:");
                let choix = (!ecran.is_empty()).then(|| ecran.to_string());
                let _ = fenetre::fenetre_choisir_ecran(app.clone(), choix);
            }
            _ => {}
        });
    if let Some(icone) = app.default_window_icon() {
        constructeur = constructeur.icon(icone.clone());
    }
    constructeur.build(app)?;
    Ok(())
}
