//! Recherche rapide (Ctrl+Alt+Espace) : résumé Wikipédia d'un mot ou d'un sujet.
//! Français d'abord, puis anglais. Seul le terme cherché est envoyé, et seulement quand on
//! le demande.

use serde::Serialize;

use crate::{journal, web};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Resultat {
    pub titre: String,
    /// Court descriptif (« Ville du Québec »).
    pub description: Option<String>,
    pub resume: String,
    pub lien: String,
    pub image: Option<String>,
    pub langue: &'static str,
}

/// Lit la réponse de `/api/rest_v1/page/summary/…`.
pub fn analyser_resume(json: &str, langue: &'static str) -> Option<Resultat> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    if v.get("type").and_then(|t| t.as_str()) == Some("disambiguation") {
        return None;
    }
    let resume = v.get("extract")?.as_str()?.trim().to_owned();
    if resume.is_empty() {
        return None;
    }
    Some(Resultat {
        titre: v.get("title")?.as_str()?.to_owned(),
        description: v.get("description").and_then(|d| d.as_str()).map(str::to_owned),
        resume,
        lien: v
            .pointer("/content_urls/desktop/page")
            .and_then(|l| l.as_str())
            .unwrap_or_default()
            .to_owned(),
        image: v
            .pointer("/thumbnail/source")
            .and_then(|l| l.as_str())
            .map(str::to_owned),
        langue,
    })
}

/// Premier titre d'une recherche (`action=query&list=search`).
pub fn premier_titre(json: &str) -> Option<String> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.pointer("/query/search/0/title")?.as_str().map(str::to_owned)
}

fn resume(langue: &'static str, titre: &str) -> Option<Resultat> {
    let url = format!(
        "https://{langue}.wikipedia.org/api/rest_v1/page/summary/{}?redirect=true",
        web::encoder(&titre.replace(' ', "_"))
    );
    match web::get(&url, &[]) {
        Ok((200, corps)) => analyser_resume(&corps, langue),
        _ => None,
    }
}

fn chercher_langue(langue: &'static str, terme: &str) -> Option<Resultat> {
    if let Some(r) = resume(langue, terme) {
        return Some(r);
    }
    // Pas de page exacte (ou page d'homonymie) : le meilleur résultat de recherche.
    let url = format!(
        "https://{langue}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=1&srsearch={}",
        web::encoder(terme)
    );
    let (code, corps) = web::get(&url, &[]).ok()?;
    if code != 200 {
        return None;
    }
    resume(langue, &premier_titre(&corps)?)
}

#[tauri::command]
pub async fn recherche_rapide(terme: String) -> Result<Option<Resultat>, String> {
    let terme = terme.trim().to_owned();
    if terme.is_empty() {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        let r = chercher_langue("fr", &terme).or_else(|| chercher_langue("en", &terme));
        journal!(
            "recherche",
            "« {terme} » → {}",
            r.as_ref().map(|r| r.titre.as_str()).unwrap_or("rien")
        );
        r
    })
    .await
    .map_err(|e| e.to_string())
}

/// Ouvre une adresse web dans le navigateur par défaut.
#[tauri::command]
pub fn ouvrir_lien(lien: String) -> Result<(), String> {
    // Pages web, et pages des Paramètres de Windows (« ms-settings:windowsupdate »).
    if !(lien.starts_with("https://")
        || lien.starts_with("http://")
        || lien.starts_with("ms-settings:")
        || lien == "ms-screenclip:")
    {
        return Err("adresse refusée".into());
    }
    #[cfg(windows)]
    {
        use windows::core::HSTRING;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        unsafe {
            ShellExecuteW(
                None,
                &HSTRING::from("open"),
                &HSTRING::from(lien),
                None,
                None,
                SW_SHOWNORMAL,
            );
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        journal!("recherche", "ouvrir {lien} : Windows seulement");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resume_wikipedia() {
        let j = r#"{"type":"standard","title":"Boucherville","description":"ville du Québec","extract":"Boucherville est une ville…","content_urls":{"desktop":{"page":"https://fr.wikipedia.org/wiki/Boucherville"}}}"#;
        let r = analyser_resume(j, "fr").unwrap();
        assert_eq!(r.titre, "Boucherville");
        assert_eq!(r.lien, "https://fr.wikipedia.org/wiki/Boucherville");
        assert!(analyser_resume(r#"{"type":"disambiguation","title":"X","extract":"…"}"#, "fr").is_none());
    }

    #[test]
    fn recherche() {
        assert_eq!(
            premier_titre(r#"{"query":{"search":[{"title":"Kimi Antonelli"}]}}"#).as_deref(),
            Some("Kimi Antonelli")
        );
        assert_eq!(premier_titre(r#"{"query":{"search":[]}}"#), None);
    }
}
