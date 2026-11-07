//! Texte d'une image : reconnaissance de texte (OCR) de Windows sur l'image du presse-papiers
//! (ex. une capture Win+Maj+S), dans la langue de Windows. Tout se fait sur le PC.

/// Lit l'image du presse-papiers, en extrait le texte et le recopie. Renvoie le texte.
#[tauri::command]
pub async fn ocr_presse_papiers() -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(win::lire_et_copier)
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
mod win {
    use windows::Graphics::Imaging::{BitmapDecoder, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::{DataWriter, InMemoryRandomAccessStream};
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};

    const CF_DIB: u32 = 8;

    fn dib() -> Option<Vec<u8>> {
        unsafe {
            OpenClipboard(None).ok()?;
            let r = (|| {
                let h = GetClipboardData(CF_DIB).ok()?;
                let g = HGLOBAL(h.0);
                let taille = GlobalSize(g);
                let p = GlobalLock(g) as *const u8;
                if p.is_null() || taille == 0 {
                    return None;
                }
                let v = std::slice::from_raw_parts(p, taille).to_vec();
                let _ = GlobalUnlock(g);
                Some(v)
            })();
            let _ = CloseClipboard();
            r
        }
    }

    fn reconnaitre(bmp: &[u8]) -> windows::core::Result<String> {
        let flux = InMemoryRandomAccessStream::new()?;
        let ecrivain = DataWriter::CreateDataWriter(&flux)?;
        ecrivain.WriteBytes(bmp)?;
        ecrivain.StoreAsync()?.join()?;
        ecrivain.DetachStream()?;
        flux.Seek(0)?;
        let image = BitmapDecoder::CreateAsync(&flux)?
            .join()?
            .GetSoftwareBitmapAsync()?
            .join()?;
        let image = SoftwareBitmap::Convert(&image, BitmapPixelFormat::Bgra8)?;
        let moteur = OcrEngine::TryCreateFromUserProfileLanguages()?;
        let resultat = moteur.RecognizeAsync(&image)?.join()?;
        // Une ligne par ligne reconnue (plus lisible que le texte collé d'un bloc).
        let mut lignes = Vec::new();
        for l in resultat.Lines()? {
            lignes.push(l.Text()?.to_string());
        }
        Ok(lignes.join("\n"))
    }

    pub fn lire_et_copier() -> Result<String, String> {
        let dib = dib().ok_or("aucune image dans le presse-papiers")?;
        let bmp = super::super::presse_papiers::dib_vers_bmp(&dib).ok_or("image illisible")?;
        let texte = reconnaitre(&bmp).map_err(|e| e.to_string())?;
        if texte.trim().is_empty() {
            return Err("aucun texte trouvé".into());
        }
        super::super::ecrire::copier_texte(texte.clone())?;
        crate::journal!("ocr", "{} caractères reconnus", texte.len());
        Ok(texte)
    }
}

#[cfg(not(windows))]
mod win {
    pub fn lire_et_copier() -> Result<String, String> {
        Err("Windows seulement".into())
    }
}
