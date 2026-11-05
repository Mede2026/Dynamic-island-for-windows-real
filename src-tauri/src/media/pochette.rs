//! Pochette d'album : conversion en PNG base64 + couleur dominante
//! (pour la lueur et l'onde sonore en phase 2). Code pur, testé sur toutes les plateformes.

use base64::Engine;
use image::{imageops::FilterType, DynamicImage, ImageFormat, RgbaImage};
use serde::Serialize;
use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::io::Cursor;

#[derive(Clone, Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Pochette {
    pub id: String,
    pub png_base64: String,
    /// Couleur dominante [rouge, vert, bleu] de 0 à 255.
    pub couleur_dominante: [u8; 3],
}

/// Identifiant court qui change quand les octets de l'image changent.
pub fn identifiant(octets: &[u8]) -> String {
    let mut h = DefaultHasher::new();
    octets.hash(&mut h);
    format!("{:016x}", h.finish())
}

/// Octets d'image (JPEG, PNG, BMP…) → Pochette.
pub fn traiter(octets: &[u8]) -> Result<Pochette, String> {
    let img = image::load_from_memory(octets).map_err(|e| format!("image illisible : {e}"))?;
    let mut png = Vec::new();
    img.write_to(&mut Cursor::new(&mut png), ImageFormat::Png)
        .map_err(|e| format!("encodage PNG impossible : {e}"))?;
    Ok(Pochette {
        id: identifiant(octets),
        png_base64: base64::engine::general_purpose::STANDARD.encode(&png),
        couleur_dominante: couleur_dominante(&img),
    })
}

/// Couleur dominante « vive » :
/// - on réduit l'image (64 px max) pour aller vite ;
/// - on range chaque pixel dans une case de couleur (16 niveaux par canal) ;
/// - les pixels presque gris, presque noirs ou transparents comptent à part ;
/// - la case la plus remplie (pondérée par la saturation) gagne ; on renvoie sa couleur moyenne.
///
/// Si l'image est presque entièrement grise, on renvoie la moyenne de tous les pixels.
pub fn couleur_dominante(img: &DynamicImage) -> [u8; 3] {
    let petite: RgbaImage = if img.width() > 64 || img.height() > 64 {
        img.resize(64, 64, FilterType::Triangle).to_rgba8()
    } else {
        img.to_rgba8()
    };

    #[derive(Default)]
    struct Case {
        poids: f64,
        somme: [f64; 3],
    }
    let mut cases: HashMap<(u8, u8, u8), Case> = HashMap::new();
    let mut total = [0f64; 3];
    let (mut n_total, mut n_vifs) = (0usize, 0usize);

    for p in petite.pixels() {
        let [r, g, b, a] = p.0;
        if a < 128 {
            continue;
        }
        n_total += 1;
        for (t, c) in total.iter_mut().zip([r, g, b]) {
            *t += c as f64;
        }
        let max = r.max(g).max(b) as f64;
        let min = r.min(g).min(b) as f64;
        let valeur = max / 255.0;
        let saturation = if max > 0.0 { (max - min) / max } else { 0.0 };
        if saturation < 0.2 || valeur < 0.15 {
            continue;
        }
        n_vifs += 1;
        let case = cases.entry((r >> 4, g >> 4, b >> 4)).or_default();
        let poids = 0.5 + saturation;
        case.poids += poids;
        for (s, c) in case.somme.iter_mut().zip([r, g, b]) {
            *s += c as f64 * poids;
        }
    }

    if n_total == 0 {
        return [0, 0, 0];
    }
    // Moins de 5 % de pixels vifs : l'image est essentiellement grise.
    if n_vifs * 20 < n_total {
        return total.map(|t| (t / n_total as f64).round() as u8);
    }
    let meilleure = cases
        .values()
        .max_by(|a, b| a.poids.total_cmp(&b.poids))
        .expect("au moins une case vive");
    meilleure.somme.map(|s| (s / meilleure.poids).round() as u8)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{Rgba, RgbaImage};

    fn image_deux_couleurs(c1: [u8; 3], part1: u32, c2: [u8; 3]) -> DynamicImage {
        let mut img = RgbaImage::new(100, 100);
        for (x, _y, p) in img.enumerate_pixels_mut() {
            let c = if x < part1 { c1 } else { c2 };
            *p = Rgba([c[0], c[1], c[2], 255]);
        }
        DynamicImage::ImageRgba8(img)
    }

    fn proche(a: [u8; 3], b: [u8; 3]) -> bool {
        a.iter().zip(b).all(|(x, y)| (*x as i32 - y as i32).abs() <= 8)
    }

    #[test]
    fn la_couleur_majoritaire_gagne() {
        let img = image_deux_couleurs([220, 30, 40], 70, [30, 60, 200]);
        assert!(
            proche(couleur_dominante(&img), [220, 30, 40]),
            "{:?}",
            couleur_dominante(&img)
        );
    }

    #[test]
    fn le_noir_et_le_gris_sont_ignores_si_une_couleur_vive_existe() {
        // 80 % noir, 20 % orange → orange.
        let img = image_deux_couleurs([5, 5, 5], 80, [250, 140, 20]);
        assert!(
            proche(couleur_dominante(&img), [250, 140, 20]),
            "{:?}",
            couleur_dominante(&img)
        );
    }

    #[test]
    fn image_grise_donne_la_moyenne() {
        let img = image_deux_couleurs([100, 100, 100], 50, [200, 200, 200]);
        assert!(
            proche(couleur_dominante(&img), [150, 150, 150]),
            "{:?}",
            couleur_dominante(&img)
        );
    }

    #[test]
    fn image_transparente() {
        let img = DynamicImage::ImageRgba8(RgbaImage::new(10, 10));
        assert_eq!(couleur_dominante(&img), [0, 0, 0]);
    }

    #[test]
    fn jpeg_vers_png_base64() {
        let img = image_deux_couleurs([10, 200, 90], 100, [0, 0, 0]);
        let mut jpeg = Vec::new();
        img.to_rgb8()
            .write_to(&mut Cursor::new(&mut jpeg), ImageFormat::Jpeg)
            .unwrap();

        let p = traiter(&jpeg).unwrap();
        let png = base64::engine::general_purpose::STANDARD.decode(&p.png_base64).unwrap();
        assert_eq!(&png[1..4], b"PNG");
        assert!(proche(p.couleur_dominante, [10, 200, 90]), "{:?}", p.couleur_dominante);
        assert_eq!(p.id, identifiant(&jpeg));
        assert!(traiter(b"pas une image").is_err());
    }
}
