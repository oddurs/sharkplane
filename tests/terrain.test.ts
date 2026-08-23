import { describe, expect, it } from "vitest";
import { terrainHeight, groundHeight, isOnRunway, RUNWAY } from "@/lib/terrain";

describe("terrain", () => {
  it("keeps the whole runway perfectly flat", () => {
    const hs = new Set<number>();
    for (let z = RUNWAY.zMin; z <= RUNWAY.zMax; z += 5) for (const x of [-RUNWAY.halfWidth, 0, RUNWAY.halfWidth]) hs.add(+terrainHeight(x, z).toFixed(4));
    expect(hs.size).toBe(1);
  });
  it("never goes below the sea bed and water is the collision floor", () => {
    for (let i = 0; i < 500; i++) {
      const x = (Math.random() - 0.5) * 3000, z = (Math.random() - 0.5) * 3000;
      expect(terrainHeight(x, z)).toBeGreaterThanOrEqual(-14);
      expect(groundHeight(x, z)).toBeGreaterThanOrEqual(0);
    }
  });
  it("knows the runway bounds", () => {
    expect(isOnRunway(0, -60)).toBe(true);
    expect(isOnRunway(RUNWAY.halfWidth + 1, -60)).toBe(false);
  });
});
