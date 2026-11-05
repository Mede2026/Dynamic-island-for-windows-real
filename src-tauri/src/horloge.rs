//! Minuteurs lancés dans l'app **Horloge** de Windows → l'île les affiche.
//!
//! Windows n'offre AUCUNE API pour lire les minuteurs de l'Horloge. On lit donc ce que sa
//! fenêtre affiche, avec UI Automation (l'outil d'accessibilité de Windows, celui des
//! lecteurs d'écran). Méthode indépendante de la langue : on relève toutes les durées
//! affichées (« 14:52 », « 00:14:52 ») ; une durée qui DIMINUE d'environ une seconde par
//! seconde est un minuteur en marche.
//!
//! Limite : la fenêtre Horloge doit être ouverte (elle peut être réduite ou derrière les
//! autres). Expérimental — voir docs/limites.md.

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "minuteur-horloge";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct MinuteurHorloge {
    /// "enCours" | "inactif"
    pub statut: &'static str,
    pub duree_ms: u64,
    pub restant_ms: u64,
    pub fin_a_ms: Option<i64>,
}

/// Toutes les durées « h:mm:ss » ou « mm:ss » d'un texte, en millisecondes.
pub fn durees_dans(texte: &str) -> Vec<u64> {
    let octets: Vec<char> = texte.chars().collect();
    let mut resultats = Vec::new();
    let mut i = 0;
    while i < octets.len() {
        if !octets[i].is_ascii_digit() || (i > 0 && (octets[i - 1].is_ascii_digit() || octets[i - 1] == ':')) {
            i += 1;
            continue;
        }
        // Groupes de chiffres séparés par « : ».
        let mut groupes: Vec<u64> = Vec::new();
        let mut j = i;
        loop {
            let debut = j;
            while j < octets.len() && octets[j].is_ascii_digit() {
                j += 1;
            }
            if j == debut || j - debut > 2 {
                groupes.clear();
                break;
            }
            groupes.push(octets[debut..j].iter().collect::<String>().parse().unwrap_or(0));
            if j < octets.len() && octets[j] == ':' && j + 1 < octets.len() && octets[j + 1].is_ascii_digit() {
                j += 1;
            } else {
                break;
            }
        }
        let valide = |g: &[u64]| g.iter().skip(1).all(|&x| x < 60);
        match groupes.as_slice() {
            [m, s] if valide(&groupes) => resultats.push((m * 60 + s) * 1000),
            [h, m, s] if valide(&groupes) => resultats.push(((h * 60 + m) * 60 + s) * 1000),
            _ => {}
        }
        i = j.max(i + 1);
    }
    resultats
}

/// Parmi deux relevés successifs (même ordre), le plus petit minuteur qui diminue au rythme
/// du temps écoulé (± 1,5 s, car l'affichage est arrondi à la seconde).
pub fn minuteur_en_cours(avant: &[u64], apres: &[u64], ecoule_ms: u64) -> Option<u64> {
    if avant.len() != apres.len() {
        return None;
    }
    avant
        .iter()
        .zip(apres)
        .filter(|(a, b)| **b < **a && (**a - **b).abs_diff(ecoule_ms) <= 1500)
        .map(|(_, b)| *b)
        .min()
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use std::time::{Duration, Instant};
    use tauri::Emitter;
    use windows::core::BOOL;
    use windows::Win32::Foundation::{HWND, LPARAM};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_MULTITHREADED};
    use windows::Win32::UI::Accessibility::{CUIAutomation, IUIAutomation, TreeScope_Descendants};
    use windows::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowTextW, IsWindowVisible};

    /// Titres de la fenêtre Horloge selon la langue de Windows.
    const TITRES: [&str; 5] = ["Horloge", "Clock", "Alarmes et horloge", "Alarms & Clock", "Uhr"];

    unsafe extern "system" fn rappel(hwnd: HWND, donnees: LPARAM) -> BOOL {
        let trouvee = &mut *(donnees.0 as *mut Option<HWND>);
        let mut t = [0u16; 128];
        let n = GetWindowTextW(hwnd, &mut t).max(0) as usize;
        let titre = String::from_utf16_lossy(&t[..n]);
        if IsWindowVisible(hwnd).as_bool() && TITRES.iter().any(|x| titre == *x) {
            *trouvee = Some(hwnd);
            return false.into();
        }
        true.into()
    }

    fn fenetre_horloge() -> Option<HWND> {
        let mut trouvee: Option<HWND> = None;
        unsafe {
            let _ = EnumWindows(Some(rappel), LPARAM(&mut trouvee as *mut _ as isize));
        }
        trouvee
    }

    fn relever(uia: &IUIAutomation, hwnd: HWND) -> Option<Vec<u64>> {
        unsafe {
            let racine = uia.ElementFromHandle(hwnd).ok()?;
            let tous = racine
                .FindAll(TreeScope_Descendants, &uia.CreateTrueCondition().ok()?)
                .ok()?;
            let mut durees = Vec::new();
            for i in 0..tous.Length().ok()? {
                if let Ok(nom) = tous.GetElement(i).and_then(|e| e.CurrentName()) {
                    durees.extend(durees_dans(&nom.to_string()));
                }
            }
            Some(durees)
        }
    }

    std::thread::Builder::new()
        .name("ile-horloge".into())
        .spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let Ok(uia) = CoCreateInstance::<_, IUIAutomation>(&CUIAutomation, None, CLSCTX_INPROC_SERVER) else {
                return journal!("horloge", "UI Automation indisponible");
            };
            let mut avant: Option<(Instant, Vec<u64>)> = None;
            let mut dernier = MinuteurHorloge {
                statut: "inactif",
                duree_ms: 0,
                restant_ms: 0,
                fin_a_ms: None,
            };
            let mut duree_max = 0u64;
            loop {
                let releve = fenetre_horloge().and_then(|h| relever(&uia, h));
                let Some(durees) = releve else {
                    // Horloge fermée : vérifier toutes les 3 s seulement.
                    avant = None;
                    if dernier.statut != "inactif" {
                        dernier = MinuteurHorloge {
                            statut: "inactif",
                            duree_ms: 0,
                            restant_ms: 0,
                            fin_a_ms: None,
                        };
                        let _ = app.emit(EVENEMENT, &dernier);
                    }
                    std::thread::sleep(Duration::from_secs(3));
                    continue;
                };
                let maintenant = Instant::now();
                let en_cours = avant
                    .as_ref()
                    .and_then(|(t, d)| minuteur_en_cours(d, &durees, maintenant.duration_since(*t).as_millis() as u64));
                let etat = match en_cours {
                    Some(restant) => {
                        duree_max = duree_max.max(restant);
                        MinuteurHorloge {
                            statut: "enCours",
                            duree_ms: duree_max,
                            restant_ms: restant,
                            fin_a_ms: Some(crate::journal::maintenant_ms() + restant as i64),
                        }
                    }
                    None => {
                        duree_max = 0;
                        MinuteurHorloge {
                            statut: "inactif",
                            duree_ms: 0,
                            restant_ms: 0,
                            fin_a_ms: None,
                        }
                    }
                };
                // Prévenir l'île si l'état change ou si l'heure de fin dérive de plus d'une seconde.
                let derive = match (etat.fin_a_ms, dernier.fin_a_ms) {
                    (Some(a), Some(b)) => (a - b).abs() > 1000,
                    _ => true,
                };
                if etat.statut != dernier.statut || (etat.statut == "enCours" && derive) {
                    journal!("horloge", "minuteur {} ({} ms)", etat.statut, etat.restant_ms);
                    let _ = app.emit(EVENEMENT, &etat);
                    dernier = etat;
                }
                avant = Some((maintenant, durees));
                std::thread::sleep(Duration::from_millis(1000));
            }
        })
        .expect("impossible de lancer le fil de l'Horloge");
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("horloge", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lecture_des_durees() {
        assert_eq!(durees_dans("Minuteur 1, 14:52"), vec![892_000]);
        assert_eq!(durees_dans("00:14:52 restant"), vec![892_000]);
        assert_eq!(durees_dans("1:02:03"), vec![3_723_000]);
        assert_eq!(durees_dans("Alarme 7:30, 08:15 et 12:61"), vec![450_000, 495_000]);
        assert!(durees_dans("Minuteur 1").is_empty());
        assert!(durees_dans("2025-11-05").is_empty());
    }

    #[test]
    fn detection_du_minuteur_qui_tourne() {
        // Deux minuteurs : l'un en pause (14:00), l'autre qui tourne (05:10 → 05:09).
        assert_eq!(
            minuteur_en_cours(&[840_000, 310_000], &[840_000, 309_000], 1000),
            Some(309_000)
        );
        // Rien ne bouge → aucun minuteur en marche.
        assert_eq!(minuteur_en_cours(&[840_000], &[840_000], 1000), None);
        // Une valeur qui saute (changement d'écran) n'est pas un minuteur.
        assert_eq!(minuteur_en_cours(&[840_000], &[300_000], 1000), None);
        // Listes différentes (la vue a changé) → on attend le prochain relevé.
        assert_eq!(minuteur_en_cours(&[1, 2], &[1], 1000), None);
    }
}
