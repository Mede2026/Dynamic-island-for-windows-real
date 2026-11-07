//! Impressions en cours : document, pages imprimées / total, imprimante ; « Imprimé » à la
//! fin, ou une erreur (papier, bourrage, hors ligne). Relevé de la file d'attente de Windows
//! toutes les 1,5 s (seulement des lectures).

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "impression";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TravailImpression {
    pub id: u32,
    pub document: String,
    pub imprimante: String,
    pub pages_imprimees: u32,
    pub pages_total: u32,
    /// Problème signalé (« Plus de papier »…), sinon None.
    pub erreur: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct EtatImpression {
    pub en_cours: Vec<TravailImpression>,
    /// Travail qui vient de quitter la file (imprimé, ou annulé avec une erreur).
    pub fini: Option<TravailImpression>,
}

/// Texte d'un état de travail (bits JOB_STATUS_*).
pub fn erreur_statut(statut: u32) -> Option<&'static str> {
    const PAUSE: u32 = 0x1;
    const ERREUR: u32 = 0x2;
    const HORS_LIGNE: u32 = 0x20;
    const PAPIER: u32 = 0x40;
    const INTERVENTION: u32 = 0x400;
    const BLOQUE: u32 = 0x200;
    if statut & PAPIER != 0 {
        Some("Plus de papier")
    } else if statut & HORS_LIGNE != 0 {
        Some("Imprimante hors ligne")
    } else if statut & (INTERVENTION | BLOQUE) != 0 {
        Some("Intervention requise")
    } else if statut & ERREUR != 0 {
        Some("Erreur d'impression")
    } else if statut & PAUSE != 0 {
        Some("En pause")
    } else {
        None
    }
}

#[cfg(windows)]
fn lire_travaux() -> Vec<TravailImpression> {
    use windows::core::PWSTR;
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, EnumJobsW, EnumPrintersW, OpenPrinterW, JOB_INFO_1W, PRINTER_ENUM_CONNECTIONS,
        PRINTER_ENUM_LOCAL, PRINTER_HANDLE, PRINTER_INFO_4W,
    };
    let texte = |p: PWSTR| {
        if p.is_null() {
            String::new()
        } else {
            unsafe { p.to_string().unwrap_or_default() }
        }
    };
    let mut travaux = Vec::new();
    unsafe {
        let (mut besoin, mut nombre) = (0u32, 0u32);
        let drapeaux = PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS;
        let _ = EnumPrintersW(drapeaux, None, 4, None, &mut besoin, &mut nombre);
        if besoin == 0 {
            return travaux;
        }
        let mut tampon = vec![0u8; besoin as usize];
        if EnumPrintersW(drapeaux, None, 4, Some(&mut tampon), &mut besoin, &mut nombre).is_err() {
            return travaux;
        }
        let imprimantes = std::slice::from_raw_parts(tampon.as_ptr() as *const PRINTER_INFO_4W, nombre as usize);
        for imp in imprimantes {
            let nom = texte(imp.pPrinterName);
            let mut h = PRINTER_HANDLE::default();
            if OpenPrinterW(imp.pPrinterName, &mut h, None).is_err() {
                continue;
            }
            let (mut b, mut n) = (0u32, 0u32);
            let _ = EnumJobsW(h, 0, 32, 1, None, &mut b, &mut n);
            if b > 0 {
                let mut t = vec![0u8; b as usize];
                if EnumJobsW(h, 0, 32, 1, Some(&mut t), &mut b, &mut n).is_ok() {
                    for j in std::slice::from_raw_parts(t.as_ptr() as *const JOB_INFO_1W, n as usize) {
                        travaux.push(TravailImpression {
                            id: j.JobId,
                            document: texte(j.pDocument),
                            imprimante: nom.clone(),
                            pages_imprimees: j.PagesPrinted,
                            pages_total: j.TotalPages,
                            erreur: erreur_statut(j.Status).map(str::to_owned),
                        });
                    }
                }
            }
            let _ = ClosePrinter(h);
        }
    }
    travaux
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use tauri::Emitter;
    std::thread::Builder::new()
        .name("ile-impression".into())
        .spawn(move || {
            let mut avant: Vec<TravailImpression> = Vec::new();
            loop {
                std::thread::sleep(std::time::Duration::from_millis(1500));
                let maintenant = lire_travaux();
                if maintenant == avant {
                    continue;
                }
                let fini = avant.iter().find(|a| !maintenant.iter().any(|m| m.id == a.id)).cloned();
                if let Some(f) = &fini {
                    journal!("impression", "fini : « {} » sur {}", f.document, f.imprimante);
                }
                let _ = app.emit(
                    EVENEMENT,
                    EtatImpression {
                        en_cours: maintenant.clone(),
                        fini,
                    },
                );
                avant = maintenant;
            }
        })
        .ok();
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("impression", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    #[test]
    fn statuts() {
        assert_eq!(super::erreur_statut(0x40), Some("Plus de papier"));
        assert_eq!(super::erreur_statut(0x10), None); // en cours d'impression
        assert_eq!(super::erreur_statut(0), None);
    }
}
