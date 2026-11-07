//! Traduction d'un texte copié avec Google Traduction (service web public, sans clé) :
//! français → anglais, toute autre langue → français (ou la langue demandée).

use serde::Serialize;

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Traduction {
    pub texte: String,
    /// Langue détectée du texte d'origine (« en », « fr »…).
    pub de: String,
    pub vers: String,
}

pub fn url(texte: &str, vers: &str) -> String {
    format!(
        "https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl={vers}&dt=t&q={}",
        crate::web::encoder(texte)
    )
}

/// Réponse : [[["Bonjour","Hello",…],…], null, "en", …] → texte traduit et langue détectée.
pub fn lire(json: &str, vers: &str) -> Option<Traduction> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let morceaux = v.get(0)?.as_array()?;
    let texte: String = morceaux.iter().filter_map(|m| m.get(0)?.as_str()).collect();
    let de = v.get(2).and_then(|x| x.as_str()).unwrap_or("").to_string();
    (!texte.trim().is_empty()).then(|| Traduction { texte, de, vers: vers.to_string() })
}

fn demander(texte: &str, vers: &str) -> Result<Traduction, String> {
    match crate::web::get(&url(texte, vers), &[])? {
        (200, json) => lire(&json, vers).ok_or_else(|| "Traduction illisible.".to_string()),
        (code, _) => Err(format!("Google Traduction indisponible (HTTP {code}).")),
    }
}

/// Traduit `texte` (5 000 caractères au plus). Sans langue demandée : en français, ou en
/// anglais si le texte est déjà en français.
#[tauri::command]
pub async fn traduire(texte: String, vers: Option<String>) -> Result<Traduction, String> {
    let texte: String = texte.chars().take(5000).collect();
    if texte.trim().is_empty() {
        return Err("Rien à traduire.".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(v) = vers {
            return demander(&texte, &v);
        }
        let t = demander(&texte, "fr")?;
        if t.de == "fr" {
            demander(&texte, "en")
        } else {
            Ok(t)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn lit_la_reponse() {
        let j = r#"[[["Bonjour le monde. ","Hello world. ",null,null,10],["Ça va ?","How are you?",null,null,3]],null,"en",null,null,null,1]"#;
        let t = lire(j, "fr").unwrap();
        assert_eq!(t.texte, "Bonjour le monde. Ça va ?");
        assert_eq!(t.de, "en");
    }
    #[test]
    fn adresse_encodee() {
        assert!(url("salut ça va", "en").contains("tl=en"));
        assert!(!url("salut ça va", "en").contains(' '));
    }
}
