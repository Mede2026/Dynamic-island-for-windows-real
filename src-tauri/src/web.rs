//! Requêtes HTTP (paroles, recherche rapide, reconnaissance de chanson) faites par le
//! backend avec le client HTTP de Windows : pas de dépendance en plus, et pas de blocage
//! « CORS » comme dans la page.

/// Identité envoyée aux services (LRCLIB demande un User-Agent qui nomme l'app).
pub const AGENT: &str = "DynamicIslandForWindows/0.1 (https://github.com/Mede2026/Dynamic-island-for-windows-real)";

/// Réponse : code HTTP et corps (texte).
pub type Reponse = (u16, String);

/// Encode une valeur pour une adresse (`a b` → `a%20b`).
pub fn encoder(texte: &str) -> String {
    let mut s = String::new();
    for o in texte.bytes() {
        match o {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => s.push(o as char),
            _ => s.push_str(&format!("%{o:02X}")),
        }
    }
    s
}

#[cfg(windows)]
fn client(entetes: &[(&str, &str)]) -> windows::core::Result<windows::Web::Http::HttpClient> {
    use windows::core::HSTRING;
    let client = windows::Web::Http::HttpClient::new()?;
    let defaut = client.DefaultRequestHeaders()?;
    defaut.UserAgent()?.TryParseAdd(&HSTRING::from(AGENT))?;
    for (nom, valeur) in entetes {
        defaut.TryAppendWithoutValidation(&HSTRING::from(*nom), &HSTRING::from(*valeur))?;
    }
    Ok(client)
}

#[cfg(windows)]
pub fn get(url: &str, entetes: &[(&str, &str)]) -> Result<Reponse, String> {
    use windows::core::HSTRING;
    use windows::Foundation::Uri;
    (|| -> windows::core::Result<Reponse> {
        let rep = client(entetes)?
            .GetAsync(&Uri::CreateUri(&HSTRING::from(url))?)?
            .join()?;
        let code = rep.StatusCode()?.0 as u16;
        let corps = rep.Content()?.ReadAsStringAsync()?.join()?.to_string();
        Ok((code, corps))
    })()
    .map_err(|e| e.to_string())
}

#[cfg(windows)]
pub fn post_json(url: &str, corps: &str, entetes: &[(&str, &str)]) -> Result<Reponse, String> {
    use windows::core::HSTRING;
    use windows::Foundation::Uri;
    use windows::Storage::Streams::UnicodeEncoding;
    use windows::Web::Http::HttpStringContent;
    (|| -> windows::core::Result<Reponse> {
        let contenu = HttpStringContent::CreateFromStringWithEncodingAndMediaType(
            &HSTRING::from(corps),
            UnicodeEncoding::Utf8,
            &HSTRING::from("application/json"),
        )?;
        let rep = client(entetes)?
            .PostAsync(&Uri::CreateUri(&HSTRING::from(url))?, &contenu)?
            .join()?;
        let code = rep.StatusCode()?.0 as u16;
        let texte = rep.Content()?.ReadAsStringAsync()?.join()?.to_string();
        Ok((code, texte))
    })()
    .map_err(|e| e.to_string())
}

#[cfg(not(windows))]
pub fn get(_url: &str, _entetes: &[(&str, &str)]) -> Result<Reponse, String> {
    Err("requêtes web : Windows seulement".into())
}

#[cfg(not(windows))]
pub fn post_json(_url: &str, _corps: &str, _entetes: &[(&str, &str)]) -> Result<Reponse, String> {
    Err("requêtes web : Windows seulement".into())
}

#[cfg(test)]
mod tests {
    #[test]
    fn encodage() {
        assert_eq!(super::encoder("Pedro Jaxomy"), "Pedro%20Jaxomy");
        assert_eq!(super::encoder("Été & co"), "%C3%89t%C3%A9%20%26%20co");
    }
}
