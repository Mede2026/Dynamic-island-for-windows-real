//! Appel entrant (Teams, WhatsApp, Discord…) : boutons de l'île.
//!
//! Windows ne permet pas d'appuyer sur les boutons d'une notification d'une autre app. Donc :
//!  - « Répondre » ramène la fenêtre de l'app devant ; pour Teams, l'île envoie en plus son
//!    raccourci clavier officiel (Ctrl+Maj+S répondre, Ctrl+Maj+D refuser) ;
//!  - « Refuser » : Teams → Ctrl+Maj+D ; autres apps → l'île se contente de se refermer.

use crate::journal;

/// Exécutables de chaque app (nom affiché → morceaux du nom de fichier).
fn executables(application: &str) -> &'static [&'static str] {
    let a = application.to_lowercase();
    if a.contains("teams") {
        &["ms-teams", "teams"]
    } else if a.contains("whatsapp") {
        &["whatsapp"]
    } else if a.contains("discord") {
        &["discord"]
    } else if a.contains("zoom") {
        &["zoom"]
    } else if a.contains("skype") {
        &["skype"]
    } else if a.contains("slack") {
        &["slack"]
    } else if a.contains("signal") {
        &["signal"]
    } else if a.contains("telegram") {
        &["telegram"]
    } else {
        &[]
    }
}

pub fn est_teams(application: &str) -> bool {
    application.to_lowercase().contains("teams")
}

#[cfg(windows)]
mod win {
    use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM, RECT};
    use windows::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY,
        VK_CONTROL, VK_MENU, VK_SHIFT,
    };
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowRect, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow,
        ShowWindow, SW_RESTORE,
    };

    fn exe(pid: u32) -> String {
        unsafe {
            let Ok(p) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else {
                return String::new();
            };
            let mut t = [0u16; 512];
            let mut n = t.len() as u32;
            let ok =
                QueryFullProcessImageNameW(p, PROCESS_NAME_WIN32, windows::core::PWSTR(t.as_mut_ptr()), &mut n).is_ok();
            let _ = CloseHandle(p);
            if ok {
                String::from_utf16_lossy(&t[..n as usize])
                    .rsplit('\\')
                    .next()
                    .unwrap_or("")
                    .to_lowercase()
            } else {
                String::new()
            }
        }
    }

    /// La plus grande fenêtre visible d'une des apps.
    pub fn fenetre(noms: &[&str]) -> Option<HWND> {
        struct R<'a> {
            noms: &'a [&'a str],
            meilleure: Option<(HWND, i64)>,
        }
        unsafe extern "system" fn rappel(hwnd: HWND, d: LPARAM) -> windows::core::BOOL {
            let r = &mut *(d.0 as *mut R);
            if !IsWindowVisible(hwnd).as_bool() {
                return true.into();
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let e = exe(pid);
            if r.noms.iter().any(|n| e.starts_with(n)) {
                let mut rc = RECT::default();
                let _ = GetWindowRect(hwnd, &mut rc);
                let aire = (rc.right - rc.left) as i64 * (rc.bottom - rc.top) as i64;
                if r.meilleure.is_none_or(|(_, a)| aire > a) {
                    r.meilleure = Some((hwnd, aire));
                }
            }
            true.into()
        }
        let mut r = R { noms, meilleure: None };
        unsafe {
            let _ = EnumWindows(Some(rappel), LPARAM(&mut r as *mut R as isize));
        }
        r.meilleure.map(|(h, _)| h)
    }

    fn touche(vk: VIRTUAL_KEY, relache: bool) -> INPUT {
        INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 {
                ki: KEYBDINPUT {
                    wVk: vk,
                    wScan: 0,
                    dwFlags: if relache { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) },
                    time: 0,
                    dwExtraInfo: 0,
                },
            },
        }
    }

    /// Met la fenêtre devant. Windows ne laisse une app passer devant qu'après une action
    /// de l'utilisateur : un appui sur Alt (relâché aussitôt) suffit.
    pub fn devant(hwnd: HWND) {
        unsafe {
            let _ = SendInput(
                &[touche(VK_MENU, false), touche(VK_MENU, true)],
                std::mem::size_of::<INPUT>() as i32,
            );
            if IsIconic(hwnd).as_bool() {
                let _ = ShowWindow(hwnd, SW_RESTORE);
            }
            let _ = SetForegroundWindow(hwnd);
        }
    }

    /// Ctrl+Maj+<lettre>.
    pub fn raccourci(lettre: u8) {
        let l = VIRTUAL_KEY(lettre as u16);
        let entrees = [
            touche(VK_CONTROL, false),
            touche(VK_SHIFT, false),
            touche(l, false),
            touche(l, true),
            touche(VK_SHIFT, true),
            touche(VK_CONTROL, true),
        ];
        unsafe {
            let _ = SendInput(&entrees, std::mem::size_of::<INPUT>() as i32);
        }
    }
}

/// Répondre (`accepter`) ou refuser un appel entrant.
#[tauri::command]
pub fn appel_entrant_repondre(application: String, accepter: bool) -> Result<(), String> {
    journal!(
        "appel",
        "appel entrant {} : {application}",
        if accepter { "accepté" } else { "refusé" }
    );
    #[cfg(windows)]
    {
        let teams = est_teams(&application);
        if !accepter && !teams {
            return Ok(()); // rien à faire pour les autres apps : l'île se referme
        }
        let fenetre = win::fenetre(executables(&application));
        if let Some(h) = fenetre {
            win::devant(h);
        }
        if teams {
            std::thread::sleep(std::time::Duration::from_millis(250));
            win::raccourci(if accepter { b'S' } else { b'D' });
        }
        if fenetre.is_none() && !teams {
            return Err("fenêtre de l'app introuvable".into());
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = (executables(&application), accepter);
        Err("Windows seulement".into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn apps() {
        assert!(super::est_teams("Microsoft Teams"));
        assert_eq!(super::executables("WhatsApp"), &["whatsapp"]);
        assert!(super::executables("Messages").is_empty());
    }
}
