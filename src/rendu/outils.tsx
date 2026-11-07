/**
 * Outils ouverts DANS l'île (plus de fenêtres) : recherche, minuteur rapide, copiés récemment,
 * note. L'île prend la forme « outil » (formesContenu.outil) ; le titre est rangé à gauche de la
 * caméra, le contenu dessous. Échap ou un clic à côté referme l'outil.
 */

import type { ReactNode } from "react";
import { v } from "../config/store";
import { ContenuRecherche } from "../recherche/Recherche";
import { Lanceur } from "../lanceur/Lanceur";
import { Historique } from "../historique/Historique";
import { Note } from "../note/Note";
import { texte, type Ctx } from "./contenus";

export type NomOutil = "recherche" | "minuteur" | "copies" | "note";

const OUTILS: Record<NomOutil, { titre: string; couleur: string }> = {
  recherche: { titre: "Recherche", couleur: "#ffd60a" },
  minuteur: { titre: "Minuteur", couleur: "#ff8c2b" },
  copies: { titre: "Copiés", couleur: "#bf5af2" },
  note: { titre: "Note", couleur: "#ffd60a" },
};

export function estOutil(x: unknown): x is NomOutil {
  return typeof x === "string" && x in OUTILS;
}

/** Ferme l'outil ouvert (pont.ts écoute cet événement). */
export function fermerOutil() {
  window.dispatchEvent(new CustomEvent("ile-outil-fermer"));
}

export function OutilEtendu({ cfg, S, etat }: Ctx) {
  const act = etat.activites.find((a) => a.type === "outil");
  const nom = (act?.donnees as { outil?: unknown } | undefined)?.outil;
  if (!estOutil(nom)) return null;
  const forme = cfg.formesContenu.outil.taille.pt;
  const largeur = v(forme.largeur);
  const hauteur = v(forme.hauteur);
  const marge = 16;
  const haut = v(cfg.zoneCamera.hauteurPt) + 6;
  const a = cfg.alerte;
  const { titre, couleur } = OUTILS[nom];
  let contenu: ReactNode;
  if (nom === "recherche") contenu = <ContenuRecherche fermer={fermerOutil} dansIle />;
  else if (nom === "minuteur") contenu = <Lanceur fermer={fermerOutil} dansIle />;
  else if (nom === "copies") contenu = <Historique fermer={fermerOutil} dansIle />;
  else contenu = <Note fermer={fermerOutil} dansIle />;
  return (
    <>
      <div style={texte(a.texte, S, { left: (marge + 6) * S, top: (v(cfg.zoneCamera.hauteurPt) / 2 - v(a.texte.taillePt) * 0.62) * S, color: couleur })}>{titre}</div>
      <div
        // Le contenu est dessiné en px « fenêtre » puis mis à l'échelle de l'île (zoom = S).
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        style={{
          position: "absolute",
          left: marge * S,
          top: haut * S,
          width: largeur - 2 * marge,
          height: hauteur - haut - marge,
          zoom: S,
          pointerEvents: "auto",
          color: "#fff",
          cursor: "default",
          userSelect: "text",
        }}
      >
        {contenu}
      </div>
    </>
  );
}
