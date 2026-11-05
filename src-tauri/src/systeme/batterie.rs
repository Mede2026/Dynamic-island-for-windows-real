//! Batterie : pourcentage, chargeur branché/débranché.
//! Windows : lecture avec GetSystemPowerStatus, changements reçus par les
//! événements WinRT `PowerManager` (aucune scrutation).

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::{evenements, journal};

#[derive(Clone, Debug, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EtatBatterie {
    /// false sur un PC de bureau sans batterie.
    pub presente: bool,
    /// 0–100, ou None si inconnu.
    pub pourcentage: Option<u8>,
    /// Chargeur branché (alimentation secteur).
    pub branche: bool,
    pub en_charge: bool,
    /// Mode économie d'énergie.
    pub economie: bool,
}

/// Valeurs brutes de SYSTEM_POWER_STATUS → EtatBatterie (fonction pure, testée).
pub fn depuis_brut(ac: u8, drapeaux: u8, pourcentage: u8, systeme: u8) -> EtatBatterie {
    const SANS_BATTERIE: u8 = 128;
    const EN_CHARGE: u8 = 8;
    const INCONNU: u8 = 255;
    let presente = drapeaux != INCONNU && drapeaux & SANS_BATTERIE == 0;
    EtatBatterie {
        presente,
        pourcentage: (presente && pourcentage <= 100).then_some(pourcentage),
        branche: ac == 1,
        en_charge: presente && drapeaux & EN_CHARGE != 0,
        economie: systeme & 1 != 0,
    }
}

static DERNIER: Mutex<Option<EtatBatterie>> = Mutex::new(None);

pub fn dernier() -> EtatBatterie {
    DERNIER.lock().unwrap().clone().unwrap_or_default()
}

/// Publie l'état s'il a changé.
#[cfg_attr(not(windows), allow(dead_code))]
fn publier(app: &AppHandle, etat: EtatBatterie) {
    let mut d = DERNIER.lock().unwrap();
    if d.as_ref() != Some(&etat) {
        journal!(
            "batterie",
            "{}% branché={} en_charge={} économie={}",
            etat.pourcentage.map(|p| p.to_string()).unwrap_or("?".into()),
            etat.branche,
            etat.en_charge,
            etat.economie
        );
        *d = Some(etat.clone());
        let _ = app.emit(evenements::BATTERIE, &etat);
    }
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use windows::core::IInspectable;
    use windows::Foundation::EventHandler;
    use windows::System::Power::PowerManager;
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

    fn lire() -> Option<EtatBatterie> {
        let mut s = SYSTEM_POWER_STATUS::default();
        unsafe { GetSystemPowerStatus(&mut s) }.ok()?;
        Some(depuis_brut(
            s.ACLineStatus,
            s.BatteryFlag,
            s.BatteryLifePercent,
            s.SystemStatusFlag,
        ))
    }

    if let Some(e) = lire() {
        publier(&app, e);
    }

    let gestionnaire = |app: AppHandle| {
        EventHandler::<IInspectable>::new(move |_, _| {
            if let Some(e) = lire() {
                publier(&app, e);
            }
            Ok(())
        })
    };
    // Les jetons sont ignorés : on reste abonné pendant toute la vie de l'app.
    let r1 = PowerManager::PowerSupplyStatusChanged(&gestionnaire(app.clone()));
    let r2 = PowerManager::RemainingChargePercentChanged(&gestionnaire(app.clone()));
    let r3 = PowerManager::BatteryStatusChanged(&gestionnaire(app.clone()));
    let r4 = PowerManager::EnergySaverStatusChanged(&gestionnaire(app));
    if let Some(e) = [r1.err(), r2.err(), r3.err(), r4.err()].into_iter().flatten().next() {
        journal!("batterie", "abonnement aux événements incomplet : {e}");
    }
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("batterie", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn portable_sur_batterie() {
        let e = depuis_brut(0, 1, 87, 0);
        assert_eq!(
            e,
            EtatBatterie {
                presente: true,
                pourcentage: Some(87),
                branche: false,
                en_charge: false,
                economie: false
            }
        );
    }

    #[test]
    fn portable_en_charge_economie() {
        let e = depuis_brut(1, 8 | 2, 15, 1);
        assert!(e.branche && e.en_charge && e.economie);
        assert_eq!(e.pourcentage, Some(15));
    }

    #[test]
    fn pc_de_bureau() {
        let e = depuis_brut(1, 128, 255, 0);
        assert!(!e.presente);
        assert_eq!(e.pourcentage, None);
        assert!(e.branche);
        let inconnu = depuis_brut(255, 255, 255, 0);
        assert!(!inconnu.presente && !inconnu.branche);
    }
}
