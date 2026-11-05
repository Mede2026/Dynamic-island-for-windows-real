import { describe, expect, it } from "vitest";
import { appleVersFramer, dipVersPx, framerVersApple, ptVersDip, pxVersDip } from "./units";

describe("conversions d'unités", () => {
  it("pt → DIP → px → DIP", () => {
    const dip = ptVersDip(10, 1.25);
    expect(dip).toBeCloseTo(12.5);
    const px = dipVersPx(dip, 1.5);
    expect(px).toBeCloseTo(18.75);
    expect(pxVersDip(px, 1.5)).toBeCloseTo(dip);
  });
});

describe("conversions de ressorts", () => {
  it("Apple → Framer → Apple redonne les mêmes valeurs", () => {
    const apple = { response: 0.42, dampingFraction: 0.73 };
    const framer = appleVersFramer(apple, 1.3);
    const retour = framerVersApple(framer);
    expect(retour.response).toBeCloseTo(apple.response, 10);
    expect(retour.dampingFraction).toBeCloseTo(apple.dampingFraction, 10);
  });

  it("formule connue : response = 2π s, ζ = 1, m = 1 → k = 1, c = 2", () => {
    const f = appleVersFramer({ response: 2 * Math.PI, dampingFraction: 1 });
    expect(f.stiffness).toBeCloseTo(1);
    expect(f.damping).toBeCloseTo(2);
  });
});
