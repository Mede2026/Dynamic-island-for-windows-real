import { describe, expect, it } from "vitest";
import { cheminIle, retraitCoin } from "./squircle";

function points(d: string): [number, number][] {
  return [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("squircle", () => {
  it("cercle (n = 2) : retrait identique à un arc de rayon a", () => {
    const a = 20;
    for (const d of [1, 5, 10, 15]) {
      expect(retraitCoin(d, a, 2)).toBeCloseTo(a - Math.sqrt(a * a - (a - d) ** 2), 6);
    }
    expect(retraitCoin(25, a, 2)).toBe(0);
  });

  it("le chemin reste dans le rectangle et le touche sur les 4 côtés", () => {
    const p = points(cheminIle(10, 5, 374, 205, 69.5, 3.12));
    const xs = p.map((q) => q[0]);
    const ys = p.map((q) => q[1]);
    expect(Math.min(...xs)).toBeCloseTo(10, 1);
    expect(Math.max(...xs)).toBeCloseTo(384, 1);
    expect(Math.min(...ys)).toBeCloseTo(5, 1);
    expect(Math.max(...ys)).toBeCloseTo(210, 1);
  });

  it("capsule (a > h/2) : coupée proprement à mi-hauteur", () => {
    const p = points(cheminIle(0, 0, 125.5, 36.8, 22.4, 2.55));
    expect(Math.max(...p.map((q) => q[1]))).toBeCloseTo(36.8, 1);
    expect(Math.min(...p.map((q) => q[0]))).toBeGreaterThanOrEqual(0);
    expect(Math.min(...p.map((q) => q[0]))).toBeLessThan(0.3);
  });

  it("dimensions nulles → chemin vide", () => {
    expect(cheminIle(0, 0, 0, 10, 5, 2)).toBe("");
  });
});
