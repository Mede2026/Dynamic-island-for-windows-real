//! Luminosité de l'écran → alerte (comme le volume).
//! Windows : WMI `root\WMI`, événement `WmiMonitorBrightnessEvent` (aucune scrutation).
//! Fonctionne pour l'écran INTÉGRÉ d'un portable ; la plupart des écrans externes ne signalent
//! pas leur luminosité à Windows (voir docs/limites.md).

use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "luminosite";

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use tauri::Emitter;
    use windows::core::BSTR;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoInitializeSecurity, CoSetProxyBlanket, CLSCTX_INPROC_SERVER,
        COINIT_MULTITHREADED, EOAC_NONE, RPC_C_AUTHN_LEVEL_CALL, RPC_C_AUTHN_LEVEL_DEFAULT,
        RPC_C_IMP_LEVEL_IMPERSONATE,
    };
    use windows::Win32::System::Rpc::{RPC_C_AUTHN_WINNT, RPC_C_AUTHZ_NONE};
    use windows::Win32::System::Variant::{VARIANT, VT_I4, VT_UI1, VT_UI4};
    use windows::Win32::System::Wmi::{
        IWbemClassObject, IWbemLocator, WbemLocator, WBEM_FLAG_FORWARD_ONLY, WBEM_FLAG_RETURN_IMMEDIATELY,
        WBEM_INFINITE,
    };

    fn valeur(o: &IWbemClassObject, nom: &str) -> Option<u8> {
        let mut v = VARIANT::default();
        let n: Vec<u16> = nom.encode_utf16().chain(Some(0)).collect();
        unsafe {
            o.Get(windows::core::PCWSTR(n.as_ptr()), 0, &mut v, None, None).ok()?;
            let interne = &v.Anonymous.Anonymous;
            let x: i64 = match interne.vt {
                t if t == VT_UI1 => interne.Anonymous.bVal as i64,
                t if t == VT_I4 => interne.Anonymous.lVal as i64,
                t if t == VT_UI4 => interne.Anonymous.ulVal as i64,
                _ => return None,
            };
            Some(x.clamp(0, 100) as u8)
        }
    }

    std::thread::Builder::new()
        .name("ile-luminosite".into())
        .spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            // Déjà réglé par une autre partie du programme ? (erreur ignorée dans ce cas)
            let _ = CoInitializeSecurity(
                None,
                -1,
                None,
                None,
                RPC_C_AUTHN_LEVEL_DEFAULT,
                RPC_C_IMP_LEVEL_IMPERSONATE,
                None,
                EOAC_NONE,
                None,
            );
            let resultat = (|| -> windows::core::Result<()> {
                let localisateur: IWbemLocator = CoCreateInstance(&WbemLocator, None, CLSCTX_INPROC_SERVER)?;
                let service = localisateur.ConnectServer(
                    &BSTR::from("ROOT\\WMI"),
                    &BSTR::new(),
                    &BSTR::new(),
                    &BSTR::new(),
                    0,
                    &BSTR::new(),
                    None,
                )?;
                CoSetProxyBlanket(
                    &service,
                    RPC_C_AUTHN_WINNT,
                    RPC_C_AUTHZ_NONE,
                    None,
                    RPC_C_AUTHN_LEVEL_CALL,
                    RPC_C_IMP_LEVEL_IMPERSONATE,
                    None,
                    EOAC_NONE,
                )?;
                let evenements = service.ExecNotificationQuery(
                    &BSTR::from("WQL"),
                    &BSTR::from("SELECT * FROM WmiMonitorBrightnessEvent"),
                    WBEM_FLAG_RETURN_IMMEDIATELY | WBEM_FLAG_FORWARD_ONLY,
                    None,
                )?;
                journal!("luminosite", "prêt (écran intégré)");
                loop {
                    let mut objets: [Option<IWbemClassObject>; 1] = [None];
                    let mut n = 0u32;
                    evenements.Next(WBEM_INFINITE, &mut objets, &mut n).ok()?;
                    if let Some(o) = &objets[0] {
                        if let Some(niveau) = valeur(o, "Brightness") {
                            journal!("luminosite", "{niveau} %");
                            crate::systeme::osd::signaler();
                            let _ = app.emit(EVENEMENT, niveau);
                        }
                    }
                }
            })();
            if let Err(e) = resultat {
                journal!("luminosite", "indisponible (écran sans réglage WMI ?) : {e}");
            }
        })
        .expect("impossible de lancer le fil de la luminosité");
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("luminosite", "non disponible sur ce système (Windows seulement)");
}
