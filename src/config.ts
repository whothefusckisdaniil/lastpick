export const APP_CONFIG = {
  // --- OpenDota ---
  apiBase: 'https://api.opendota.com/api',
  cdnBase: 'https://cdn.cloudflare.steamstatic.com',
  docsUrl: 'https://docs.opendota.com/',

  // --- Caching (localStorage, hours) ---
  cacheTtlHours: {
    heroes: 24,
    heroStats: 24,
    matchups: 24,
    patch: 24,
  },

  // --- Scoring model (MVP, tweakable) ---
  scoring: {
    // wins of candidate vs enemy are stored from enemy perspective,
    // we invert: candidateWinrate = 1 - wins/games_played
    // delta is in percentage points vs 50%
    neutralWinrate: 50,
    // shrink tiny samples toward neutral before averaging
    shrinkageK: 60,
    // a single matchup with fewer games than this is not usable (treated as missing)
    minMatchesPerPair: 20,
    // V2 strict coverage: a candidate must have a usable matchup vs EVERY
    // selected enemy, otherwise it is hidden. Partial-lineup heroes must not
    // compete with full-lineup heroes. If false, candidates need at least
    // minUsableEnemies usable matchups instead.
    requireFullCoverage: true,
    // Used only when requireFullCoverage = false: minimum usable matchups.
    minUsableEnemies: 1,
    // do not show candidates whose average sample is below this
    minimumSampleAvg: 40,
    // confidence = min(1, sqrt(avgMatches / confidenceDenominator))
    confidenceDenominator: 400,
    // teamCounterScore = weighted average of matchup deltas (weight = sqrt(games))
    // finalScore = counterScore * wCounter + positionBonus * wPosition, then blended toward 0 by (1 - confidence)
    wCounter: 0.8,
    wPosition: 0.2,
    // --- V8 experiment: weak-link penalty (model W) ---
    // A matchup whose shrunk delta is below this many pp counts as a "very bad
    // matchup"; each such matchup subtracts weakLinkPenalty points from raw.
    // Fixed a priori (no fitting to the live drafts): threshold -5pp ≈ 45% WR
    // against an enemy, penalty 3pp per bad matchup — enough to reorder the
    // top when a candidate has a real weak link, not enough to dominate.
    weakLinkThreshold: -5,
    weakLinkPenalty: 3,
    // positionBonus mapped from positionScore 0..10 -> -4..+4 points
    positionBonusRange: 4,
    // ТЗ №9: there is no longer a heuristic role-fit HARD gate. The hard gate is
    // empirical — src/scoring/positionEligibility.ts requires the hero to
    // actually be picked on the lane (STRATZ position share + games).
    // `positionScore` (OpenDota role tags + curated affinity) survives only as a
    // secondary ranking signal via positionBonus, which is worth at most
    // wPosition * positionBonusRange = 0.8 points of the final score. That is
    // deliberately too small to override matchup evidence, and far too blunt to
    // decide eligibility: OpenDota tags Wraith King "Support" and Meepo
    // "Disabler", which is exactly what put them in the wrong lanes before.
    topN: 15,
    // --- Allies & bans ---
    // Synergy (advantage of being on the same team) is weighted below counter
    // value: it is typically smaller in magnitude and noisier, and the main
    // question stays "who beats the enemy". draft = counter + wSynergy × synergy.
    wSynergy: 0.5,
    // Lane partner (your ally on the same lane, from ally positions): lane win
    // share with that ally minus what both heroes' usual lane shares predict,
    // in pp, shrunk by lanes/(lanes + laneShrinkK). Small weight: the lane is
    // only the first ~10 minutes. draft += wLane × lane.
    wLane: 0.15,
    laneShrinkK: 150,
    laneMinGames: 30,
    // Ban suggestions: threat to your team + wSynergy × fit with the enemy team.
    banSuggestions: 8,
  },

  // --- Player profile & "My pool" (src/player/poolStats.ts, src/scoring/poolScoring.ts) ---
  player: {
    // A hero's personal edge (win rate − the hero's meta win rate on the rank)
    // is shrunk like a matchup: edge × games / (games + shrinkK), so 3 games
    // at 100% do not top the list (3 games, +50 pp → 2.8; 100 games, +6 pp →
    // 4.0). The "strongest" list also needs strongMinGames games.
    shrinkK: 50,
    strongMinGames: 5,
    // In the pool: a hero with this many games all-time, or this many in the
    // last 90 days. Below lowDataGames in total the thresholds are softened
    // (lowDataMin) and the results say "little data".
    minGamesAll: 8,
    minGames90: 3,
    lowDataGames: 30,
    lowDataMin: 2,
    // Personal comfort in the pool ranking: weight on the shrunk edge (pp),
    // centred on the player's own average (a 55% player is not "+5 on every
    // hero"). Deliberately much smaller than the counter part: personal win
    // rates are noisy (party, role, streaks). pool score = counter score + wComfort × comfort.
    wComfort: 0.2,
    // "Comfort" label: this many games and a shrunk edge above comfortEdge pp.
    comfortGames: 30,
    comfortEdge: 2,
    // Labels (formulas, not opinions):
    //   comfort  — ≥ comfortGames games and shrunk edge ≥ comfortEdge pp;
    //   gem      — gemMinGames..gemMaxGames games, raw edge ≥ gemEdge pp ("little data");
    //   under    — ≥ underGames games and shrunk edge ≤ underEdge pp (neutral wording);
    //   meta     — shrunk edge ≥ metaEdge and the hero's meta win rate ≥ metaWinrate % on the rank.
    gemMinGames: 5,
    gemMaxGames: 15,
    gemEdge: 10,
    underGames: 30,
    underEdge: -2,
    metaWinrate: 52,
    metaEdge: 1,
    // "Better avoid" in the pool: at most this many heroes with a negative pool score.
    avoidCount: 3,
    // Pool width: heroes with ≥ widthGames games; narrow / wide thresholds.
    widthGames: 10,
    narrowPool: 8,
    widePool: 20,
    // A last game older than this many days: the pool is marked as old.
    staleDays: 30,
    // "Heroes worth learning": heroes with < maxGames games, meta win rate ≥
    // metaMin % on the rank, similarity ≥ minSim (0..1) to one of the player's
    // strongCount strongest heroes. score = similarity × (1 + metaWeight × min(meta − 50, metaCap)):
    // similarity leads, the meta only reorders — a specialists' hero (Meepo at
    // 58% because only Meepo players pick it) must not top the list.
    // Similarity = weighted positions cosine, Dota role tags, threat tags, attribute/attack.
    // With "My roles" set: share ≥ roleShare on one of them (positions.json).
    learn: {
      maxGames: 5,
      metaMin: 50.5,
      minSim: 0.55,
      strongCount: 5,
      metaWeight: 0.05,
      metaCap: 4,
      roleShare: 0.1,
      count: 5,
      weights: { pos: 0.5, roles: 0.25, tags: 0.15, kind: 0.1 },
    },
    // Dynamics: this many latest patches.
    patchCount: 6,
    // Comparing two pools: rows per list; frequent teammates offered.
    compareCount: 5,
    peerCount: 6,
  },

  ui: {
    maxEnemies: 5,
    // you are the 5th player
    maxAllies: 4,
    // Captains Mode bans 7 per team; ranked All Pick nominates up to 10
    maxBans: 14,
    searchLimit: 9,
  },
} as const;

export type PositionFilter = 'all' | '1' | '2' | '3' | '4' | '5';

export const POSITIONS: { id: PositionFilter; label: string; short: string }[] = [
  { id: 'all', label: 'All Positions', short: 'All' },
  { id: '1', label: 'Position 1 — Carry', short: 'Carry' },
  { id: '2', label: 'Position 2 — Mid', short: 'Mid' },
  { id: '3', label: 'Position 3 — Offlane', short: 'Offlane' },
  { id: '4', label: 'Position 4 — Soft Support', short: 'Support 4' },
  { id: '5', label: 'Position 5 — Hard Support', short: 'Support 5' },
];
