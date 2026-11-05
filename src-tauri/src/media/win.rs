//! Média sous Windows : GlobalSystemMediaTransportControlsSessionManager (GSMTC).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use tauri::{AppHandle, Emitter};
use windows::Foundation::TypedEventHandler;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Gestionnaire,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as StatutWin,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use super::{choisir_session, partage, pochette, Action, EtatMedia, SourceMedia, StatutLecture};
use crate::journal::maintenant_ms;
use crate::{evenements, journal};

/// Écart entre l'époque Windows (1601) et l'époque Unix (1970), en unités de 100 ns.
const EPOQUE_WINDOWS_VERS_UNIX: i64 = 116_444_736_000_000_000;

struct Abonnement {
    session: Session,
    proprietes: i64,
    lecture: i64,
    chronologie: i64,
}

struct Media {
    app: AppHandle,
    gestionnaire: Gestionnaire,
    abonnements: Mutex<HashMap<String, Abonnement>>,
    /// Sérialise les mises à jour (les événements Windows arrivent sur plusieurs fils).
    verrou_maj: Mutex<()>,
}

static MEDIA: OnceLock<Media> = OnceLock::new();

pub fn demarrer(app: AppHandle) {
    std::thread::Builder::new()
        .name("ile-media".into())
        .spawn(move || {
            // Fil « multithread » COM : les objets WinRT créés ici sont utilisables partout.
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            match initialiser(app) {
                Ok(()) => journal!("media", "GSMTC prêt"),
                Err(e) => journal!("media", "GSMTC indisponible : {e}"),
            }
            // Ce fil reste en vie pour garder l'appartement COM ouvert.
            loop {
                std::thread::park();
            }
        })
        .expect("impossible de lancer le fil média");
}

fn initialiser(app: AppHandle) -> windows::core::Result<()> {
    let gestionnaire = Gestionnaire::RequestAsync()?.join()?;
    gestionnaire.SessionsChanged(&TypedEventHandler::new(|_, _| {
        journal!("media", "liste des sessions modifiée");
        rafraichir(true);
        Ok(())
    }))?;
    gestionnaire.CurrentSessionChanged(&TypedEventHandler::new(|_, _| {
        journal!("media", "session courante modifiée");
        rafraichir(true);
        Ok(())
    }))?;
    let _ = MEDIA.set(Media {
        app,
        gestionnaire,
        abonnements: Mutex::new(HashMap::new()),
        verrou_maj: Mutex::new(()),
    });
    rafraichir(true);
    Ok(())
}

pub fn rafraichir_maintenant() {
    rafraichir(true);
}

fn statut(s: StatutWin) -> StatutLecture {
    match s {
        StatutWin::Closed => StatutLecture::Ferme,
        StatutWin::Opened => StatutLecture::Ouverture,
        StatutWin::Changing => StatutLecture::Changement,
        StatutWin::Stopped => StatutLecture::Arrete,
        StatutWin::Playing => StatutLecture::Lecture,
        StatutWin::Paused => StatutLecture::Pause,
        _ => StatutLecture::Aucun,
    }
}

fn s_abonner(session: &Session) -> windows::core::Result<Abonnement> {
    Ok(Abonnement {
        proprietes: session.MediaPropertiesChanged(&TypedEventHandler::new(|_, _| {
            rafraichir(true);
            Ok(())
        }))?,
        lecture: session.PlaybackInfoChanged(&TypedEventHandler::new(|_, _| {
            rafraichir(false);
            Ok(())
        }))?,
        chronologie: session.TimelinePropertiesChanged(&TypedEventHandler::new(|_, _| {
            rafraichir(false);
            Ok(())
        }))?,
        session: session.clone(),
    })
}

fn se_desabonner(a: &Abonnement) {
    let _ = a.session.RemoveMediaPropertiesChanged(a.proprietes);
    let _ = a.session.RemovePlaybackInfoChanged(a.lecture);
    let _ = a.session.RemoveTimelinePropertiesChanged(a.chronologie);
}

/// Relit tout l'état et prévient le front-end si quelque chose a changé.
/// `avec_pochette` : relire aussi les métadonnées et la pochette (plus coûteux).
fn rafraichir(avec_pochette: bool) {
    let Some(m) = MEDIA.get() else { return };
    let _garde = m.verrou_maj.lock().unwrap();
    if let Err(e) = rafraichir_interne(m, avec_pochette) {
        journal!("media", "erreur de lecture : {e}");
    }
}

fn rafraichir_interne(m: &Media, avec_pochette: bool) -> windows::core::Result<()> {
    // 1. Liste des sessions + abonnements aux nouvelles sessions.
    let liste = m.gestionnaire.GetSessions()?;
    let mut sessions: Vec<Session> = Vec::new();
    let mut sources: Vec<SourceMedia> = Vec::new();
    for i in 0..liste.Size()? {
        let s = liste.GetAt(i)?;
        let app_id = s.SourceAppUserModelId()?.to_string();
        let st = s
            .GetPlaybackInfo()
            .and_then(|p| p.PlaybackStatus())
            .map(statut)
            .unwrap_or_default();
        sources.push(SourceMedia { app_id, statut: st });
        sessions.push(s);
    }
    {
        let mut abos = m.abonnements.lock().unwrap();
        abos.retain(|id, a| {
            let garder = sources.iter().any(|s| &s.app_id == id);
            if !garder {
                se_desabonner(a);
            }
            garder
        });
        for (s, src) in sessions.iter().zip(&sources) {
            if !abos.contains_key(&src.app_id) {
                match s_abonner(s) {
                    Ok(a) => {
                        journal!("media", "nouvelle source : {}", src.app_id);
                        abos.insert(src.app_id.clone(), a);
                    }
                    Err(e) => journal!("media", "abonnement impossible à {} : {e}", src.app_id),
                }
            }
        }
    }

    // 2. Choix de la session active.
    let courante = m
        .gestionnaire
        .GetCurrentSession()
        .ok()
        .and_then(|s| s.SourceAppUserModelId().ok())
        .map(|h| h.to_string());
    let epinglee = partage().epinglee.lock().unwrap().clone();
    let index = choisir_session(&sources, epinglee.as_deref(), courante.as_deref());

    let precedent = partage().dernier.lock().unwrap().clone();
    let mut etat = EtatMedia {
        sources: sources.clone(),
        source_epinglee: epinglee,
        ..Default::default()
    };

    if let Some(i) = index {
        let s = &sessions[i];
        etat.source_active = Some(sources[i].app_id.clone());
        etat.statut = sources[i].statut;

        // Métadonnées (titre, artiste, album) — on garde les anciennes si on ne relit pas.
        let meme_source = precedent.source_active == etat.source_active;
        if avec_pochette || !meme_source {
            if let Ok(p) = s.TryGetMediaPropertiesAsync()?.join() {
                etat.titre = p.Title().map(|h| h.to_string()).unwrap_or_default();
                etat.artiste = p.Artist().map(|h| h.to_string()).unwrap_or_default();
                etat.album = p.AlbumTitle().map(|h| h.to_string()).unwrap_or_default();
                etat.pochette_id = lire_pochette(m, &p);
            }
        } else {
            etat.titre = precedent.titre.clone();
            etat.artiste = precedent.artiste.clone();
            etat.album = precedent.album.clone();
            etat.pochette_id = precedent.pochette_id.clone();
        }

        // Position et durée.
        if let Ok(t) = s.GetTimelineProperties() {
            let debut = t.StartTime().map(|d| d.Duration).unwrap_or(0);
            let fin = t.EndTime().map(|d| d.Duration).unwrap_or(0);
            let pos = t.Position().map(|d| d.Duration).unwrap_or(0);
            etat.position_ms = (pos - debut) / 10_000;
            etat.duree_ms = (fin - debut).max(0) / 10_000;
            etat.position_maj_a_ms = t
                .LastUpdatedTime()
                .map(|d| (d.UniversalTime - EPOQUE_WINDOWS_VERS_UNIX) / 10_000)
                .unwrap_or_else(|_| maintenant_ms());
        }

        // Boutons disponibles.
        if let Ok(c) = s.GetPlaybackInfo().and_then(|p| p.Controls()) {
            etat.peut_lire_pause = c.IsPlayPauseToggleEnabled().unwrap_or(false);
            etat.peut_suivant = c.IsNextEnabled().unwrap_or(false);
            etat.peut_precedent = c.IsPreviousEnabled().unwrap_or(false);
            etat.peut_aller_a = c.IsPlaybackPositionEnabled().unwrap_or(false);
        }
    }

    if etat != precedent {
        journal!(
            "media",
            "{:?} « {} » — {} [{}] {} / {} ms",
            etat.statut,
            etat.titre,
            etat.artiste,
            etat.source_active.as_deref().unwrap_or("aucune source"),
            etat.position_ms,
            etat.duree_ms
        );
        *partage().dernier.lock().unwrap() = etat.clone();
        let _ = m.app.emit(evenements::MEDIA, &etat);
    }
    Ok(())
}

/// Lit la pochette ; l'envoie au front-end seulement si elle a changé. Renvoie son identifiant.
fn lire_pochette(
    m: &Media,
    p: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    let reference = p.Thumbnail().ok()?;
    let flux = reference.OpenReadAsync().ok()?.join().ok()?;
    let taille = flux.Size().ok()? as u32;
    if taille == 0 {
        return None;
    }
    let lecteur = DataReader::CreateDataReader(&flux.GetInputStreamAt(0).ok()?).ok()?;
    lecteur.LoadAsync(taille).ok()?.join().ok()?;
    let mut octets = vec![0u8; taille as usize];
    lecteur.ReadBytes(&mut octets).ok()?;

    let id = pochette::identifiant(&octets);
    let deja = partage().pochette.lock().unwrap().as_ref().map(|p| p.id.clone());
    if deja.as_deref() == Some(id.as_str()) {
        return Some(id);
    }
    match pochette::traiter(&octets) {
        Ok(poch) => {
            journal!(
                "media",
                "nouvelle pochette {} ({} octets), couleur dominante {:?}",
                poch.id,
                octets.len(),
                poch.couleur_dominante
            );
            let _ = m.app.emit(evenements::MEDIA_POCHETTE, &poch);
            *partage().pochette.lock().unwrap() = Some(poch);
            Some(id)
        }
        Err(e) => {
            journal!("media", "pochette illisible : {e}");
            None
        }
    }
}

fn session_active(m: &Media) -> Result<Session, String> {
    let id = partage()
        .dernier
        .lock()
        .unwrap()
        .source_active
        .clone()
        .ok_or("aucune source média")?;
    let abos = m.abonnements.lock().unwrap();
    abos.get(&id)
        .map(|a| a.session.clone())
        .ok_or_else(|| format!("source « {id} » introuvable"))
}

pub fn agir(action: Action) -> Result<(), String> {
    let m = MEDIA.get().ok_or("média pas encore prêt")?;
    let s = session_active(m)?;
    let resultat = match action {
        Action::LecturePause => s.TryTogglePlayPauseAsync().and_then(|op| op.join()),
        Action::Suivant => s.TrySkipNextAsync().and_then(|op| op.join()),
        Action::Precedent => s.TrySkipPreviousAsync().and_then(|op| op.join()),
        // Windows compte en unités de 100 ns (1 ms = 10 000).
        Action::AllerA(ms) => s.TryChangePlaybackPositionAsync(ms * 10_000).and_then(|op| op.join()),
    };
    journal!("media", "commande {:?} → {:?}", action, resultat);
    match resultat {
        Ok(true) => Ok(()),
        Ok(false) => Err("l'application a refusé la commande".into()),
        Err(e) => Err(e.to_string()),
    }
}
