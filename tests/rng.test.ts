import { describe, expect, it } from "vitest";
import { Rng, hashString, todayKey } from "@/lib/rng";

describe("rng", () => {
  it("is deterministic per seed", () => {
    const a = new Rng(hashString("sharkplane:2026-08-23")), b = new Rng(hashString("sharkplane:2026-08-23"));
    expect(Array.from({ length: 5 }, () => a.next())).toEqual(Array.from({ length: 5 }, () => b.next()));
  });
  it("stays in [0,1) and differs across days", () => {
    const a = new Rng(hashString("a")), b = new Rng(hashString("b"));
    for (let i = 0; i < 1000; i++) { const v = a.next(); expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
    expect(a.next()).not.toBe(b.next());
  });
  it("formats the day key", () => { expect(todayKey(new Date(2026, 7, 23))).toBe("2026-08-23"); });
});
