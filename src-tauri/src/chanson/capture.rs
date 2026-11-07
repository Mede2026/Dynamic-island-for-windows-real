//! Enregistre quelques secondes du son QUI SORT du PC (« bouclage » WASAPI), en mémoire
//! seulement : rien n'est écrit sur le disque. Renvoie du mono, -1..1, et sa fréquence.

#[cfg(windows)]
pub fn enregistrer(duree: std::time::Duration) -> Result<(Vec<f32>, u32), String> {
    use windows::Win32::Media::Audio::{
        eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
        AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_LOOPBACK, WAVEFORMATEX,
        WAVEFORMATEXTENSIBLE,
    };
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    const WAVE_FORMAT_IEEE_FLOAT: u16 = 3;
    const WAVE_FORMAT_EXTENSIBLE: u16 = 0xFFFE;
    // KSDATAFORMAT_SUBTYPE_IEEE_FLOAT
    const SOUS_FORMAT_FLOTTANT: windows::core::GUID =
        windows::core::GUID::from_u128(0x00000003_0000_0010_8000_00aa00389b71);

    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let r = (|| -> windows::core::Result<(Vec<f32>, u32)> {
            let enumerateur: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let sortie = enumerateur.GetDefaultAudioEndpoint(eRender, eConsole)?;
            let client: IAudioClient = sortie.Activate(CLSCTX_ALL, None)?;
            let format: *mut WAVEFORMATEX = client.GetMixFormat()?;
            let f = std::ptr::read_unaligned(format);
            let flottant = f.wFormatTag == WAVE_FORMAT_IEEE_FLOAT
                || (f.wFormatTag == WAVE_FORMAT_EXTENSIBLE
                    && std::ptr::read_unaligned(std::ptr::addr_of!(
                        (*(format as *const WAVEFORMATEXTENSIBLE)).SubFormat
                    )) == SOUS_FORMAT_FLOTTANT);
            let (canaux, frequence, bits) = (f.nChannels as usize, f.nSamplesPerSec, f.wBitsPerSample);
            let init = client.Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK,
                10_000_000,
                0,
                format,
                None,
            );
            CoTaskMemFree(Some(format as *const _));
            init?;
            let capture: IAudioCaptureClient = client.GetService()?;
            client.Start()?;
            let mut son = Vec::with_capacity(frequence as usize * duree.as_secs() as usize + 1);
            let debut = std::time::Instant::now();
            while debut.elapsed() < duree {
                std::thread::sleep(std::time::Duration::from_millis(25));
                while capture.GetNextPacketSize()? > 0 {
                    let mut donnees = std::ptr::null_mut();
                    let (mut images, mut drapeaux) = (0u32, 0u32);
                    capture.GetBuffer(&mut donnees, &mut images, &mut drapeaux, None, None)?;
                    let n = images as usize;
                    if drapeaux & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || donnees.is_null() {
                        son.extend(std::iter::repeat_n(0.0, n));
                    } else if flottant && bits == 32 {
                        let e = std::slice::from_raw_parts(donnees as *const f32, n * canaux);
                        son.extend(e.chunks(canaux).map(|c| c.iter().sum::<f32>() / canaux as f32));
                    } else if bits == 16 {
                        let e = std::slice::from_raw_parts(donnees as *const i16, n * canaux);
                        son.extend(
                            e.chunks(canaux)
                                .map(|c| c.iter().map(|&x| x as f32 / 32768.0).sum::<f32>() / canaux as f32),
                        );
                    } else if bits == 32 {
                        let e = std::slice::from_raw_parts(donnees as *const i32, n * canaux);
                        son.extend(
                            e.chunks(canaux)
                                .map(|c| c.iter().map(|&x| x as f32 / 2_147_483_648.0).sum::<f32>() / canaux as f32),
                        );
                    }
                    capture.ReleaseBuffer(images)?;
                }
            }
            let _ = client.Stop();
            Ok((son, frequence))
        })();
        r.map_err(|e| e.to_string())
    }
}

#[cfg(not(windows))]
pub fn enregistrer(_duree: std::time::Duration) -> Result<(Vec<f32>, u32), String> {
    Err("capture du son : Windows seulement".into())
}
