//! Mises à jour de l'île : vérifie la dernière Release sur GitHub (au démarrage, puis toutes
//! les 6 h) ; « Installer » télécharge l'installateur officiel de la Release et le lance.
//! Seules les adresses de ce dépôt sont acceptées.

use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::{journal, web};

pub const EVENEMENT: &str = "nouvelle-version";
const DEPOT: &str = "Mede2026/Dynamic-island-for-windows-real";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NouvelleVersion {
    pub version: String,
    pub url: String,
}

/// « v0.1.10 » → [0, 1, 10].
pub fn numeros(v: &str) -> Vec<u32> {
    v.trim_start_matches(['v', 'V'])
        .split('.')
        .map(|p| p.parse().unwrap_or(0))
        .collect()
}

pub fn plus_recente(candidate: &str, actuelle: &str) -> bool {
    numeros(candidate) > numeros(actuelle)
}

/// Lit la réponse de `/releases/latest` : version et installateur `…-setup.exe`.
pub fn analyser(json: &str) -> Option<NouvelleVersion> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let version = v.get("tag_name")?.as_str()?.to_owned();
    let url = v
        .get("assets")?
        .as_array()?
        .iter()
        .filter_map(|a| a.get("browser_download_url")?.as_str())
        .find(|u| u.ends_with("-setup.exe"))?
        .to_owned();
    Some(NouvelleVersion { version, url })
}

pub fn url_autorisee(url: &str) -> bool {
    url.starts_with(&format!("https://github.com/{DEPOT}/releases/download/")) && url.ends_with("-setup.exe")
}

fn verifier() -> Result<Option<NouvelleVersion>, String> {
    let (code, corps) = web::get(
        &format!("https://api.github.com/repos/{DEPOT}/releases/latest"),
        &[("Accept", "application/vnd.github+json")],
    )?;
    if code != 200 {
        return Err(format!("GitHub a répondu {code}"));
    }
    Ok(analyser(&corps).filter(|n| plus_recente(&n.version, env!("CARGO_PKG_VERSION"))))
}

/// Vérifie maintenant (bouton du panneau). None : déjà à jour.
#[tauri::command]
pub async fn app_verifier_maj() -> Result<Option<NouvelleVersion>, String> {
    tauri::async_runtime::spawn_blocking(verifier)
        .await
        .map_err(|e| e.to_string())?
}

/// Télécharge l'installateur, le lance, puis ferme l'île (pour qu'il puisse la remplacer).
#[tauri::command]
pub async fn app_installer_maj(app: AppHandle, url: String) -> Result<(), String> {
    if !url_autorisee(&url) {
        return Err("adresse refusée".into());
    }
    let chemin = std::env::temp_dir().join("DynamicIsland-setup.exe");
    let c = chemin.clone();
    tauri::async_runtime::spawn_blocking(move || web::telecharger(&url, &c))
        .await
        .map_err(|e| e.to_string())??;
    journal!("mise-a-jour", "installateur téléchargé : {}", chemin.display());
    std::process::Command::new(&chemin).spawn().map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(400));
    app.exit(0);
    Ok(())
}

pub fn demarrer(app: AppHandle) {
    std::thread::Builder::new()
        .name("ile-mise-a-jour-app".into())
        .spawn(move || loop {
            std::thread::sleep(std::time::Duration::from_secs(90));
            match verifier() {
                Ok(Some(n)) => {
                    journal!("mise-a-jour", "nouvelle version : {}", n.version);
                    let _ = app.emit(EVENEMENT, n);
                }
                Ok(None) => journal!("mise-a-jour", "à jour ({})", env!("CARGO_PKG_VERSION")),
                Err(e) => journal!("mise-a-jour", "vérification impossible : {e}"),
            }
            std::thread::sleep(std::time::Duration::from_secs(6 * 3600));
        })
        .ok();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn versions() {
        assert!(plus_recente("v0.1.10", "0.1.9"));
        assert!(plus_recente("v0.2.0", "0.1.9"));
        assert!(!plus_recente("v0.1.8", "0.1.8"));
        assert!(!plus_recente("v0.1.7", "0.1.8"));
    }

    #[test]
    fn reponse() {
        let j = r#"{"tag_name":"v0.1.9","assets":[{"browser_download_url":"https://github.com/Mede2026/Dynamic-island-for-windows-real/releases/download/v0.1.9/x.msi"},{"browser_download_url":"https://github.com/Mede2026/Dynamic-island-for-windows-real/releases/download/v0.1.9/Dynamic.Island_0.1.9_x64-setup.exe"}]}"#;
        let n = analyser(j).unwrap();
        assert_eq!(n.version, "v0.1.9");
        assert!(url_autorisee(&n.url));
        assert!(!url_autorisee("https://exemple.com/x-setup.exe"));
    }
}
