import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); }, removeItem: (k: string) => { mem.delete(k); } });
vi.stubGlobal("navigator", { userAgent: "test" });

describe("store", () => {
  beforeEach(() => { mem.clear(); vi.resetModules(); });

  it("rejects unknown keys and wrong types from localStorage", async () => {
    mem.set("sharkplane.options", JSON.stringify({ volume: "loud", evil: "<script>", fov: 9999, lang: "is" }));
    const { store } = await import("@/lib/store");
    store.hydrate();
    const o = store.get().options as unknown as Record<string, unknown>;
    expect(o.volume).toBe(0.7); expect(o.evil).toBeUndefined(); expect(o.fov).toBe(9999 > 0 ? Math.min(1e9, 9999) : 0); expect(o.lang).toBe("is");
  });

  it("tracks high score and progress across rounds", async () => {
    const { store } = await import("@/lib/store");
    store.hydrate();
    store.finishRound({ score: 500, eaten: 3, eatenByKind: { fighter: 3, bomber: 0, escort: 0, boss: 0 }, bestCombo: 2, firstBite: 4, objectives: [], medal: "none", dateKey: "2026-08-23" }, "bay", 0);
    expect(store.get().round.isHighScore).toBe(true);
    store.finishRound({ score: 200, eaten: 1, eatenByKind: { fighter: 1, bomber: 0, escort: 0, boss: 0 }, bestCombo: 1, firstBite: 9, objectives: [], medal: "bronze", dateKey: "2026-08-23" }, "bay", 1);
    expect(store.get().round.isHighScore).toBe(false);
    expect(store.get().round.highScore).toBe(500);
    expect(store.get().progress).toMatchObject({ totalEaten: 4, medals: 1, sorties: 2, bestScore: 500 });
    expect(store.get().progress.levels.bay).toMatchObject({ bestScore: 500, stars: 1, sorties: 2 });
    expect(store.totalStars()).toBe(1);
  });
});
