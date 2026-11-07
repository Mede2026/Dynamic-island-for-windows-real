//! Météo dans l'île : position de Windows (si l'utilisateur l'autorise ; sinon Boucherville),
//! météo d'Open-Meteo (gratuit, sans clé), toutes les 15 minutes. Événement « meteo ».

use serde::Serialize;

/// Boucherville (Québec) : utilisé si la position de Windows est refusée ou indisponible.
pub const DEFAUT: (f64, f64) = (45.5911, -73.4363);

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meteo {
    pub temperature: f64,
    /// Code météo de l'OMM (0 = ciel clair, 61 = pluie, 71 = neige…).
    pub code: u32,
    pub jour: bool,
    /// Minutes avant la pluie (ou la neige) dans l'heure qui vient, si elle arrive.
    pub precipitation_dans: Option<u32>,
    pub neige: bool,
    /// Position de Windows utilisée (sinon Boucherville).
    pub position_reelle: bool,
}

pub fn url(lat: f64, lon: f64) -> String {
    format!(
        "https://api.open-meteo.com/v1/forecast?latitude={lat:.3}&longitude={lon:.3}&current=temperature_2m,weather_code,is_day&minutely_15=precipitation,snowfall&forecast_minutely_15=5&timezone=auto"
    )
}

/// Lit la réponse d'Open-Meteo.
pub fn lire(json: &str, position_reelle: bool) -> Option<Meteo> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    let c = &v["current"];
    let pluie = v["minutely_15"]["precipitation"].as_array();
    let neige = v["minutely_15"]["snowfall"].as_array();
    // Premier quart d'heure (après le présent) où il tombe quelque chose.
    let mut dans = None;
    let mut tombe_neige = false;
    for i in 1..5 {
        let p = pluie.and_then(|a| a.get(i)).and_then(|x| x.as_f64()).unwrap_or(0.0);
        let n = neige.and_then(|a| a.get(i)).and_then(|x| x.as_f64()).unwrap_or(0.0);
        if p >= 0.1 || n > 0.0 {
            dans = Some((i as u32) * 15);
            tombe_neige = n > 0.0;
            break;
        }
    }
    Some(Meteo {
        temperature: c["temperature_2m"].as_f64()?,
        code: c["weather_code"].as_u64().unwrap_or(0) as u32,
        jour: c["is_day"].as_u64().unwrap_or(1) == 1,
        precipitation_dans: dans,
        neige: tombe_neige,
        position_reelle,
    })
}

#[cfg(windows)]
fn position() -> Option<(f64, f64)> {
    use windows::Devices::Geolocation::{GeolocationAccessStatus, Geolocator};
    let acces = Geolocator::RequestAccessAsync().ok()?.join().ok()?;
    if acces != GeolocationAccessStatus::Allowed {
        return None;
    }
    let p = Geolocator::new().ok()?.GetGeopositionAsync().ok()?.join().ok()?;
    let pos = p.Coordinate().ok()?.Point().ok()?.Position().ok()?;
    Some((pos.Latitude, pos.Longitude))
}

#[cfg(not(windows))]
fn position() -> Option<(f64, f64)> {
    None
}

pub fn demarrer(app: &tauri::AppHandle) {
    use tauri::Emitter;
    let app = app.clone();
    let _ = std::thread::Builder::new().name("ile-meteo".into()).spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(6));
        let mut lieu: Option<(f64, f64, bool)> = None;
        let mut tour = 0u32;
        loop {
            // La position est relue toutes les 2 heures (on bouge peu).
            if lieu.is_none() || tour.is_multiple_of(8) {
                lieu = Some(match position() {
                    Some((a, o)) => (a, o, true),
                    None => (DEFAUT.0, DEFAUT.1, false),
                });
            }
            let (lat, lon, reelle) = lieu.unwrap_or((DEFAUT.0, DEFAUT.1, false));
            match crate::web::get(&url(lat, lon), &[]) {
                Ok((200, json)) => match lire(&json, reelle) {
                    Some(m) => {
                        let _ = app.emit("meteo", &m);
                    }
                    None => crate::journal!("meteo", "réponse illisible"),
                },
                Ok((code, _)) => crate::journal!("meteo", "HTTP {code}"),
                Err(e) => crate::journal!("meteo", "pas de connexion : {e}"),
            }
            tour += 1;
            std::thread::sleep(std::time::Duration::from_secs(15 * 60));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn pluie_dans_30_min() {
        let j = r#"{"current":{"temperature_2m":4.2,"weather_code":3,"is_day":1},"minutely_15":{"precipitation":[0,0,0.4,0.8,1],"snowfall":[0,0,0,0,0]}}"#;
        let m = lire(j, false).unwrap();
        assert_eq!(m.temperature, 4.2);
        assert_eq!(m.precipitation_dans, Some(30));
        assert!(!m.neige);
    }
    #[test]
    fn neige_et_ciel_clair() {
        let neige = r#"{"current":{"temperature_2m":-3,"weather_code":71,"is_day":0},"minutely_15":{"precipitation":[0,0.2,0,0,0],"snowfall":[0,0.3,0,0,0]}}"#;
        assert!(lire(neige, true).unwrap().neige);
        let clair = r#"{"current":{"temperature_2m":20,"weather_code":0,"is_day":1},"minutely_15":{"precipitation":[0,0,0,0,0],"snowfall":[0,0,0,0,0]}}"#;
        assert_eq!(lire(clair, true).unwrap().precipitation_dans, None);
    }
}
