# Standard Tournament engine

An opt-in, dependency-free rules engine. Nothing in the existing tournament app
is imported, patched, or automatically wired up. No DOM, Firebase, storage,
randomness, current time, scheduling/court assignment, or score-target rules are
required. The host controls persistence and presentation.

## Loading

Load as a **classic script**, then use the `StandardTournamentEngine` browser
global. No bundler or module loader is needed:

```html
<script src="/tournament/engine/standard-engine.js"></script>
<script>
  const engine = StandardTournamentEngine;
  console.log(engine.capabilities('standard'));
</script>
```

In Node (Node 18+ for the tests):

```js
const engine = require('./tournament/engine/standard-engine.js');
```

## Competition definition

```js
const definition = {
  id: 'summer-open',
  mode: 'standard',
  affiliations: [{ id: 'club-a', name: 'Club A' }],
  entries: [
    { id: 'pair-1', name: 'Alex / Sam', affiliationId: 'club-a', seed: 1 },
    { id: 'pair-2', name: 'Jo / Pat', affiliationId: 'club-a', seed: 2 },
    { id: 'pair-3', name: 'Lee / Kim', affiliationId: null, seed: 3 }
  ],
  divisions: [{
    id: 'open-doubles',
    name: 'Open Doubles',
    entryIds: ['pair-1', 'pair-2', 'pair-3'],
    format: 'round-robin',
    qualifiers: { count: 2 },
    standings: {
      order: ['wins', 'headToHead', 'pointDifferential', 'pointsFor', 'pointsAgainst'],
      allowDraws: false,
      points: { win: 3, draw: 1, loss: 0 }
    }
  }]
};

let state = engine.createCompetition(definition);
const match = state.divisions[0].stages[0].matches[0];
state = engine.recordResult(state, match.id, { a: 11, b: 7 });
const standings = state.divisions[0].stages[0].tables[0].rows;
// Save state as JSON; use participants.a / participants.b to render competitors.
// Scores a and b refer to those sides, not to seed order or displayed names.
state = engine.clearResult(state, match.id);
```

All IDs are caller-supplied, nonempty strings, unique within their entity type.
The engine never derives identity from a name, array index, affiliation, or
player list. An entry is an opaque competitor: a single player, pair, or team.
Extra JSON entry metadata (such as player IDs) is retained but not interpreted.
Affiliations are optional display/grouping metadata, **not opponents**. Entries
from the same affiliation play each other in a full round robin. Every division
explicitly lists its entries; entries may participate in several divisions.
Cross-division player conflicts are a scheduling concern outside this engine.

Optional entry `seed` values are positive integers. Smaller numbers seed first;
missing or equal seeds are ordered by stable entry ID (code-unit order, not
locale). Names and input array order do not affect generated matches. Low-level
`generatePools` and `generateBracket` instead accept an already seeded list.
IDs survive renames and result corrections; changing membership or format is a
new draw and should use a new competition ID if old results must be retained.

## Formats and qualification

- `round-robin`: every unordered pair plays exactly once, arranged into rounds
  without duplicate entry appearances in a round. Odd entry counts rest one
  entry per round; rest slots are not matches. Optional `qualifiers: { count: N }`
  advances the top N to a single-elimination playoff.
- `pools`: requires `poolCount` between 1 and the entry count. Entries are
  distributed in a deterministic snake, with pool sizes differing by at most
  one. Each pool plays a full round robin. Optional
  `qualifiers: { perPool: N, wildcards: W }` advances N from every pool plus W
  best remaining entries. `wildcards` defaults to zero. Automatic seeds are
  interleaved by rank then pool (A1, B1, A2, B2, ...); wildcards follow.
  Wildcards require equal-sized pools: unequal schedules are not silently
  compared using raw totals. Head-to-head is skipped across pools.
- `single-elimination`: seeded power-of-two bracket with byes awarded to the
  highest seeds. No qualifier configuration is accepted. A bracket of N > 0
  entries has N−1 played matches. Structural bye nodes have no scores, wins,
  or standings points. No third-place/consolation match is implied.

Omit qualifiers, use `null`, or request zero qualifiers to have no playoff.
One qualifier produces a champion placeholder without a played playoff match.
Empty round-robin and elimination divisions are valid; empty pools are not.
A one-entry elimination bracket is already complete; an empty bracket is
complete with `championId: null`.

## Results, standings, and advancement

Results are `{ a, b }`, nonnegative safe-integer scores. A result submitted via
`recordResult` is final, not live/provisional. Ties require `allowDraws: true` in
the preliminary stage and are always forbidden in elimination. Sport-specific
win-by-two, target scores, forfeits, and disqualifications belong to the host.

Standings include played, wins, losses, draws, points for/against, point
differential, and standing points. Available ordered criteria are `wins`,
`standingPoints`, `headToHead`, `pointDifferential`, `pointsFor`, `pointsAgainst`,
and `seed`. Points against and seed sort ascending; other criteria sort
descending. The default order is shown in the example. Configured points can
be any finite numbers, including negative loss points.

Head-to-head partitions an entire tied group using standing points from its
completed mini-table, not a potentially cyclic pairwise sort. It applies only
when every pair in that group has a completed meeting. Remaining equal groups
continue to the next criterion; head-to-head is not recursively reapplied.

Unresolved sporting ties have a shared competition `rank`, sequential display
`position`, `tied: true`, and `tiedEntryIds`. Entry IDs stabilize display order
but **never break a qualification tie**. A tied qualifier slot stays pending,
even if every tied entry would advance, because playoff seed order is still
ambiguous. Hosts can configure `seed` as an explicit last-resort tiebreak before
creating the draw; there is no implicit coin toss or silent manual override.

Every match retains its source slots:

```js
{ type: 'entry', entryId: 'pair-1' }
{ type: 'bye' }
{ type: 'winner', matchId: '...' }
{ type: 'qualifier', stageId: '...', poolId: null, rank: 1 }
{ type: 'wildcard', stageId: '...', rank: 1 }
```

Resolved participants live separately in `match.participants`. Status is
`pending`, `ready`, `complete`, or `bye`; `winnerId` and `loserId` are explicit.
Unresolved entrants are **not byes**. Preliminary stages expose `tables` and
`complete`. Brackets expose `champion` (source slot), `championId`, and `complete`.
Qualifiers wait for the **whole preliminary stage** to finish. Wildcards also
wait for any tie across an automatic qualification boundary to be resolved.

`recordResult`, `clearResult`, and `resolveAdvancement` return new JSON-safe
states without mutating their inputs. They recalculate standings and advancement.
Changing or removing a result clears downstream scores if a participant changes
or a prerequisite becomes unresolved, recursively. Unaffected matches keep their
results. A correction that keeps the same participants keeps their result.
Persist the returned state, not the original. `resolveAdvancement` can refresh
a JSON-restored engine state; it is not an untrusted-state/schema migration API.

## API summary

| API | Returns |
| --- | --- |
| `capabilities(mode = 'standard')` | Fresh capability flags and supported formats |
| `normalizeCompetition(definition)` | Validated, detached definition |
| `createCompetition(definition)` | Resolved state, all stages, matches, tables, and estimates |
| `generateRoundRobin(entryIds, { id?, divisionId?, poolId? })` | Match array; pair-derived stable IDs |
| `generatePools(seededEntryIds, { id?, divisionId?, poolCount })` | Pools with entry IDs and intra-pool matches |
| `generateBracket(seededEntryIdsOrSlots, { id?, divisionId? })` | Bracket stage including bye nodes and winner placeholders |
| `getStandings(entries, matches, settings?)` | Ranked rows from completed scored matches only |
| `estimateMatches({ entryCount, format?, poolCount?, qualifiers? })` | Preliminary/elimination/total counts, qualifiers, pool-size distribution, bracket size/byes/slots |
| `recordResult(state, matchId, { a, b })` | New state with final result and resolved advancement |
| `clearResult(state, matchId)` | New state with result removed and advancement recalculated |
| `resolveAdvancement(state)` | New state with derived standings and advancement refreshed |
| `createEngine({ mode?, legacyAdapter? })` | Standard API or legacy-only dispatch facade |

`getStandings` accepts entry objects or IDs and engine-format match objects.
Only matches with `status: 'complete'` and a result contribute. Pass matches for
one table, not the preliminary stage plus playoffs. Low-level bracket builders
can display qualifier placeholders before sources exist; use `createCompetition`
for a complete source graph. Winner slots resolve within their bracket, in
topological match order; arbitrary cross-bracket dependencies are not supported.

Estimates exclude automatic byes from played match counts. `bracketSlots` counts
all bracket nodes, including byes; `bracketSize` counts positions. `poolSizes`
describes the balanced size distribution, not the specific snake pool ordering.
No explicit empty seed slots are accepted by `generateBracket`; padding is
automatic. Errors throw before a result is accepted; no partial state is saved.

## Legacy dual-meet boundary

```js
const legacy = StandardTournamentEngine.createEngine({
  mode: 'dual-meet',
  legacyAdapter: existingDualMeetAdapter // Supplied by the host, never imported here.
});
const legacyState = legacy.createCompetition(existingLegacyDefinition);
```

The facade delegates `createCompetition`, `recordResult`, `clearResult`,
`resolveAdvancement`, `getStandings`, and `estimateMatches` with original
arguments and adapter `this`. Missing methods throw when called. No data is
converted, no legacy state is changed on load, and no dual-meet scheduling,
medals, Dream Breaker, or club-total rules are reimplemented. Standard capability
flags are false for dual-meet; they describe this engine, not the host adapter.
An explicit adapter is required; there is no fallback into standard rules.

## Deterministic verification

From the repository root, no install step:

```sh
node --test tournament/engine/tests/*.test.js
```

Tests exercise browser-global loading, adapter isolation, stable identity,
immutability and JSON roundtrips, round-robin coverage and round conflicts,
snake pools and estimates, seeded brackets and byes, configurable qualifiers and
wildcards, mini-table tiebreaks, unresolved ties, correction propagation, and
invalid inputs. Bounded exhaustive cases cover 0–32 round-robin entry counts,
all pool counts for 1–20 entries, and complete elimination runs for 0–33 entries.
