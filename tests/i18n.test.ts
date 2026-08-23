import { describe, expect, it } from "vitest";
import { setLang, t } from "@/lib/i18n";

describe("i18n", () => {
  it("has every key in both languages", () => {
    setLang("en"); const en = t("sortie"); setLang("is"); const is = t("sortie");
    expect(en).toBe("SORTIE"); expect(is).toBe("FLUGFERÐ");
    for (const key of ["r_takeoff", "t_done", "hungry", "complete"] as const) { setLang("is"); expect(t(key)).not.toBe(""); }
    setLang("en");
  });
});
