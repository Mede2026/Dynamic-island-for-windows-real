//! Niveau sonore RÉEL de la sortie audio (pour l'onde de la musique) : compteurs de crête de
//! Windows (`IAudioMeterInformation`), lus 30 fois par seconde UNIQUEMENT quand l'île le
//! demande (musique en lecture et onde visible). Le reste du temps, le fil dort.
//!
//! On prend le plus fort de TOUS les compteurs : chaque sortie active (pas seulement celle
//! « par défaut » : casque Bluetooth, écran HDMI…) et chaque application qui joue sur elles.
//! Le compteur global d'une sortie reste à 0 sur certains pilotes ; ceux des applications non.

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
    // Sous le verrou : sinon le réveil peut tomber entre le test et l'attente du fil, et être perdu.
    let _g = REVEIL.0.lock().unwrap();
    ACTIF.store(actif, Ordering::Relaxed);
    REVEIL.1.notify_all();
}

fn attendre_activation() {
    let mut g = REVEIL.0.lock().unwrap();
    while !ACTIF.load(Ordering::Relaxed) {
        g = REVEIL.1.wait(g).unwrap();
    }
}

/// Les compteurs de crête à lire (relus toutes les 2 s : casque branché, nouvelle app…).
#[cfg(windows)]
struct Compteurs {
    liste: Vec<windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation>,
}

#[cfg(windows)]
impl Compteurs {
    unsafe fn lire(enumerateur: &windows::Win32::Media::Audio::IMMDeviceEnumerator) -> Self {
        use windows::core::Interface;
        use windows::Win32::Media::Audio::Endpoints::IAudioMeterInformation;
        use windows::Win32::Media::Audio::{eRender, IAudioSessionManager2, DEVICE_STATE_ACTIVE};
        use windows::Win32::System::Com::CLSCTX_ALL;

        let mut liste = Vec::new();
        let Ok(sorties) = enumerateur.EnumAudioEndpoints(eRender, DEVICE_STATE_ACTIVE) else {
            return Self { liste };
        };
        for i in 0..sorties.GetCount().unwrap_or(0) {
            let Ok(sortie) = sorties.Item(i) else { continue };
            if let Ok(c) = sortie.Activate::<IAudioMeterInformation>(CLSCTX_ALL, None) {
                liste.push(c);
            }
            let Ok(sessions) = sortie
                .Activate::<IAudioSessionManager2>(CLSCTX_ALL, None)
                .and_then(|m| m.GetSessionEnumerator())
            else {
                continue;
            };
            for j in 0..sessions.GetCount().unwrap_or(0) {
                if let Some(c) = sessions
                    .GetSession(j)
                    .ok()
                    .and_then(|s| s.cast::<IAudioMeterInformation>().ok())
                {
                    liste.push(c);
                }
            }
        }
        Self { liste }
    }

    unsafe fn niveau(&self) -> f32 {
        self.liste
            .iter()
            .filter_map(|c| c.GetPeakValue().ok())
            .fold(0.0, f32::max)
    }
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use std::time::{Duration, Instant};
    use tauri::Emitter;
    use windows::Win32::Media::Audio::{IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED};

    std::thread::Builder::new()
        .name("ile-niveau-audio".into())
        .spawn(move || unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            let Ok(enumerateur) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL)
            else {
                return journal!("niveau-audio", "indisponible");
            };
            // Quelques lignes de journal au début, pour diagnostiquer une onde immobile.
            let mut diagnostics = 3;
            loop {
                attendre_activation();
                let compteurs = Compteurs::lire(&enumerateur);
                let debut = Instant::now();
                let mut crete = 0.0f32;
                while ACTIF.load(Ordering::Relaxed) && debut.elapsed() < Duration::from_secs(2) {
                    let niveau = compteurs.niveau();
                    crete = crete.max(niveau);
                    let _ = app.emit(EVENEMENT, niveau);
                    std::thread::sleep(Duration::from_millis(33));
                }
                if diagnostics > 0 {
                    diagnostics -= 1;
                    journal!(
                        "niveau-audio",
                        "{} compteurs, crête sur 2 s = {crete:.3}",
                        compteurs.liste.len()
                    );
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
