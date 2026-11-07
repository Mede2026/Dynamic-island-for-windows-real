//! Intégration à Windows : l'île se comporte comme une app du système.
//!
//!  - **Identité** (AppUserModelID) : la même que celle des raccourcis créés par l'installateur,
//!    pour que Windows relie l'île, son icône épinglée et ses notifications ;
//!  - **Menu de l'icône** (Jump List) : clic droit sur l'icône épinglée dans la barre des tâches
//!    (ou dans Démarrer) → « Minuteur 5 min », « Lanceur de minuteur… », « Réglages » ;
//!  - **Liens `dynamicisland://`** : `dynamicisland://minuteur/5m` lance un minuteur depuis un
//!    navigateur, un raccourci, un Stream Deck ou une notification ;
//!  - **Notification Windows** à la fin du minuteur, avec « Répéter » et « OK » (elle reste
//!    dans le centre de notifications si on n'était pas devant l'écran).
//!
//! Tout est écrit dans `HKCU` (le compte de l'utilisateur) : aucun droit administrateur.

use tauri::AppHandle;

use crate::{journal, minuteur, plateau};

/// Identité de l'app pour Windows = `identifier` de tauri.conf.json (comme les raccourcis
/// créés par l'installateur).
pub const AUMID: &str = "com.mederic.dynamicisland";
pub const PROTOCOLE: &str = "dynamicisland";
#[cfg(windows)]
const NOM: &str = "Dynamic Island";

/// Durées proposées dans le menu de l'icône (minutes).
pub const DUREES_MENU: [u64; 6] = [1, 3, 5, 10, 25, 60];

/// Remplace un lien `dynamicisland://…` par les arguments équivalents de la ligne de commande.
///
/// `minuteur/5m` → `--minuteur 5m` ; `minuteur/pause|reprendre|annuler` ; `lanceur` ;
/// `reglages`. Aussi en anglais (`timer`, `settings`). Inconnu → rien.
pub fn arguments_du_lien(lien: &str) -> Vec<String> {
    let reste = lien
        .get(PROTOCOLE.len() + 1..)
        .filter(|_| lien.len() > PROTOCOLE.len() && lien[..PROTOCOLE.len()].eq_ignore_ascii_case(PROTOCOLE))
        .unwrap_or("");
    let reste = reste.split(['?', '#']).next().unwrap_or("").to_lowercase();
    let segments: Vec<&str> = reste.split('/').filter(|s| !s.is_empty()).collect();
    let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect();
    match segments.as_slice() {
        ["minuteur" | "timer", "pause"] => a(&["--minuteur-pause"]),
        ["minuteur" | "timer", "reprendre" | "resume"] => a(&["--minuteur-reprendre"]),
        ["minuteur" | "timer", "annuler" | "cancel" | "stop"] => a(&["--minuteur-annuler"]),
        ["minuteur" | "timer", duree] => a(&["--minuteur", duree]),
        ["minuteur" | "timer"] | ["lanceur" | "launcher"] => a(&["--lanceur"]),
        ["reglages" | "settings"] => a(&["--reglages"]),
        ["chanson" | "shazam" | "song"] => a(&["--chanson"]),
        _ => Vec::new(),
    }
}

/// Arguments reçus (sans le nom du programme), liens traduits.
pub fn normaliser(args: &[String]) -> Vec<String> {
    args.iter()
        .flat_map(|a| {
            if a.len() > PROTOCOLE.len()
                && a[..PROTOCOLE.len()].eq_ignore_ascii_case(PROTOCOLE)
                && a[PROTOCOLE.len()..].starts_with(':')
            {
                arguments_du_lien(a)
            } else {
                vec![a.clone()]
            }
        })
        .collect()
}

/// Exécute ce que demandent les arguments (au lancement, ou transmis par une 2e instance).
///
/// `deuxieme_instance` : l'île tournait déjà. Sans ordre (ex. clic sur l'icône épinglée),
/// on ouvre le lanceur de minuteur plutôt que de ne rien faire.
pub fn executer(app: &AppHandle, args: &[String], deuxieme_instance: bool) {
    let args = normaliser(args.get(1..).unwrap_or_default());
    let mut ordre = false;
    if args.iter().any(|a| a == "--lanceur") {
        plateau::ouvrir_lanceur(app);
        ordre = true;
    }
    if args.iter().any(|a| a == "--reglages") {
        plateau::ouvrir_panneau(app);
        ordre = true;
    }
    if args.iter().any(|a| a == "--chanson") {
        crate::chanson::lancer(app);
        ordre = true;
    }
    if minuteur::ordre_depuis_arguments(&args).is_some() {
        minuteur::executer_arguments(app, &args);
        ordre = true;
    }
    if deuxieme_instance && !ordre && !args.iter().any(|a| a == crate::demarrage::ARGUMENT) {
        plateau::ouvrir_lanceur(app);
    }
}

/// « 5 min », « 1 h 30 min », « 45 s ».
pub fn texte_duree(ms: u64) -> String {
    let s = ms.div_ceil(1000);
    let (h, m, sec) = (s / 3600, (s % 3600) / 60, s % 60);
    let mut morceaux = Vec::new();
    if h > 0 {
        morceaux.push(format!("{h} h"));
    }
    if m > 0 {
        morceaux.push(format!("{m} min"));
    }
    if sec > 0 || morceaux.is_empty() {
        morceaux.push(format!("{sec} s"));
    }
    morceaux.join(" ")
}

/// Contenu XML de la notification « Minuteur terminé » (boutons Répéter / OK).
pub fn xml_notification_fin(duree_ms: u64) -> String {
    let duree = texte_duree(duree_ms);
    let secondes = duree_ms.div_ceil(1000).max(1);
    format!(
        r#"<toast activationType="protocol" launch="{p}://lanceur">
  <visual><binding template="ToastGeneric">
    <text>Minuteur terminé</text>
    <text>{duree}</text>
  </binding></visual>
  <actions>
    <action content="Répéter ({duree})" activationType="protocol" arguments="{p}://minuteur/{secondes}s"/>
    <action content="OK" activationType="system" arguments="dismiss"/>
  </actions>
</toast>"#,
        p = PROTOCOLE
    )
}

/// Préférence « notification Windows à la fin du minuteur » (activée par défaut).
fn notification_voulue(app: &AppHandle) -> bool {
    crate::parametres::lire(app)
        .affichage
        .get("notificationMinuteur")
        .and_then(|v| v.as_bool())
        .unwrap_or(true)
}

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/// À appeler tout au début (avant la création des fenêtres).
#[cfg(windows)]
pub fn definir_identite() {
    use windows::core::HSTRING;
    use windows::Win32::UI::Shell::SetCurrentProcessExplicitAppUserModelID;
    if let Err(e) = unsafe { SetCurrentProcessExplicitAppUserModelID(&HSTRING::from(AUMID)) } {
        journal!("integration", "identité impossible : {e}");
    }
}

/// Protocole, nom pour les notifications, menu de l'icône (en arrière-plan).
#[cfg(windows)]
pub fn installer() {
    std::thread::Builder::new()
        .name("ile-integration".into())
        .spawn(|| {
            let exe = match std::env::current_exe() {
                Ok(e) => e.to_string_lossy().into_owned(),
                Err(e) => return journal!("integration", "chemin du programme inconnu : {e}"),
            };
            match enregistrer_protocole(&exe) {
                Ok(()) => journal!("integration", "liens {PROTOCOLE}:// enregistrés"),
                Err(e) => journal!("integration", "liens {PROTOCOLE}:// impossibles : {e}"),
            }
            if let Err(e) = enregistrer_identite() {
                journal!("integration", "nom des notifications impossible : {e}");
            }
            // Garde-fou : si la création du menu fait planter l'île, le témoin reste sur le
            // disque et on ne réessaie plus aux lancements suivants.
            let temoin = journal::dossier_app().map(|d| d.join("jump-list-en-cours"));
            if temoin.as_ref().is_some_and(|t| t.exists()) {
                return journal!("integration", "menu de l'icône désactivé (plantage précédent)");
            }
            if let Some(t) = &temoin {
                let _ = std::fs::write(t, "");
            }
            match unsafe { creer_jump_list(&exe) } {
                Ok(()) => journal!("integration", "menu de l'icône (Jump List) créé"),
                Err(e) => journal!("integration", "menu de l'icône impossible : {e}"),
            }
            if let Some(t) = &temoin {
                let _ = std::fs::remove_file(t);
            }
        })
        .ok();
}

#[cfg(windows)]
fn ecrire_registre(chemin: &str, nom: Option<&str>, valeur: &str) -> windows::core::Result<()> {
    use windows::core::HSTRING;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE,
        REG_SZ,
    };
    unsafe {
        let mut cle = HKEY::default();
        RegCreateKeyExW(
            HKEY_CURRENT_USER,
            &HSTRING::from(chemin),
            None,
            None,
            REG_OPTION_NON_VOLATILE,
            KEY_WRITE,
            None,
            &mut cle,
            None,
        )
        .ok()?;
        let octets: Vec<u8> = valeur.encode_utf16().chain([0]).flat_map(u16::to_le_bytes).collect();
        let r = match nom {
            Some(n) => RegSetValueExW(cle, &HSTRING::from(n), None, REG_SZ, Some(&octets)),
            None => RegSetValueExW(cle, None, None, REG_SZ, Some(&octets)),
        };
        let _ = RegCloseKey(cle);
        r.ok()
    }
}

/// `HKCU\Software\Classes\dynamicisland` : Windows ouvre l'île pour les liens `dynamicisland://`.
#[cfg(windows)]
fn enregistrer_protocole(exe: &str) -> windows::core::Result<()> {
    let base = format!(r"Software\Classes\{PROTOCOLE}");
    ecrire_registre(&base, None, &format!("URL:{NOM}"))?;
    ecrire_registre(&base, Some("URL Protocol"), "")?;
    ecrire_registre(&format!(r"{base}\DefaultIcon"), None, &format!("\"{exe}\",0"))?;
    ecrire_registre(
        &format!(r"{base}\shell\open\command"),
        None,
        &format!("\"{exe}\" \"%1\""),
    )
}

/// Nom affiché sur les notifications, même sans raccourci dans Démarrer (version de dev).
#[cfg(windows)]
fn enregistrer_identite() -> windows::core::Result<()> {
    ecrire_registre(
        &format!(r"Software\Classes\AppUserModelId\{AUMID}"),
        Some("DisplayName"),
        NOM,
    )
}

/// Menu de l'icône épinglée (clic droit) : « Tâches » de la Jump List.
#[cfg(windows)]
unsafe fn creer_jump_list(exe: &str) -> windows::core::Result<()> {
    use windows::core::{Interface, HSTRING};
    use windows::Win32::Storage::EnhancedStorage::PKEY_Title;
    use windows::Win32::System::Com::StructuredStorage::{PropVariantClear, PROPVARIANT};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::Common::{IObjectArray, IObjectCollection};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{
        DestinationList, EnumerableObjectCollection, ICustomDestinationList, IShellLinkW, SHStrDupW, ShellLink,
    };

    let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
    journal!("integration", "menu de l'icône : création…");
    let liste: ICustomDestinationList = CoCreateInstance(&DestinationList, None, CLSCTX_INPROC_SERVER)?;
    liste.SetAppID(&HSTRING::from(AUMID))?;
    let mut places = 0u32;
    let _retires: IObjectArray = liste.BeginList(&mut places)?;
    let taches: IObjectCollection = CoCreateInstance(&EnumerableObjectCollection, None, CLSCTX_INPROC_SERVER)?;

    let ajouter = |titre: &str, arguments: &str| -> windows::core::Result<()> {
        let lien: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        lien.SetPath(&HSTRING::from(exe))?;
        lien.SetArguments(&HSTRING::from(arguments))?;
        lien.SetIconLocation(&HSTRING::from(exe), 0)?;
        lien.SetDescription(&HSTRING::from(titre))?;
        let proprietes: IPropertyStore = lien.cast()?;
        // Méthode documentée (InitPropVariantFromString) : chaîne allouée par COM, copiée
        // par SetValue, puis libérée par PropVariantClear. Une chaîne de Rust provoquait
        // une corruption du tas (plantage de la v0.1.2 au démarrage).
        let chaine = SHStrDupW(&HSTRING::from(titre))?;
        let mut valeur = PROPVARIANT::default();
        (*valeur.Anonymous.Anonymous).vt = VT_LPWSTR;
        (*valeur.Anonymous.Anonymous).Anonymous.pwszVal = chaine;
        let r = proprietes.SetValue(&PKEY_Title, &valeur);
        let _ = PropVariantClear(&mut valeur);
        r?;
        proprietes.Commit()?;
        taches.AddObject(&lien)
    };
    for m in DUREES_MENU {
        ajouter(
            &format!("Minuteur {}", texte_duree(m * 60_000)),
            &format!("--minuteur {m}m"),
        )?;
    }
    ajouter("Lanceur de minuteur…", "--lanceur")?;
    ajouter("Quelle est cette chanson ?", "--chanson")?;
    ajouter("Réglages de l'île", "--reglages")?;

    journal!("integration", "menu de l'icône : tâches prêtes");
    let tableau: IObjectArray = taches.cast()?;
    liste.AddUserTasks(&tableau)?;
    liste.CommitList()
}

/// Notification Windows « Minuteur terminé » (si la préférence est activée).
#[cfg(windows)]
pub fn notifier_fin_minuteur(app: &AppHandle, duree_ms: u64) {
    if !notification_voulue(app) {
        return;
    }
    std::thread::spawn(move || {
        use windows::core::HSTRING;
        use windows::Data::Xml::Dom::XmlDocument;
        use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
        use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
        let r = (|| -> windows::core::Result<()> {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
            }
            let doc = XmlDocument::new()?;
            doc.LoadXml(&HSTRING::from(xml_notification_fin(duree_ms)))?;
            let notification = ToastNotification::CreateToastNotification(&doc)?;
            ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(AUMID))?.Show(&notification)
        })();
        if let Err(e) = r {
            journal!("integration", "notification de fin impossible : {e}");
        }
    });
}

#[cfg(not(windows))]
pub fn definir_identite() {}

#[cfg(not(windows))]
pub fn installer() {
    journal!("integration", "intégration Windows non disponible sur ce système");
}

#[cfg(not(windows))]
pub fn notifier_fin_minuteur(app: &AppHandle, duree_ms: u64) {
    if notification_voulue(app) {
        journal!(
            "integration",
            "fin du minuteur ({}) — notification Windows seulement",
            texte_duree(duree_ms)
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn v(a: &[&str]) -> Vec<String> {
        a.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn liens() {
        assert_eq!(
            arguments_du_lien("dynamicisland://minuteur/5m"),
            v(&["--minuteur", "5m"])
        );
        assert_eq!(
            arguments_du_lien("dynamicisland://minuteur/5m/"),
            v(&["--minuteur", "5m"])
        );
        assert_eq!(
            arguments_du_lien("DynamicIsland://Timer/90S"),
            v(&["--minuteur", "90s"])
        );
        assert_eq!(
            arguments_du_lien("dynamicisland://minuteur/pause"),
            v(&["--minuteur-pause"])
        );
        assert_eq!(
            arguments_du_lien("dynamicisland://minuteur/annuler"),
            v(&["--minuteur-annuler"])
        );
        assert_eq!(arguments_du_lien("dynamicisland://minuteur"), v(&["--lanceur"]));
        assert_eq!(arguments_du_lien("dynamicisland:reglages"), v(&["--reglages"]));
        assert_eq!(arguments_du_lien("dynamicisland://lanceur?source=x"), v(&["--lanceur"]));
        assert!(arguments_du_lien("dynamicisland://inconnu").is_empty());
        assert!(arguments_du_lien("https://exemple.com").is_empty());
    }

    #[test]
    fn normalisation() {
        assert_eq!(
            normaliser(&v(&["dynamicisland://minuteur/3m"])),
            v(&["--minuteur", "3m"])
        );
        assert_eq!(normaliser(&v(&["--minuteur", "5m"])), v(&["--minuteur", "5m"]));
        assert!(minuteur::ordre_depuis_arguments(&normaliser(&v(&["dynamicisland://timer/1h30m"]))).is_some());
    }

    #[test]
    fn durees_en_texte() {
        assert_eq!(texte_duree(300_000), "5 min");
        assert_eq!(texte_duree(5_400_000), "1 h 30 min");
        assert_eq!(texte_duree(45_000), "45 s");
        assert_eq!(texte_duree(3_600_000), "1 h");
        assert_eq!(texte_duree(0), "0 s");
    }

    #[test]
    fn notification_bien_formee() {
        let x = xml_notification_fin(300_000);
        assert!(x.contains("dynamicisland://minuteur/300s"));
        assert!(x.contains("Répéter (5 min)"));
        assert!(!x.contains('&'));
    }
}
