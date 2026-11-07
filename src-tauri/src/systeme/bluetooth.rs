//! Appareils Bluetooth : alerte à la connexion / déconnexion (nom, type, batterie),
//! comme les écouteurs sur iPhone.
//!
//! Deux « observateurs » de Windows (Bluetooth classique et basse consommation) listent les
//! appareils CONNECTÉS : un appareil qui apparaît vient de se connecter, un appareil qui
//! disparaît vient de se déconnecter. Ceux déjà connectés au démarrage ne déclenchent rien.
//! Batterie : service GATT standard « Battery » (0x180F) quand l'appareil le propose.

use serde::Serialize;
use tauri::AppHandle;

use crate::journal;

pub const EVENEMENT: &str = "bluetooth";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppareilBluetooth {
    pub nom: String,
    pub connecte: bool,
    /// "audio" | "clavier" | "souris" | "telephone" | "manette" | "autre"
    pub categorie: &'static str,
    /// Pourcentage, si l'appareil le donne.
    pub batterie: Option<u8>,
}

/// Catégorie d'après la « classe d'appareil » Bluetooth (classe majeure + mineure).
pub fn categorie_classe(majeure: i32, mineure: i32) -> &'static str {
    match majeure {
        4 => "audio",     // Audio/Video : écouteurs, casque, enceinte
        2 => "telephone", // Phone
        5 => match mineure & 0b11_0000 {
            0b01_0000 => "clavier",
            0b10_0000 => "souris",
            _ if mineure & 0b1111 == 0b0010 || mineure & 0b1111 == 0b0001 => "manette",
            _ => "autre",
        },
        _ => "autre",
    }
}

/// Catégorie d'après le nom (appareils basse consommation, sans classe).
pub fn categorie_nom(nom: &str) -> &'static str {
    let n = nom.to_lowercase();
    let contient = |mots: &[&str]| mots.iter().any(|m| n.contains(m));
    if contient(&[
        "airpods",
        "buds",
        "headphone",
        "headset",
        "casque",
        "écouteur",
        "ecouteur",
        "wh-",
        "wf-",
        "jbl",
        "bose",
        "beats",
        "speaker",
        "enceinte",
    ]) {
        "audio"
    } else if contient(&["keyboard", "clavier", "keys"]) {
        "clavier"
    } else if contient(&["mouse", "souris", "mx master", "trackpad"]) {
        "souris"
    } else if contient(&["controller", "manette", "xbox", "dualsense", "dualshock", "gamepad"]) {
        "manette"
    } else if contient(&["iphone", "galaxy", "pixel", "phone", "téléphone"]) {
        "telephone"
    } else {
        "autre"
    }
}

#[cfg(windows)]
mod win {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::{Arc, Mutex};
    use tauri::Emitter;
    use windows::core::{IInspectable, HSTRING};
    use windows::Devices::Bluetooth::GenericAttributeProfile::{
        GattCharacteristicUuids, GattCommunicationStatus, GattServiceUuids,
    };
    use windows::Devices::Bluetooth::{
        BluetoothCacheMode, BluetoothConnectionStatus, BluetoothDevice, BluetoothLEDevice,
    };
    use windows::Devices::Enumeration::{DeviceInformation, DeviceInformationUpdate, DeviceWatcher};
    use windows::Foundation::TypedEventHandler;
    use windows::Storage::Streams::DataReader;

    type Connus = Arc<Mutex<HashMap<String, (String, &'static str, Option<u8>)>>>;

    fn batterie_ble(le: &BluetoothLEDevice) -> Option<u8> {
        let services = le
            .GetGattServicesForUuidWithCacheModeAsync(GattServiceUuids::Battery().ok()?, BluetoothCacheMode::Uncached)
            .ok()?
            .join()
            .ok()?;
        if services.Status().ok()? != GattCommunicationStatus::Success {
            return None;
        }
        let service = services.Services().ok()?.GetAt(0).ok()?;
        let cars = service
            .GetCharacteristicsForUuidWithCacheModeAsync(
                GattCharacteristicUuids::BatteryLevel().ok()?,
                BluetoothCacheMode::Uncached,
            )
            .ok()?
            .join()
            .ok()?;
        if cars.Status().ok()? != GattCommunicationStatus::Success {
            return None;
        }
        let lecture = cars
            .Characteristics()
            .ok()?
            .GetAt(0)
            .ok()?
            .ReadValueWithCacheModeAsync(BluetoothCacheMode::Uncached)
            .ok()?
            .join()
            .ok()?;
        if lecture.Status().ok()? != GattCommunicationStatus::Success {
            return None;
        }
        let tampon = lecture.Value().ok()?;
        if tampon.Length().ok()? < 1 {
            return None;
        }
        let v = DataReader::FromBuffer(&tampon).ok()?.ReadByte().ok()?;
        (v <= 100).then_some(v)
    }

    /// Catégorie et batterie d'un appareil qui vient de se connecter.
    fn details(id: &HSTRING, nom: &str) -> (&'static str, Option<u8>) {
        // Bluetooth classique (écouteurs, la plupart des casques) : classe d'appareil, puis
        // batterie par son pendant basse consommation (même adresse) s'il existe.
        if let Some(classique) = BluetoothDevice::FromIdAsync(id).ok().and_then(|a| a.join().ok()) {
            let categorie = classique
                .ClassOfDevice()
                .ok()
                .and_then(|c| Some(categorie_classe(c.MajorClass().ok()?.0, c.MinorClass().ok()?.0)))
                .filter(|c| *c != "autre")
                .unwrap_or_else(|| categorie_nom(nom));
            let batterie = classique
                .BluetoothAddress()
                .ok()
                .and_then(|a| BluetoothLEDevice::FromBluetoothAddressAsync(a).ok()?.join().ok())
                .and_then(|le| batterie_ble(&le));
            return (categorie, batterie);
        }
        let batterie = BluetoothLEDevice::FromIdAsync(id)
            .ok()
            .and_then(|a| a.join().ok())
            .and_then(|le| batterie_ble(&le));
        (categorie_nom(nom), batterie)
    }

    fn observer(app: AppHandle, selecteur: HSTRING, connus: Connus) -> windows::core::Result<DeviceWatcher> {
        let observateur = DeviceInformation::CreateWatcherAqsFilter(&selecteur)?;
        let pret = Arc::new(AtomicBool::new(false));

        let (p, c, a) = (pret.clone(), connus.clone(), app.clone());
        observateur.Added(&TypedEventHandler::<DeviceWatcher, DeviceInformation>::new(
            move |_, info| {
                let Some(info) = info.as_ref() else { return Ok(()) };
                let id = info.Id()?;
                let nom = info.Name()?.to_string();
                if nom.is_empty() {
                    return Ok(());
                }
                if !p.load(Ordering::Relaxed) {
                    // Déjà connecté au démarrage : on retient seulement le nom.
                    c.lock().unwrap().insert(id.to_string(), (nom, categorie_nom(""), None));
                    return Ok(());
                }
                let (c, a) = (c.clone(), a.clone());
                // La lecture de la batterie peut prendre 1 à 2 s : dans un fil à part.
                std::thread::spawn(move || {
                    let (categorie, batterie) = details(&id, &nom);
                    journal!("bluetooth", "connecté : {nom} ({categorie}, batterie {batterie:?})");
                    c.lock()
                        .unwrap()
                        .insert(id.to_string(), (nom.clone(), categorie, batterie));
                    let _ = a.emit(
                        EVENEMENT,
                        AppareilBluetooth {
                            nom,
                            connecte: true,
                            categorie,
                            batterie,
                        },
                    );
                });
                Ok(())
            },
        ))?;

        let (c, a) = (connus.clone(), app.clone());
        observateur.Removed(&TypedEventHandler::<DeviceWatcher, DeviceInformationUpdate>::new(
            move |_, maj| {
                let Some(maj) = maj.as_ref() else { return Ok(()) };
                let id = maj.Id()?.to_string();
                if let Some((nom, categorie, batterie)) = c.lock().unwrap().remove(&id) {
                    journal!("bluetooth", "déconnecté : {nom}");
                    let _ = a.emit(
                        EVENEMENT,
                        AppareilBluetooth {
                            nom,
                            connecte: false,
                            categorie,
                            batterie,
                        },
                    );
                }
                Ok(())
            },
        ))?;

        observateur.EnumerationCompleted(&TypedEventHandler::<DeviceWatcher, IInspectable>::new(move |_, _| {
            pret.store(true, Ordering::Relaxed);
            Ok(())
        }))?;
        observateur.Start()?;
        Ok(observateur)
    }

    pub fn demarrer(app: AppHandle) {
        std::thread::Builder::new()
            .name("ile-bluetooth".into())
            .spawn(move || {
                let connus: Connus = Default::default();
                let mut observateurs = Vec::new();
                let selecteurs = [
                    (
                        "classique",
                        BluetoothDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected),
                    ),
                    (
                        "basse consommation",
                        BluetoothLEDevice::GetDeviceSelectorFromConnectionStatus(BluetoothConnectionStatus::Connected),
                    ),
                ];
                for (nom, selecteur) in selecteurs {
                    match selecteur.and_then(|s| observer(app.clone(), s, connus.clone())) {
                        Ok(o) => observateurs.push(o),
                        Err(e) => journal!("bluetooth", "observateur {nom} impossible : {e}"),
                    }
                }
                journal!("bluetooth", "prêt ({} observateurs)", observateurs.len());
                // Garder les observateurs en vie.
                loop {
                    std::thread::park();
                }
            })
            .ok();
    }
}

#[cfg(windows)]
pub use win::demarrer;

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    journal!("bluetooth", "non disponible sur ce système (Windows seulement)");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn categories() {
        assert_eq!(categorie_classe(4, 1), "audio");
        assert_eq!(categorie_classe(5, 0b01_0000), "clavier");
        assert_eq!(categorie_classe(5, 0b10_0000), "souris");
        assert_eq!(categorie_nom("AirPods Pro de Médéric"), "audio");
        assert_eq!(categorie_nom("MX Master 3S"), "souris");
        assert_eq!(categorie_nom("Xbox Wireless Controller"), "manette");
        assert_eq!(categorie_nom("Truc"), "autre");
    }
}
