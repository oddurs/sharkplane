/** Device capability detection → quality tier + platform quirks. Runs once on the client. */
export type Tier = "high" | "medium" | "low";

export const isTouch = () => typeof window !== "undefined" && (navigator.maxTouchPoints > 0 || matchMedia("(pointer: coarse)").matches);
export const isIOS = () => typeof navigator !== "undefined" && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
export const isStandalone = () => typeof window !== "undefined" && (matchMedia("(display-mode: standalone)").matches || (navigator as unknown as { standalone?: boolean }).standalone === true);

function gpuName(): string {
  try {
    const c = document.createElement("canvas");
    const gl = (c.getContext("webgl2") ?? c.getContext("webgl")) as WebGLRenderingContext | null;
    const ext = gl?.getExtension("WEBGL_debug_renderer_info");
    return ext && gl ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : "";
  } catch { return ""; }
}

/** Heuristic tier: mobile defaults to medium, weak/old devices to low, desktops with a real GPU to high. */
export function detectTier(): Tier {
  if (typeof navigator === "undefined") return "high";
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const gpu = gpuName().toLowerCase();
  const software = /swiftshader|llvmpipe|software|mesa offscreen/.test(gpu);
  const weakMobileGpu = /adreno [1-5]\d\d|mali-(4|t)|mali-g[1-5]\d|powervr|apple a(7|8|9|10)/.test(gpu);
  if (software) return "low";
  if (isTouch()) {
    if (mem <= 3 || cores <= 4 || weakMobileGpu) return "low";
    return "medium";
  }
  if (mem <= 4 || cores <= 2 || /intel(r)? (hd|uhd) graphics [3-5]\d\d/.test(gpu)) return "medium";
  return "high";
}
