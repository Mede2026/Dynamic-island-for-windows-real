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

/// Définitions d'un mot dans le Wiktionnaire français : les premières lignes de définition
/// de la section « Français » (texte brut de l'API « extracts »).
pub fn definitions(extrait: &str) -> Option<(String, Vec<String>)> {
    const NATURES: [&str; 12] = [
        "Nom commun",
        "Verbe",
        "Adjectif",
        "Adverbe",
        "Pronom",
        "Préposition",
        "Conjonction",
        "Interjection",
        "Nom propre",
        "Locution",
        "Article",
        "Adjectif numéral",
    ];
    let francais = extrait
        .split("\n== ")
        .find(|s| s.starts_with("Français"))
        .unwrap_or(extrait);
    let mut lignes = francais.lines().map(str::trim);
    let nature = lignes.find(|l| NATURES.iter().any(|n| l.trim_matches('=').trim().starts_with(n)))?;
    let nature = nature.trim_matches('=').trim().to_owned();
    let mut defs = Vec::new();
    // Ligne du mot (avec sa prononciation), puis les définitions jusqu'à la section suivante.
    for l in lignes.skip(1) {
        if l.starts_with("==") {
            break;
        }
        if l.is_empty() || l.len() < 12 {
            continue;
        }
        defs.push(l.to_owned());
        if defs.len() == 3 {
            break;
        }
    }
    (!defs.is_empty()).then_some((nature, defs))
}

fn wiktionnaire(mot: &str) -> Option<Resultat> {
    let url = format!(
        "https://fr.wiktionary.org/w/api.php?action=query&prop=extracts&explaintext=1&redirects=1&format=json&titles={}",
        web::encoder(mot)
    );
    let (code, corps) = web::get(&url, &[]).ok()?;
    if code != 200 {
        return None;
    }
    let v: serde_json::Value = serde_json::from_str(&corps).ok()?;
    let page = v.pointer("/query/pages")?.as_object()?.values().next()?;
    let titre = page.get("title")?.as_str()?.to_owned();
    let (nature, defs) = definitions(page.get("extract")?.as_str()?)?;
    Some(Resultat {
        lien: format!("https://fr.wiktionary.org/wiki/{}", web::encoder(&titre)),
        titre,
        description: Some(format!("Wiktionnaire · {nature}")),
        resume: defs
            .iter()
            .enumerate()
            .map(|(i, d)| format!("{}. {d}", i + 1))
            .collect::<Vec<_>>()
            .join("\n"),
        image: None,
        langue: "fr",
    })
}

/// Taux de change (Banque centrale européenne, via frankfurter.app) : 1 `de` = ? `vers`.
#[tauri::command]
pub async fn taux_de_change(de: String, vers: String) -> Result<f64, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let url = format!(
            "https://api.frankfurter.app/latest?from={}&to={}",
            web::encoder(&de),
            web::encoder(&vers)
        );
        let (code, corps) = web::get(&url, &[])?;
        if code != 200 {
            return Err(format!("taux indisponible ({code})"));
        }
        let v: serde_json::Value = serde_json::from_str(&corps).map_err(|e| e.to_string())?;
        v.pointer(&format!("/rates/{vers}"))
            .and_then(|t| t.as_f64())
            .ok_or("taux introuvable".into())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn recherche_rapide(terme: String) -> Result<Option<Resultat>, String> {
    let terme = terme.trim().to_owned();
    if terme.is_empty() {
        return Ok(None);
    }
    tauri::async_runtime::spawn_blocking(move || {
        // Un seul mot en minuscules : d'abord sa définition (Wiktionnaire).
        let mot = !terme.contains(' ') && terme.chars().next().is_some_and(|c| c.is_lowercase());
        let r = if mot { wiktionnaire(&terme) } else { None }
            .or_else(|| chercher_langue("fr", &terme))
            .or_else(|| chercher_langue("en", &terme))
            .or_else(|| if mot { None } else { wiktionnaire(&terme.to_lowercase()) });
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
    fn wiktionnaire() {
        let e = "== Français ==\n\n=== Étymologie ===\nDu latin.\n\n=== Nom commun ===\nbatterie \\bat.ʁi\\ féminin\n\nEnsemble d'instruments à percussion joués par un seul musicien.\nAppareil qui accumule l'énergie électrique.\n\n==== Synonymes ====\ndrum";
        let (nature, defs) = definitions(e).unwrap();
        assert_eq!(nature, "Nom commun");
        assert_eq!(defs.len(), 2);
        assert!(defs[0].starts_with("Ensemble"));
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
