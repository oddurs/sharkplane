/** Juice hierarchy: routine bites stay small so milestones can actually land. */
export type Tier = "routine" | "notable" | "milestone";
export const TIERS: Record<Tier, { hitStop: number; shake: number; yell: boolean; rumble: [number, number, number] }> = {
  routine: { hitStop: 0.04, shake: 0.3, yell: false, rumble: [0.4, 0.3, 120] },
  notable: { hitStop: 0.08, shake: 0.6, yell: true, rumble: [0.7, 0.4, 180] },
  milestone: { hitStop: 0.12, shake: 0.9, yell: true, rumble: [1, 0.5, 400] },
};
/** Seconds after a milestone during which lesser chatter stays quiet. */
export const BIG_MOMENT_QUIET = 1.4;
