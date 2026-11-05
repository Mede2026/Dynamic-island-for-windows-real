//! Fenêtre de l'île : placement en haut au centre, choix de l'écran, DPI,
//! clics traversants, détection du plein écran.
//!
//! Aucune valeur VISUELLE ici. La fenêtre est un « canevas » transparent
//! (une surface de dessin invisible) ; la taille de l'île se trouve dans
//! src/island.config.ts et est dessinée par le front-end.

#[cfg(not(windows))]
mod autre;
#[cfg(windows)]
mod win;

#[cfg(not(windows))]
use autre as plateforme;
#[cfg(windows)]
use win as plateforme;

use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use crate::{evenements, journal};

/// Nom (label) de la fenêtre dans tauri.conf.json.
pub const LABEL: &str = "ile";

/// Intervalle de vérification du curseur pour les clics traversants (réglage technique).
const INTERVALLE_CURSEUR: Duration = Duration::from_millis(16);
/// Intervalle de vérification du plein écran et des écrans branchés (réglage technique).
const INTERVALLE_LENT: Duration = Duration::from_millis(1000);

// ---------------------------------------------------------------------------
// Types échangés avec le front-end
// ---------------------------------------------------------------------------

/// Rectangle en DIP, relatif au coin haut-gauche de la fenêtre.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct RectDip {
    pub x: f64,
    pub y: f64,
    pub largeur: f64,
    pub hauteur: f64,
}

/// Rectangle en pixels physiques de l'écran.
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
pub struct RectPx {
    pub x: i32,
    pub y: i32,
    pub largeur: u32,
    pub hauteur: u32,
}

impl RectPx {
    pub fn contient(&self, autre: &RectPx) -> bool {
        self.x <= autre.x
            && self.y <= autre.y
            && self.x as i64 + self.largeur as i64 >= autre.x as i64 + autre.largeur as i64
            && self.y as i64 + self.hauteur as i64 >= autre.y as i64 + autre.hauteur as i64
    }
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct InfoEcran {
    /// Identifiant stable (nom Windows du périphérique, ex. « \\.\DISPLAY1 »).
    pub id: String,
    pub principal: bool,
    /// Position et taille en pixels physiques.
    pub rect: RectPx,
    /// Échelle Windows : 1.0 = 100 %, 1.25 = 125 %, 1.5 = 150 %…
    pub facteur_echelle: f64,
    /// Taux de rafraîchissement réel (Hz), si Windows le donne.
    pub frequence_hz: Option<u32>,
}

/// Infos envoyées au front-end après chaque placement de la fenêtre.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfoFenetre {
    pub ecran: InfoEcran,
    /// Position et taille de la fenêtre (pixels physiques).
    pub fenetre: RectPx,
    /// Taille de la fenêtre en DIP (= pixels CSS dans la page).
    pub largeur_dip: f64,
    pub hauteur_dip: f64,
}

// ---------------------------------------------------------------------------
// État partagé
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct EtatFenetre {
    /// Écran choisi par l'utilisateur (id) ; None = écran principal.
    pub ecran_choisi: Mutex<Option<String>>,
    /// Taille du canevas demandée par le front-end (DIP) ; None = valeur par défaut.
    pub canevas_dip: Mutex<Option<(f64, f64)>>,
    /// Zones « touchables » (DIP, relatives à la fenêtre). Ailleurs, les clics traversent.
    zones: Mutex<Vec<RectDip>>,
    zones_changees: Condvar,
    /// Origine de la fenêtre (px physiques) et échelle, mises en cache pour le fil du curseur.
    geometrie: Mutex<Option<((i32, i32), f64)>>,
    pub cacher_en_plein_ecran: AtomicBool,
    pub ecouter_clic_exterieur: AtomicBool,
    pub plein_ecran: AtomicBool,
    /// Windows : clics traversants par RÉGION de fenêtre (fluide) au lieu de WS_EX_LAYERED.
    pub mode_region: AtomicBool,
    /// Zone d'affichage demandée par le front-end (DIP, relative à la fenêtre).
    region_dip: Mutex<Option<RectDip>>,
    derniere_info: Mutex<Option<InfoFenetre>>,
    signature_ecrans: Mutex<String>,
}

// ---------------------------------------------------------------------------
// Calculs purs (testés plus bas)
// ---------------------------------------------------------------------------

/// Position du coin haut-gauche pour centrer la fenêtre en haut de l'écran.
pub fn position_haut_centre(ecran: RectPx, taille: (u32, u32)) -> (i32, i32) {
    let x = ecran.x + ((ecran.largeur as i64 - taille.0 as i64) / 2) as i32;
    (x, ecran.y)
}

/// Taille du canevas en pixels physiques.
/// Par défaut (aucune demande du front-end) : toute la largeur de l'écran et un tiers de sa hauteur.
pub fn taille_canevas_px(canevas_dip: Option<(f64, f64)>, ecran: RectPx, echelle: f64) -> (u32, u32) {
    match canevas_dip {
        Some((l, h)) => (
            ((l * echelle).round().max(1.0) as u32).min(ecran.largeur),
            ((h * echelle).round().max(1.0) as u32).min(ecran.hauteur),
        ),
        None => (ecran.largeur, (ecran.hauteur / 3).max(1)),
    }
}

/// Le curseur (px physiques, coordonnées écran) est-il dans une des zones touchables ?
pub fn curseur_dans_zones(curseur: (i32, i32), origine: (i32, i32), echelle: f64, zones: &[RectDip]) -> bool {
    let x = (curseur.0 - origine.0) as f64 / echelle;
    let y = (curseur.1 - origine.1) as f64 / echelle;
    zones
        .iter()
        .any(|z| x >= z.x && x < z.x + z.largeur && y >= z.y && y < z.y + z.hauteur)
}

/// Zone d'affichage en pixels physiques (x, y, largeur, hauteur), arrondie vers l'extérieur.
pub fn region_px(r: RectDip, echelle: f64) -> (i32, i32, i32, i32) {
    let x0 = (r.x * echelle).floor() as i32;
    let y0 = (r.y * echelle).floor() as i32;
    let x1 = ((r.x + r.largeur) * echelle).ceil() as i32;
    let y1 = ((r.y + r.hauteur) * echelle).ceil() as i32;
    (x0, y0, (x1 - x0).max(0), (y1 - y0).max(0))
}

/// Une chaîne qui change dès qu'un écran est branché, débranché, déplacé ou change d'échelle.
pub fn signature_ecrans(ecrans: &[InfoEcran]) -> String {
    ecrans
        .iter()
        .map(|e| {
            format!(
                "{}|{}|{},{},{}x{}|{}|{:?}",
                e.id,
                e.principal,
                e.rect.x,
                e.rect.y,
                e.rect.largeur,
                e.rect.hauteur,
                e.facteur_echelle,
                e.frequence_hz
            )
        })
        .collect::<Vec<_>>()
        .join(";")
}

/// Choisit l'écran cible : celui demandé s'il existe encore, sinon le principal, sinon le premier.
pub fn choisir_ecran<'a>(ecrans: &'a [InfoEcran], demande: Option<&str>) -> Option<&'a InfoEcran> {
    demande
        .and_then(|id| ecrans.iter().find(|e| e.id == id))
        .or_else(|| ecrans.iter().find(|e| e.principal))
        .or_else(|| ecrans.first())
}

// ---------------------------------------------------------------------------
// Écrans
// ---------------------------------------------------------------------------

fn info_ecran(m: &Monitor, principal: Option<&Monitor>, index: usize) -> InfoEcran {
    let id = m.name().cloned().unwrap_or_else(|| format!("ecran-{index}"));
    let est_principal = principal
        .map(|p| p.name() == m.name() && p.position() == m.position())
        .unwrap_or(index == 0);
    InfoEcran {
        frequence_hz: plateforme::frequence_ecran(&id),
        id,
        principal: est_principal,
        rect: RectPx {
            x: m.position().x,
            y: m.position().y,
            largeur: m.size().width,
            hauteur: m.size().height,
        },
        facteur_echelle: m.scale_factor(),
    }
}

pub fn lister_ecrans(app: &AppHandle) -> Vec<InfoEcran> {
    let principal = app.primary_monitor().ok().flatten();
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .enumerate()
        .map(|(i, m)| info_ecran(m, principal.as_ref(), i))
        .collect()
}

fn fenetre(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(LABEL)
}

/// Place (ou replace) la fenêtre en haut au centre de l'écran choisi.
pub fn placer(app: &AppHandle) -> Result<InfoFenetre, String> {
    let etat = app.state::<EtatFenetre>();
    let fen = fenetre(app).ok_or("fenêtre introuvable")?;
    let ecrans = lister_ecrans(app);
    let demande = etat.ecran_choisi.lock().unwrap().clone();
    let ecran = choisir_ecran(&ecrans, demande.as_deref())
        .cloned()
        .ok_or("aucun écran détecté")?;

    let taille = taille_canevas_px(*etat.canevas_dip.lock().unwrap(), ecran.rect, ecran.facteur_echelle);
    let (x, y) = position_haut_centre(ecran.rect, taille);

    // Position d'abord (Windows peut changer l'échelle en changeant d'écran), puis taille, puis position.
    fen.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;
    fen.set_size(PhysicalSize::new(taille.0, taille.1))
        .map_err(|e| e.to_string())?;
    fen.set_position(PhysicalPosition::new(x, y))
        .map_err(|e| e.to_string())?;

    *etat.geometrie.lock().unwrap() = Some(((x, y), ecran.facteur_echelle));
    *etat.signature_ecrans.lock().unwrap() = signature_ecrans(&ecrans);

    let info = InfoFenetre {
        fenetre: RectPx {
            x,
            y,
            largeur: taille.0,
            hauteur: taille.1,
        },
        largeur_dip: taille.0 as f64 / ecran.facteur_echelle,
        hauteur_dip: taille.1 as f64 / ecran.facteur_echelle,
        ecran,
    };
    journal!(
        "fenetre",
        "placée sur {} ({}x{} px, échelle {}, {:?} Hz) → canevas {}x{} px à ({}, {})",
        info.ecran.id,
        info.ecran.rect.largeur,
        info.ecran.rect.hauteur,
        info.ecran.facteur_echelle,
        info.ecran.frequence_hz,
        taille.0,
        taille.1,
        x,
        y
    );
    *etat.derniere_info.lock().unwrap() = Some(info.clone());
    appliquer_region(app);
    let _ = app.emit(evenements::ECRAN, &info);
    Ok(info)
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/// Applique la zone d'affichage (mode région) avec l'échelle actuelle de l'écran.
fn appliquer_region(app: &AppHandle) {
    let etat = app.state::<EtatFenetre>();
    if !etat.mode_region.load(Ordering::Relaxed) {
        return;
    }
    let (Some(fen), Some((_, echelle))) = (fenetre(app), *etat.geometrie.lock().unwrap()) else {
        return;
    };
    let region = etat.region_dip.lock().unwrap().map(|r| region_px(r, echelle));
    // Aucune zone encore : fenêtre entièrement « absente » (rien de visible, tout traverse).
    plateforme::definir_region(&fen, Some(region.unwrap_or((0, 0, 0, 0))));
}

/// `clics_classiques` : mode de compatibilité (WS_EX_LAYERED basculé au survol).
pub fn initialiser(app: &AppHandle, clics_classiques: bool) -> Result<(), String> {
    let fen = fenetre(app).ok_or("fenêtre introuvable")?;
    plateforme::appliquer_styles(&fen);
    let etat = app.state::<EtatFenetre>();
    let region = plateforme::REGION_DISPONIBLE && !clics_classiques;
    etat.mode_region.store(region, Ordering::Relaxed);
    journal!(
        "fenetre",
        "clics traversants : {}",
        if region {
            "région de fenêtre (fluide)"
        } else {
            "classique (WS_EX_LAYERED)"
        }
    );
    placer(app)?;
    fen.show().map_err(|e| e.to_string())?;
    if !region {
        // Au départ, rien n'est touchable : tous les clics traversent.
        // (Après show() : sous Linux, la fenêtre doit exister à l'écran pour accepter ce réglage.)
        fen.set_ignore_cursor_events(true).map_err(|e| e.to_string())?;
    }

    // Garder la géométrie en cache à jour si Windows déplace / redimensionne la fenêtre.
    let app2 = app.clone();
    fen.on_window_event(move |ev| {
        if let tauri::WindowEvent::ScaleFactorChanged { .. } = ev {
            journal!("fenetre", "changement d'échelle détecté → replacement");
            let _ = placer(&app2);
        }
    });

    lancer_fil_curseur(app.clone());
    lancer_fil_lent(app.clone());
    Ok(())
}

/// Fil « curseur » : rend la fenêtre cliquable seulement quand le curseur est sur une zone touchable.
fn lancer_fil_curseur(app: AppHandle) {
    std::thread::Builder::new()
        .name("ile-curseur".into())
        .spawn(move || {
            let etat = app.state::<EtatFenetre>();
            let mut dedans_avant = false;
            let mut bouton_avant = false;
            loop {
                // Dort tant qu'il n'y a rien à surveiller (CPU ≈ 0 % au repos).
                // Attention : ne JAMAIS appeler la fenêtre en gardant ce verrou (les commandes
                // tournent sur le fil principal → interblocage possible).
                let zones = {
                    let mut z = etat.zones.lock().unwrap();
                    while z.is_empty() && !dedans_avant && !etat.ecouter_clic_exterieur.load(Ordering::Relaxed) {
                        z = etat.zones_changees.wait_timeout(z, Duration::from_secs(5)).unwrap().0;
                    }
                    z.clone()
                };

                let geo = *etat.geometrie.lock().unwrap();
                if let (Some((origine, echelle)), Some(curseur)) = (geo, plateforme::curseur_ecran(&app)) {
                    let dedans = curseur_dans_zones(curseur, origine, echelle, &zones);
                    if dedans != dedans_avant {
                        // En mode région, Windows route déjà les clics : rien à basculer.
                        if !etat.mode_region.load(Ordering::Relaxed) {
                            if let Some(f) = fenetre(&app) {
                                let _ = f.set_ignore_cursor_events(!dedans);
                            }
                        }
                        let _ = app.emit(evenements::SURVOL, dedans);
                        dedans_avant = dedans;
                    }

                    if etat.ecouter_clic_exterieur.load(Ordering::Relaxed) {
                        if let Some(bouton) = plateforme::bouton_gauche_enfonce() {
                            if bouton && !bouton_avant && !dedans {
                                journal!("fenetre", "clic à l'extérieur de l'île");
                                let _ = app.emit(evenements::CLIC_EXTERIEUR, ());
                            }
                            bouton_avant = bouton;
                        }
                    }
                }
                std::thread::sleep(INTERVALLE_CURSEUR);
            }
        })
        .expect("impossible de lancer le fil du curseur");
}

/// Fil « lent » : écrans branchés/débranchés et applications en plein écran.
fn lancer_fil_lent(app: AppHandle) {
    std::thread::Builder::new()
        .name("ile-ecrans".into())
        .spawn(move || loop {
            std::thread::sleep(INTERVALLE_LENT);
            let etat = app.state::<EtatFenetre>();

            // 1. Configuration des écrans.
            let ecrans = lister_ecrans(&app);
            let sig = signature_ecrans(&ecrans);
            if !ecrans.is_empty() && *etat.signature_ecrans.lock().unwrap() != sig {
                journal!(
                    "fenetre",
                    "configuration des écrans modifiée ({} écran(s))",
                    ecrans.len()
                );
                let _ = app.emit(evenements::ECRANS_CHANGES, &ecrans);
                let _ = placer(&app);
            }

            // 2. Plein écran.
            if let Some(fen) = fenetre(&app) {
                let plein = plateforme::plein_ecran_actif(&fen);
                if plein != etat.plein_ecran.swap(plein, Ordering::Relaxed) {
                    journal!("fenetre", "plein écran : {}", plein);
                    let _ = app.emit(evenements::PLEIN_ECRAN, plein);
                    appliquer_visibilite(&app);
                }
            }
        })
        .expect("impossible de lancer le fil des écrans");
}

fn appliquer_visibilite(app: &AppHandle) {
    let etat = app.state::<EtatFenetre>();
    let cacher = etat.cacher_en_plein_ecran.load(Ordering::Relaxed) && etat.plein_ecran.load(Ordering::Relaxed);
    if let Some(fen) = fenetre(app) {
        let _ = if cacher { fen.hide() } else { fen.show() };
    }
}

// ---------------------------------------------------------------------------
// Commandes appelées par le front-end
// ---------------------------------------------------------------------------

#[tauri::command]
pub fn fenetre_ecrans(app: AppHandle) -> Vec<InfoEcran> {
    lister_ecrans(&app)
}

#[tauri::command]
pub fn fenetre_info(app: AppHandle) -> Option<InfoFenetre> {
    app.state::<EtatFenetre>().derniere_info.lock().unwrap().clone()
}

/// `id = null` → écran principal.
#[tauri::command]
pub fn fenetre_choisir_ecran(app: AppHandle, id: Option<String>) -> Result<InfoFenetre, String> {
    *app.state::<EtatFenetre>().ecran_choisi.lock().unwrap() = id.clone();
    crate::parametres::modifier(&app, |p| p.ecran = id);
    placer(&app)
}

/// Taille de la surface de dessin (DIP). `null` → valeur par défaut.
#[tauri::command]
pub fn fenetre_definir_canevas(app: AppHandle, taille: Option<(f64, f64)>) -> Result<InfoFenetre, String> {
    *app.state::<EtatFenetre>().canevas_dip.lock().unwrap() = taille;
    placer(&app)
}

/// Zones où l'île peut être touchée (DIP, relatives à la fenêtre) et zone d'affichage `region`.
/// Windows (mode région) : hors de `region`, la fenêtre n'existe pas → les clics passent dessous.
#[tauri::command]
pub fn fenetre_zones_touchables(app: AppHandle, zones: Vec<RectDip>, region: Option<RectDip>) {
    let etat = app.state::<EtatFenetre>();
    *etat.zones.lock().unwrap() = zones;
    etat.zones_changees.notify_all();
    if region.is_some() {
        *etat.region_dip.lock().unwrap() = region;
        appliquer_region(&app);
    }
}

/// Active la détection des clics hors de l'île (utile en mode étendu seulement).
#[tauri::command]
pub fn fenetre_ecouter_clic_exterieur(app: AppHandle, actif: bool) {
    let etat = app.state::<EtatFenetre>();
    etat.ecouter_clic_exterieur.store(actif, Ordering::Relaxed);
    etat.zones_changees.notify_all();
}

#[tauri::command]
pub fn fenetre_cacher_en_plein_ecran(app: AppHandle, actif: bool) {
    app.state::<EtatFenetre>()
        .cacher_en_plein_ecran
        .store(actif, Ordering::Relaxed);
    crate::parametres::modifier(&app, |p| p.cacher_en_plein_ecran = actif);
    appliquer_visibilite(&app);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const ECRAN: RectPx = RectPx {
        x: 0,
        y: 0,
        largeur: 2560,
        hauteur: 1440,
    };

    fn ecran(id: &str, principal: bool, x: i32) -> InfoEcran {
        InfoEcran {
            id: id.into(),
            principal,
            rect: RectPx {
                x,
                y: 0,
                largeur: 1920,
                hauteur: 1080,
            },
            facteur_echelle: 1.0,
            frequence_hz: Some(60),
        }
    }

    #[test]
    fn centre_en_haut() {
        assert_eq!(position_haut_centre(ECRAN, (1000, 300)), (780, 0));
        // Écran secondaire à gauche (coordonnées négatives).
        let gauche = RectPx {
            x: -1920,
            y: -200,
            largeur: 1920,
            hauteur: 1080,
        };
        assert_eq!(position_haut_centre(gauche, (920, 100)), (-1420, -200));
    }

    #[test]
    fn canevas_converti_selon_l_echelle_et_borne_a_l_ecran() {
        assert_eq!(taille_canevas_px(Some((400.0, 100.0)), ECRAN, 1.5), (600, 150));
        assert_eq!(taille_canevas_px(Some((400.0, 100.0)), ECRAN, 1.25), (500, 125));
        assert_eq!(taille_canevas_px(Some((9999.0, 9999.0)), ECRAN, 1.0), (2560, 1440));
        assert_eq!(taille_canevas_px(None, ECRAN, 2.0), (2560, 480));
    }

    #[test]
    fn zones_touchables_en_dip() {
        let zones = [RectDip {
            x: 100.0,
            y: 10.0,
            largeur: 50.0,
            hauteur: 20.0,
        }];
        // Échelle 150 % : la zone va de 150 à 225 px en x, de 15 à 45 px en y (+ origine).
        let origine = (1000, 0);
        assert!(curseur_dans_zones((1150, 15), origine, 1.5, &zones));
        assert!(curseur_dans_zones((1224, 44), origine, 1.5, &zones));
        assert!(!curseur_dans_zones((1225, 30), origine, 1.5, &zones));
        assert!(!curseur_dans_zones((1149, 30), origine, 1.5, &zones));
        assert!(!curseur_dans_zones((1200, 50), origine, 1.5, &zones));
        assert!(!curseur_dans_zones((1200, 30), origine, 1.5, &[]));
    }

    #[test]
    fn region_arrondie_vers_l_exterieur() {
        let r = RectDip {
            x: 10.2,
            y: 0.0,
            largeur: 100.1,
            hauteur: 40.0,
        };
        assert_eq!(region_px(r, 2.0), (20, 0, 201, 80));
        assert_eq!(region_px(r, 1.25), (12, 0, 126, 50));
    }

    #[test]
    fn rect_contient() {
        let fen = RectPx {
            x: -1,
            y: -1,
            largeur: 2562,
            hauteur: 1442,
        };
        assert!(fen.contient(&ECRAN));
        assert!(ECRAN.contient(&ECRAN));
        let petite = RectPx {
            x: 0,
            y: 0,
            largeur: 2560,
            hauteur: 1400,
        };
        assert!(!petite.contient(&ECRAN));
    }

    #[test]
    fn choix_de_l_ecran() {
        let ecrans = vec![ecran("A", false, -1920), ecran("B", true, 0)];
        assert_eq!(choisir_ecran(&ecrans, None).unwrap().id, "B");
        assert_eq!(choisir_ecran(&ecrans, Some("A")).unwrap().id, "A");
        // Écran débranché → retour au principal.
        assert_eq!(choisir_ecran(&ecrans, Some("Z")).unwrap().id, "B");
        assert!(choisir_ecran(&[], None).is_none());
    }

    #[test]
    fn signature_change_avec_l_echelle() {
        let mut ecrans = vec![ecran("A", true, 0)];
        let s1 = signature_ecrans(&ecrans);
        ecrans[0].facteur_echelle = 1.25;
        assert_ne!(s1, signature_ecrans(&ecrans));
    }
}
