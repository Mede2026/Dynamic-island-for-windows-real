import { describe, expect, it } from "vitest";
import { indiceLigne, lireLrc } from "./paroles";

describe("paroles", () => {
  const lrc = "[ar: Artiste]\n[00:01.50] Première\n[00:04.00]\n[00:05.2] Deuxième\n[01:00.00][01:30.00] Refrain";
  it("lit le format LRC", () => {
    const l = lireLrc(lrc);
    expect(l.map((x) => x.t)).toEqual([1500, 4000, 5200, 60_000, 90_000]);
    expect(l[0]!.texte).toBe("Première");
    expect(l[1]!.texte).toBe("");
    expect(l[4]!.texte).toBe("Refrain");
  });
  it("trouve la ligne en cours", () => {
    const l = lireLrc(lrc);
    expect(indiceLigne(l, 0)).toBe(-1);
    expect(indiceLigne(l, 1500)).toBe(0);
    expect(indiceLigne(l, 4999)).toBe(1);
    expect(indiceLigne(l, 70_000)).toBe(3);
    expect(indiceLigne(l, 200_000)).toBe(4);
  });
});
