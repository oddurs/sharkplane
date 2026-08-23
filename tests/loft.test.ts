import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { loft, onSkin, sectionAt } from "@/lib/loft";

describe("loft", () => {
  it("winds faces outward (normals point away from the axis)", () => {
    const g = loft([{ z: -1, w: 1, h: 1 }, { z: 1, w: 1, h: 1 }], 8, false);
    const pos = g.attributes.position, nor = g.attributes.normal;
    let outward = 0, total = 0;
    for (let i = 0; i < pos.count; i++) {
      const p = new THREE.Vector3(pos.getX(i), pos.getY(i), 0), n = new THREE.Vector3(nor.getX(i), nor.getY(i), nor.getZ(i));
      if (p.lengthSq() > 0.01) { total++; if (p.normalize().dot(n) > 0) outward++; }
    }
    expect(outward / total).toBeGreaterThan(0.95);
  });
  it("caps closed hulls", () => {
    const open = loft([{ z: 0, w: 1, h: 1 }, { z: 1, w: 1, h: 1 }], 8, false).attributes.position.count;
    const closed = loft([{ z: 0, w: 1, h: 1 }, { z: 1, w: 1, h: 1 }], 8, true).attributes.position.count;
    expect(closed).toBe(open + 2 * 8 * 3);
  });
  it("interpolates sections and places skin points on the ellipse", () => {
    const s = sectionAt([{ z: 0, w: 1, h: 2 }, { z: 2, w: 3, h: 4 }], 1);
    expect(s.w).toBe(2); expect(s.h).toBe(3);
    const p = onSkin({ z: 0, w: 2, h: 1 }, 0);
    expect(p.x).toBeCloseTo(2); expect(p.y).toBeCloseTo(0);
  });
});
