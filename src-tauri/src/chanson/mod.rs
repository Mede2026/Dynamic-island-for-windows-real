//! « Quelle est cette chanson ? » : l'île écoute le son du PC quelques secondes, calcule une
//! empreinte (des pics de fréquence, jamais l'enregistrement) et la soumet au service de
//! reconnaissance de Shazam (le même que leur site, sans clé ; service NON officiel, il
//! peut changer). Seulement quand on le demande (raccourci, menu, lien).

pub mod capture;
pub mod signature;

use serde::Serialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter};

use crate::{journal, web};

pub const EVENEMENT: &str = "reconnaissance";
const DUREE_ECOUTE_S: u64 = 9;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Reconnaissance {
    /// "ecoute" | "recherche" | "trouvee" | "introuvable" | "erreur"
    pub etape: &'static str,
    pub titre: Option<String>,
    pub artiste: Option<String>,
    pub pochette: Option<String>,
    pub lien: Option<String>,
}

impl Reconnaissance {
    fn etape(etape: &'static str) -> Self {
        Self {
            etape,
            titre: None,
            artiste: None,
            pochette: None,
            lien: None,
        }
    }
}

static EN_COURS: AtomicBool = AtomicBool::new(false);

/// Lit la réponse du service : titre, artiste, pochette, lien.
pub fn analyser(json: &str) -> Option<Reconnaissance> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let piste = v.get("track")?;
    let texte = |p: &str| piste.pointer(p).and_then(|t| t.as_str()).map(str::to_owned);
    Some(Reconnaissance {
        etape: "trouvee",
        titre: texte("/title"),
        artiste: texte("/subtitle"),
        pochette: texte("/images/coverarthq").or_else(|| texte("/images/coverart")),
        lien: texte("/url"),
    })
}

fn uuid() -> String {
    // UUID v4 à partir de l'horloge et de l'adresse d'une variable (suffisant ici).
    let mut x = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0) as u64
        ^ (&x_graine as *const _ as u64);
    let mut octets = [0u8; 16];
    for o in octets.iter_mut() {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        *o = x as u8;
    }
    octets[6] = (octets[6] & 0x0f) | 0x40;
    octets[8] = (octets[8] & 0x3f) | 0x80;
    let h: String = octets.iter().map(|o| format!("{o:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &h[0..8],
        &h[8..12],
        &h[12..16],
        &h[16..20],
        &h[20..32]
    )
    .to_uppercase()
}
#[allow(non_upper_case_globals)]
static x_graine: u8 = 0;

fn reconnaitre(app: &AppHandle) -> Reconnaissance {
    let _ = app.emit(EVENEMENT, Reconnaissance::etape("ecoute"));
    let (son, frequence) = match capture::enregistrer(std::time::Duration::from_secs(DUREE_ECOUTE_S)) {
        Ok(s) => s,
        Err(e) => {
            journal!("chanson", "capture impossible : {e}");
            return Reconnaissance::etape("erreur");
        }
    };
    let son16 = signature::reechantillonner(&son, frequence);
    let mut g = signature::Generateur::default();
    g.ajouter(&son16);
    journal!(
        "chanson",
        "{} échantillons à {frequence} Hz → {} pics",
        son.len(),
        g.nombre_pics()
    );
    if g.nombre_pics() < 5 {
        return Reconnaissance::etape("introuvable"); // silence
    }
    let _ = app.emit(EVENEMENT, Reconnaissance::etape("recherche"));
    let maintenant = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let corps = serde_json::json!({
        "geolocation": { "altitude": 30, "latitude": 45.6, "longitude": -73.4 },
        "signature": {
            "samplems": g.nombre_echantillons as u64 * 1000 / signature::FREQUENCE_ECHANTILLONNAGE as u64,
            "timestamp": maintenant,
            "uri": g.encoder(),
        },
        "timestamp": maintenant,
        "timezone": "America/Toronto",
    })
    .to_string();
    let url = format!(
        "https://amp.shazam.com/discovery/v5/fr/CA/android/-/tag/{}/{}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&video=v3",
        uuid(),
        uuid()
    );
    match web::post_json(&url, &corps, &[("Content-Language", "fr_CA")]) {
        Ok((200, reponse)) => analyser(&reponse).unwrap_or_else(|| Reconnaissance::etape("introuvable")),
        Ok((code, _)) => {
            journal!("chanson", "réponse {code}");
            Reconnaissance::etape("erreur")
        }
        Err(e) => {
            journal!("chanson", "requête impossible : {e}");
            Reconnaissance::etape("erreur")
        }
    }
}

/// Lance une reconnaissance (une seule à la fois). Le résultat arrive par l'événement.
pub fn lancer(app: &AppHandle) {
    if EN_COURS.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let r = reconnaitre(&app);
        journal!("chanson", "{} : {:?} — {:?}", r.etape, r.titre, r.artiste);
        let _ = app.emit(EVENEMENT, r);
        EN_COURS.store(false, Ordering::SeqCst);
    });
}

#[tauri::command]
pub fn chanson_reconnaitre(app: AppHandle) {
    lancer(&app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reponse() {
        let r = analyser(r#"{"matches":[{}],"track":{"title":"Pedro","subtitle":"Jaxomy","url":"https://www.shazam.com/track/1","images":{"coverart":"https://x/c.jpg"}}}"#).unwrap();
        assert_eq!(r.titre.as_deref(), Some("Pedro"));
        assert_eq!(r.artiste.as_deref(), Some("Jaxomy"));
        assert_eq!(r.pochette.as_deref(), Some("https://x/c.jpg"));
        assert!(analyser(r#"{"matches":[]}"#).is_none());
    }

    #[test]
    fn identifiants() {
        let u = uuid();
        assert_eq!(u.len(), 36);
        assert_eq!(&u[14..15], "4");
    }
}
