import { describe, expect, it } from "vitest";
import { lireDuree } from "./Lanceur";

describe("durées du lanceur", () => {
  it("comprend les formats courants", () => {
    expect(lireDuree("5")).toBe(300_000);
    expect(lireDuree("2:30")).toBe(150_000);
    expect(lireDuree("1:05:00")).toBe(3_900_000);
    expect(lireDuree("1h15")).toBe(4_500_000);
    expect(lireDuree("1h")).toBe(3_600_000);
    expect(lireDuree("90s")).toBe(90_000);
    expect(lireDuree(" 10 ")).toBe(600_000);
    expect(lireDuree("")).toBeNull();
    expect(lireDuree("abc")).toBeNull();
  });
});
