# Dispatch Per-Record Groups + Neighbour-in-Flight Guard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop `/claude-tweaks:dispatch` from chaining a record to every record its Key Files transitively overlap with. Each eligible record becomes its own dispatch group, and a record waits only while a direct file-sharing neighbour holds a live claim.

**Architecture:**
- **Grouping.** The queue pull replaces `groupByFileOverlap(items)` with a new pure `buildDispatchGroups` in `grouping.js`: one group per record, and fast-lane bundles that stay disjoint via a new `conflicts` option. `groupByFileOverlap` itself is untouched.
- **Neighbour guard.** A new module, `bin/lib/dispatch/in-flight-neighbours.js`, turns live-claimed direct neighbours into non-removing `neighbour-in-flight` exclusions. Bare drain's ranking skips them; `#N` forms report them and still dispatch.
- **Cache invalidation.** The queue-order disk cache gains a `grouping` field, so a cache hit never reuses groups computed under the old transitive rule.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T101533-record-3278/work/3278-spec.md` (record #3278).

## Global Constraints

- `groupByFileOverlap`'s behaviour and its existing tests stay byte-for-byte unchanged (AC7). Its other consumers (`ranking.js` `computeOverlapSet`, `preflight-records`, flow `waves.js`, flow multi-spec conflict detection, `/help`) must not change.
- **Linking file:** a non-hub, non-bare-directory path, using the same hub rule `groupByFileOverlap` uses:
  - `computeHubPaths` with `HUB_PATH_MIN_COUNT = 3`, `HUB_PATH_FRACTION = 0.1`, overridable via `options.hubPathMinCount` / `options.hubPathFraction`;
  - a path ending in `/` never links.
- **In flight** means a claim blob classified `live` by `classifyClaimBlob` (`plugin/bin/lib/issues/claims.js`). A `bot:in-progress` label alone never counts. A failed claim read means not in flight (fail open).
- `neighbour-in-flight` exclusions never remove a record from `dispatch-groups.json`.
  - Its `queue-pull-script.md` reason bullet must contain the literal ``stay IN `dispatch-groups.json` `` so `tests/dispatch-named-form-exclusion-reasons.test.js` derives it as non-removing.
- **Byte ceilings:** `plugin/skills/dispatch/SKILL.md` (46,052 B now) and `plugin/skills/dispatch/queue-pull-script.md` (46,248 B now) must each stay ≤ `CEILING_BYTES` = 51,200. `_shared/issue-claims.md` is at 45,048 B.
- No new policy key. `dispatch-group-size-guard` and `dispatch-fastlane-bundle-cap` stay; only their prose and summary text change.
  - A `policy-schema.js` summary must be ≤ 140 chars, must not contain its own key, and must not be duplicated verbatim in `policy-schema.md` (`tests/policy-schema-metadata.test.js`).
- Never write the literal tokens TBD/TODO in authored prose.
- Commit style: `{Verb} {what} — {detail}`, ending with `Claude-Session: https://claude.ai/code/session_018PRa7txtVyujyqYrPLjGn4`.

## Review Focus

1. **Stale disk cache:** a queue-order blob written by an older plugin (no `grouping` field) must be treated as a cache miss, not reused. Task 2 tests `cacheUsable` with a grouping-less blob.
2. **Self-overlap:** a candidate's own number appearing in the in-flight list (a stale `bot:in-progress` label on an eligible record) must never make it its own neighbour. Task 1 tests `findInFlightNeighbours` with a shared id.
3. **One bad read:** a claim read that throws, or returns `failure`, must fail open for that record without aborting the pass for others. Task 3 tests a mixed batch.
4. **Bundling under conflict:** with `bundleCap` 3 and four fast-lane singletons where #1 conflicts with #2, the conflicting pair must still be split deterministically, oldest-first. Task 1 tests it.
5. **Empty pool:** an empty in-flight pool (the `gh issue list` fetch failed and wrote `[]`) must yield zero exclusions, not throw. Task 3 tests `inFlight: []`.

---

### Task 1: Pure grouping primitives in `grouping.js`

**Files:**
- Modify: `plugin/bin/lib/issues/grouping.js` — add `directOverlaps`, `findInFlightNeighbours`, `buildDispatchGroups`; add `options.conflicts` to `bundleFastLaneSingletons`; update its "Disjoint Key Files is already guaranteed by construction" comment, since that is no longer true by construction once every record is its own group.
- Test: `tests/bin-lib/issues/grouping.test.js` — append new tests. Do not edit any existing test (AC7).

**Interfaces:**
- **Produces:** `directOverlaps(items, options = {}) -> Map<id, Array<{ id, files: string[] }>>`.
  - `items`: `[{ id, keyFiles: string[] }]`.
  - Symmetric: every pair sharing ≥1 linking file appears under both ids. `files` is sorted. Pairs with no shared linking file are absent, and an id with no neighbours has no entry.
  - Hubs are computed over `items`, exactly as in `groupByFileOverlap`.
- **Produces:** `findInFlightNeighbours(candidates, inFlight, options = {}) -> Map<candidateId, Array<{ number, files }>>`.
  - Both inputs are `{ id, keyFiles }`.
  - Computes `directOverlaps` over the union (candidates first; an `inFlight` item whose id is also a candidate id is dropped from the union).
  - Returns only candidate → in-flight edges, with `number` = the in-flight id.
  - A candidate with no in-flight neighbour maps to `[]`. Every candidate id has an entry.
- **Produces:** `bundleFastLaneSingletons(groups, { bundleCap, conflicts })`.
  - `conflicts`: an optional `(numberA, numberB) => boolean`, defaulting to "never conflicts".
  - Chunking becomes first-fit over open chunks, in sorted order: each issue joins the earliest chunk that has fewer than `bundleCap` members and no conflicting member, otherwise it starts a new chunk.
  - With no conflicts this reproduces today's fixed-size slicing exactly, so the output is byte-identical (AC6.2).
  - Size-1 chunks go to passthrough, as today. Finalize per bucket, after every issue in that bucket is placed: walk its chunks in creation order, sending size-1 chunks to passthrough and the rest to bundles. This keeps today's output order exactly.
- **Produces:** `buildDispatchGroups(issues, { bundleCap, hubPathMinCount, hubPathFraction } = {}) -> { groups, bundles }`.
  - `issues`: eligible issue objects (`number`, `body`, `labels`, `createdAt`).
  - Builds `items` via `extractKeyFiles`, one single-record group per issue, and a `conflicts` predicate from `directOverlaps(items)`, then returns `bundleFastLaneSingletons(groups, { bundleCap, conflicts })`.
- Export all four new names from `module.exports`.

- [ ] **Step 1: Write the failing tests** (append to `tests/bin-lib/issues/grouping.test.js`; extend the destructuring `require` with `directOverlaps, findInFlightNeighbours, buildDispatchGroups`)

  - **Fixture helper:** `rec(number, files, { fastLane = false, createdAt })` builds an issue whose body is `## Technical Approach\n\n### Key Files\n\n` + one ``- `{file}` — x`` line per file. It adds a `ceremony:fast-lane` label when `fastLane`, plus a `priority:medium` label.
  - `test('AC1.1-AC1.3: the 2026-10-17 18-record chained shape yields single-record groups and no oversized group', …)`:
    - Builds the fixture from the real 25 live edges, recorded at reproduction time. Each edge adds its files to both records' Key Files:

      ```js
      const EDGES = [[3289,3035,['plugin/skills/flow/multi-spec.md']],[3289,3018,['plugin/skills/flow/manifesto.md']],[3289,2734,['plugin/skills/flow/manifesto.md']],[3266,3015,['plugin/skills/_shared/subagent-output-contract.md']],[3226,3018,['plugin/bin/lib/policy-schema.js']],[3226,3014,['plugin/skills/flow/steps-and-gates.md','plugin/bin/lib/flow/preflight.js']],[3079,3047,['plugin/skills/review/code-mode-steps.md']],[3079,3021,['plugin/skills/review/code-mode-steps.md']],[3079,3004,['plugin/skills/build/SKILL.md']],[3079,2977,['plugin/skills/review/code-mode-steps.md']],[3047,3021,['plugin/skills/review/code-mode-steps.md']],[3047,2977,['plugin/skills/review/code-mode-steps.md']],[3035,3030,['plugin/bin/hooks.js']],[3035,3026,['plugin/bin/hooks.js']],[3035,3015,['docs/hooks.md']],[3035,2986,['plugin/bin/hooks.js','docs/hooks.md']],[3030,3026,['plugin/bin/hooks.js']],[3030,2986,['plugin/bin/hooks.js']],[3026,2986,['plugin/bin/hooks.js']],[3021,2977,['plugin/skills/review/code-mode-steps.md']],[3018,2734,['plugin/skills/flow/manifesto.md']],[3015,2986,['docs/hooks.md']],[3004,2887,['plugin/bin/lib/wrap-up/pack.js']],[3004,2869,['plugin/skills/build/dispatch.md']],[3004,2734,['plugin/bin/lib/issues/autonomy.js']]];
      ```
    - Pads the pool to the live size of 61 with 43 records (numbers 5001–5043), each citing its own unique file. The hub threshold is then `max(3, ceil(61 × 0.1))` = 7, and no path is cited more than 4 times (AC1.2).
    - Asserts `groupByFileOverlap(items)`'s largest group has length 18 (proving the fixture really chains).
    - Asserts `buildDispatchGroups(issues, { bundleCap: 3 })` returns 61 groups, each of length 1, with `bundles: []` (no fast-lane labels).
    - Asserts `partitionGroupsBySizeGuard(groups).oversized` is `[]`.
  - `test('AC2.1: bundleCap <= 1 gives exactly one single-record group per candidate', …)`: 5 fast-lane records, 2 sharing a file. With `bundleCap: 1` and with `bundleCap: 0`, it returns 5 groups of length 1, and `groups.flat().map(i => i.number).sort()` equals the 5 input numbers.
  - `test('AC3.1: findInFlightNeighbours reports a live neighbour sharing a specific file, with that file', …)`: candidate `{id: 1, keyFiles: ['a.js', 'b.js']}`, in-flight `{id: 9, keyFiles: ['b.js']}` → `get(1)` deep-equals `[{ number: 9, files: ['b.js'] }]`.
  - `test('AC3.2: sharing only a bare-directory entry is not reported', …)`: shared `tests/` only → `get(1)` deep-equals `[]`.
  - `test('AC3.3: sharing only a path at or above the hub threshold is not reported', …)`: 3 candidates plus 1 in-flight record, all citing `hub.js` (count 4 ≥ 3), and nothing else shared → every candidate maps to `[]`.
  - `test('AC3.4: a candidate with no in-flight records returns an empty list', …)`: `findInFlightNeighbours([{id: 1, keyFiles: ['a.js']}], [])` → `get(1)` deep-equals `[]`.
  - `test('Review Focus 2: a candidate id repeated in inFlight is never its own neighbour', …)`: candidate `{id: 5, keyFiles: ['x.js']}`, in-flight `[{id: 5, keyFiles: ['x.js']}]` → `get(5)` deep-equals `[]`.
  - `test('directOverlaps is symmetric and omits pairs with no linking file', …)`: items 1:[a.js], 2:[a.js, b.js], 3:[c.js] → `get(1)` = `[{id: 2, files: ['a.js']}]`, `get(2)` = `[{id: 1, files: ['a.js']}]`, `has(3)` false.
  - `test('AC6.1: bundleFastLaneSingletons never bundles two conflicting fast-lane singletons', …)`: three fast-lane singletons A, B, C (oldest-first, same priority, no `auto:merge`); `conflicts` true only for (A, B) in either order; `bundleCap: 3` → no bundle contains both A and B. The expected bundles are `[[A, C]]`, with B passed through.
  - `test('AC6.2: with no conflicts option the output is byte-identical to the pre-change slicing', …)`: 7 fast-lane singletons, `bundleCap: 3`. `JSON.stringify(result)` must equal the literal output today's implementation produces for the same input. Capture it in Step 2 by running the current function before editing, then paste the literal into the assertion.
  - `test('Review Focus 4: conflicting pair is split deterministically under first-fit', …)`: four fast-lane singletons 1, 2, 3, 4 (oldest-first), `conflicts(1, 2)` true, `bundleCap: 3` → `bundles` deep-equals `[{ records: [1, 3, 4] }]`, with 2 passed through as a singleton.

- [ ] **Step 2: Capture the AC6.2 baseline literal, then run the tests to verify they fail**

  Run first, before any edit, to capture the literal:
  `node -e "const g=require('./plugin/bin/lib/issues/grouping'); const mk=(n)=>[{number:n,labels:[{name:'ceremony:fast-lane'},{name:'priority:medium'}],createdAt:'2026-01-0'+n+'T00:00:00Z'}]; console.log(JSON.stringify(g.bundleFastLaneSingletons([1,2,3,4,5,6,7].map(mk),{bundleCap:3})))"`

  Then: `node --test tests/bin-lib/issues/grouping.test.js`
  Expected: FAIL (`directOverlaps is not a function` / `buildDispatchGroups is not a function`).

- [ ] **Step 3: Implement the four functions in `plugin/bin/lib/issues/grouping.js`**

  Reuse `computeHubPaths` and the bare-directory rule. `buildDispatchGroups` maps ids back to issue objects, the same way `queue-pull-script.md` does today (`ids.map((id) => byId.get(id))`).

- [ ] **Step 4: Run the tests to verify they pass**

  Run: `node --test tests/bin-lib/issues/grouping.test.js`
  Expected: PASS, including every pre-existing test unedited.
  Then confirm AC7.1: `git diff --stat -- tests/bin-lib/issues/grouping.test.js` shows insertions only.
  `git diff -- tests/bin-lib/issues/grouping.test.js | grep -c '^-[^-]'` must print `0`. The only exception is the one `require` destructuring line, which may change.

- [ ] **Step 5: Commit**

  `git add plugin/bin/lib/issues/grouping.js tests/bin-lib/issues/grouping.test.js`, then commit `Add per-record dispatch grouping primitives — directOverlaps, findInFlightNeighbours, buildDispatchGroups`.

---

### Task 2: Queue-order cache grouping version

**Files:**
- Modify: `plugin/bin/lib/dispatch/queue-order.js`
- Test: `tests/bin-lib/dispatch/queue-order.test.js` (append)

**Interfaces:**
- **Produces:** `GROUPING_MODE = 'per-record'` (exported).
- **Produces:** `composeOrderBlob({...})` always writes `grouping: GROUPING_MODE` on the blob. Existing callers pass nothing new, so this is an additive field.
- **Produces:** `cacheUsable(persisted, current) -> boolean` = `!!persisted && persisted.grouping === GROUPING_MODE && signalsMatch(persisted.freshnessSignal, current)`. Never throws.

- [ ] **Step 1: Write the failing tests**
  - `composeOrderBlob carries grouping: 'per-record'`.
  - `Review Focus 1: cacheUsable rejects a blob with no grouping field even when signals match` (build the blob by hand without `grouping`).
  - `cacheUsable accepts a per-record blob whose signals match`.
  - `cacheUsable rejects mismatched signals`.
  - `cacheUsable(null, x) is false`.

  **Return-shape widening:** both existing `composeOrderBlob` tests (`tests/bin-lib/dispatch/queue-order.test.js:107` and `:116`) `deepStrictEqual` the blob. Extend both expected objects with `grouping: 'per-record'`, and name the widening in the commit message. Then `grep -rn "composeOrderBlob\|readOrder(" tests/ plugin/` for any other literal-shape assertion or reader, and list each hit in the commit body.
- [ ] **Step 2:** Run `node --test tests/bin-lib/dispatch/queue-order.test.js`. Expected: FAIL (`cacheUsable is not a function`).
- [ ] **Step 3:** Implement in `queue-order.js`, with one comment line naming #3278 as the reason the field exists.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit**

  `git add plugin/bin/lib/dispatch/queue-order.js tests/bin-lib/dispatch/queue-order.test.js`, then commit `Version the dispatch queue-order cache by grouping rule — per-record blobs only`.

---

### Task 3: Neighbour-in-flight exclusion module

**Files:**
- Create: `plugin/bin/lib/dispatch/in-flight-neighbours.js`
- Test: `tests/bin-lib/dispatch/in-flight-neighbours.test.js`

**Interfaces:**
- **Consumes:** `findInFlightNeighbours`, `extractKeyFiles` (Task 1, `../issues/grouping`); `classifyClaimBlob` (`../issues/claims`).
- **Produces:** `neighbourInFlightExclusions({ candidates, inFlight, readClaimContent, now, hubOptions = {} }) -> { exclusions, unreadable }`.
  - **Inputs:** `candidates` and `inFlight` are issue objects (`number`, `body`). `readClaimContent(number) -> { content: string|null } | { failure: string }`, and may throw.
  - **Pruning:** call `findInFlightNeighbours` first and read claims only for in-flight numbers that appear as some candidate's neighbour, each read at most once.
  - **Liveness:** a neighbour is live iff its read returned `{content}` and `classifyClaimBlob(content, now).state === 'live'`.
  - **Failures:** a thrown read or a `failure` result adds the number to `unreadable` (sorted, unique) and counts as not live.
  - **Output:** `exclusions` holds `{ reason: 'neighbour-in-flight', records: [candidateNumber], detail: { neighbours: [{ number, files }] } }` for each candidate with ≥1 live neighbour (only its live neighbours listed), ordered by candidate number ascending.

- [ ] **Step 1: Write the failing tests**
  - **Helpers:** a `rec(number, files)` body builder, as in Task 1.
  - **Live claim:** `const live = JSON.stringify({ runId: 'r', claimedAt: new Date(NOW).toISOString(), ttlHours: 72 })`.
  - **Expired claim:** `claimedAt` 100h before `NOW`.
  - **Tombstone:** `JSON.stringify({ released: true })`.
  - `AC4.0 (positive control): a live-claimed neighbour sharing a file produces one exclusion` → `exclusions` deep-equals `[{ reason: 'neighbour-in-flight', records: [1], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } }]`.
  - `AC4.1: an absent claim blob ({content: null}) produces no exclusion`.
  - `AC4.1: an expired claim produces no exclusion`.
  - `AC4.1: an unreadable claim blob ('not json') produces no exclusion`.
  - `AC4.1: a leftover bot:in-progress label with a tombstone claim produces no exclusion`.
  - `AC4.2: a failed claim read ({failure}) and a thrown read both mean not in flight, and are listed in unreadable`.
  - `Review Focus 3: one throwing read does not stop a live neighbour of another candidate from excluding it`: two candidates, two in-flight records; the reader throws for one and returns live for the other → exactly one exclusion, and `unreadable` = `[thrower]`.
  - `Review Focus 5: an empty inFlight pool yields no exclusions and no reads`: `readClaimContent` asserts it is never called.
  - `reads each in-flight number at most once even when it neighbours two candidates`: count the calls.
- [ ] **Step 2:** Run `node --test tests/bin-lib/dispatch/in-flight-neighbours.test.js`. Expected: FAIL (`Cannot find module`).
- [ ] **Step 3:** Implement `plugin/bin/lib/dispatch/in-flight-neighbours.js`. Give it a header comment in the house style: the purpose, plus why a failed read fails open, citing #3278's accepted gap that merge-time conflicts are handled by `_shared/pr-first-merge.md`'s Conflict path.
- [ ] **Step 4:** Run the same command. Expected: PASS.
- [ ] **Step 5: Commit**

  `git add plugin/bin/lib/dispatch/in-flight-neighbours.js tests/bin-lib/dispatch/in-flight-neighbours.test.js`, then commit `Add the neighbour-in-flight exclusion module — live direct neighbours only, fail open`.

---

### Task 4: Wire the queue pull

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md`
- Test: `tests/dispatch-named-form-exclusion-reasons.test.js` (append one test); the existing `tests/node-eval-file-heredoc-syntax.test.js` checks the new heredoc's syntax automatically.

**Interfaces:**
- **Consumes:** `buildDispatchGroups` (Task 1), `cacheUsable` (Task 2), `neighbourInFlightExclusions` (Task 3).
- **Consumes:** `readClaimBlob`, `defaultGhApi` (`bin/lib/issues/claim-store.js`); `defaultRunner` (`bin/lib/issues/claims-git-cas.js`). These are the same readers `specify/shaping-mode.md`'s near-duplicate refusal snippet uses: chain `tip` from the first `via: 'git'` read so the whole pass costs one fetch.
- **Produces:** `neighbour-in-flight` entries in `dispatch-exclusions.json`, consumed by Task 5's ranking and Task 6's report.

- [ ] **Step 1: Write the failing test** (append to `tests/dispatch-named-form-exclusion-reasons.test.js`)

```js
test('AC5.3: neighbour-in-flight is a queue-pull reason that is not removing (#3278)', () => {
  assert.ok(QUEUE_PULL.includes("- `reason: 'neighbour-in-flight'`"), 'queue-pull-script.md has no neighbour-in-flight reason bullet');
  assert.ok(!REMOVING_REASONS.includes('neighbour-in-flight'), 'neighbour-in-flight records stay in dispatch-groups.json');
});
```

- [ ] **Step 2:** Run `node --test tests/dispatch-named-form-exclusion-reasons.test.js`. Expected: FAIL on the first assertion.
- [ ] **Step 3: Edit `queue-pull-script.md`**, all within the one fenced script except the bullet edits:
  1. **Reason bullet.** After the `oversized` bullet, add a bullet starting ``- `reason: 'neighbour-in-flight'` (`detail: {neighbours: [{number, files}]}`, #3278) — `` and covering three points:
     - every remaining candidate sharing a linking Key File with an open `bot:in-progress` record whose claim blob reads `live`;
     - that these records stay IN `dispatch-groups.json` (use that exact phrase);
     - that only bare drain's ranking skips them, while `#N`/`#N,#M,...` report and dispatch.

     Name the fail-open posture: an unreadable claim or a failed fetch means no exclusion.
  2. **Count reword.** Replace `A sixth reason, \`firing\`,` with `One further reason, \`firing\`,`, so the count needs no upkeep. Run the three-form renumbering grep in Step 4.
  3. **Cache-hit block.** Replace `if (!signalsMatch(persisted.freshnessSignal, current)) { console.log('0'); process.exit(0); }` with a `cacheUsable(persisted, current)` check, and update its `require` to import `cacheUsable`. Keep `buildFreshnessSignal` imported.
  4. **Cache-miss grouping block.** Replace `const rawGroups = groupByFileOverlap(items).map((ids) => ids.map((id) => byId.get(id)));` and the following `bundleFastLaneSingletons(rawGroups, { bundleCap })` call with `const { groups, bundles } = buildDispatchGroups(finalEligible, { bundleCap });`.
     - Keep the `items` construction, because the missing-Key-Files warning loop still reads it.
     - Drop the now-unused `groupByFileOverlap`/`bundleFastLaneSingletons` names from that block's `require`.
     - Update the "#1910" comment to say grouping is per-record (#3278) with fast-lane bundles kept disjoint.
  5. **In-flight fetch.** Add `DISPATCH_IN_FLIGHT_RAW: 'dispatch-in-flight-raw.json',` to the `files` map.
  6. **Neighbour pass.** Insert it after the shipped-candidate pass's closing `fi` and before the `# #1579` cross-PR comment. It must be a single comment of at most 4 lines naming #3278, followed by:

```bash
gh issue list --label bot:in-progress --state open --json number,body,labels --limit 200 > "$DISPATCH_IN_FLIGHT_RAW" 2>/dev/null || echo '[]' > "$DISPATCH_IN_FLIGHT_RAW"
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" "$DISPATCH_EXCLUSIONS" <<NODE_EVAL_EOF
  const { execFileSync } = require('child_process');
  const { neighbourInFlightExclusions } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/in-flight-neighbours.js');
  const { readClaimBlob, defaultGhApi } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claim-store.js');
  const { defaultRunner } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims-git-cas.js');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  let slug = null;
  try { slug = execFileSync('gh', ['repo', 'view', '--json', 'nameWithOwner', '-q', '.nameWithOwner'], { encoding: 'utf8' }).trim(); } catch {}
  let tip = null;
  const readClaimContent = (n) => {
    const r = readClaimBlob({ gitRunner: defaultRunner, ghApi: defaultGhApi }, slug, n, tip);
    if (r.failure) return { failure: r.failure };
    if (r.via === 'git') tip = r.sha;
    return { content: r.absent ? null : r.content };
  };
  const { exclusions, unreadable } = neighbourInFlightExclusions({
    candidates: require(process.argv[1]).flat(), inFlight: require(process.argv[2]), readClaimContent, now: Date.now(),
  });
  for (const e of exclusions) appendExclusion(process.argv[3], e);
  if (unreadable.length) console.error('AUTO — dispatch: neighbour-in-flight claim read failed for #' + unreadable.join(', #') + '; treated as not in flight');
NODE_EVAL_EOF
NEIGHBOUR_RC=$?
if [ "$NEIGHBOUR_RC" -ne 0 ]; then
  echo "dispatch: queue-pull stopped -- neighbour-in-flight exclusion pass failed (exit $NEIGHBOUR_RC); see error above." >&2
  exit 1
fi
```

     **Verbatim-command run-once check:** before committing, run the `gh issue list --label bot:in-progress …` line once read-only (to a scratch file), and record its count in the commit body. **Behavioral claim:** the `exit 1` mirrors the #3110 convention, because a throwing `appendExclusion` means the exclusions file may be partially written.
  7. **Near-duplicate comment.** In the `# #1944` comment, replace "(a same-group pair is already co-built together by groupByFileOverlap, and has nothing new to warn about here)" with "(a same-group pair is a fast-lane bundle's members, already co-built together, and has nothing new to warn about here)".
- [ ] **Step 4: Run the checks**
  - `node --test tests/dispatch-named-form-exclusion-reasons.test.js tests/node-eval-file-heredoc-syntax.test.js tests/node-e-snippet-syntax.test.js tests/session-tmp-root-migration.test.js tests/dispatch-not-spec-shaped-exclusion-fixture.test.js tests/dispatch-named-target-exclusion-fixture.test.js tests/dispatch-shipped-candidate-prose.test.js`. Expected: PASS.
  - `wc -c plugin/skills/dispatch/queue-pull-script.md`: must be ≤ 51200.
  - **Renumbering, three forms:** `grep -rn "sixth reason" plugin/ tests/`, `grep -rn "six reasons" plugin/ tests/`, `grep -rn "A sixth" plugin/skills/dispatch`. All must be empty.
- [ ] **Step 5: Commit**

  `git add plugin/skills/dispatch/queue-pull-script.md tests/dispatch-named-form-exclusion-reasons.test.js`, then commit `Group the dispatch queue per record and add the neighbour-in-flight pass — #3278`.

---

### Task 5: Bare-drain ranking skips neighbour-in-flight groups

**Files:**
- Modify: `plugin/skills/dispatch/next-ranking.md`:
  - line 52, `groupIsExcluded(g, entries, ['oversized', 'firing'])` → `['oversized', 'firing', 'neighbour-in-flight']`;
  - line 25 (prose naming the reasons checked together) and line 9's lead sentence, so that both name `neighbour-in-flight`.
- Modify: `plugin/skills/dispatch/firing-exclusion.md:44`: the same reasons-list statement.
- Test: `tests/dispatch-firing-exclusion.test.js`. Extend `runRanking` with an optional `extraEntries = []` that is concatenated into `entries`, then append a test.

**Interfaces:** Consumes the `neighbour-in-flight` entry shape from Task 3.

- [ ] **Step 1: Write the failing test**

```js
test('AC5.1: bare-drain ranking never selects a group with a neighbour-in-flight member (#3278)', () => {
  const pick = runRanking({
    groups: [group(100, { priority: 'high' }), group(300, { priority: 'low' })],
    extraEntries: [{ reason: 'neighbour-in-flight', records: [100], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } }],
  });
  assert.ok(pick, 'expected a pick');
  assert.strictEqual(pick[0].number, 300);
});
```

- [ ] **Step 2:** Run `node --test tests/dispatch-firing-exclusion.test.js`. Expected: FAIL (picks 100).
- [ ] **Step 3:** Make the three prose/code edits.
- [ ] **Step 4:** Run the same command. Expected: PASS. Also run `grep -n "'oversized', 'firing'" plugin/skills/dispatch/*.md`: every hit must now include `'neighbour-in-flight'`.
- [ ] **Step 5: Commit**

  Commit `next-ranking.md`, `firing-exclusion.md` and the test with the message `Skip neighbour-in-flight groups in bare-drain ranking — #3278`.

---

### Task 6: Dispatch SKILL.md, the new report, and the oversized report

**Files:**
- Create: `plugin/skills/dispatch/neighbour-in-flight-report.md` (shape mirrors `oversized-group-report.md`).
  - **Header:** `# Dispatch Step 3 — Neighbour-in-Flight Report`, plus a "Referenced by" line.
  - **Input:** this run's `dispatch-exclusions.json`, filtered to `reason: 'neighbour-in-flight'`.
  - **Output:** one line per entry, ``#{n} waits — direct neighbour(s) in flight: #{m} ({files}); bare drain skips it this firing``.
  - **Rules:** for `#N`/`#N,#M,...` the same line prints and the record still dispatches; the drain+zero-eligible exception is the same as the other reports; omit when empty.
- Modify: `plugin/skills/dispatch/SKILL.md`:
  - lines 48–49 table cells → "select + dispatch record `#N`'s group (the record itself, or the fast-lane bundle it was folded into)", plus the matching list wording;
  - after line 156, add `**Neighbour-in-flight report (refs #3278).** See \`neighbour-in-flight-report.md\`, this skill's directory (bare drain skips the record this firing; \`#N\`/\`#N,#M,...\` print the line and still dispatch).`;
  - lines 160–164: the near-duplicate paragraph's "Same-group pairs are already co-built together by Step 2's grouping" → "Same-group pairs (a fast-lane bundle's members) are already co-built together";
  - line 169's Loop: "oversized and this-firing-excluded groups" → "oversized, neighbour-in-flight, and this-firing-excluded groups";
  - line 178, the `#N` bullet's last sentence (from "Otherwise pull its **whole file-overlap group**" to the end) → "Otherwise take its group from Step 2's output — the record itself, or the fast-lane bundle it was folded into; when this run's `dispatch-exclusions.json` carries a `neighbour-in-flight` entry for it, print `neighbour-in-flight-report.md`'s line first and dispatch anyway.";
  - line 180, the `#N[,#M,#O...]` bullet: append "A selected record with a `neighbour-in-flight` entry prints that report's line and still dispatches.";
  - lines 211–215: "This group's own file-overlap membership was already fixed by Step 2's `groupByFileOverlap` queue pull … the same primitive …" → "This group's membership (one record, or one fast-lane bundle) was already fixed by Step 2's queue pull (`queue-pull-script.md`, `grouping.js`'s `buildDispatchGroups`). This step re-derives nothing; it only mints a directory for the group Step 2 already computed.";
  - line 303's Anti-Patterns row: "Claiming a single member of a file-overlap group without its partners" / "The branch and its overlap partners would race" → "Claiming one member of a fast-lane bundle without the rest" / "The bundle shares one branch and PR — `_shared/issue-claims.md`'s group-claim rule requires every member before starting any".
- Modify: `plugin/skills/dispatch/oversized-group-report.md`: append "Since #3278 a group is one record or one fast-lane bundle, so this report fires only when `dispatch-fastlane-bundle-cap` is set above `dispatch-group-size-guard`."
- Modify: `docs/plugin-structure.md:106`: add `neighbour-in-flight-report.md` to the dispatch row, after `oversized-group-report.md`.
- Create test: `tests/dispatch-per-record-groups-prose.test.js`.

- [ ] **Step 1: Write the failing test** `tests/dispatch-per-record-groups-prose.test.js`. Use `readText` from `./helpers/read-skill` and `CEILING_BYTES` from `../plugin/bin/lib/skill-audit/context-cost`.
  - `AC5.2: the #N bullet prints the neighbour-in-flight report line and dispatches anyway`: the `**\`#N\`** — direct.` line includes `neighbour-in-flight-report.md` and `dispatch anyway`.
  - `AC8.2: no dispatch prose says a record pulls its whole file-overlap group`: none of `dispatch/SKILL.md`, `_shared/issue-claims.md`, `help/reference-card.md`, `docs/getting-started.md` contains `whole file-overlap group`. Task 7 edits the last three; this test lands in Task 6 and stays red on those three until Task 7. To keep each task green on its own, split it into a Task 6 assertion over `dispatch/SKILL.md` only and a Task 7 assertion over the other three.
  - `AC9.1: dispatch SKILL.md and queue-pull-script.md stay within CEILING_BYTES`: `Buffer.byteLength` ≤ `CEILING_BYTES` for both.
  - `neighbour-in-flight-report.md exists and is cited from SKILL.md Step 3`.
- [ ] **Step 2:** Run `node --test tests/dispatch-per-record-groups-prose.test.js`. Expected: FAIL.
- [ ] **Step 3:** Make the edits above. **Moved-prose pin check:** before editing, run `grep -rn -E "co-built together by Step 2|overlap partners would race|whole file-overlap group|re-derives nothing" tests/`. Expect no hits; if any appear, re-point them in this task.
- [ ] **Step 4: Run the checks**
  - `node --test tests/dispatch-per-record-groups-prose.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/bin-lib/dispatch/reporting-fastlane-bundle-citation.test.js tests/skill-catalog-completeness.test.js tests/bin-lib/skill-audit/context-cost.test.js`. Expected: PASS.
  - `wc -c plugin/skills/dispatch/SKILL.md` ≤ 51200.
- [ ] **Step 5: Commit**

  Commit the files with the message `Describe per-record dispatch groups and add the neighbour-in-flight report — #3278`.

---

### Task 7: Shared contract, cross-references, policy text, decision record

**Files:**
- Modify: `plugin/skills/_shared/issue-claims.md`:
  - **lines 279–287 (Group claiming):** dispatch groups are single records or fast-lane bundles (`grouping.js`'s `buildDispatchGroups`, #3278). Claiming every member before starting any applies to a fast-lane bundle. File overlap between separate groups is guarded by the `neighbour-in-flight` exclusion (`dispatch/queue-pull-script.md`), not by bundling, and anything it misses is resolved at merge by `_shared/pr-first-merge.md`'s Conflict path. Keep the partial-claim and racing-convergence sentences, reworded from "group" to "bundle" where they describe bundles.
  - **line 533:** "the record's whole file-overlap group" → "the record's group (itself, or its fast-lane bundle)".
  - **line 612:** "Selects each authorized record's whole file-overlap group" → "Selects each authorized record's group (the record, or its fast-lane bundle)".
- Modify: `plugin/skills/help/reference-card.md:45` and `docs/getting-started.md:122`: the same "whole file-overlap group" rewording.
- Modify: `plugin/bin/lib/policy-schema.js:63`: change the `dispatch-group-size-guard` summary to "Caps a dispatch group's size before bare-drain selection excludes it; since per-record grouping only a large fast-lane bundle can exceed it." This must be ≤ 140 chars and must not contain the key; trim if over.
- Modify: `plugin/skills/_shared/policy-schema.md:130` and `plugin/skills/dispatch/configuration.md:11`: the row text for the same key states that groups are per-record, so only a fast-lane bundle larger than the guard trips it. Do not copy the `.js` summary verbatim.
- Modify: `plugin/skills/dispatch/design-notes.md`: append a `## Why per-record groups, not transitive file-overlap groups` section (#3278).
  - **Defect:** "must not be in flight together" is pairwise, but union-find spread it along chains. The live 2026-10-17 queue had one 18-record group held by 25 real direct overlaps, and no path was cited by the hub threshold of 7.
  - **Rejected alternatives:** (1) hub exclusion already ships (#1365) and lowering it would split real conflicts; (2) a weakest-edge cut needs a deterministic rule racing firings agree on, and it keeps the bundle model; (3) an `#N`-only neighbourhood leaves bare drain starving.
  - **Accepted gaps:** two firings picking neighbours at once; same-hunk conflicts parking `pending-review`; tests pinning bytes across files.
- Modify: `plugin/bin/lib/dispatch/exclusions.js:90`: the comment "(a file-overlap group -- {number}[])" → "(a dispatch group -- {number}[])".
- Test: append to `tests/dispatch-per-record-groups-prose.test.js`.

- [ ] **Step 1: Write the failing tests** (append)
  - `AC8.1: issue-claims Group claiming says groups are single records or fast-lane bundles and all-members claiming applies to bundles`: slice `_shared/issue-claims.md` from `### Group claiming` to the next `**Post-write verification`. The slice must match `/single records? or (?:a |one )?fast-lane bundles?/i` and `/fast-lane bundle/`, and include `neighbour-in-flight`.
  - `AC8.2 (shared/help/docs): no prose says a record pulls its whole file-overlap group`, covering the three non-dispatch files.
  - `design-notes.md records the per-record decision with its three rejected alternatives`: heading present, and the section names `#1365`, `weakest`, and `bare drain`.
- [ ] **Step 2:** Run `node --test tests/dispatch-per-record-groups-prose.test.js`. Expected: FAIL on the new tests.
- [ ] **Step 3:** Make the edits.
- [ ] **Step 4: Run the checks**
  - `node --test tests/dispatch-per-record-groups-prose.test.js tests/policy-schema.test.js tests/policy-schema-metadata.test.js tests/bin-lib/dispatch/exclusions.test.js`. Expected: PASS.
  - `grep -rn "whole file-overlap group" plugin/ docs/`: must be empty.
- [ ] **Step 5: Commit**

  Commit with the message `Re-describe dispatch groups as per-record across shared contracts and docs — #3278`.

---

### Task 8: Real-input probe and full suite

**Files:** none committed beyond what earlier tasks produced; the scratch output stays scratch.

- [ ] **Step 1: Real-input probe.**
  - Snapshot the live queue with `gh issue list --label auto:build --state open --json number,title,body,labels,createdAt --limit 500 > {scratch}/q.json`, and keep the records eligible the way the queue pull does: `grants.build`, and none of `bot:in-progress`, `bot:blocked`, `bot:parked`.
  - Run `buildDispatchGroups(eligible, { bundleCap: 3 })` and print the largest group size, alongside `groupByFileOverlap(items)`'s largest group size over the same input.
  - **Independent count:** `jq` the eligible count from `q.json` (`[.[] | select(...)] | length`) and reconcile it with `groups.flat().length`.
  - Record all three numbers in the ledger as an `observation` row.
- [ ] **Step 2: Full suite (AC9.2).** Run `npm test > {scratch}/npm-test.log 2>&1; echo exit=$?` and read the tail. Expected: exit 0. On failure, run the failing files in isolation before concluding anything.
- [ ] **Step 3:** No commit unless the probe or the suite forced a fix; such a fix commits under its owning task's message style.
