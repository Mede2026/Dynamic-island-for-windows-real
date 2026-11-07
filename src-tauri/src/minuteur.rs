//! Minuteur interne de l'app : démarrer, pause, reprendre, annuler, temps restant.
//!
//! La logique (`Minuteur`) est pure : on lui donne l'heure, elle ne la lit jamais
//! elle-même → facile à tester. Les commandes Tauri l'enveloppent.

use serde::Serialize;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

use crate::journal::maintenant_ms;
use crate::{evenements, journal};

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum StatutMinuteur {
    Inactif,
    EnCours,
    Pause,
    Termine,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EtatMinuteur {
    pub statut: StatutMinuteur,
    pub duree_ms: u64,
    pub restant_ms: u64,
    /// Heure de fin (ms depuis 1970) si le minuteur tourne : le front-end
    /// peut afficher le compte à rebours sans recevoir un événement par seconde.
    pub fin_a_ms: Option<i64>,
}

#[derive(Debug)]
pub struct Minuteur {
    statut: StatutMinuteur,
    duree_ms: u64,
    /// Temps restant au moment de `depuis_ms`.
    restant_ms: u64,
    /// Instant (horloge monotone, ms) du dernier démarrage / de la dernière reprise.
    depuis_ms: u64,
    /// Change à chaque action : un vieux réveil ne peut pas terminer un nouveau minuteur.
    pub generation: u64,
}

impl Default for Minuteur {
    fn default() -> Self {
        Self {
            statut: StatutMinuteur::Inactif,
            duree_ms: 0,
            restant_ms: 0,
            depuis_ms: 0,
            generation: 0,
        }
    }
}

impl Minuteur {
    pub fn restant(&self, maintenant: u64) -> u64 {
        match self.statut {
            StatutMinuteur::EnCours => self
                .restant_ms
                .saturating_sub(maintenant.saturating_sub(self.depuis_ms)),
            StatutMinuteur::Pause => self.restant_ms,
            _ => 0,
        }
    }

    pub fn demarrer(&mut self, duree_ms: u64, maintenant: u64) -> Result<(), String> {
        if duree_ms == 0 {
            return Err("durée nulle".into());
        }
        self.statut = StatutMinuteur::EnCours;
        self.duree_ms = duree_ms;
        self.restant_ms = duree_ms;
        self.depuis_ms = maintenant;
        self.generation += 1;
        Ok(())
    }

    pub fn pause(&mut self, maintenant: u64) -> Result<(), String> {
        if self.statut != StatutMinuteur::EnCours {
            return Err("le minuteur ne tourne pas".into());
        }
        self.restant_ms = self.restant(maintenant);
        self.statut = StatutMinuteur::Pause;
        self.generation += 1;
        Ok(())
    }

    pub fn reprendre(&mut self, maintenant: u64) -> Result<(), String> {
        if self.statut != StatutMinuteur::Pause {
            return Err("le minuteur n'est pas en pause".into());
        }
        self.statut = StatutMinuteur::EnCours;
        self.depuis_ms = maintenant;
        self.generation += 1;
        Ok(())
    }

    pub fn annuler(&mut self) {
        *self = Self {
            generation: self.generation + 1,
            ..Self::default()
        };
    }

    /// Passe à `Termine` si le temps est écoulé. Renvoie true si ça vient d'arriver.
    pub fn verifier(&mut self, maintenant: u64) -> bool {
        if self.statut == StatutMinuteur::EnCours && self.restant(maintenant) == 0 {
            self.statut = StatutMinuteur::Termine;
            self.restant_ms = 0;
            self.generation += 1;
            return true;
        }
        false
    }

    pub fn etat(&self, maintenant: u64, maintenant_unix_ms: i64) -> EtatMinuteur {
        let restant = self.restant(maintenant);
        EtatMinuteur {
            statut: self.statut,
            duree_ms: self.duree_ms,
            restant_ms: restant,
            fin_a_ms: (self.statut == StatutMinuteur::EnCours).then_some(maintenant_unix_ms + restant as i64),
        }
    }
}

// ---------------------------------------------------------------------------
// Intégration Tauri
// ---------------------------------------------------------------------------

#[derive(Default)]
pub struct EtatMinuteurApp(pub Mutex<Minuteur>);

/// Horloge monotone (ms) : ne recule jamais, même si l'heure de Windows change.
fn horloge() -> u64 {
    static DEPART: OnceLock<Instant> = OnceLock::new();
    DEPART.get_or_init(Instant::now).elapsed().as_millis() as u64
}

fn publier(app: &AppHandle, m: &Minuteur) -> EtatMinuteur {
    let etat = m.etat(horloge(), maintenant_ms());
    journal!("minuteur", "{:?}, restant {} ms", etat.statut, etat.restant_ms);
    let _ = app.emit(evenements::MINUTEUR, &etat);
    etat
}

/// Lance un réveil qui terminera le minuteur à l'heure prévue (s'il n'a pas changé entre-temps).
fn programmer_reveil(app: &AppHandle, m: &Minuteur) {
    if m.statut != StatutMinuteur::EnCours {
        return;
    }
    let generation = m.generation;
    let attente = m.restant(horloge());
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(attente));
        let etat = app.state::<EtatMinuteurApp>();
        let mut m = etat.0.lock().unwrap();
        if m.generation == generation && m.verifier(horloge()) {
            publier(&app, &m);
            crate::integration::notifier_fin_minuteur(&app, m.duree_ms);
        }
    });
}

fn agir(
    app: &AppHandle,
    action: impl FnOnce(&mut Minuteur, u64) -> Result<(), String>,
) -> Result<EtatMinuteur, String> {
    let etat = app.state::<EtatMinuteurApp>();
    let mut m = etat.0.lock().unwrap();
    action(&mut m, horloge())?;
    programmer_reveil(app, &m);
    Ok(publier(app, &m))
}

#[tauri::command]
pub fn minuteur_demarrer(app: AppHandle, duree_ms: u64) -> Result<EtatMinuteur, String> {
    agir(&app, |m, t| m.demarrer(duree_ms, t))
}

#[tauri::command]
pub fn minuteur_pause(app: AppHandle) -> Result<EtatMinuteur, String> {
    agir(&app, |m, t| m.pause(t))
}

#[tauri::command]
pub fn minuteur_reprendre(app: AppHandle) -> Result<EtatMinuteur, String> {
    agir(&app, |m, t| m.reprendre(t))
}

#[tauri::command]
pub fn minuteur_annuler(app: AppHandle) -> Result<EtatMinuteur, String> {
    agir(&app, |m, _| {
        m.annuler();
        Ok(())
    })
}

#[tauri::command]
pub fn minuteur_etat(app: AppHandle) -> EtatMinuteur {
    app.state::<EtatMinuteurApp>()
        .0
        .lock()
        .unwrap()
        .etat(horloge(), maintenant_ms())
}

// ---------------------------------------------------------------------------
// Contrôle par la ligne de commande (raccourci Windows, MacroPad, Stream Deck…)
//   dynamic-island.exe --minuteur 5m      (aussi : 90s, 1h30m, 2m30s, 300 = secondes)
//   dynamic-island.exe --minuteur-pause | --minuteur-reprendre | --minuteur-annuler
// Si l'île tourne déjà, la 2e instance transmet ces arguments à la 1re puis se ferme.
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OrdreMinuteur {
    Demarrer(u64),
    Pause,
    Reprendre,
    Annuler,
}

/// « 5m », « 90s », « 1h30m », « 2m30s », « 300 » (secondes) → millisecondes.
pub fn analyser_duree(texte: &str) -> Option<u64> {
    let t = texte.trim().to_lowercase();
    if t.is_empty() {
        return None;
    }
    if let Ok(secondes) = t.parse::<u64>() {
        return Some(secondes * 1000);
    }
    let (mut total, mut nombre) = (0u64, String::new());
    for c in t.chars() {
        if c.is_ascii_digit() {
            nombre.push(c);
            continue;
        }
        let n: u64 = nombre.parse().ok()?;
        nombre.clear();
        total += n * match c {
            'h' => 3_600_000,
            'm' => 60_000,
            's' => 1_000,
            _ => return None,
        };
    }
    (nombre.is_empty() && total > 0).then_some(total)
}

pub fn ordre_depuis_arguments(args: &[String]) -> Option<OrdreMinuteur> {
    let mut it = args.iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "--minuteur" => return it.next().and_then(|d| analyser_duree(d)).map(OrdreMinuteur::Demarrer),
            "--minuteur-pause" => return Some(OrdreMinuteur::Pause),
            "--minuteur-reprendre" => return Some(OrdreMinuteur::Reprendre),
            "--minuteur-annuler" => return Some(OrdreMinuteur::Annuler),
            _ => {}
        }
    }
    None
}

/// Exécute un éventuel ordre de minuteur trouvé dans les arguments.
pub fn executer_arguments(app: &AppHandle, args: &[String]) {
    let Some(ordre) = ordre_depuis_arguments(args) else {
        return;
    };
    journal!("minuteur", "ordre reçu par la ligne de commande : {:?}", ordre);
    let r = match ordre {
        OrdreMinuteur::Demarrer(ms) => agir(app, |m, t| m.demarrer(ms, t)),
        OrdreMinuteur::Pause => agir(app, |m, t| m.pause(t)),
        OrdreMinuteur::Reprendre => agir(app, |m, t| m.reprendre(t)),
        OrdreMinuteur::Annuler => agir(app, |m, _| {
            m.annuler();
            Ok(())
        }),
    };
    if let Err(e) = r {
        journal!("minuteur", "ordre refusé : {e}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durees() {
        assert_eq!(analyser_duree("5m"), Some(300_000));
        assert_eq!(analyser_duree("90s"), Some(90_000));
        assert_eq!(analyser_duree("1h30m"), Some(5_400_000));
        assert_eq!(analyser_duree("2M30S"), Some(150_000));
        assert_eq!(analyser_duree("300"), Some(300_000));
        assert_eq!(analyser_duree("5"), Some(5_000));
        for mauvais in ["", "m", "5x", "5m3", "abc", "0s"] {
            assert_eq!(analyser_duree(mauvais), None, "{mauvais}");
        }
    }

    #[test]
    fn arguments() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(
            ordre_depuis_arguments(&a(&["ile.exe", "--minuteur", "10m"])),
            Some(OrdreMinuteur::Demarrer(600_000))
        );
        assert_eq!(
            ordre_depuis_arguments(&a(&["ile.exe", "--minuteur-annuler"])),
            Some(OrdreMinuteur::Annuler)
        );
        assert_eq!(ordre_depuis_arguments(&a(&["ile.exe", "--minuteur"])), None);
        assert_eq!(ordre_depuis_arguments(&a(&["ile.exe", "--demarrage-auto"])), None);
    }

    #[test]
    fn cycle_complet() {
        let mut m = Minuteur::default();
        assert_eq!(m.restant(0), 0);
        m.demarrer(10_000, 1_000).unwrap();
        assert_eq!(m.restant(4_000), 7_000);

        m.pause(4_000).unwrap();
        assert_eq!(m.restant(60_000), 7_000); // le temps ne bouge pas en pause
        assert!(m.pause(60_000).is_err());

        m.reprendre(60_000).unwrap();
        assert_eq!(m.restant(61_000), 6_000);
        assert!(!m.verifier(66_999));
        assert!(m.verifier(67_000));
        assert_eq!(m.etat(67_000, 0).statut, StatutMinuteur::Termine);
        assert!(!m.verifier(70_000)); // une seule fois
    }

    #[test]
    fn annuler_et_generation() {
        let mut m = Minuteur::default();
        m.demarrer(5_000, 0).unwrap();
        let g = m.generation;
        m.annuler();
        assert!(m.generation > g);
        assert_eq!(m.etat(1_000, 0).statut, StatutMinuteur::Inactif);
        assert!(!m.verifier(10_000));
    }

    #[test]
    fn etat_donne_l_heure_de_fin() {
        let mut m = Minuteur::default();
        m.demarrer(3_000, 100).unwrap();
        let e = m.etat(1_100, 1_000_000);
        assert_eq!(e.restant_ms, 2_000);
        assert_eq!(e.fin_a_ms, Some(1_002_000));
        m.pause(1_100).unwrap();
        assert_eq!(m.etat(1_100, 0).fin_a_ms, None);
    }

    #[test]
    fn erreurs() {
        let mut m = Minuteur::default();
        assert!(m.demarrer(0, 0).is_err());
        assert!(m.reprendre(0).is_err());
        assert!(m.pause(0).is_err());
    }
}
