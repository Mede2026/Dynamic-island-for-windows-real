//! Recherche « partout dans Windows » (barre de recherche de l'île) : apps du menu Démarrer
//! et du Microsoft Store, fichiers de l'utilisateur (index de recherche de Windows, jamais
//! les dossiers du système), icônes, ouverture.

use serde::Serialize;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AppTrouvee {
    pub nom: String,
    /// Nom d'analyse dans « shell:AppsFolder » (AUMID ou chemin) : sert à lancer l'app.
    pub id: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FichierTrouve {
    pub nom: String,
    pub chemin: String,
    /// Dossier parent, affiché en gris (« Documents › École »).
    pub dossier: String,
}

/// Dossiers jamais montrés (système, programmes, développement).
pub fn exclu(chemin: &str) -> bool {
    let c = chemin.to_lowercase().replace('/', "\\");
    [
        "\\appdata\\",
        "\\windows\\",
        "\\program files",
        "\\programdata\\",
        "\\node_modules\\",
        "\\.git\\",
        "\\$recycle.bin\\",
        "\\target\\",
    ]
    .iter()
    .any(|m| c.contains(m))
        || c.rsplit('\\').next().is_some_and(|n| n.starts_with('.') || n.starts_with("~$") || n == "desktop.ini")
}

/// Score de correspondance (plus grand = mieux) ; `None` si le texte ne correspond pas.
pub fn score(nom: &str, texte: &str) -> Option<u32> {
    let n = sans_accents(&nom.to_lowercase());
    let t = sans_accents(&texte.trim().to_lowercase());
    if t.is_empty() {
        return None;
    }
    if n == t {
        return Some(100);
    }
    if n.starts_with(&t) {
        return Some(80);
    }
    if n.split(|c: char| !c.is_alphanumeric()).any(|m| m.starts_with(&t)) {
        return Some(60);
    }
    // Initiales : « vsc » → « Visual Studio Code ».
    let initiales: String = n.split(|c: char| !c.is_alphanumeric()).filter_map(|m| m.chars().next()).collect();
    if t.len() >= 2 && initiales.starts_with(&t) {
        return Some(50);
    }
    n.contains(&t).then_some(30)
}

pub fn sans_accents(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'à' | 'â' | 'ä' | 'á' => 'a',
            'é' | 'è' | 'ê' | 'ë' => 'e',
            'î' | 'ï' | 'í' => 'i',
            'ô' | 'ö' | 'ó' => 'o',
            'ù' | 'û' | 'ü' | 'ú' => 'u',
            'ç' => 'c',
            _ => c,
        })
        .collect()
}

/// Apps qui correspondent au texte (8 au plus, les meilleures d'abord).
#[tauri::command]
pub async fn partout_apps(texte: String) -> Vec<AppTrouvee> {
    tauri::async_runtime::spawn_blocking(move || {
        let apps = plateforme::apps();
        let mut res: Vec<(u32, AppTrouvee)> = apps
            .into_iter()
            .filter_map(|a| score(&a.nom, &texte).map(|s| (s, a)))
            .collect();
        res.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.nom.len().cmp(&b.1.nom.len())));
        res.into_iter().take(8).map(|(_, a)| a).collect()
    })
    .await
    .unwrap_or_default()
}

/// Fichiers de l'utilisateur qui correspondent (index de recherche de Windows), 10 au plus.
#[tauri::command]
pub async fn partout_fichiers(texte: String) -> Vec<FichierTrouve> {
    if texte.trim().chars().count() < 2 {
        return Vec::new();
    }
    tauri::async_runtime::spawn_blocking(move || {
        let mut res: Vec<(u32, FichierTrouve)> = plateforme::fichiers(&texte)
            .into_iter()
            .filter(|f| !exclu(&f.chemin))
            .map(|f| (score(&f.nom, &texte).unwrap_or(10), f))
            .collect();
        res.sort_by_key(|x| std::cmp::Reverse(x.0));
        res.dedup_by(|a, b| a.1.chemin == b.1.chemin);
        res.into_iter().take(10).map(|(_, f)| f).collect()
    })
    .await
    .unwrap_or_default()
}

/// Icône (PNG base64, 64 px) d'une app (`app:<id>`) ou d'un fichier (`fichier:<chemin>`).
#[tauri::command]
pub async fn partout_icone(cle: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || plateforme::icone(&cle)).await.ok().flatten()
}

/// Lance une app trouvée.
#[tauri::command]
pub async fn partout_lancer_app(id: String) -> Result<(), String> {
    plateforme::ouvrir(&format!("shell:AppsFolder\\{id}"))
}

/// Ouvre un fichier trouvé (ou le montre dans l'Explorateur).
#[tauri::command]
pub async fn partout_ouvrir_fichier(chemin: String, montrer: bool) -> Result<(), String> {
    if exclu(&chemin) || !std::path::Path::new(&chemin).exists() {
        return Err("fichier introuvable".into());
    }
    if montrer {
        plateforme::montrer(&chemin)
    } else {
        plateforme::ouvrir(&chemin)
    }
}

#[cfg(windows)]
mod plateforme {
    use super::{AppTrouvee, FichierTrouve};
    use std::collections::HashMap;
    use std::sync::{Mutex, OnceLock};
    use std::time::{Duration, Instant};
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::*;

    fn texte_pwstr(p: windows::core::PWSTR) -> String {
        let s = unsafe { p.to_string().unwrap_or_default() };
        unsafe { CoTaskMemFree(Some(p.0 as *const _)) };
        s
    }

    /// Liste des apps (dossier virtuel « Applications » de Windows), gardée 10 minutes.
    pub fn apps() -> Vec<AppTrouvee> {
        type Liste = Option<(Instant, Vec<AppTrouvee>)>;
        static CACHE: OnceLock<Mutex<Liste>> = OnceLock::new();
        let cache = CACHE.get_or_init(|| Mutex::new(None));
        if let Some((quand, liste)) = cache.lock().unwrap().as_ref() {
            if quand.elapsed() < Duration::from_secs(600) {
                return liste.clone();
            }
        }
        let liste = lister_apps().unwrap_or_default();
        *cache.lock().unwrap() = Some((Instant::now(), liste.clone()));
        liste
    }

    fn lister_apps() -> windows::core::Result<Vec<AppTrouvee>> {
        let mut liste = Vec::new();
        unsafe {
            let dossier: IShellItem = SHGetKnownFolderItem(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None)?;
            let enumere: IEnumShellItems = dossier.BindToHandler(None, &BHID_EnumItems)?;
            loop {
                let mut item = [None];
                let mut n = 0u32;
                if enumere.Next(&mut item, Some(&mut n)).is_err() || n == 0 {
                    break;
                }
                let Some(item) = item[0].take() else { break };
                let nom = item.GetDisplayName(SIGDN_NORMALDISPLAY).map(texte_pwstr).unwrap_or_default();
                let id = item.GetDisplayName(SIGDN_PARENTRELATIVEPARSING).map(texte_pwstr).unwrap_or_default();
                let bas = nom.to_lowercase();
                // Désinstalleurs, aides et liens web : pas des apps qu'on veut ouvrir.
                if nom.is_empty() || id.is_empty() || bas.contains("uninstall") || bas.contains("désinstaller") || id.starts_with("http") {
                    continue;
                }
                liste.push(AppTrouvee { nom, id });
            }
        }
        liste.sort_by(|a, b| a.nom.cmp(&b.nom));
        liste.dedup_by(|a, b| a.nom == b.nom);
        Ok(liste)
    }

    /// Dossiers cherchés : ceux de l'utilisateur (et OneDrive), jamais le système.
    fn dossiers() -> Vec<String> {
        let mut d = Vec::new();
        if let Ok(profil) = std::env::var("USERPROFILE") {
            for n in ["Desktop", "Documents", "Downloads", "Pictures", "Music", "Videos"] {
                d.push(format!("{profil}\\{n}"));
            }
        }
        for v in ["OneDrive", "OneDriveConsumer", "OneDriveCommercial"] {
            if let Ok(o) = std::env::var(v) {
                if !d.contains(&o) {
                    d.push(o);
                }
            }
        }
        d.into_iter().filter(|p| std::path::Path::new(p).is_dir()).collect()
    }

    pub fn fichiers(texte: &str) -> Vec<FichierTrouve> {
        use windows::Storage::Search::{FolderDepth, IndexerOption, QueryOptions};
        use windows::Storage::StorageFolder;
        let mut res = Vec::new();
        for chemin in dossiers() {
            let r = (|| -> windows::core::Result<()> {
                let dossier = StorageFolder::GetFolderFromPathAsync(&HSTRING::from(chemin.as_str()))?.join()?;
                let options = QueryOptions::new()?;
                options.SetFolderDepth(FolderDepth::Deep)?;
                options.SetIndexerOption(IndexerOption::UseIndexerWhenAvailable)?;
                options.SetUserSearchFilter(&HSTRING::from(texte))?;
                let trouves = dossier.CreateFileQueryWithOptions(&options)?.GetFilesAsync(0, 6)?.join()?;
                for f in trouves {
                    let p = f.Path()?.to_string();
                    let parent = std::path::Path::new(&p)
                        .parent()
                        .map(|x| x.display().to_string())
                        .unwrap_or_default();
                    let profil = std::env::var("USERPROFILE").unwrap_or_default();
                    let dossier = parent.strip_prefix(&profil).unwrap_or(&parent).trim_start_matches('\\').replace('\\', " › ");
                    res.push(FichierTrouve { nom: f.Name()?.to_string(), chemin: p, dossier });
                }
                Ok(())
            })();
            if let Err(e) = r {
                crate::journal!("partout", "recherche dans {chemin} impossible : {e}");
            }
        }
        res
    }

    /// Icône PNG base64 (64 px). Gardée en mémoire (par app, par type de fichier).
    pub fn icone(cle: &str) -> Option<String> {
        static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
        let cache = CACHE.get_or_init(|| Mutex::new(HashMap::new()));
        let (analyse, cle_cache) = if let Some(id) = cle.strip_prefix("app:") {
            (format!("shell:AppsFolder\\{id}"), cle.to_string())
        } else {
            let chemin = cle.strip_prefix("fichier:")?;
            let ext = std::path::Path::new(chemin).extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            // Images, raccourcis et programmes ont chacun leur icône ; sinon une par type.
            let propre = matches!(ext.as_str(), "exe" | "lnk" | "url" | "ico");
            (chemin.to_string(), if propre { cle.to_string() } else { format!("ext:{ext}") })
        };
        if let Some(i) = cache.lock().unwrap().get(&cle_cache) {
            return i.clone();
        }
        let i = image_shell(&analyse);
        cache.lock().unwrap().insert(cle_cache, i.clone());
        i
    }

    fn image_shell(analyse: &str) -> Option<String> {
        use base64::Engine;
        use windows::Win32::Foundation::SIZE;
        use windows::Win32::Graphics::Gdi::*;
        unsafe {
            let item: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(analyse), None).ok()?;
            let bmp = item.GetImage(SIZE { cx: 64, cy: 64 }, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK).ok()?;
            let mut info = BITMAP::default();
            GetObjectW(bmp.into(), std::mem::size_of::<BITMAP>() as i32, Some(&mut info as *mut _ as *mut _));
            let (l, h) = (info.bmWidth.max(1), info.bmHeight.max(1));
            let mut bi = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: l,
                    biHeight: -h, // de haut en bas
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut px = vec![0u8; (l * h * 4) as usize];
            let dc = GetDC(None);
            let lignes = GetDIBits(dc, bmp, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS);
            ReleaseDC(None, dc);
            let _ = DeleteObject(bmp.into());
            if lignes == 0 {
                return None;
            }
            // BGRA (alpha prémultiplié) → RGBA.
            for p in px.chunks_exact_mut(4) {
                let a = p[3] as u32;
                let (b, g, r) = (p[0] as u32, p[1] as u32, p[2] as u32);
                let d = |c: u32| (c * 255).checked_div(a).map_or(0, |x| x.min(255) as u8);
                p[0] = d(r);
                p[1] = d(g);
                p[2] = d(b);
            }
            let img = image::RgbaImage::from_raw(l as u32, h as u32, px)?;
            let mut png = Vec::new();
            img.write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png).ok()?;
            Some(base64::engine::general_purpose::STANDARD.encode(png))
        }
    }

    pub fn ouvrir(cible: &str) -> Result<(), String> {
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let r = unsafe { ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from(cible), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
        if r.0 as isize > 32 {
            Ok(())
        } else {
            Err(format!("ouverture impossible ({})", r.0 as isize))
        }
    }

    pub fn montrer(chemin: &str) -> Result<(), String> {
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
        let args = HSTRING::from(format!("/select,\"{chemin}\""));
        let r = unsafe { ShellExecuteW(None, &HSTRING::from("open"), &HSTRING::from("explorer.exe"), &args, PCWSTR::null(), SW_SHOWNORMAL) };
        if r.0 as isize > 32 {
            Ok(())
        } else {
            Err("Explorateur impossible à ouvrir".into())
        }
    }
}

#[cfg(not(windows))]
mod plateforme {
    use super::{AppTrouvee, FichierTrouve};
    pub fn apps() -> Vec<AppTrouvee> {
        Vec::new()
    }
    pub fn fichiers(_texte: &str) -> Vec<FichierTrouve> {
        Vec::new()
    }
    pub fn icone(_cle: &str) -> Option<String> {
        None
    }
    pub fn ouvrir(_cible: &str) -> Result<(), String> {
        Err("Windows seulement".into())
    }
    pub fn montrer(_chemin: &str) -> Result<(), String> {
        Err("Windows seulement".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn correspondances() {
        assert_eq!(score("Spotify", "spot"), Some(80));
        assert_eq!(score("Visual Studio Code", "studio"), Some(60));
        assert_eq!(score("Visual Studio Code", "vsc"), Some(50));
        assert_eq!(score("Paramètres", "parametres"), Some(100));
        assert_eq!(score("Calculatrice", "zzz"), None);
    }
    #[test]
    fn dossiers_systeme_exclus() {
        assert!(exclu("C:\\Users\\m\\AppData\\Local\\x.txt"));
        assert!(exclu("C:\\Windows\\System32\\a.dll"));
        assert!(exclu("C:\\Users\\m\\Documents\\projet\\node_modules\\a.js"));
        assert!(!exclu("C:\\Users\\m\\Documents\\École\\devoir.docx"));
    }
}
