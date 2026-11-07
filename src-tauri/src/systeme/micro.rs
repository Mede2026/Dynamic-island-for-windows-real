//! Couper / rétablir le micro (bouton de l'appel en cours) : sourdine du micro par défaut
//! de Windows (toutes les applications l'entendent).

/// `muet = null` → simple lecture. Renvoie l'état réel après l'action.
#[tauri::command]
pub async fn micro_muet(muet: Option<bool>) -> Result<bool, String> {
    plateforme(muet)
}

#[cfg(windows)]
fn plateforme(muet: Option<bool>) -> Result<bool, String> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eCapture, eCommunications, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let e: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
        let v: IAudioEndpointVolume = e
            .GetDefaultAudioEndpoint(eCapture, eCommunications)
            .and_then(|p| p.Activate(CLSCTX_ALL, None))
            .map_err(|e| format!("aucun micro : {e}"))?;
        if let Some(m) = muet {
            v.SetMute(m, std::ptr::null()).map_err(|e| e.to_string())?;
        }
        v.GetMute().map(|b| b.as_bool()).map_err(|e| e.to_string())
    }
}

/// Micro coupé / rétabli (touche du clavier ou du casque, Win+Alt+K…) → alerte.
pub const EVENEMENT: &str = "micro-muet";

#[cfg(windows)]
pub fn demarrer(app: tauri::AppHandle) {
    use std::sync::Mutex;
    use tauri::Emitter;
    use windows::core::{implement, Result};
    use windows::Win32::Media::Audio::Endpoints::{
        IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl,
    };
    use windows::Win32::Media::Audio::{
        eCapture, eCommunications, IMMDeviceEnumerator, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA,
    };
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    #[implement(IAudioEndpointVolumeCallback)]
    struct Rappel {
        app: tauri::AppHandle,
        dernier: Mutex<Option<bool>>,
    }
    impl IAudioEndpointVolumeCallback_Impl for Rappel_Impl {
        fn OnNotify(&self, d: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> Result<()> {
            if let Some(d) = unsafe { d.as_ref() } {
                let muet = d.bMuted.as_bool();
                let mut dernier = self.dernier.lock().unwrap();
                if *dernier != Some(muet) {
                    *dernier = Some(muet);
                    crate::journal!("micro", "micro {}", if muet { "coupé" } else { "rétabli" });
                    let _ = self.app.emit(EVENEMENT, muet);
                }
            }
            Ok(())
        }
    }

    std::thread::Builder::new()
        .name("ile-micro".into())
        .spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let r = (|| -> Result<(IAudioEndpointVolume, IAudioEndpointVolumeCallback)> {
                let e: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
                let v: IAudioEndpointVolume = e
                    .GetDefaultAudioEndpoint(eCapture, eCommunications)?
                    .Activate(CLSCTX_ALL, None)?;
                let rappel: IAudioEndpointVolumeCallback = Rappel {
                    app: app.clone(),
                    dernier: Mutex::new(v.GetMute().ok().map(|b| b.as_bool())),
                }
                .into();
                v.RegisterControlChangeNotify(&rappel)?;
                Ok((v, rappel))
            })();
            match r {
                Ok(_garder) => {
                    crate::journal!("micro", "prêt");
                    loop {
                        std::thread::park();
                    }
                }
                Err(e) => crate::journal!("micro", "aucun micro à surveiller : {e}"),
            }
        })
        .ok();
}

#[cfg(not(windows))]
pub fn demarrer(_app: tauri::AppHandle) {}

#[cfg(not(windows))]
fn plateforme(_muet: Option<bool>) -> Result<bool, String> {
    Err("non disponible sur ce système".into())
}
