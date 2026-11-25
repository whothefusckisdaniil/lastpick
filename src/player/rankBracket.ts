/**
 * OpenDota `rank_tier`: tens = medal (1 Herald … 8 Immortal), units = stars
 * (0–5; Immortal has none). Mapped onto the site's four rank groups.
 */
export const MEDALS = ['herald', 'guardian', 'crusader', 'archon', 'legend', 'ancient', 'divine', 'immortal'] as const;
export type Medal = (typeof MEDALS)[number];

export interface RankInfo {
  medal: Medal;
  /** 1..8 */
  medalIndex: number;
  stars: number;
  /** The site's rank group (STRATZ bracket id). */
  bracket: string;
}

export function bracketOfMedal(medalIndex: number): string {
  return medalIndex <= 2 ? 'HERALD_GUARDIAN' : medalIndex <= 4 ? 'CRUSADER_ARCHON' : medalIndex <= 6 ? 'LEGEND_ANCIENT' : 'DIVINE_IMMORTAL';
}

/** Null when hidden or not calibrated. */
export function rankInfo(tier: number | null | undefined): RankInfo | null {
  if (tier == null || !Number.isFinite(tier) || tier < 10) return null;
  const medalIndex = Math.floor(tier / 10);
  if (medalIndex < 1 || medalIndex > 8) return null;
  return { medal: MEDALS[medalIndex - 1], medalIndex, stars: medalIndex === 8 ? 0 : Math.min(5, tier % 10), bracket: bracketOfMedal(medalIndex) };
}
