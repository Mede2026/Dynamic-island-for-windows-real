//! Paroles synchronisées de la chanson en cours, depuis LRCLIB (base libre et gratuite,
//! sans clé). On n'envoie que titre, artiste, album et durée. Résultat gardé sur le disque
//! (`%APPDATA%\com.mederic.dynamicisland\paroles\`) : une chanson n'est cherchée qu'une fois.

use serde::Serialize;

use crate::{journal, web};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Paroles {
    /// Format LRC (« [01:02.30] texte ») ; None = pas de version synchronisée.
    pub synchronisees: Option<String>,
    pub instrumental: bool,
}

/// Nom de fichier sûr pour le cache.
pub fn cle_cache(artiste: &str, titre: &str) -> String {
    let brut = format!("{}-{}", artiste.trim(), titre.trim()).to_lowercase();
    let mut cle: String = brut
        .chars()
        .map(|c| if c.is_alphanumeric() { c } else { '_' })
        .collect();
    cle.truncate(120);
    cle
}

/// Lit la réponse JSON de LRCLIB (`/api/get` : un objet ; `/api/search` : une liste).
pub fn analyser(json: &str) -> Option<Paroles> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let objet = if v.is_array() {
        // Recherche : la première entrée synchronisée, sinon la première.
        let liste = v.as_array()?;
        liste
            .iter()
            .find(|e| {
                e.get("syncedLyrics")
                    .and_then(|s| s.as_str())
                    .is_some_and(|s| !s.is_empty())
            })
            .or_else(|| liste.first())?
            .clone()
    } else {
        v
    };
    Some(Paroles {
        synchronisees: objet
            .get("syncedLyrics")
            .and_then(|s| s.as_str())
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned),
        instrumental: objet.get("instrumental").and_then(|b| b.as_bool()).unwrap_or(false),
    })
}

fn chercher_en_ligne(artiste: &str, titre: &str, album: &str, duree_s: Option<u32>) -> Result<Option<Paroles>, String> {
    let base = "https://lrclib.net/api";
    let mut url = format!(
        "{base}/get?artist_name={}&track_name={}",
        web::encoder(artiste),
        web::encoder(titre)
    );
    if !album.is_empty() {
        url.push_str(&format!("&album_name={}", web::encoder(album)));
    }
    if let Some(d) = duree_s {
        url.push_str(&format!("&duration={d}"));
    }
    let (code, corps) = web::get(&url, &[])?;
    if code == 200 {
        if let Some(p) = analyser(&corps).filter(|p| p.synchronisees.is_some() || p.instrumental) {
            return Ok(Some(p));
        }
    }
    // Pas trouvé exactement (titre « - Remastered », durée un peu différente…) : recherche.
    let url = format!(
        "{base}/search?track_name={}&artist_name={}",
        web::encoder(titre),
        web::encoder(artiste)
    );
    let (code, corps) = web::get(&url, &[])?;
    Ok(if code == 200 { analyser(&corps) } else { None })
}

/// Paroles de la chanson (cache, sinon LRCLIB). Lent (réseau) : appelée hors du fil principal.
#[tauri::command]
pub async fn paroles_chercher(artiste: String, titre: String, album: String, duree_s: Option<u32>) -> Option<Paroles> {
    if titre.trim().is_empty() {
        return None;
    }
    let dossier = journal::dossier_app().map(|d| d.join("paroles"));
    let fichier = dossier
        .as_ref()
        .map(|d| d.join(format!("{}.json", cle_cache(&artiste, &titre))));
    if let Some(f) = &fichier {
        if let Ok(texte) = std::fs::read_to_string(f) {
            return serde_json::from_str::<Option<PourCache>>(&texte)
                .ok()
                .flatten()
                .map(Into::into);
        }
    }
    let resultat = tauri::async_runtime::spawn_blocking(move || chercher_en_ligne(&artiste, &titre, &album, duree_s))
        .await
        .map_err(|e| e.to_string())
        .and_then(|r| r);
    match resultat {
        Ok(p) => {
            journal!(
                "paroles",
                "{}",
                match &p {
                    Some(p) if p.synchronisees.is_some() => "trouvées (synchronisées)",
                    Some(p) if p.instrumental => "instrumental",
                    _ => "aucune",
                }
            );
            // Mémoriser aussi « aucune » pour ne pas redemander à chaque lecture.
            if let (Some(d), Some(f)) = (&dossier, &fichier) {
                let _ = std::fs::create_dir_all(d);
                let _ = std::fs::write(
                    f,
                    serde_json::to_string(&p.clone().map(PourCache::from)).unwrap_or_default(),
                );
            }
            p
        }
        Err(e) => {
            journal!("paroles", "recherche impossible : {e}");
            None
        }
    }
}

/// Même structure, lisible depuis le cache.
#[derive(serde::Deserialize, Serialize)]
struct PourCache {
    synchronisees: Option<String>,
    instrumental: bool,
}

impl From<Paroles> for PourCache {
    fn from(p: Paroles) -> Self {
        Self {
            synchronisees: p.synchronisees,
            instrumental: p.instrumental,
        }
    }
}

impl From<PourCache> for Paroles {
    fn from(p: PourCache) -> Self {
        Self {
            synchronisees: p.synchronisees,
            instrumental: p.instrumental,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reponse_get() {
        let p = analyser(r#"{"id":1,"instrumental":false,"syncedLyrics":"[00:01.00] Bonjour"}"#).unwrap();
        assert_eq!(p.synchronisees.as_deref(), Some("[00:01.00] Bonjour"));
        assert!(!p.instrumental);
    }

    #[test]
    fn reponse_recherche() {
        let p =
            analyser(r#"[{"syncedLyrics":null},{"syncedLyrics":"[00:02.00] Salut","instrumental":false}]"#).unwrap();
        assert_eq!(p.synchronisees.as_deref(), Some("[00:02.00] Salut"));
        assert!(analyser("[]").is_none());
    }

    #[test]
    fn cle() {
        assert_eq!(cle_cache("Jaxomy", "Pedro"), "jaxomy_pedro");
    }
}
