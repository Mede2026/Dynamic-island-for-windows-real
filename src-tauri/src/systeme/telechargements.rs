//! Téléchargements en cours dans le dossier Téléchargements : les navigateurs écrivent dans
//! un fichier temporaire (« photo.jpg.crdownload », « .part »…) puis le renomment à la fin.
//! Relevé toutes les secondes : nom, taille déjà reçue et vitesse ; la taille totale n'est
//! pas connue, donc pas de pourcentage. Fin : le fichier final apparaît.

use serde::Serialize;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "telechargements";

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Telechargement {
    pub nom: String,
    pub octets: u64,
    /// Octets par seconde (moyenne des dernières secondes).
    pub vitesse: f64,
}

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EtatTelechargements {
    pub en_cours: Vec<Telechargement>,
    /// Fichier terminé à l'instant (nom, chemin complet).
    pub termine: Option<(String, String)>,
}

const SUFFIXES: [&str; 4] = [".crdownload", ".part", ".download", ".partial"];

/// Nom final d'un fichier temporaire de navigateur (None : fichier ordinaire).
pub fn nom_final(fichier: &str) -> Option<String> {
    let bas = fichier.to_lowercase();
    let suffixe = SUFFIXES.iter().find(|s| bas.ends_with(*s))?;
    let nom = &fichier[..fichier.len() - suffixe.len()];
    if nom.is_empty() {
        return None;
    }
    // Chrome : « Non confirmé 123456.crdownload » avant que le vrai nom soit connu.
    let provisoire = (nom.starts_with("Unconfirmed ") || nom.starts_with("Non confirmé "))
        && nom
            .rsplit(' ')
            .next()
            .is_some_and(|n| n.chars().all(|c| c.is_ascii_digit()));
    Some(if provisoire { String::new() } else { nom.to_owned() })
}

fn dossier() -> Option<PathBuf> {
    #[cfg(windows)]
    unsafe {
        use windows::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, KNOWN_FOLDER_FLAG};
        if let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Downloads, KNOWN_FOLDER_FLAG(0), None) {
            let chemin = p.to_string().ok();
            windows::Win32::System::Com::CoTaskMemFree(Some(p.0 as *const _));
            if let Some(c) = chemin {
                return Some(PathBuf::from(c));
            }
        }
    }
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(|h| PathBuf::from(h).join("Downloads"))
}

pub fn demarrer(app: AppHandle) {
    use tauri::Emitter;
    let Some(dossier) = dossier() else {
        return journal!("telechargements", "dossier Téléchargements introuvable");
    };
    journal!("telechargements", "surveille {}", dossier.display());
    std::thread::Builder::new()
        .name("ile-telechargements".into())
        .spawn(move || {
            // fichier temporaire → (nom final, tailles des dernières secondes)
            let mut suivis: HashMap<String, (String, Vec<u64>)> = HashMap::new();
            let mut avant_vide = true;
            loop {
                std::thread::sleep(std::time::Duration::from_millis(1000));
                let mut vus = Vec::new();
                if let Ok(entrees) = std::fs::read_dir(&dossier) {
                    for e in entrees.flatten() {
                        let nom = e.file_name().to_string_lossy().into_owned();
                        if let Some(final_) = nom_final(&nom) {
                            // Taille lue sur le fichier lui-même : celle du dossier (mise en cache
                            // par Windows) cesse d'avancer pendant que le navigateur écrit.
                            let taille = std::fs::metadata(e.path()).map(|m| m.len()).unwrap_or(0);
                            let suivi = suivis
                                .entry(nom.clone())
                                .or_insert_with(|| (final_.clone(), Vec::new()));
                            suivi.0 = final_;
                            suivi.1.push(taille);
                            if suivi.1.len() > 5 {
                                suivi.1.remove(0);
                            }
                            vus.push(nom);
                        }
                    }
                }
                // Disparus : terminés si le fichier final existe.
                let mut termine = None;
                for (temp, (final_, _)) in suivis.clone() {
                    if vus.contains(&temp) {
                        continue;
                    }
                    suivis.remove(&temp);
                    let chemin = dossier.join(&final_);
                    if !final_.is_empty() && chemin.exists() {
                        journal!("telechargements", "terminé : {final_}");
                        termine = Some((final_, chemin.to_string_lossy().into_owned()));
                    }
                }
                let en_cours: Vec<Telechargement> = suivis
                    .values()
                    .map(|(nom, tailles)| Telechargement {
                        nom: if nom.is_empty() {
                            "Téléchargement".into()
                        } else {
                            nom.clone()
                        },
                        octets: *tailles.last().unwrap_or(&0),
                        vitesse: match (tailles.first(), tailles.last()) {
                            (Some(a), Some(b)) if tailles.len() > 1 => {
                                b.saturating_sub(*a) as f64 / (tailles.len() - 1) as f64
                            }
                            _ => 0.0,
                        },
                    })
                    .collect();
                let vide = en_cours.is_empty();
                if !(vide && avant_vide && termine.is_none()) {
                    let _ = app.emit(EVENEMENT, EtatTelechargements { en_cours, termine });
                }
                avant_vide = vide;
            }
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::nom_final;

    #[test]
    fn noms() {
        assert_eq!(nom_final("rapport.pdf.crdownload").as_deref(), Some("rapport.pdf"));
        assert_eq!(nom_final("setup.exe.part").as_deref(), Some("setup.exe"));
        assert_eq!(nom_final("Unconfirmed 123456.crdownload").as_deref(), Some(""));
        assert_eq!(nom_final("Non confirmé 42.crdownload").as_deref(), Some(""));
        assert_eq!(nom_final("photo.jpg"), None);
        assert_eq!(nom_final(".part"), None);
    }
}
