//! Icône dans la zone de notification (quitter, réglages, écran, options) et
//! panneau de réglages (fenêtre « reglages », aussi ouverte par Ctrl+Alt+D).

use std::sync::atomic::Ordering;
use tauri::menu::{CheckMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::ManagerExt;
use tauri_plugin_global_shortcut::{Shortcut, ShortcutEvent, ShortcutState};

use crate::{fenetre, journal};

pub const RACCOURCI_PANNEAU: &str = "ctrl+alt+d";
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
    if let Err(e) = r {
        journal!("plateau", "panneau impossible à ouvrir : {e}");
    }
}

pub fn gestion_raccourci(app: &AppHandle, _raccourci: &Shortcut, evenement: ShortcutEvent) {
    if evenement.state() == ShortcutState::Pressed {
        ouvrir_panneau(app);
    }
}

pub fn installer(app: &AppHandle) -> tauri::Result<()> {
    let reglages = MenuItem::with_id(app, "reglages", "Réglages (Ctrl+Alt+D)", true, None::<&str>)?;
    let auto = CheckMenuItem::with_id(
        app,
        "auto",
        "Démarrer avec Windows",
        true,
        app.autolaunch().is_enabled().unwrap_or(false),
        None::<&str>,
    )?;
    let cacher = CheckMenuItem::with_id(app, "plein-ecran", "Cacher en plein écran", true, false, None::<&str>)?;
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
