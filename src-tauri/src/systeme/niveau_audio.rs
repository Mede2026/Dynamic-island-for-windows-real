//! Niveau sonore RÉEL de la sortie audio (pour l'onde de la musique) : compteur de crête de
//! Windows (`IAudioMeterInformation`), lu 30 fois par seconde UNIQUEMENT quand l'île le
//! demande (musique en lecture et onde visible). Le reste du temps, le fil dort.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Condvar, Mutex};
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "niveau-audio";

static ACTIF: AtomicBool = AtomicBool::new(false);
static REVEIL: (Mutex<()>, Condvar) = (Mutex::new(()), Condvar::new());

/// L'île demande (ou non) le niveau sonore.
#[tauri::command]
pub fn audio_niveau_actif(actif: bool) {
    ACTIF.store(actif, Ordering::Relaxed);
    REVEIL.1.notify_all();
}

fn attendre_activation() {
    let mut g = REVEIL.0.lock().unwrap();
    while !ACTIF.load(Ordering::Relaxed) {
        g = REVEIL.1.wait(g).unwrap();
    }
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use std::time::{Duration, Instant};
    use tauri::Emitter;
    use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    std::thread::Builder::new()
        .name("ile-niveau-audio".into())
        .spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let Ok(enumerateur) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            else {
                return journal!("niveau-audio", "indisponible");
            };
            loop {
                attendre_activation();
                // Relire la sortie par défaut toutes les 2 s (casque branché…).
                let compteur: Option<IAudioMeterInformation> = enumerateur
                    .GetDefaultAudioEndpoint(eRender, eConsole)
                    .and_then(|p| p.Activate(CLSCTX_ALL, None))
                    .ok();
                let debut = Instant::now();
                while ACTIF.load(Ordering::Relaxed) && debut.elapsed() < Duration::from_secs(2) {
                    let niveau = compteur.as_ref().and_then(|c| c.GetPeakValue().ok()).unwrap_or(0.0);
                    let _ = app.emit(EVENEMENT, niveau);
                    std::thread::sleep(Duration::from_millis(33));
                }
            }
        })
        .expect("impossible de lancer le fil du niveau audio");
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    // Hors Windows : l'île utilise une onde simulée.
    let _ = attendre_activation as fn();
    journal!("niveau-audio", "non disponible sur ce système (Windows seulement)");
}
