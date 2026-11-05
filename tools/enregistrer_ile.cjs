/**
 * Enregistre NOTRE île (mode démo dans Chromium) image par image, de façon DÉTERMINISTE :
 * une horloge virtuelle remplace performance.now / Date.now / requestAnimationFrame /
 * setTimeout / setInterval, et avance par pas exacts de 1/120 s. Le vrai code
 * (React + Framer Motion) tourne normalement, simplement « au ralenti » et sans saccade
 * de capture → horodatages exacts, même sur une machine lente.
 *
 *   npx vite --port 1420 &            (serveur de développement)
 *   node tools/enregistrer_ile.cjs    → tools/output/notre_ile/<scenario>/{imgNNNNN.png, temps.json}
 *
 * Échelle des images : ISLAND_SCALE px par point (deviceScaleFactor 1).
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const PAS_MS = 1000 / 120;

const SCENARIOS = {
  // nom: [[instant (ms), scénario], ...] — reproduit les vidéos de référence.
  ouvrir_fermer: [[600, "musique"], [2200, "etendre"], [4400, "fermer"], [5900, null]],
  split: [[600, "musique"], [2200, "minuteur"], [4000, "finMinuteur"], [5500, null]],
  alerte: [[600, "musique"], [2200, "charge"], [6400, null]],
  repos: [[600, "musique"], [2200, "finMusique"], [3400, null]],
};

const HORLOGE_VIRTUELLE = () => {
  // Framer Motion confie opacité/flou à l'API Web Animations (horloge RÉELLE du navigateur) :
  // on la retire pour que toutes les animations suivent l'horloge virtuelle.
  delete Element.prototype.animate;
  let t = 0;
  let id = 1;
  let rafs = [];
  let minuteries = [];
  const D0 = Date.now();
  performance.now = () => t;
  Date.now = () => D0 + t;
  window.requestAnimationFrame = (cb) => {
    rafs.push({ i: ++id, cb });
    return id;
  };
  window.cancelAnimationFrame = (i) => {
    rafs = rafs.filter((r) => r.i !== i);
  };
  window.setTimeout = (cb, ms = 0, ...a) => {
    const i = ++id;
    minuteries.push({ i, a: t + Math.max(ms, 0), cb: () => cb(...a) });
    return i;
  };
  window.clearTimeout = (i) => {
    minuteries = minuteries.filter((m) => m.i !== i);
  };
  window.setInterval = (cb, ms = 0, ...a) => {
    const i = ++id;
    const relancer = () => {
      minuteries.push({ i, a: t + Math.max(ms, 1), cb: () => (cb(...a), relancer()) });
    };
    relancer();
    return i;
  };
  window.clearInterval = window.clearTimeout;
  window.__avancer = (ms) => {
    const fin = t + ms;
    for (;;) {
      minuteries.sort((x, y) => x.a - y.a);
      const m = minuteries[0];
      if (!m || m.a > fin) break;
      minuteries.shift();
      t = m.a;
      m.cb();
    }
    t = fin;
    const r = rafs;
    rafs = [];
    r.forEach((x) => x.cb(t));
    return t;
  };
};

(async () => {
  const url = process.env.URL || "http://localhost:1420/?demo";
  const sortie = path.join(__dirname, "output", "notre_ile");
  const navigateur = await chromium.launch();
  for (const [nom, etapes] of Object.entries(SCENARIOS)) {
    const dossier = path.join(sortie, nom);
    fs.rmSync(dossier, { recursive: true, force: true });
    fs.mkdirSync(dossier, { recursive: true });
    const page = await navigateur.newPage({ viewport: { width: 520, height: 330 }, deviceScaleFactor: 1 });
    await page.addInitScript(HORLOGE_VIRTUELLE);
    await page.goto(url);
    await page.waitForFunction(() => window.__ile !== undefined);
    // Laisser React, les polices et Framer Motion s'installer.
    for (let k = 0; k < 30; k++) await page.evaluate((p) => window.__avancer(p), PAS_MS);
    await page.evaluate(() => document.fonts.ready);

    const temps = [];
    const fin = etapes[etapes.length - 1][0];
    let prochaine = 0;
    for (let n = 0, t = 0; t <= fin; n++, t = n * PAS_MS) {
      while (prochaine < etapes.length && etapes[prochaine][0] <= t) {
        const sc = etapes[prochaine][1];
        if (sc) await page.evaluate((s) => window.__ile.jouer(s), sc);
        prochaine++;
      }
      await page.evaluate((p) => window.__avancer(p), PAS_MS);
      await page.screenshot({ path: path.join(dossier, `img${String(n).padStart(5, "0")}.png`) });
      temps.push(t + PAS_MS);
    }
    fs.writeFileSync(path.join(dossier, "temps.json"), JSON.stringify(temps));
    console.log(`${nom}: ${temps.length} images à 120 i/s (horloge virtuelle)`);
    await page.close();
  }
  await navigateur.close();
})();
