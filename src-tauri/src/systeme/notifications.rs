//! Notifications Windows via `UserNotificationListener`.
//!
//! LIMITE IMPORTANTE (voir docs/limites.md) : cette API exige que l'application ait
//! une « identité de package » (installée en MSIX) et la capacité
//! `userNotificationListener`. Une app Tauri installée en .exe/.msi classique n'en a pas :
//! l'accès est alors refusé. On essaie quand même ; l'état est exposé au front-end.

use serde::Serialize;
use std::sync::Mutex;
use tauri::AppHandle;

use crate::journal;

#[derive(Clone, Debug, Serialize, PartialEq, Eq, Default)]
#[serde(rename_all = "camelCase")]
pub struct EtatNotifications {
    pub disponible: bool,
    /// Pourquoi ce n'est pas disponible (en français).
    pub raison: Option<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: u32,
    pub application: String,
    pub textes: Vec<String>,
}

static DERNIER: Mutex<Option<EtatNotifications>> = Mutex::new(None);

pub fn dernier() -> EtatNotifications {
    DERNIER.lock().unwrap().clone().unwrap_or(EtatNotifications {
        disponible: false,
        raison: Some("vérification en cours".into()),
    })
}

fn definir(etat: EtatNotifications) {
    journal!(
        "notifications",
        "disponible={} {}",
        etat.disponible,
        etat.raison.as_deref().unwrap_or("")
    );
    *DERNIER.lock().unwrap() = Some(etat);
}

/// Identifiants présents maintenant mais pas avant (fonction pure, testée).
pub fn nouveaux(avant: &[u32], maintenant: &[u32]) -> Vec<u32> {
    maintenant.iter().copied().filter(|id| !avant.contains(id)).collect()
}

#[cfg(windows)]
mod win {
    use super::*;
    use crate::evenements;
    use std::time::Duration;
    use tauri::Emitter;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
    use windows::UI::Notifications::Management::{UserNotificationListener, UserNotificationListenerAccessStatus};
    use windows::UI::Notifications::{KnownNotificationBindings, NotificationKinds, UserNotification};

    /// Intervalle de lecture (réglage technique) : l'événement NotificationChanged
    /// n'est pas disponible hors package, on relit donc la liste.
    const INTERVALLE: Duration = Duration::from_secs(2);

    fn decrire(n: &UserNotification) -> windows::core::Result<Notification> {
        let application = n
            .AppInfo()
            .and_then(|a| a.DisplayInfo())
            .and_then(|d| d.DisplayName())
            .map(|h| h.to_string())
            .unwrap_or_default();
        let mut textes = Vec::new();
        if let Ok(liaison) = n
            .Notification()?
            .Visual()?
            .GetBinding(&KnownNotificationBindings::ToastGeneric()?)
        {
            let elements = liaison.GetTextElements()?;
            for i in 0..elements.Size()? {
                textes.push(elements.GetAt(i)?.Text()?.to_string());
            }
        }
        Ok(Notification {
            id: n.Id()?,
            application,
            textes,
        })
    }

    fn lister(l: &UserNotificationListener) -> windows::core::Result<Vec<UserNotification>> {
        let v = l.GetNotificationsAsync(NotificationKinds::Toast)?.join()?;
        (0..v.Size()?).map(|i| v.GetAt(i)).collect()
    }

    pub fn demarrer(app: AppHandle) {
        std::thread::Builder::new()
            .name("ile-notifications".into())
            .spawn(move || {
                unsafe {
                    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
                }
                let ecouteur = match UserNotificationListener::Current() {
                    Ok(l) => l,
                    Err(e) => {
                        return definir(EtatNotifications {
                            disponible: false,
                            raison: Some(format!(
                                "UserNotificationListener indisponible (app non packagée ?) : {e}"
                            )),
                        })
                    }
                };
                let acces = ecouteur.RequestAccessAsync().and_then(|op| op.join());
                match acces {
                    Ok(UserNotificationListenerAccessStatus::Allowed) => {}
                    Ok(autre) => {
                        return definir(EtatNotifications {
                            disponible: false,
                            raison: Some(format!("accès refusé par Windows ({autre:?})")),
                        })
                    }
                    Err(e) => {
                        return definir(EtatNotifications {
                            disponible: false,
                            raison: Some(format!("demande d'accès impossible : {e}")),
                        })
                    }
                }
                definir(EtatNotifications {
                    disponible: true,
                    raison: None,
                });

                // Les notifications déjà présentes au démarrage ne sont pas annoncées.
                let mut connus: Vec<u32> = lister(&ecouteur)
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|n| n.Id().ok())
                    .collect();
                loop {
                    std::thread::sleep(INTERVALLE);
                    let Ok(liste) = lister(&ecouteur) else {
                        continue;
                    };
                    let ids: Vec<u32> = liste.iter().filter_map(|n| n.Id().ok()).collect();
                    for id in nouveaux(&connus, &ids) {
                        if let Some(n) = liste.iter().find(|n| n.Id().ok() == Some(id)) {
                            if let Ok(info) = decrire(n) {
                                journal!("notifications", "{} : {:?}", info.application, info.textes);
                                let _ = app.emit(evenements::NOTIFICATION, &info);
                            }
                        }
                    }
                    connus = ids;
                }
            })
            .expect("impossible de lancer le fil des notifications");
    }
}

#[cfg(windows)]
pub use win::demarrer;

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {
    definir(EtatNotifications {
        disponible: false,
        raison: Some("Windows seulement".into()),
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detection_des_nouvelles() {
        assert_eq!(nouveaux(&[1, 2], &[2, 3, 4]), vec![3, 4]);
        assert!(nouveaux(&[1, 2], &[1]).is_empty());
    }
}
