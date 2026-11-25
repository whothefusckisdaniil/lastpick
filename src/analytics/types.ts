/**
 * Product analytics: what each event carries. Only coarse, anonymous facts
 * about the action — never a Steam / Dota ID, a match ID, a nickname or the
 * heroes of a particular draft.
 */

/** 'all' or a position 1–5. */
export type PositionProp = 'all' | '1' | '2' | '3' | '4' | '5';
/** The site's rank group, lower-case ('all', 'herald_guardian', …, 'divine_immortal'). */
export type RankProp = string;
export type ShareSurface = 'draft' | 'match' | 'profile';

export interface EventProps {
  /** Counterpick recommendations shown for a draft (debounced, once per draft). */
  draft_results_viewed: {
    position: PositionProp;
    rank: RankProp;
    enemyCount: number;
    allyCount: number;
    banCount: number;
    /** Results built from the player's own pool. */
    pool: boolean;
  };
  /** The match analysis rendered (data loaded, parsed or shown without parse). */
  match_analysis_loaded: {
    parsed: boolean;
    /** Centred on one player or the whole match. */
    perspective: 'player' | 'match';
    /** How the match was opened. */
    source: 'recent' | 'input' | 'link';
    mode: 'ranked' | 'all_pick' | 'turbo' | 'other';
  };
  /** A player profile loaded successfully. */
  player_profile_loaded: {
    visibility: 'open' | 'limited';
    /** Medal name or 'none'. */
    rank: string;
    isMe: boolean;
    /** Served from the cache because the service was down. */
    stale: boolean;
    source: 'saved' | 'input' | 'search' | 'link';
  };
  /** "My pool" recommendations shown (once per switch-on). */
  my_pool_applied: {
    position: PositionProp;
    rank: RankProp;
    /** Heroes in the pool, bucketed. */
    poolSize: '<10' | '10-19' | '20-39' | '40+';
    lowData: boolean;
  };
  /** The statistical build of a hero shown (once per hero, position and rank). */
  hero_build_viewed: {
    position: PositionProp;
    rank: RankProp;
  };
  /** A link copied or a card image saved / shared — only when it succeeded. */
  share_created: {
    surface: ShareSurface;
    kind: 'link' | 'image';
    /** Image size; 'none' for links. */
    format: 'story' | 'post' | 'none';
  };
}

export type EventName = keyof EventProps;

/** A provider behind trackEvent(): PostHog today, anything tomorrow. */
export interface AnalyticsProvider {
  name: string;
  track(event: EventName, props: Record<string, string | number | boolean>): void;
}
