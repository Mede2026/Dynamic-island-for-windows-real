//! Client d'Asus Fan Control (app Windows déjà installée, pas modifiée) : canal nommé
//! `\\.\pipe\AsusFanControl`, une requête JSON par ligne, une réponse JSON par ligne (UTF-8).
//! Fonctions typées pour chaque commande + abonnement au statut en direct (événement
//! « ventilateurs », `null` quand Asus Fan Control n'est pas lancé).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};

pub const CANAL: &str = r"\\.\pipe\AsusFanControl";
pub const PAS_LANCE: &str = "Asus Fan Control n'est pas lancé : ouvre-le, puis réessaie.";

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct LimiteBatterie {
    pub enabled: bool,
    pub percent: Option<u32>,
    pub full_charge_pending: bool,
}

/// Statut renvoyé par `status`, `subscribe` et toutes les commandes qui modifient quelque chose.
#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Statut {
    pub temperature: Option<f64>,
    pub rpms: Vec<f64>,
    /// 0 = automatique, -1 = ventilateurs arrêtés, sinon pourcentage appliqué.
    pub applied_percent: Option<f64>,
    pub control_on: bool,
    pub mode: Option<String>,
    pub unit: Option<String>,
    pub speed: Option<f64>,
    #[serde(rename = "override")]
    pub forcage: Option<Value>,
    pub fans_stopped: bool,
    pub on_charger: Option<bool>,
    pub battery_percent: Option<f64>,
    pub battery_limit: Option<LimiteBatterie>,
    pub error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Courbe {
    pub unit: String,
    pub points: Vec<(f64, f64)>,
}

/// Réponse : `ok` vrai → le JSON ; faux → le message d'erreur.
pub fn lire_reponse(ligne: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(ligne.trim()).map_err(|_| "Réponse illisible d'Asus Fan Control.".to_string())?;
    if v["ok"].as_bool() == Some(true) {
        Ok(v)
    } else {
        Err(v["error"].as_str().unwrap_or("Erreur d'Asus Fan Control.").to_string())
    }
}

/// Ouvre le canal (réessaie un peu s'il est occupé).
fn ouvrir() -> Result<std::fs::File, String> {
    for essai in 0..5 {
        match std::fs::OpenOptions::new().read(true).write(true).open(CANAL) {
            Ok(f) => return Ok(f),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(PAS_LANCE.into()),
            // ERROR_PIPE_BUSY (231) : toutes les instances sont prises, on attend un peu.
            Err(e) if e.raw_os_error() == Some(231) && essai < 4 => std::thread::sleep(std::time::Duration::from_millis(80)),
            Err(e) => return Err(format!("Asus Fan Control injoignable : {e}")),
        }
    }
    Err(PAS_LANCE.into())
}

/// Une requête, une réponse (connexion courte).
pub fn requete(commande: Value) -> Result<Value, String> {
    let mut canal = ouvrir()?;
    let mut ligne = commande.to_string();
    ligne.push('\n');
    canal.write_all(ligne.as_bytes()).map_err(|e| e.to_string())?;
    canal.flush().map_err(|e| e.to_string())?;
    let mut reponse = String::new();
    BufReader::new(canal).read_line(&mut reponse).map_err(|e| e.to_string())?;
    lire_reponse(&reponse)
}

fn statut(commande: Value) -> Result<Statut, String> {
    let v = requete(commande)?;
    serde_json::from_value(v).map_err(|e| format!("Statut illisible : {e}"))
}

async fn bloquant<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn ventilo_statut() -> Result<Statut, String> {
    bloquant(|| statut(json!({"cmd": "status"}))).await
}

/// `silent`, `normal`, `max` ou `curve`.
#[tauri::command]
pub async fn ventilo_profil(profil: String) -> Result<Statut, String> {
    if !matches!(profil.as_str(), "silent" | "normal" | "max" | "curve") {
        return Err("Profil inconnu.".into());
    }
    bloquant(move || statut(json!({"cmd": "setProfile", "profile": profil}))).await
}

/// Vitesse fixe : en pourcentage (0–100) ou en tours/minute.
#[tauri::command]
pub async fn ventilo_vitesse(pourcent: Option<u32>, rpm: Option<u32>) -> Result<Statut, String> {
    let cmd = match (pourcent, rpm) {
        (Some(p), _) => json!({"cmd": "setSpeed", "percent": p.min(100)}),
        (None, Some(r)) => json!({"cmd": "setSpeed", "rpm": r}),
        _ => return Err("Vitesse manquante.".into()),
    };
    bloquant(move || statut(cmd)).await
}

#[tauri::command]
pub async fn ventilo_controle(actif: bool) -> Result<Statut, String> {
    bloquant(move || statut(json!({"cmd": "setControl", "enabled": actif}))).await
}

/// Retour au contrôle automatique.
#[tauri::command]
pub async fn ventilo_auto() -> Result<Statut, String> {
    bloquant(|| statut(json!({"cmd": "auto"}))).await
}

#[tauri::command]
pub async fn ventilo_courbe() -> Result<Courbe, String> {
    bloquant(|| {
        let v = requete(json!({"cmd": "getCurve"}))?;
        serde_json::from_value(v).map_err(|e| format!("Courbe illisible : {e}"))
    })
    .await
}

/// `unite` : `percent` ou `rpm` ; `points` : [[°C, valeur], …].
#[tauri::command]
pub async fn ventilo_definir_courbe(unite: String, points: Vec<(f64, f64)>) -> Result<Statut, String> {
    bloquant(move || statut(json!({"cmd": "setCurve", "unit": unite, "points": points}))).await
}

#[tauri::command]
pub async fn ventilo_limite_batterie(actif: bool, pourcent: u32) -> Result<Statut, String> {
    bloquant(move || statut(json!({"cmd": "setBatteryLimit", "enabled": actif, "percent": pourcent.clamp(20, 100)}))).await
}

#[tauri::command]
pub async fn ventilo_charge_complete(actif: bool) -> Result<Statut, String> {
    bloquant(move || statut(json!({"cmd": "fullCharge", "enabled": actif}))).await
}

/// Affiche la fenêtre d'Asus Fan Control.
#[tauri::command]
pub async fn ventilo_montrer() -> Result<(), String> {
    bloquant(|| requete(json!({"cmd": "show"})).map(|_| ())).await
}

/// Abonnement au statut en direct (connexion dédiée, un statut par seconde). Se reconnecte
/// toutes les 5 s quand Asus Fan Control n'est pas lancé ; émet `null` quand il disparaît.
pub fn suivre(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let app = app.clone();
    let _ = std::thread::Builder::new().name("ile-ventilateurs".into()).spawn(move || {
        let mut annonce_absent = false;
        type Resume = (Option<String>, Option<f64>, bool, Option<f64>);
        let mut dernier: Option<Resume> = None;
        loop {
            match ouvrir() {
                Ok(mut canal) => {
                    annonce_absent = false;
                    if canal.write_all(b"{\"cmd\":\"subscribe\"}\n").is_ok() {
                        crate::journal!("ventilateurs", "abonné au statut d'Asus Fan Control");
                        for ligne in BufReader::new(canal).lines() {
                            let Ok(ligne) = ligne else { break };
                            match lire_reponse(&ligne).and_then(|v| serde_json::from_value::<Statut>(v).map_err(|e| e.to_string())) {
                                Ok(s) => {
                                    // Journal quand le mode change (aide à comprendre le statut d'Asus Fan Control).
                                    let resume = (s.mode.clone(), s.applied_percent, s.control_on, s.speed);
                                    if dernier.as_ref() != Some(&resume) {
                                        crate::journal!("ventilateurs", "mode={:?} appliqué={:?} contrôle={} vitesse={:?}", resume.0, resume.1, resume.2, resume.3);
                                        dernier = Some(resume);
                                    }
                                    let _ = app.emit("ventilateurs", Some(s));
                                }
                                Err(e) => crate::journal!("ventilateurs", "statut ignoré : {e}"),
                            }
                        }
                    }
                }
                Err(_) => {
                    if !annonce_absent {
                        let _ = app.emit("ventilateurs", None::<Statut>);
                        annonce_absent = true;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_secs(5));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn statut_complet() {
        let l = r#"{"ok":true,"temperature":61.5,"rpms":[3100,2900],"appliedPercent":0,"controlOn":true,"mode":"normal","unit":"percent","speed":45,"override":null,"fansStopped":false,"onCharger":true,"batteryPercent":78,"batteryLimit":{"enabled":true,"percent":80,"fullChargePending":false},"error":null}"#;
        let s: Statut = serde_json::from_value(lire_reponse(l).unwrap()).unwrap();
        assert_eq!(s.temperature, Some(61.5));
        assert_eq!(s.rpms, vec![3100.0, 2900.0]);
        assert_eq!(s.applied_percent, Some(0.0));
        assert_eq!(s.battery_limit.unwrap().percent, Some(80));
        assert_eq!(s.mode.as_deref(), Some("normal"));
    }
    #[test]
    fn erreurs() {
        assert_eq!(lire_reponse(r#"{"ok":false,"error":"profil inconnu"}"#).unwrap_err(), "profil inconnu");
        assert!(lire_reponse("pas du json").is_err());
    }
    #[cfg(not(windows))]
    #[test]
    fn canal_absent_message_clair() {
        assert_eq!(requete(json!({"cmd":"status"})).unwrap_err(), PAS_LANCE);
    }
}
