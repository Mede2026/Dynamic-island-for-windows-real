//! Verr. Maj et Verr. Num : l'île affiche une alerte quand on les active ou désactive.
//!
//! Un « crochet clavier » de Windows (`WH_KEYBOARD_LL`) signale chaque relâchement de ces
//! deux touches ; on lit alors leur état. Le crochet est sur le chemin de TOUTES les
//! frappes du PC : il ne fait que transmettre à un autre fil (aucune attente, aucun verrou).

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "verrouillage";

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Verrouillage {
    /// "majuscules" | "numerique"
    pub touche: &'static str,
    pub actif: bool,
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::sync::mpsc::{channel, Sender};
    use std::sync::{Mutex, OnceLock};
    use tauri::Emitter;
    use windows::Win32::Foundation::{LPARAM, LRESULT, WPARAM};
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetKeyState, VIRTUAL_KEY, VK_CAPITAL, VK_NUMLOCK};
    use windows::Win32::UI::WindowsAndMessaging::{
        CallNextHookEx, DispatchMessageW, GetMessageW, SetWindowsHookExW, TranslateMessage, HC_ACTION, KBDLLHOOKSTRUCT,
        MSG, WH_KEYBOARD_LL, WM_KEYUP, WM_SYSKEYUP,
    };

    static ENVOI: OnceLock<Mutex<Sender<Verrouillage>>> = OnceLock::new();

    /// État (activé ?) d'une touche à bascule, lu dans le fil de l'app au premier plan.
    fn etat_reel(vk: VIRTUAL_KEY) -> Option<bool> {
        use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
        use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
        unsafe {
            let premier_plan = GetForegroundWindow();
            if premier_plan.is_invalid() {
                return None;
            }
            let fil = GetWindowThreadProcessId(premier_plan, None);
            let moi = GetCurrentThreadId();
            if fil == 0 || fil == moi {
                return Some(GetKeyState(vk.0 as i32) & 1 != 0);
            }
            if !AttachThreadInput(moi, fil, true).as_bool() {
                return None;
            }
            let etat = GetKeyState(vk.0 as i32) & 1 != 0;
            let _ = AttachThreadInput(moi, fil, false);
            Some(etat)
        }
    }

    unsafe extern "system" fn crochet(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if code == HC_ACTION as i32 {
            // Touches volume / multimédia : l'indicateur de Windows va s'afficher.
            let vk = (*(lparam.0 as *const KBDLLHOOKSTRUCT)).vkCode;
            if (0xAD..=0xB3).contains(&vk) {
                crate::systeme::osd::signaler();
            }
        }
        if code == HC_ACTION as i32 && (wparam.0 as u32 == WM_KEYUP || wparam.0 as u32 == WM_SYSKEYUP) {
            let touche = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
            let v = if touche.vkCode == VK_CAPITAL.0 as u32 {
                Some(Verrouillage {
                    touche: "majuscules",
                    actif: GetKeyState(VK_CAPITAL.0 as i32) & 1 != 0,
                })
            } else if touche.vkCode == VK_NUMLOCK.0 as u32 {
                Some(Verrouillage {
                    touche: "numerique",
                    actif: GetKeyState(VK_NUMLOCK.0 as i32) & 1 != 0,
                })
            } else {
                None
            };
            if let (Some(v), Some(envoi)) = (v, ENVOI.get()) {
                if let Ok(e) = envoi.try_lock() {
                    let _ = e.send(v);
                }
            }
        }
        CallNextHookEx(None, code, wparam, lparam)
    }

    pub fn demarrer(app: AppHandle) {
        let (envoi, reception) = channel::<Verrouillage>();
        let _ = ENVOI.set(Mutex::new(envoi));
        std::thread::Builder::new()
            .name("ile-verrouillage-envoi".into())
            .spawn(move || {
                // Dernier état connu de chaque touche : repli si l'état réel est illisible.
                let mut maj = unsafe { GetKeyState(VK_CAPITAL.0 as i32) } & 1 != 0;
                let mut num = unsafe { GetKeyState(VK_NUMLOCK.0 as i32) } & 1 != 0;
                for v in reception {
                    // L'état lu dans le crochet peut être en retard (il dépend du fil qui le lit) :
                    // on relit l'état VRAI, celui de l'app au premier plan.
                    std::thread::sleep(std::time::Duration::from_millis(40));
                    let vk = if v.touche == "majuscules" {
                        VK_CAPITAL
                    } else {
                        VK_NUMLOCK
                    };
                    let precedent = if v.touche == "majuscules" { maj } else { num };
                    let actif = etat_reel(vk).unwrap_or(!precedent);
                    if v.touche == "majuscules" {
                        maj = actif;
                    } else {
                        num = actif;
                    }
                    let _ = app.emit(
                        EVENEMENT,
                        Verrouillage {
                            touche: v.touche,
                            actif,
                        },
                    );
                }
            })
            .ok();
        std::thread::Builder::new()
            .name("ile-verrouillage".into())
            .spawn(|| unsafe {
                use windows::Win32::System::LibraryLoader::GetModuleHandleW;
                let module = GetModuleHandleW(None).ok().map(|m| m.into());
                let Ok(_crochet) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(crochet), module, 0) else {
                    return journal!("clavier", "crochet clavier impossible");
                };
                journal!("clavier", "prêt (Verr. Maj, Verr. Num)");
                // Le crochet ne fonctionne que si ce fil traite ses messages.
                let mut msg = MSG::default();
                while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                    let _ = TranslateMessage(&msg);
                    DispatchMessageW(&msg);
                }
            })
            .ok();
    }
}

#[cfg(windows)]
pub use win::demarrer;

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("clavier", "non disponible sur ce système (Windows seulement)");
}
