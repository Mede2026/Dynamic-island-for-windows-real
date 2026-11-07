//! Claude dans la recherche de l'île : la clé API est gardée dans le Gestionnaire
//! d'informations d'identification de Windows (jamais dans un fichier, jamais envoyée à la
//! page web de l'île) ; les questions partent d'ici, vers api.anthropic.com seulement.

use serde::{Deserialize, Serialize};

#[cfg_attr(not(windows), allow(dead_code))]
const CIBLE: &str = "DynamicIsland/claude-api";
const MODELE: &str = "claude-sonnet-5-5";
const URL: &str = "https://api.anthropic.com/v1/messages";

#[derive(Deserialize, Serialize, Clone, Debug)]
pub struct Message {
    pub role: String,
    /// Texte, ou blocs (image d'une capture + question).
    pub content: serde_json::Value,
}

const CONSIGNE: &str = "Tu réponds dans la barre de recherche d'un « Dynamic Island » sur Windows : \
une petite carte. Réponds directement, en peu de phrases, dans la langue de la question \
(français par défaut). Pas de titres ni de tableaux ; du gras seulement si c'est vraiment utile.";

/// Une clé est-elle enregistrée ?
#[tauri::command]
pub fn claude_cle_presente() -> bool {
    plateforme::lire().is_some()
}

/// Enregistre la clé (vide = efface).
#[tauri::command]
pub fn claude_cle_definir(cle: String) -> Result<(), String> {
    let cle = cle.trim();
    if cle.is_empty() {
        return plateforme::effacer();
    }
    if !cle.starts_with("sk-ant-") {
        return Err("Ce n'est pas une clé API Anthropic (elle commence par « sk-ant- »).".into());
    }
    plateforme::ecrire(cle)
}

/// Pose une question (avec la conversation d'avant) ; renvoie le texte de la réponse.
#[tauri::command]
pub async fn claude_demander(messages: Vec<Message>) -> Result<String, String> {
    if messages.iter().any(|m| m.role != "user" && m.role != "assistant") {
        return Err("Conversation invalide.".into());
    }
    let cle = plateforme::lire().ok_or("Aucune clé API : Réglages → Claude.")?;
    tauri::async_runtime::spawn_blocking(move || demander(&cle, &messages, 4000))
        .await
        .map_err(|e| e.to_string())?
}

/// Vérifie la clé avec une toute petite question.
#[tauri::command]
pub async fn claude_cle_tester() -> Result<String, String> {
    let cle = plateforme::lire().ok_or("Aucune clé enregistrée.")?;
    let m = vec![Message { role: "user".into(), content: "Réponds seulement : OK".into() }];
    tauri::async_runtime::spawn_blocking(move || demander(&cle, &m, 200))
        .await
        .map_err(|e| e.to_string())?
}

pub fn corps(messages: &[Message], max_tokens: u32) -> serde_json::Value {
    serde_json::json!({
        "model": MODELE,
        "max_tokens": max_tokens,
        "system": CONSIGNE,
        // Effort « moyen » (le défaut de Sonnet 5.5 est « high »).
        "output_config": { "effort": "medium" },
        // Si Claude refuse pour une raison de sécurité, l'API essaie un autre modèle.
        "fallbacks": "default",
        "messages": messages,
    })
}

/// Texte de la réponse (blocs « text »), ou un message d'erreur lisible.
pub fn lire_reponse(code: u16, json: &str) -> Result<String, String> {
    let v: serde_json::Value = serde_json::from_str(json).map_err(|_| format!("Réponse illisible (HTTP {code})."))?;
    if code != 200 {
        let msg = v["error"]["message"].as_str().unwrap_or("erreur inconnue");
        return Err(match code {
            401 => "Clé API refusée : vérifie-la dans Réglages → Claude.".into(),
            402 | 403 => format!("Accès refusé : {msg}"),
            429 => "Trop de questions d'un coup : réessaie dans un instant.".into(),
            500..=599 => "Claude est surchargé : réessaie dans un instant.".into(),
            _ => format!("Erreur {code} : {msg}"),
        });
    }
    if v["stop_reason"] == "refusal" {
        return Err("Claude a refusé de répondre à cette question.".into());
    }
    let texte: Vec<&str> = v["content"]
        .as_array()
        .map(|b| b.iter().filter(|x| x["type"] == "text").filter_map(|x| x["text"].as_str()).collect())
        .unwrap_or_default();
    let t = texte.join("").trim().to_string();
    if t.is_empty() {
        Err("Réponse vide.".into())
    } else {
        Ok(t)
    }
}

fn demander(cle: &str, messages: &[Message], max_tokens: u32) -> Result<String, String> {
    let corps = corps(messages, max_tokens).to_string();
    let (code, json) = crate::web::post_json(
        URL,
        &corps,
        &[
            ("x-api-key", cle),
            ("anthropic-version", "2023-06-01"),
            ("anthropic-beta", "server-side-fallback-2026-07-01"),
        ],
    )?;
    lire_reponse(code, &json)
}

#[cfg(windows)]
mod plateforme {
    use super::CIBLE;
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Security::Credentials::*;

    pub fn lire() -> Option<String> {
        unsafe {
            let mut p: *mut CREDENTIALW = std::ptr::null_mut();
            CredReadW(&HSTRING::from(CIBLE), CRED_TYPE_GENERIC, None, &mut p).ok()?;
            let c = &*p;
            let octets = std::slice::from_raw_parts(c.CredentialBlob, c.CredentialBlobSize as usize);
            let cle = String::from_utf8(octets.to_vec()).ok();
            CredFree(p as *const _);
            cle.filter(|k| !k.is_empty())
        }
    }

    pub fn ecrire(cle: &str) -> Result<(), String> {
        let mut cible: Vec<u16> = CIBLE.encode_utf16().chain(Some(0)).collect();
        let mut octets = cle.as_bytes().to_vec();
        let c = CREDENTIALW {
            Type: CRED_TYPE_GENERIC,
            TargetName: PWSTR(cible.as_mut_ptr()),
            CredentialBlobSize: octets.len() as u32,
            CredentialBlob: octets.as_mut_ptr(),
            Persist: CRED_PERSIST_LOCAL_MACHINE,
            ..Default::default()
        };
        unsafe { CredWriteW(&c, 0) }.map_err(|e| format!("Impossible d'enregistrer la clé : {e}"))
    }

    pub fn effacer() -> Result<(), String> {
        let _ = unsafe { CredDeleteW(&HSTRING::from(CIBLE), CRED_TYPE_GENERIC, None) };
        Ok(())
    }
}

#[cfg(not(windows))]
mod plateforme {
    pub fn lire() -> Option<String> {
        None
    }
    pub fn ecrire(_cle: &str) -> Result<(), String> {
        Err("Windows seulement".into())
    }
    pub fn effacer() -> Result<(), String> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn requete_sonnet_effort_moyen() {
        let c = corps(&[Message { role: "user".into(), content: "Salut ?".into() }], 100);
        assert_eq!(c["model"], "claude-sonnet-5-5");
        assert_eq!(c["output_config"]["effort"], "medium");
        assert_eq!(c["fallbacks"], "default");
        assert!(c.get("thinking").is_none());
        assert!(c.get("temperature").is_none());
    }
    #[test]
    fn reponses() {
        let ok = r#"{"content":[{"type":"thinking","thinking":""},{"type":"text","text":"Bonjour"}],"stop_reason":"end_turn"}"#;
        assert_eq!(lire_reponse(200, ok).unwrap(), "Bonjour");
        assert!(lire_reponse(200, r#"{"content":[],"stop_reason":"refusal"}"#).unwrap_err().contains("refusé"));
        assert!(lire_reponse(401, r#"{"error":{"message":"invalid x-api-key"}}"#).unwrap_err().contains("Clé"));
    }
}
