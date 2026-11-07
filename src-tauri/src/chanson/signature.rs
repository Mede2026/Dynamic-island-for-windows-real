//! Empreinte audio au format de Shazam : on garde seulement des PICS de fréquence (jamais
//! l'enregistrement), regroupés en 4 bandes, puis encodés en binaire. Algorithme décrit
//! publiquement (projet SongRec) ; réécrit ici.
//!
//! Entrée : son mono à 16 000 Hz (entiers 16 bits), quelques secondes.

const TAILLE_FFT: usize = 2048;
const CASES: usize = TAILLE_FFT / 2 + 1; // 1025
const HISTORIQUE: usize = 256;
pub const FREQUENCE_ECHANTILLONNAGE: u32 = 16_000;

#[derive(Clone, Debug, PartialEq)]
pub struct Pic {
    pub passe: u32,
    pub amplitude: u16,
    pub frequence_corrigee: u16,
}

/// FFT complexe en place (radix 2), taille puissance de 2.
fn fft(re: &mut [f32], im: &mut [f32]) {
    let n = re.len();
    let mut j = 0;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j |= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut longueur = 2;
    while longueur <= n {
        let angle = -2.0 * std::f32::consts::PI / longueur as f32;
        let (wr, wi) = (angle.cos(), angle.sin());
        for debut in (0..n).step_by(longueur) {
            let (mut cr, mut ci) = (1.0f32, 0.0f32);
            for k in 0..longueur / 2 {
                let (a, b) = (debut + k, debut + k + longueur / 2);
                let tr = re[b] * cr - im[b] * ci;
                let ti = re[b] * ci + im[b] * cr;
                re[b] = re[a] - tr;
                im[b] = im[a] - ti;
                re[a] += tr;
                im[a] += ti;
                let ncr = cr * wr - ci * wi;
                ci = cr * wi + ci * wr;
                cr = ncr;
            }
        }
        longueur <<= 1;
    }
}

pub struct Generateur {
    echantillons: Vec<i16>, // anneau de 2048
    position: usize,
    ffts: Vec<Vec<f32>>,   // anneau de 256 spectres
    etales: Vec<Vec<f32>>, // anneau de 256 spectres « étalés »
    index: usize,
    passes: u32,
    fenetre: Vec<f32>,
    pub bandes: [Vec<Pic>; 4],
    pub nombre_echantillons: u32,
}

impl Default for Generateur {
    fn default() -> Self {
        Self {
            echantillons: vec![0; TAILLE_FFT],
            position: 0,
            ffts: vec![vec![0.0; CASES]; HISTORIQUE],
            etales: vec![vec![0.0; CASES]; HISTORIQUE],
            index: 0,
            passes: 0,
            fenetre: (0..TAILLE_FFT)
                .map(|i| 0.5 - 0.5 * (2.0 * std::f32::consts::PI * (i as f32 + 1.0) / 2049.0).cos())
                .collect(),
            bandes: Default::default(),
            nombre_echantillons: 0,
        }
    }
}

impl Generateur {
    /// Ajoute du son (16 kHz mono) ; traité par paquets de 128 échantillons.
    pub fn ajouter(&mut self, son: &[i16]) {
        for paquet in son.chunks_exact(128) {
            self.nombre_echantillons += 128;
            for &e in paquet {
                self.echantillons[self.position] = e;
                self.position = (self.position + 1) % TAILLE_FFT;
            }
            self.calculer_fft();
            self.etaler();
            if self.passes >= 46 {
                self.chercher_pics();
            }
            self.index = (self.index + 1) % HISTORIQUE;
        }
    }

    fn calculer_fft(&mut self) {
        let mut re = vec![0.0f32; TAILLE_FFT];
        let mut im = vec![0.0f32; TAILLE_FFT];
        for (i, r) in re.iter_mut().enumerate() {
            *r = self.echantillons[(self.position + i) % TAILLE_FFT] as f32 * self.fenetre[i];
        }
        fft(&mut re, &mut im);
        let sortie = &mut self.ffts[self.index];
        for k in 0..CASES {
            sortie[k] = ((re[k] * re[k] + im[k] * im[k]) / (1u32 << 17) as f32).max(1e-10);
        }
        self.passes += 1;
    }

    fn etaler(&mut self) {
        let mut etale = self.ffts[self.index].clone();
        for p in 0..=CASES - 3 {
            etale[p] = etale[p].max(etale[p + 1]).max(etale[p + 2]);
        }
        for decalage in [1usize, 3, 6] {
            let ancien = &mut self.etales[(self.index + HISTORIQUE - decalage) % HISTORIQUE];
            for p in 0..CASES {
                ancien[p] = ancien[p].max(etale[p]);
            }
        }
        self.etales[self.index] = etale;
    }

    fn chercher_pics(&mut self) {
        let a = |n: usize| (self.index + HISTORIQUE - n) % HISTORIQUE;
        let fft46 = &self.ffts[a(46)];
        let etale49 = &self.etales[a(49)];
        for case in 10..1015usize {
            let v = fft46[case];
            if v < 1.0 / 64.0 || v < etale49[case - 1] {
                continue;
            }
            let mut voisins = 0.0f32;
            for d in [-10i32, -7, -4, -3, 1, 2, 5, 8] {
                voisins = voisins.max(etale49[(case as i32 + d) as usize]);
            }
            if v <= voisins {
                continue;
            }
            let mut autres = voisins;
            for d in [-53i32, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249] {
                let i = ((self.index as i32 + d).rem_euclid(HISTORIQUE as i32)) as usize;
                autres = autres.max(self.etales[i][case - 1]);
            }
            if v <= autres {
                continue;
            }
            let ampl = |x: f32| x.max(1.0 / 64.0).ln() * 1477.3 + 6144.0;
            let pic = ampl(v);
            let avant = ampl(fft46[case - 1]);
            let apres = ampl(fft46[case + 1]);
            let variation1 = pic * 2.0 - avant - apres;
            let variation2 = (apres - avant) * 32.0 / variation1;
            let corrigee = case as f32 * 64.0 + variation2;
            let hz = corrigee * (FREQUENCE_ECHANTILLONNAGE as f32 / 2.0 / 1024.0 / 64.0);
            let bande = match hz {
                f if (250.0..520.0).contains(&f) => 0,
                f if (520.0..1450.0).contains(&f) => 1,
                f if (1450.0..3500.0).contains(&f) => 2,
                f if (3500.0..=5500.0).contains(&f) => 3,
                _ => continue,
            };
            self.bandes[bande].push(Pic {
                passe: self.passes - 46,
                amplitude: pic as u16,
                frequence_corrigee: corrigee as u16,
            });
        }
    }

    pub fn nombre_pics(&self) -> usize {
        self.bandes.iter().map(Vec::len).sum()
    }

    /// Empreinte binaire, en adresse `data:` prête à envoyer.
    pub fn encoder(&self) -> String {
        format!("data:audio/vnd.shazam.sig;base64,{}", base64(&self.binaire()))
    }

    pub fn binaire(&self) -> Vec<u8> {
        let mut contenu = Vec::new();
        for (i, pics) in self.bandes.iter().enumerate() {
            if pics.is_empty() {
                continue;
            }
            let mut tampon = Vec::new();
            let mut derniere = 0u32;
            for p in pics {
                if p.passe - derniere >= 255 {
                    tampon.push(0xff);
                    tampon.extend_from_slice(&p.passe.to_le_bytes());
                    derniere = p.passe;
                }
                tampon.push((p.passe - derniere) as u8);
                tampon.extend_from_slice(&p.amplitude.to_le_bytes());
                tampon.extend_from_slice(&p.frequence_corrigee.to_le_bytes());
                derniere = p.passe;
            }
            contenu.extend_from_slice(&(0x6003_0040u32 + i as u32).to_le_bytes());
            contenu.extend_from_slice(&(tampon.len() as u32).to_le_bytes());
            while tampon.len() % 4 != 0 {
                tampon.push(0);
            }
            contenu.extend_from_slice(&tampon);
        }
        let mut sortie = Vec::with_capacity(56 + contenu.len());
        let entete_taille = 48;
        let total = entete_taille + 8 + contenu.len();
        sortie.extend_from_slice(&0xcafe_2580u32.to_le_bytes());
        sortie.extend_from_slice(&0u32.to_le_bytes()); // CRC32, plus bas
        sortie.extend_from_slice(&((total - entete_taille) as u32).to_le_bytes());
        sortie.extend_from_slice(&0x9411_9c00u32.to_le_bytes());
        sortie.extend_from_slice(&[0u8; 12]);
        sortie.extend_from_slice(&(3u32 << 27).to_le_bytes()); // 16 000 Hz
        sortie.extend_from_slice(&[0u8; 8]);
        let n = self.nombre_echantillons as f32 + FREQUENCE_ECHANTILLONNAGE as f32 * 0.24;
        sortie.extend_from_slice(&(n as u32).to_le_bytes());
        sortie.extend_from_slice(&((15u32 << 19) + 0x40000).to_le_bytes());
        sortie.extend_from_slice(&0x4000_0000u32.to_le_bytes());
        sortie.extend_from_slice(&((total - entete_taille) as u32).to_le_bytes());
        sortie.extend_from_slice(&contenu);
        let crc = crc32(&sortie[8..]);
        sortie[4..8].copy_from_slice(&crc.to_le_bytes());
        sortie
    }
}

pub fn crc32(octets: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for &o in octets {
        crc ^= o as u32;
        for _ in 0..8 {
            crc = if crc & 1 != 0 {
                (crc >> 1) ^ 0xedb8_8320
            } else {
                crc >> 1
            };
        }
    }
    !crc
}

pub fn base64(octets: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut s = String::with_capacity(octets.len().div_ceil(3) * 4);
    for bloc in octets.chunks(3) {
        let n = (bloc[0] as u32) << 16 | (*bloc.get(1).unwrap_or(&0) as u32) << 8 | *bloc.get(2).unwrap_or(&0) as u32;
        s.push(T[(n >> 18) as usize & 63] as char);
        s.push(T[(n >> 12) as usize & 63] as char);
        s.push(if bloc.len() > 1 {
            T[(n >> 6) as usize & 63] as char
        } else {
            '='
        });
        s.push(if bloc.len() > 2 {
            T[n as usize & 63] as char
        } else {
            '='
        });
    }
    s
}

/// Ramène du son (mono, `frequence` Hz, -1..1) à 16 kHz en entiers 16 bits.
pub fn reechantillonner(son: &[f32], frequence: u32) -> Vec<i16> {
    if son.is_empty() || frequence == 0 {
        return Vec::new();
    }
    let rapport = frequence as f64 / FREQUENCE_ECHANTILLONNAGE as f64;
    let n = (son.len() as f64 / rapport) as usize;
    let largeur = rapport.max(1.0) as usize; // moyenne sur la fenêtre (filtre passe-bas simple)
    (0..n)
        .map(|i| {
            let debut = (i as f64 * rapport) as usize;
            let fin = (debut + largeur).min(son.len());
            let moyenne = son[debut..fin].iter().sum::<f32>() / (fin - debut).max(1) as f32;
            (moyenne.clamp(-1.0, 1.0) * 32767.0) as i16
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn crc_et_base64() {
        assert_eq!(crc32(b"123456789"), 0xcbf4_3926);
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(base64(b"Ma"), "TWE=");
    }

    #[test]
    fn fft_d_un_sinus() {
        let n = 64;
        let mut re: Vec<f32> = (0..n)
            .map(|i| (2.0 * std::f32::consts::PI * 5.0 * i as f32 / n as f32).cos())
            .collect();
        let mut im = vec![0.0; n];
        fft(&mut re, &mut im);
        let max = (0..n / 2)
            .max_by(|&a, &b| re[a].hypot(im[a]).total_cmp(&re[b].hypot(im[b])))
            .unwrap();
        assert_eq!(max, 5);
    }

    #[test]
    fn pics_d_une_melodie() {
        // Notes qui changent toutes les 0,25 s : des pics dans plusieurs bandes.
        let notes = [440.0f32, 660.0, 880.0, 1320.0, 2000.0, 3000.0, 4000.0, 550.0];
        let son: Vec<i16> = (0..16_000 * 4)
            .map(|i| {
                let f = notes[(i / 4000) % notes.len()];
                ((2.0 * std::f32::consts::PI * f * i as f32 / 16_000.0).sin() * 12_000.0) as i16
            })
            .collect();
        let mut g = Generateur::default();
        g.ajouter(&son);
        assert!(g.nombre_pics() > 10, "{} pics", g.nombre_pics());
        let b = g.binaire();
        assert_eq!(&b[0..4], &0xcafe_2580u32.to_le_bytes());
        assert_eq!(u32::from_le_bytes(b[4..8].try_into().unwrap()), crc32(&b[8..]));
        assert_eq!(u32::from_le_bytes(b[8..12].try_into().unwrap()) as usize, b.len() - 48);
        assert!(g.encoder().starts_with("data:audio/vnd.shazam.sig;base64,"));
    }

    #[test]
    fn reechantillonnage() {
        let son = vec![0.5f32; 48_000];
        let r = reechantillonner(&son, 48_000);
        assert_eq!(r.len(), 16_000);
        assert!((r[100] - 16383).abs() <= 1);
    }
}
