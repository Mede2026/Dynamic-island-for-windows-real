//! VPN connecté / déconnecté : une carte réseau de VPN (WireGuard, OpenVPN, NordVPN, Proton,
//! Cisco, Fortinet…) qui passe « active » ou non. Relevé toutes les 4 s (lecture seulement).

use serde::Serialize;
use tauri::AppHandle;

#[cfg(windows)]
use crate::journal;

pub const EVENEMENT: &str = "vpn";

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Vpn {
    pub connecte: bool,
    pub nom: Option<String>,
}

/// Carte réseau de VPN ? (type PPP, ou nom reconnu).
pub fn est_vpn(type_carte: u32, nom: &str, description: &str) -> bool {
    const PPP: u32 = 23;
    let t = format!("{nom} {description}").to_lowercase();
    type_carte == PPP
        || [
            "vpn",
            "wireguard",
            "openvpn",
            "tap-windows",
            "wintun",
            "nordlynx",
            "proton",
            "anyconnect",
            "fortinet",
            "globalprotect",
            "pangp",
            "zerotier",
            "tailscale",
        ]
        .iter()
        .any(|m| t.contains(m))
}

#[cfg(windows)]
fn vpn_actif() -> Option<String> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
    };
    use windows::Win32::Networking::WinSock::AF_UNSPEC;
    unsafe {
        let mut taille = 16_000u32;
        let mut tampon = vec![0u8; taille as usize];
        let drapeaux = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST;
        let mut r = GetAdaptersAddresses(
            AF_UNSPEC.0 as u32,
            drapeaux,
            None,
            Some(tampon.as_mut_ptr() as *mut _),
            &mut taille,
        );
        if r == 111 {
            // ERROR_BUFFER_OVERFLOW : agrandir.
            tampon = vec![0u8; taille as usize];
            r = GetAdaptersAddresses(
                AF_UNSPEC.0 as u32,
                drapeaux,
                None,
                Some(tampon.as_mut_ptr() as *mut _),
                &mut taille,
            );
        }
        if r != 0 {
            return None;
        }
        let mut p = tampon.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
        while let Some(a) = p.as_ref() {
            let nom = a.FriendlyName.to_string().unwrap_or_default();
            let desc = a.Description.to_string().unwrap_or_default();
            if a.OperStatus.0 == 1 && est_vpn(a.IfType, &nom, &desc) {
                return Some(if nom.is_empty() { desc } else { nom });
            }
            p = a.Next;
        }
        None
    }
}

#[cfg(windows)]
pub fn demarrer(app: AppHandle) {
    use tauri::Emitter;
    std::thread::Builder::new()
        .name("ile-vpn".into())
        .spawn(move || {
            let mut avant = vpn_actif();
            journal!("vpn", "prêt ({:?})", avant);
            loop {
                std::thread::sleep(std::time::Duration::from_secs(4));
                let maintenant = vpn_actif();
                if maintenant.is_some() != avant.is_some() {
                    journal!("vpn", "connecté={}", maintenant.is_some());
                    let _ = app.emit(
                        EVENEMENT,
                        Vpn {
                            connecte: maintenant.is_some(),
                            nom: maintenant.clone().or(avant.clone()),
                        },
                    );
                }
                avant = maintenant;
            }
        })
        .ok();
}

#[cfg(not(windows))]
pub fn demarrer(_app: AppHandle) {}

#[cfg(test)]
mod tests {
    #[test]
    fn reconnaissance() {
        assert!(super::est_vpn(53, "NordLynx", "NordLynx Tunnel"));
        assert!(super::est_vpn(23, "Connexion", ""));
        assert!(!super::est_vpn(71, "Wi-Fi", "Intel Wi-Fi 6E AX211"));
    }
}
