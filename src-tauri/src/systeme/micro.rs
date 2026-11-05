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

#[cfg(not(windows))]
fn plateforme(_muet: Option<bool>) -> Result<bool, String> {
    Err("non disponible sur ce système".into())
}
