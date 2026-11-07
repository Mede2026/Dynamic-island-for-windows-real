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
/// Cacher / afficher l'île.
pub const RACCOURCI_CACHER: &str = "ctrl+alt+h";
/// Note rapide.
pub const RACCOURCI_NOTE: &str = "ctrl+alt+n";
const LABEL_NOTE: &str = "note";

/// Ctrl+Alt+N : petite fenêtre de note (enregistrée au fil de la frappe), ou la ferme.
pub fn basculer_note(app: &AppHandle) {
    if let Some(f) = app.get_webview_window(LABEL_NOTE) {
        let _ = f.close();
        return;
    }
    let r = WebviewWindowBuilder::new(app, LABEL_NOTE, WebviewUrl::App("index.html?note".into()))
        .title("Note — Dynamic Island")
        .inner_size(380.0, 420.0)
        .always_on_top(true)
        .center()
        .build();
    if let Err(e) = r {
        journal!("plateau", "note impossible à ouvrir : {e}");
    }
}

/// Étagère (fichiers sous la main).
pub const RACCOURCI_ETAGERE: &str = "ctrl+alt+e";

/// Historique du presse-papiers.
pub const RACCOURCI_HISTORIQUE: &str = "ctrl+alt+v";
pub const LABEL_HISTORIQUE: &str = "historique";

/// Ctrl+Alt+V : les 10 derniers textes copiés, ou ferme la fenêtre.
pub fn basculer_historique(app: &AppHandle) {
    if let Some(f) = app.get_webview_window(LABEL_HISTORIQUE) {
        let _ = f.close();
        return;
    }
    let r = WebviewWindowBuilder::new(app, LABEL_HISTORIQUE, WebviewUrl::App("index.html?historique".into()))
        .title("Presse-papiers — Dynamic Island")
        .inner_size(440.0, 460.0)
        .resizable(false)
        .always_on_top(true)
        .center()
        .build();
    if let Err(e) = r {
        journal!("plateau", "historique impossible à ouvrir : {e}");
    }
}

/// « Quelle est cette chanson ? »
pub const RACCOURCI_CHANSON: &str = "ctrl+alt+s";
/// Recherche rapide (définition / résumé Wikipédia).
pub const RACCOURCI_RECHERCHE: &str = "ctrl+alt+space";
const LABEL_RECHERCHE: &str = "recherche";

/// Ctrl+Alt+Espace : petite fenêtre de recherche, ou la ferme.
pub fn basculer_recherche(app: &AppHandle) {
    if let Some(f) = app.get_webview_window(LABEL_RECHERCHE) {
        let _ = f.close();
        return;
    }
    let r = WebviewWindowBuilder::new(app, LABEL_RECHERCHE, WebviewUrl::App("index.html?recherche".into()))
        .title("Recherche — Dynamic Island")
        .inner_size(460.0, 360.0)
        .resizable(false)
        .always_on_top(true)
        .center()
        .build();
    if let Err(e) = r {
        journal!("plateau", "recherche impossible à ouvrir : {e}");
    }
}

/// Enregistre les raccourcis un par un ; en cas de refus (déjà pris par un autre programme),
/// essaie un raccourci de secours et le note dans le journal — sans jamais bloquer le démarrage.
pub fn enregistrer_raccourcis(app: &AppHandle) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let essais: [(&str, &[&str]); 8] = [
        ("réglages", &[RACCOURCI_PANNEAU, "ctrl+alt+shift+d"]),
        ("lanceur", &[RACCOURCI_LANCEUR, "ctrl+alt+shift+m"]),
        ("cacher", &[RACCOURCI_CACHER, "ctrl+alt+shift+h"]),
        ("recherche", &[RACCOURCI_RECHERCHE, "ctrl+alt+shift+space"]),
        ("chanson", &[RACCOURCI_CHANSON, "ctrl+alt+shift+s"]),
        ("historique", &[RACCOURCI_HISTORIQUE, "ctrl+alt+shift+v"]),
        ("étagère", &[RACCOURCI_ETAGERE, "ctrl+alt+shift+e"]),
        ("note", &[RACCOURCI_NOTE, "ctrl+alt+shift+n"]),
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
    ouvrir_lanceur(app);
}

/// Ouvre le lanceur de minuteur (ou le ramène devant s'il est déjà ouvert).
pub fn ouvrir_lanceur(app: &AppHandle) {
    if let Some(f) = app.get_webview_window(LABEL_LANCEUR) {
        let _ = f.show();
        let _ = f.set_focus();
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
    } else if est(RACCOURCI_NOTE) || est("ctrl+alt+shift+n") {
        basculer_note(app);
    } else if est(RACCOURCI_ETAGERE) || est("ctrl+alt+shift+e") {
        let _ = app.emit("ouvrir-etagere", ());
    } else if est(RACCOURCI_HISTORIQUE) || est("ctrl+alt+shift+v") {
        basculer_historique(app);
    } else if est(RACCOURCI_CHANSON) || est("ctrl+alt+shift+s") {
        crate::chanson::lancer(app);
    } else if est(RACCOURCI_RECHERCHE) || est("ctrl+alt+shift+space") {
        basculer_recherche(app);
    } else if est(RACCOURCI_CACHER) || est("ctrl+alt+shift+h") {
        fenetre::basculer_cachee(app);
    } else {
        basculer_panneau(app);
    }
}

/// Clic droit sur l'île : son menu, juste à côté (sans passer par l'icône près de l'horloge).
/// Identifiants « ile:… » : traités par `gerer_menu_ile` (le menu de l'icône les ignore).
#[tauri::command]
pub async fn ile_menu(app: AppHandle) -> Result<(), String> {
    let construire = || -> tauri::Result<Menu<tauri::Wry>> {
        let item = |id: &str, texte: &str| MenuItem::with_id(&app, format!("ile:{id}"), texte, true, None::<&str>);
        Menu::with_items(
            &app,
            &[
                &item("lanceur", "Lancer un minuteur\tCtrl+Alt+M")?,
                &item("chanson", "Quelle est cette chanson ?\tCtrl+Alt+S")?,
                &item("etagere", "Étagère\tCtrl+Alt+E")?,
                &item("historique", "Presse-papiers récent\tCtrl+Alt+V")?,
                &item("recherche", "Recherche rapide\tCtrl+Alt+Espace")?,
                &PredefinedMenuItem::separator(&app)?,
                &item("cacher", "Cacher l'île\tCtrl+Alt+H")?,
                &item("reglages", "Réglages\tCtrl+Alt+D")?,
            ],
        )
    };
    let menu = construire().map_err(|e| e.to_string())?;
    let fen = app.get_webview_window(fenetre::LABEL).ok_or("île introuvable")?;
    fen.popup_menu(&menu).map_err(|e| e.to_string())
}

/// Bouton du menu de l'île (clic droit) : « lanceur », « chanson », « etagere »…
/// ASYNCHRONE : sous Windows, une commande synchrone qui crée une fenêtre bloque Tauri
/// (fenêtre blanche, île figée).
#[tauri::command]
pub async fn ile_action(app: AppHandle, action: String) {
    gerer_menu_ile(&app, &format!("ile:{action}"));
}

/// Actions du menu du clic droit sur l'île.
fn gerer_menu_ile(app: &AppHandle, id: &str) {
    match id {
        "ile:lanceur" => ouvrir_lanceur(app),
        "ile:chanson" => crate::chanson::lancer(app),
        "ile:etagere" => {
            let _ = app.emit("ouvrir-etagere", ());
        }
        "ile:historique" => basculer_historique(app),
        "ile:note" => basculer_note(app),
        "ile:recherche" => basculer_recherche(app),
        "ile:cacher" => {
            fenetre::basculer_cachee(app);
        }
        "ile:reglages" => ouvrir_panneau(app),
        _ => {}
    }
}

pub fn installer(app: &AppHandle) -> tauri::Result<()> {
    app.on_menu_event(|app, ev| {
        let id = ev.id().as_ref();
        if id.starts_with("ile:") {
            gerer_menu_ile(app, id);
        }
    });
    let reglages = MenuItem::with_id(app, "reglages", "Réglages (Ctrl+Alt+D)", true, None::<&str>)?;
    let lanceur = MenuItem::with_id(app, "lanceur", "Lancer un minuteur (Ctrl+Alt+M)", true, None::<&str>)?;
    let chanson = MenuItem::with_id(
        app,
        "chanson",
        "Quelle est cette chanson ? (Ctrl+Alt+S)",
        true,
        None::<&str>,
    )?;
    let historique = MenuItem::with_id(
        app,
        "historique",
        "Presse-papiers récent (Ctrl+Alt+V)",
        true,
        None::<&str>,
    )?;
    let etagere = MenuItem::with_id(app, "etagere", "Étagère (Ctrl+Alt+E)", true, None::<&str>)?;
    let cacher_ile = MenuItem::with_id(
        app,
        "cacher-ile",
        "Cacher / afficher l'île (Ctrl+Alt+H)",
        true,
        None::<&str>,
    )?;
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
            &chanson,
            &historique,
            &etagere,
            &cacher_ile,
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
            "chanson" => crate::chanson::lancer(app),
            "historique" => basculer_historique(app),
            "etagere" => {
                let _ = app.emit("ouvrir-etagere", ());
            }
            "cacher-ile" => {
                fenetre::basculer_cachee(app);
            }
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
