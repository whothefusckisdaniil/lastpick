import type { EventName, EventProps } from './types';

/**
 * Every event LASTPICK may send and the only keys it may carry. trackEvent()
 * drops anything else at runtime, so a stray property (an ID, a nickname)
 * can never reach a provider even if a caller passes it by mistake.
 */
export const EVENTS: { [E in EventName]: readonly (keyof EventProps[E])[] } = {
  draft_results_viewed: ['position', 'rank', 'enemyCount', 'allyCount', 'banCount', 'pool'],
  match_analysis_loaded: ['parsed', 'perspective', 'source', 'mode'],
  player_profile_loaded: ['visibility', 'rank', 'isMe', 'stale', 'source'],
  my_pool_applied: ['position', 'rank', 'poolSize', 'lowData'],
  hero_build_viewed: ['position', 'rank'],
  share_created: ['surface', 'kind', 'format'],
};

export const EVENT_NAMES = Object.keys(EVENTS) as EventName[];
