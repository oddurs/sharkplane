import { beforeEach, describe, expect, it } from "vitest";
import { LEVELS, dailyLevel, setLevel, starsFor } from "@/lib/levels";
import { terrainHeight, isOnRunway, RUNWAY } from "@/lib/terrain";

describe("levels", () => {
  beforeEach(() => setLevel(LEVELS[0]));

  it("level 0 terrain is byte-identical to the pre-level build", () => {
    const reference: [number, number, number][] = [
      [0, -60, 0.5], [500, 300, 59.77024496204651], [-620, -520, 137.23017931463656],
      [1000, -1000, 56.904688915494454], [-300, 800, 24.435260373351944],
      [123.4, -567.8, -8.064521691861133], [-1200, 150, -12.445607841458779],
    ];
    for (const [x, z, h] of reference) expect(terrainHeight(x, z)).toBeCloseTo(h, 10);
  });

  it("every level keeps the runway flat and terrain within bounds", () => {
    for (const level of LEVELS) {
      setLevel(level);
      const hs = new Set<number>();
      for (let z = RUNWAY.zMin; z <= RUNWAY.zMax; z += 10) hs.add(+terrainHeight(0, z).toFixed(4));
      expect(hs.size, level.id).toBe(1);
      expect(isOnRunway(0, -60)).toBe(true);
      for (let i = 0; i < 200; i++) {
        const x = (Math.random() - 0.5) * 3000, z = (Math.random() - 0.5) * 3000;
        const h = terrainHeight(x, z);
        expect(h, level.id).toBeGreaterThanOrEqual(-14);
        expect(h, level.id).toBeLessThan(400);
      }
    }
  });

  it("levels are distinct: fjords have canyons, dunes are dry, caldera has a cone", () => {
    setLevel(LEVELS[1]);
    let mn = 1e9, mx = -1e9;
    for (let a = -600; a < 600; a += 20) { const h = terrainHeight(a, -a + 400); mn = Math.min(mn, h); mx = Math.max(mx, h); }
    expect(mx - mn).toBeGreaterThan(50); // canyon relief
    setLevel(LEVELS[2]);
    let wet = 0;
    for (let i = 0; i < 400; i++) if (terrainHeight((Math.random() - 0.5) * 2600, (Math.random() - 0.5) * 2600) < 0) wet++;
    expect(wet / 400).toBeLessThan(0.05); // dune sea is dry
    setLevel(LEVELS[4]);
    expect(terrainHeight(-150, -500)).toBeLessThan(terrainHeight(-150, -500 + 220) - 20); // crater dips well below the rim
  });

  it("stars ladder and daily rotation behave", () => {
    expect(starsFor("gold", 0)).toBe(3);
    expect(starsFor("silver", 2)).toBe(2);
    expect(starsFor("silver", 1)).toBe(1);
    expect(starsFor("bronze", 2)).toBe(1);
    expect(starsFor("none", 2)).toBe(0);
    expect(dailyLevel("2026-08-24", 1).id).toBe("bay");
    const ids = new Set([dailyLevel("2026-08-24", 5).id, dailyLevel("2026-08-25", 5).id, dailyLevel("2026-08-26", 5).id, dailyLevel("2026-08-27", 5).id]);
    expect(ids.size).toBeGreaterThan(1);
  });
});
