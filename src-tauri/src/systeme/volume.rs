//! Volume de la sortie audio par défaut, en temps réel.
//! Windows : IAudioEndpointVolume + rappel (callback) `IAudioEndpointVolumeCallback`.
//! Quand la sortie par défaut change (casque branché…), on se réabonne grâce à
//! `IMMNotificationClient`.

use serde::Serialize;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter};

use crate::{evenements, journal};

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EtatVolume {
    /// 0.0 – 1.0
    pub niveau: f32,
    pub muet: bool,
}

static DERNIER: Mutex<Option<EtatVolume>> = Mutex::new(None);

pub fn dernier() -> Option<EtatVolume> {
    DERNIER.lock().unwrap().clone()
}

/// `initial` : première lecture (ne doit pas déclencher d'alerte côté front-end).
#[cfg_attr(not(windows), allow(dead_code))]
fn publier(app: &AppHandle, etat: EtatVolume, initial: bool) {
    let mut d = DERNIER.lock().unwrap();
    if d.as_ref() == Some(&etat) {
        return;
    }
    journal!(
        "volume",
        "{:.0}% muet={}{}",
        etat.niveau * 100.0,
        etat.muet,
        if initial { " (initial)" } else { "" }
    );
    *d = Some(etat.clone());
    #[derive(Clone, Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Message {
        #[serde(flatten)]
        etat: EtatVolume,
        initial: bool,
    }
    let _ = app.emit(evenements::VOLUME, Message { etat, initial });
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::mpsc::{channel, Sender};
    use std::time::Duration;
    use windows::core::{implement, Result, PCWSTR};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::Endpoints::{
        IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
    };
    use windows::Win32::Media::Audio::{
        eConsole, eRender, EDataFlow, ERole, IMMDeviceEnumerator, IMMNotificationClient, IMMNotificationClient_Impl,
        MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA, DEVICE_STATE,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    #[implement(IAudioEndpointVolumeCallback)]
    struct RappelVolume {
        app: AppHandle,
    }

    impl IAudioEndpointVolumeCallback_Impl for RappelVolume_Impl {
        fn OnNotify(&self, donnees: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
            if let Some(d) = unsafe { donnees.as_ref() } {
                publier(
                    &self.app,
                    EtatVolume {
                        niveau: d.fMasterVolume,
                        muet: d.bMuted.as_bool(),
                    },
                    false,
                );
            }
            Ok(())
        }
    }

    #[implement(IMMNotificationClient)]
    struct RappelPeripherique {
        changement: Mutex<Sender<()>>,
    }

    impl IMMNotificationClient_Impl for RappelPeripherique_Impl {
        fn OnDeviceStateChanged(&self, _: &PCWSTR, _: DEVICE_STATE) -> Result<()> {
            Ok(())
        }
        fn OnDeviceAdded(&self, _: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn OnDeviceRemoved(&self, _: &PCWSTR) -> Result<()> {
            Ok(())
        }
        fn OnDefaultDeviceChanged(&self, flux: EDataFlow, role: ERole, _: &PCWSTR) -> Result<()> {
            if flux == eRender && role == eConsole {
                let _ = self.changement.lock().unwrap().send(());
            }
            Ok(())
        }
        fn OnPropertyValueChanged(&self, _: &PCWSTR, _: &PROPERTYKEY) -> Result<()> {
            Ok(())
        }
    }

    pub fn demarrer(app: AppHandle) {
        std::thread::Builder::new()
            .name("ile-volume".into())
            .spawn(move || {
                if let Err(e) = boucle(app) {
                    journal!("volume", "indisponible : {e}");
                }
            })
            .expect("impossible de lancer le fil du volume");
    }

    fn boucle(app: AppHandle) -> Result<()> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED).ok()? };
        let enumerateur: IMMDeviceEnumerator = unsafe { CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)? };
        let (tx, rx) = channel();
        let client: IMMNotificationClient = RappelPeripherique {
            changement: Mutex::new(tx),
        }
        .into();
        unsafe { enumerateur.RegisterEndpointNotificationCallback(&client)? };
        let rappel: IAudioEndpointVolumeCallback = RappelVolume { app: app.clone() }.into();

        let mut initial = true;
        loop {
            // S'abonner à la sortie par défaut actuelle.
            let actuel = unsafe {
                enumerateur.GetDefaultAudioEndpoint(eRender, eConsole).and_then(|p| {
                    let v: IAudioEndpointVolume = p.Activate(CLSCTX_ALL, None)?;
                    v.RegisterControlChangeNotify(&rappel)?;
                    publier(
                        &app,
                        EtatVolume {
                            niveau: v.GetMasterVolumeLevelScalar()?,
                            muet: v.GetMute()?.as_bool(),
                        },
                        initial,
                    );
                    Ok(v)
                })
            };
            if let Err(e) = &actuel {
                journal!("volume", "aucune sortie audio par défaut : {e}");
            }
            initial = false;

            // Attendre un changement de sortie par défaut (on regroupe les rafales).
            if rx.recv().is_err() {
                break;
            }
            while rx.recv_timeout(Duration::from_millis(200)).is_ok() {}
            journal!("volume", "sortie audio par défaut modifiée → réabonnement");
            if let Ok(v) = actuel {
                let _ = unsafe { v.UnregisterControlChangeNotify(&rappel) };
            }
        }
        unsafe { enumerateur.UnregisterEndpointNotificationCallback(&client)? };
        Ok(())
    }
}

#[cfg(windows)]
pub use win::demarrer;

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("volume", "non disponible sur ce système (Windows seulement)");
}
