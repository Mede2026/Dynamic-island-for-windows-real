//! Remplacer l'indicateur de volume et de luminosité de Windows par l'île (comme sur iPhone,
//! où seule l'île réagit). L'indicateur de Windows n'est pas supprimé : juste après un
//! changement de volume ou de luminosité, sa fenêtre (dans l'Explorateur) est rendue
//! entièrement transparente et « traversable ».
//!
//! Il ne doit JAMAIS rester invisible après l'île. Chaque fenêtre modifiée garde son style
//! d'origine dans une propriété ; tout est remis : quand l'option est désactivée, quand l'île
//! se ferme, au démarrage suivant (après un plantage), et par un petit processus « gardien »
//! (`--gardien-osd <pid>`) qui attend la fin de l'île, quelle qu'elle soit, puis remet tout.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub const ARGUMENT_GARDIEN: &str = "--gardien-osd";

static ACTIF: AtomicBool = AtomicBool::new(false);
static RAFALE: AtomicBool = AtomicBool::new(false);
static DERNIER_MS: AtomicU64 = AtomicU64::new(0);

fn maintenant_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::journal;
    use std::sync::Mutex;
    use windows::core::{w, BOOL, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, COLORREF, HANDLE, HWND, LPARAM, RECT};
    use windows::Win32::System::Threading::{OpenProcess, WaitForSingleObject, INFINITE, PROCESS_SYNCHRONIZE};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, FindWindowExW, FindWindowW, GetClassNameW, GetPropW, GetSystemMetrics, GetWindowLongW,
        GetWindowRect, GetWindowThreadProcessId, IsWindowVisible, RemovePropW, SetLayeredWindowAttributes, SetPropW,
        SetWindowLongW, GWL_EXSTYLE, LWA_ALPHA, SM_CXSCREEN, SM_CYSCREEN, WS_EX_LAYERED, WS_EX_TRANSPARENT,
    };

    const PROPRIETE: PCWSTR = w!("DynamicIslandOsdOriginal");
    /// Bit ajouté au style mémorisé : un style 0 reste une propriété non nulle.
    const MARQUE: usize = 1 << 40;

    static GARDIEN: Mutex<Option<std::process::Child>> = Mutex::new(None);

    fn classe(hwnd: HWND) -> String {
        let mut tampon = [0u16; 64];
        let n = unsafe { GetClassNameW(hwnd, &mut tampon) } as usize;
        String::from_utf16_lossy(&tampon[..n])
    }

    /// Fenêtres de l'indicateur visibles maintenant : dans le processus de la barre des tâches,
    /// petites, de classe « XamlExplorerHostIslandWindow » (Windows 11) ou « NativeHWNDHost »
    /// contenant un « DirectUIHWND » (Windows 10).
    unsafe fn indicateurs() -> Vec<HWND> {
        struct Recherche {
            pid: u32,
            trouvees: Vec<HWND>,
        }
        unsafe extern "system" fn rappel(hwnd: HWND, donnees: LPARAM) -> BOOL {
            let r = &mut *(donnees.0 as *mut Recherche);
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            if pid != r.pid || !IsWindowVisible(hwnd).as_bool() || !GetPropW(hwnd, PROPRIETE).is_invalid() {
                return true.into();
            }
            let c = classe(hwnd);
            let candidate = c == "XamlExplorerHostIslandWindow"
                || (c == "NativeHWNDHost"
                    && FindWindowExW(Some(hwnd), None, w!("DirectUIHWND"), PCWSTR::null()).is_ok());
            if candidate {
                let mut rect = RECT::default();
                let petite = GetWindowRect(hwnd, &mut rect).is_ok()
                    && rect.right - rect.left < GetSystemMetrics(SM_CXSCREEN) / 2
                    && rect.bottom - rect.top < GetSystemMetrics(SM_CYSCREEN) / 2;
                if petite {
                    r.trouvees.push(hwnd);
                }
            }
            true.into()
        }
        let Ok(barre) = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) else {
            return Vec::new();
        };
        let mut r = Recherche {
            pid: 0,
            trouvees: Vec::new(),
        };
        GetWindowThreadProcessId(barre, Some(&mut r.pid));
        let _ = EnumWindows(Some(rappel), LPARAM(&mut r as *mut Recherche as isize));
        r.trouvees
    }

    unsafe fn cacher(hwnd: HWND) {
        let style = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        if SetPropW(hwnd, PROPRIETE, Some(HANDLE((style as usize | MARQUE) as *mut _))).is_err() {
            return;
        }
        SetWindowLongW(
            hwnd,
            GWL_EXSTYLE,
            (style | WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as i32,
        );
        let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 0, LWA_ALPHA);
    }

    /// Remet toutes les fenêtres modifiées dans leur état d'origine.
    pub fn restaurer() {
        unsafe extern "system" fn rappel(hwnd: HWND, _: LPARAM) -> BOOL {
            let p = GetPropW(hwnd, PROPRIETE);
            if !p.is_invalid() {
                let origine = (p.0 as usize & 0xFFFF_FFFF) as u32;
                if origine & WS_EX_LAYERED.0 != 0 {
                    let _ = SetLayeredWindowAttributes(hwnd, COLORREF(0), 255, LWA_ALPHA);
                }
                SetWindowLongW(hwnd, GWL_EXSTYLE, origine as i32);
                let _ = RemovePropW(hwnd, PROPRIETE);
            }
            true.into()
        }
        unsafe {
            let _ = EnumWindows(Some(rappel), LPARAM(0));
        }
    }

    pub fn configurer(actif: bool) {
        let mut g = GARDIEN.lock().unwrap_or_else(|e| e.into_inner());
        if actif {
            // Sans gardien, on ne cache rien (sécurité).
            let vivant = g.as_mut().is_some_and(|c| matches!(c.try_wait(), Ok(None)));
            if !vivant {
                *g = lancer_gardien()
                    .map_err(|e| journal!("osd", "gardien impossible : {e}"))
                    .ok();
            }
            ACTIF.store(g.is_some(), Ordering::SeqCst);
            if g.is_some() {
                lancer_crochet_affichage();
            }
            journal!("osd", "indicateur de Windows remplacé par l'île : {}", g.is_some());
        } else {
            ACTIF.store(false, Ordering::SeqCst);
            restaurer();
            if let Some(mut c) = g.take() {
                let _ = c.kill();
                let _ = c.wait();
            }
        }
    }

    fn lancer_gardien() -> std::io::Result<std::process::Child> {
        use std::os::windows::process::CommandExt;
        const SANS_FENETRE: u32 = 0x0800_0000;
        std::process::Command::new(std::env::current_exe()?)
            .arg(ARGUMENT_GARDIEN)
            .arg(std::process::id().to_string())
            .creation_flags(SANS_FENETRE)
            .spawn()
    }

    /// Processus gardien : attend la fin de l'île (même un plantage), puis remet l'indicateur.
    pub fn gardien(pid: &str) {
        if let Ok(pid) = pid.parse::<u32>() {
            unsafe {
                if let Ok(processus) = OpenProcess(PROCESS_SYNCHRONIZE, false, pid) {
                    WaitForSingleObject(processus, INFINITE);
                    let _ = CloseHandle(processus);
                }
            }
        }
        restaurer();
    }

    /// Crochet « une fenêtre de l'Explorateur s'affiche » : l'indicateur est caché à
    /// l'instant même où il apparaît (pas de flash), s'il suit de près un changement.
    fn lancer_crochet_affichage() {
        use std::sync::Once;
        use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
        use windows::Win32::UI::WindowsAndMessaging::{
            DispatchMessageW, GetMessageW, TranslateMessage, EVENT_OBJECT_SHOW, MSG, WINEVENT_OUTOFCONTEXT,
        };
        static UNE_FOIS: Once = Once::new();
        unsafe extern "system" fn rappel(
            _: HWINEVENTHOOK,
            _: u32,
            hwnd: HWND,
            objet: i32,
            enfant: i32,
            _: u32,
            _: u32,
        ) {
            if objet != 0 || enfant != 0 || !ACTIF.load(Ordering::Relaxed) {
                return;
            }
            if maintenant_ms().saturating_sub(DERNIER_MS.load(Ordering::Relaxed)) > 1500 {
                return;
            }
            if indicateurs().contains(&hwnd) {
                cacher(hwnd);
            }
        }
        UNE_FOIS.call_once(|| {
            std::thread::Builder::new()
                .name("ile-osd-crochet".into())
                .spawn(|| unsafe {
                    let Ok(barre) = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) else {
                        return;
                    };
                    let mut pid = 0u32;
                    GetWindowThreadProcessId(barre, Some(&mut pid));
                    let crochet = SetWinEventHook(
                        EVENT_OBJECT_SHOW,
                        EVENT_OBJECT_SHOW,
                        None,
                        Some(rappel),
                        pid,
                        0,
                        WINEVENT_OUTOFCONTEXT,
                    );
                    if crochet.is_invalid() {
                        return journal!("osd", "crochet d'affichage impossible");
                    }
                    let mut msg = MSG::default();
                    while GetMessageW(&mut msg, None, 0, 0).as_bool() {
                        let _ = TranslateMessage(&msg);
                        DispatchMessageW(&msg);
                    }
                })
                .ok();
        });
    }

    /// Volume ou luminosité vient de changer : chercher l'indicateur pendant 1 s.
    pub fn signaler() {
        if !ACTIF.load(Ordering::Relaxed) {
            return;
        }
        DERNIER_MS.store(maintenant_ms(), Ordering::Relaxed);
        if RAFALE.swap(true, Ordering::SeqCst) {
            return;
        }
        std::thread::spawn(|| {
            while maintenant_ms().saturating_sub(DERNIER_MS.load(Ordering::Relaxed)) < 1000
                && ACTIF.load(Ordering::Relaxed)
            {
                for hwnd in unsafe { indicateurs() } {
                    unsafe { cacher(hwnd) };
                }
                std::thread::sleep(std::time::Duration::from_millis(40));
            }
            RAFALE.store(false, Ordering::SeqCst);
        });
    }
}

#[cfg(windows)]
pub use win::{configurer, gardien, restaurer, signaler};

#[cfg(not(windows))]
pub fn configurer(actif: bool) {
    ACTIF.store(actif, Ordering::SeqCst);
}
#[cfg(not(windows))]
pub fn gardien(_pid: &str) {}
#[cfg(not(windows))]
pub fn restaurer() {}
#[cfg(not(windows))]
pub fn signaler() {
    let _ = (&RAFALE, &DERNIER_MS, maintenant_ms());
}

/// Préférence « remplacer l'indicateur de Windows » (activée par défaut).
pub fn voulu(affichage: &serde_json::Map<String, serde_json::Value>) -> bool {
    affichage.get("remplacerOsd").and_then(|v| v.as_bool()).unwrap_or(true)
}
