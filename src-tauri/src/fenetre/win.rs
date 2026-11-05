//! Partie Windows de la fenêtre (API Win32 via le crate `windows`).

use super::RectPx;
use tauri::{AppHandle, WebviewWindow};
use windows::core::PCWSTR;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM};
use windows::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_BORDER_COLOR, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DONOTROUND,
};
use windows::Win32::Graphics::Gdi::{
    EnumDisplaySettingsW, GetMonitorInfoW, MonitorFromWindow, DEVMODEW, ENUM_CURRENT_SETTINGS, MONITORINFO,
    MONITOR_DEFAULTTONEAREST,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::Shell::{
    DefSubclassProc, SHQueryUserNotificationState, SetWindowSubclass, QUNS_BUSY, QUNS_PRESENTATION_MODE,
    QUNS_RUNNING_D3D_FULL_SCREEN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetClassNameW, GetCursorPos, GetDesktopWindow, GetForegroundWindow, GetShellWindow, GetWindowLongPtrW,
    GetWindowRect, SetWindowLongPtrW, GWL_EXSTYLE, MA_NOACTIVATE, WM_MOUSEACTIVATE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST,
};

use crate::journal;

/// Valeur spéciale de DWM : « aucune bordure » (Windows 11).
const DWMWA_COLOR_NONE: u32 = 0xFFFF_FFFE;

/// Styles qui empêchent l'île de voler le focus et de paraître dans Alt+Tab,
/// et qui retirent bordure / coins arrondis ajoutés par Windows 11.
pub fn appliquer_styles(fen: &WebviewWindow) {
    let Ok(hwnd) = fen.hwnd() else {
        journal!("fenetre", "HWND introuvable : styles non appliqués");
        return;
    };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let voulu = ex | (WS_EX_NOACTIVATE.0 | WS_EX_TOOLWINDOW.0 | WS_EX_TOPMOST.0) as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, voulu);

        // Un clic sur l'île ne doit jamais activer la fenêtre (le clavier reste dans l'app active).
        if !SetWindowSubclass(hwnd, Some(sous_classe), 1, 0).as_bool() {
            journal!("fenetre", "SetWindowSubclass a échoué");
        }

        let coins = DWMWCP_DONOTROUND;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &coins as *const _ as *const _,
            std::mem::size_of_val(&coins) as u32,
        );
        let bordure = DWMWA_COLOR_NONE;
        let _ = DwmSetWindowAttribute(
            hwnd,
            DWMWA_BORDER_COLOR,
            &bordure as *const _ as *const _,
            std::mem::size_of_val(&bordure) as u32,
        );
    }
    journal!(
        "fenetre",
        "styles Windows appliqués (sans focus, hors Alt+Tab, sans bordure)"
    );
}

unsafe extern "system" fn sous_classe(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _donnees: usize,
) -> LRESULT {
    if msg == WM_MOUSEACTIVATE {
        return LRESULT(MA_NOACTIVATE as isize);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// Taux de rafraîchissement actuel de l'écran (ex. « \\.\DISPLAY1 »).
pub fn frequence_ecran(id: &str) -> Option<u32> {
    let nom: Vec<u16> = id.encode_utf16().chain(std::iter::once(0)).collect();
    let mut mode = DEVMODEW {
        dmSize: std::mem::size_of::<DEVMODEW>() as u16,
        ..Default::default()
    };
    let ok = unsafe { EnumDisplaySettingsW(PCWSTR(nom.as_ptr()), ENUM_CURRENT_SETTINGS, &mut mode) };
    // 0 ou 1 = « valeur par défaut du matériel » (inconnue).
    (ok.as_bool() && mode.dmDisplayFrequency > 1).then_some(mode.dmDisplayFrequency)
}

pub fn curseur_ecran(_app: &AppHandle) -> Option<(i32, i32)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p) }.ok()?;
    Some((p.x, p.y))
}

pub fn bouton_gauche_enfonce() -> Option<bool> {
    // Bit de poids fort = bouton actuellement enfoncé.
    Some(unsafe { GetAsyncKeyState(VK_LBUTTON.0 as i32) } as u16 & 0x8000 != 0)
}

fn rect_px(r: RECT) -> RectPx {
    RectPx {
        x: r.left,
        y: r.top,
        largeur: (r.right - r.left).max(0) as u32,
        hauteur: (r.bottom - r.top).max(0) as u32,
    }
}

/// Une application occupe-t-elle tout l'écran (jeu, vidéo, présentation) ?
pub fn plein_ecran_actif(fen: &WebviewWindow) -> bool {
    unsafe {
        // 1. Ce que Windows sait déjà (jeux Direct3D, présentations).
        if let Ok(etat) = SHQueryUserNotificationState() {
            if etat == QUNS_BUSY || etat == QUNS_RUNNING_D3D_FULL_SCREEN || etat == QUNS_PRESENTATION_MODE {
                return true;
            }
        }

        // 2. La fenêtre active couvre-t-elle tout son écran ? (vidéo plein écran dans un navigateur…)
        let premier_plan = GetForegroundWindow();
        if premier_plan.is_invalid() || premier_plan == GetDesktopWindow() || premier_plan == GetShellWindow() {
            return false;
        }
        if fen.hwnd().map(|h| h == premier_plan).unwrap_or(false) {
            return false;
        }
        let mut classe = [0u16; 64];
        let n = GetClassNameW(premier_plan, &mut classe).max(0) as usize;
        let classe = String::from_utf16_lossy(&classe[..n]);
        if classe == "WorkerW" || classe == "Progman" {
            return false; // bureau
        }

        let mut r = RECT::default();
        if GetWindowRect(premier_plan, &mut r).is_err() {
            return false;
        }
        let moniteur = MonitorFromWindow(premier_plan, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO {
            cbSize: std::mem::size_of::<MONITORINFO>() as u32,
            ..Default::default()
        };
        if !GetMonitorInfoW(moniteur, &mut info).as_bool() {
            return false;
        }
        rect_px(r).contient(&rect_px(info.rcMonitor))
    }
}
