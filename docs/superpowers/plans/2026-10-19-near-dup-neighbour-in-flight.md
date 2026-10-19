# Near-Duplicate Neighbour-in-Flight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A strong near-duplicate of an in-flight record counts as a neighbour in dispatch's neighbour-in-flight pass; an explicit list names the predicted conflict and merge order before it dispatches; the drain-PR overlap re-check and auto-merge hold gain a near-duplicate hit source.

**Architecture:** One predicate (`isStrongNearDuplicate`) in `near-duplicate.js` decides "strong". `in-flight-neighbours.js` merges strong hits into its existing per-candidate neighbour list. A new pure module, `plugin/bin/lib/dispatch/near-dup-pairs.js`, owns pair enumeration, predicted-conflict selection, and drain-PR hit matching, so the near-ceiling skill prose (`queue-pull-script.md` is about 48.9 KB, `SKILL.md` about 46.3 KB) only calls functions. The new module departs from the spec's Key Files; it's a byte-headroom and testability call.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-19T034328-spec-3520/work/3520-spec.md`

Scope keywords: findNearDuplicates, neighbour-in-flight, DRAIN_OVERLAP_HOLD_RE, dispatch-near-dup-pairs

## Global Constraints

- Strong = `sharedAnchors.length >= 2 || score >= 2`, one exported constant `STRONG_NEAR_DUPLICATE_MIN = 2` bounding both. No second rule anywhere.
- `findNearDuplicates`' existing hit fields (`number`, `title`, `score`, `signals`), scores and ordering are unchanged; `sharedAnchors` is additive.
- No new exclusion reason: near-duplicate neighbours reuse `reason: 'neighbour-in-flight'`.
- A file-only neighbour element stays exactly `{number, files}`, with no `signals`/`sharedAnchors` keys.
- Fail open: an unreadable claim or failed fetch excludes nothing (existing rule).
- The Step 6 hold line keeps the literal prefix `held — overlaps drain PR #{pr}` so `DRAIN_OVERLAP_HOLD_RE` still matches.
- `detectCrossPRFileOverlap` is not modified.
- Same-group pairs stay silent.
- Existing prose pins stay green: `neighbour-in-flight-report.md` keeps `waits — direct neighbour(s) in flight` and `bare drain skips it this firing` (`tests/dispatch-per-record-groups-prose.test.js`); `queue-pull-script.md` keeps the `` - `reason: 'neighbour-in-flight'` `` bullet start (`tests/dispatch-named-form-exclusion-reasons.test.js`), the `# #3278: neighbour-in-flight pass` anchor, and the `#1944: cross-group near-duplicate candidate warning` / `near-duplicate candidates across groups` strings (`tests/specify-near-duplicate-prose.test.js`).
- Commit subjects: `{Verb} {what} — {detail}`, ending with the `Claude-Session:` trailer from the session.

## Review Focus

1. A pair that matches both rules (shared Key File and strong near-duplicate) must yield ONE neighbour element carrying both `files` and `signals`, not two elements. Pinned in Task 2.
2. An in-flight record that is also a candidate (same number in both lists) must not neighbour itself or another candidate via the near-duplicate rule, mirroring `findInFlightNeighbours`. Pinned in Task 2.
3. A `parked`/`parent-issue` in-flight record never becomes a near-duplicate neighbour, because `findNearDuplicates` skips it. Pinned in Task 2.
4. The near-duplicate pairs file must be rewritten (`[]`) on every pull, so a prior pull's pairs never leak into a later Step 4/6 check. Pinned in Task 4.
5. A drain-PR near-duplicate hit whose partner is in the same group (both members) is not a hit. Pinned in Task 3.

---

### Task 1: `sharedAnchors` and the strong predicate

Covers: AC4.1, AC2.3

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js` (Signal 3 loop ~lines 181-192, constants, exports)
- Test: `tests/bin-lib/issues/near-duplicate.test.js`

**Interfaces:**
- Produces: hits shaped `{ number, title, score, signals, sharedAnchors: string[] }` (`sharedAnchors` sorted ascending, `[]` when Signal 3 did not fire); `STRONG_NEAR_DUPLICATE_MIN = 2`; `isStrongNearDuplicate(hit) -> boolean`, false for a null/malformed hit.

- [ ] **Step 1: Write the failing tests** (append to the suite; covers AC4.1):
  - `AC4: every hit carries sharedAnchors, empty when body-anchor-overlap did not fire`: the existing key-files-overlap fixture (line 24's shape) gives `hit.sharedAnchors` deepStrictEqual `[]`; the line-54 body-anchor fixture gives a non-empty array.
  - `AC4: existing fields, scores and ordering are unchanged`: run the sorting fixture (line 185's shape) and assert `hits.map(({number, title, score, signals}) => ({number, title, score, signals}))` equals the values that test already asserts.
  - `sharedAnchors lists every shared Current State anchor, sorted`: subject and record both cite `` `docs/donts.md` ``, `` `fs.realpathSync` ``, `` `fs.realpathSync.native` `` under `## Current State`, with unrelated titles and no Key Files, giving `['docs/donts.md', 'fs.realpathSync', 'fs.realpathSync.native']`, score 1.
  - `isStrongNearDuplicate: 2+ shared anchors or score >= 2 is strong; one anchor alone is not`: `{score:1, sharedAnchors:['a','b']}` gives true; `{score:2, sharedAnchors:[]}` gives true; `{score:1, sharedAnchors:['a']}` gives false; `null` and `{}` give false; `STRONG_NEAR_DUPLICATE_MIN === 2`.
  - `generic shared anchors never count toward sharedAnchors`: two bodies sharing only `` `--run-dir` `` and `` `/claude-tweaks:dispatch` `` produce no hit.

- [ ] **Step 2: Run to verify it fails**
  Run: `node --test tests/bin-lib/issues/near-duplicate.test.js`
  Expected: FAIL, with `sharedAnchors` undefined and `isStrongNearDuplicate is not a function`.

- [ ] **Step 3: Implement.** Replace the `anchorOverlap` short-circuit with a collected, sorted intersection; push `body-anchor-overlap` when it is non-empty; add `sharedAnchors` to the pushed hit. Add the constant and the predicate beside `MIN_REFUSAL_SCORE`, with a one-line comment citing #3520 and the two calibration points. Export both. `shapingRefusal` is untouched.

- [ ] **Step 4: Verify.** `node --test tests/bin-lib/issues/near-duplicate.test.js tests/specify-near-duplicate-prose.test.js` passes.

- [ ] **Step 5: Commit** both files: `Add sharedAnchors and isStrongNearDuplicate to findNearDuplicates — threshold for the near-duplicate neighbour rule (#3520)`.

### Task 2: Near-duplicate neighbours in the neighbour-in-flight pass

Covers: AC1.1, AC1.2, AC2.1, AC2.2, AC2.3, AC3.1, AC3.2, AC5.1, AC9.1

**Files:**
- Modify: `plugin/bin/lib/dispatch/in-flight-neighbours.js`
- Test: `tests/bin-lib/dispatch/in-flight-neighbours.test.js`

**Interfaces:**
- Consumes: `findNearDuplicates`, `isStrongNearDuplicate` (Task 1).
- Produces: unchanged signatures. `neighbourInFlightExclusions(...)` neighbour elements are `{number, files}` (file-only), `{number, files: [], signals, sharedAnchors}` (near-duplicate-only), or `{number, files: [...], signals, sharedAnchors}` (both). `neighbourClaimTargets(...)` returns the sorted union of file and near-duplicate neighbours. Candidates and in-flight records are full issue objects (`number`, `title`, `body`, `labels`).

- [ ] **Step 1: Write the failing tests** (covers AC1.1, AC1.2, AC2.1, AC2.2, AC2.3, AC3.1, AC3.2, AC5.1; AC9.1 is Step 5's revert proof against the AC1 test). Add a `nd(number, title, anchors)` fixture helper: a body with `## Current State` citing each anchor in backticks and no `### Key Files`.
  - `AC1: a #3417/#3419-shaped pair with no Key Files and three shared anchors excludes`: candidate `nd(1, 'Alpha widget gate', ['docs/donts.md','fs.realpathSync','fs.realpathSync.native'])`, in-flight `nd(9, 'Zeta ledger sweep', same)`, live claim gives exactly one exclusion `{reason:'neighbour-in-flight', records:[1], detail:{neighbours:[{number:9, files:[], signals:['body-anchor-overlap'], sharedAnchors:[those 3, sorted]}]}}`.
  - `AC2: one shared non-generic anchor (a #3417/#3012 shape) does not exclude`: one anchor `plugin/bin/lib/hooks/pre-tool-use.js` gives `{exclusions:[], unreadable:[]}`, and the reader is never called.
  - `AC2: two shared anchors exclude`.
  - `AC2: shared anchors that are all generic do not exclude`: anchors `--run-dir`, `/claude-tweaks:dispatch`, `auto:build`.
  - `AC3: a strong near-duplicate with an expired or tombstoned claim does not exclude; a failed read lists it in unreadable`: reuses `expired`/`tombstone`/`{failure}`.
  - `AC5: a file-only neighbour element carries no signals key`: the existing positive control's element `Object.keys` deepStrictEqual `['number','files']`.
  - `Review Focus 1: a record matching both rules yields one element with files and signals`.
  - `Review Focus 2: an in-flight record that is also a candidate is never a near-duplicate neighbour`.
  - `Review Focus 3: a parked in-flight near-duplicate is not a neighbour`.
  - `neighbourClaimTargets includes near-duplicate neighbours`: the AC1 pair gives `[9]`.
  - Keep every existing test unchanged; they must still pass.

- [ ] **Step 2: Run to verify it fails.** `node --test tests/bin-lib/dispatch/in-flight-neighbours.test.js` should FAIL on AC1/AC2-two/RF1/claim-targets.

- [ ] **Step 3: Implement** a private `collectNeighbours(candidates, inFlight, hubOptions) -> Map<candidateNumber, Array<element>>`. It calls `findInFlightNeighbours` as today, then, per candidate, `findNearDuplicates(candidate, pool)`, where `pool` is in-flight records whose number is not any candidate's number. It keeps `isStrongNearDuplicate` hits and merges them keyed on in-flight number: the existing file elements first, in their existing order, then near-duplicate-only elements by ascending number. Both `neighbourInFlightExclusions` and `neighbourClaimTargets` iterate this map. The output mapping preserves file-only elements as `{number, files}` exactly. Update the header comment to name both rules (#3278, #3520).

- [ ] **Step 4: Verify.** `node --test tests/bin-lib/dispatch/in-flight-neighbours.test.js tests/dispatch-neighbour-in-flight-mcp.test.js` passes.

- [ ] **Step 5: AC9.1 revert proof.** Temporarily make `collectNeighbours` skip the near-duplicate merge. Run the suite and confirm AC1 is red, quoting the failing test name. Restore, and confirm green again.

- [ ] **Step 6: Commit** both files: `Count strong near-duplicates as neighbours in the neighbour-in-flight pass — closes the no-Key-Files blind spot (#3520)`.

### Task 3: Pair enumeration, predicted conflicts, drain-PR hits

**Files:**
- Create: `plugin/bin/lib/dispatch/near-dup-pairs.js`
- Test: `tests/bin-lib/dispatch/near-dup-pairs.test.js`

**Interfaces:**
- Consumes: `findNearDuplicates`, `isStrongNearDuplicate` (Task 1).
- Produces:
  - `nearDuplicatePairsAcrossGroups(groups: issue[][]) -> [{records:[subject, hit], signals, sharedAnchors, strong: boolean}]`. Iteration order and dedup are identical to today's `queue-pull-script.md` near-duplicate heredoc (groups in order, subjects in order, the first sighting of an unordered pair wins), so its stderr line is unchanged.
  - `predictedConflicts(pairs, selectedGroups: issue[][]) -> [{first, second, signals, sharedAnchors}]`: only pairs whose two members sit in two different selected groups; `first` is the member in the lower-indexed group. Ordered by `first`'s group index, then `second`'s.
  - `drainNearDuplicateHits(memberNumbers: number[], pairs, drainPrs: [{number, closingIssueNumbers}]) -> [{pr, member, partner}]`: one hit per (member, partner, PR) where the pair contains the member, the partner is not a member, and the PR closes the partner. Sorted by pr, then member.
  - All three return `[]` on null or malformed input, never throwing.

- [ ] **Step 1: Write the failing tests**, one per function plus edge cases:
  - The pairs-across-groups line order matches today's heredoc on a three-group fixture.
  - `strong` is set per `isStrongNearDuplicate`.
  - A same-group pair is omitted.
  - `predictedConflicts` drops a pair with a member outside `selectedGroups`, and orders by group index.
  - `drainNearDuplicateHits` finds a partner closed by a drain PR; Review Focus 5 (partner is a member) gives `[]`; a PR closing an unrelated issue gives `[]`.
  - Null inputs give `[]`.

- [ ] **Step 2: Run to verify it fails.** `node --test tests/bin-lib/dispatch/near-dup-pairs.test.js` FAILS with `Cannot find module`.

- [ ] **Step 3: Implement** the module (header comment: pure, no I/O, #3520).

- [ ] **Step 4: Verify.** The same command passes.

- [ ] **Step 5: Commit** both files: `Add near-dup-pairs module — pair enumeration, predicted conflicts and drain-PR hits for dispatch (#3520)`.

### Task 4: Queue-pull and MCP wiring

Covers: AC8.1, AC8.2

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (files map ~line 17-46; reason list line 7; in-flight fetch line 614; near-duplicate heredoc lines 672-695)
- Modify: `plugin/skills/dispatch/mcp-transport.md` (Step 2 pool, step 1's `[{number, body, labels}]`)
- Test: `tests/dispatch-neighbour-in-flight-mcp.test.js`; Create: `tests/dispatch-near-dup-pairs-script.test.js`

**Interfaces:**
- Consumes: `nearDuplicatePairsAcrossGroups` (Task 3).
- Produces: a session-scoped `$DISPATCH_NEAR_DUP_PAIRS` (`'dispatch-near-dup-pairs.json'`) holding `[{records:[A,B], signals, sharedAnchors}]`, strong pairs only, rewritten on every pull.

- [ ] **Step 1: Write the failing tests** (covers AC8.1, AC8.2).
  - New script test, extract-and-run style (copy the `snippet`/`run` mechanics from the MCP test). Extract the `#1944` heredoc from `queue-pull-script.md`, run it over a groups fixture holding one strong and one weak cross-group pair with `DISPATCH_NEAR_DUP_PAIRS` set. Assert:
    - stderr still has both `AUTO — dispatch: near-duplicate candidates across groups:` lines;
    - the file holds only the strong pair, without a `strong` key;
    - Review Focus 4: a second run over a pair-free fixture rewrites the file to `[]`.
  - The same new test asserts:
    - the files map declares `DISPATCH_NEAR_DUP_PAIRS: 'dispatch-near-dup-pairs.json'`;
    - the `bot:in-progress` fetch's `--json` list is `number,title,body,labels` (AC8);
    - the reason-list bullet names both neighbour rules.
  - In the MCP test, add `AC8: the pool shape includes title`: the section includes `[{number, title, body, labels}]`. Add a near-duplicate case: an in-flight fixture with three shared anchors and no Key Files. Snippet 0 prints `[9]`, and snippet 1 writes an exclusion whose element carries `sharedAnchors`.

- [ ] **Step 2: Run to verify it fails.** `node --test tests/dispatch-near-dup-pairs-script.test.js tests/dispatch-neighbour-in-flight-mcp.test.js` FAILS.

- [ ] **Step 3: Implement the prose.**
  - Add the files-map entry.
  - Add `title` to line 614's `--json`.
  - Rewrite the reason-list `neighbour-in-flight` bullet, kept to about its current length: a linking Key File OR a strong near-duplicate (`isStrongNearDuplicate`, #3520), with the `detail` shape `{neighbours: [{number, files, signals?, sharedAnchors?}]}`.
  - Replace the near-duplicate heredoc body with one `nearDuplicatePairsAcrossGroups` call that prints the same stderr line per pair and writes the strong pairs (minus `strong`) to `process.argv[2]` (`$DISPATCH_NEAR_DUP_PAIRS`), always writing, `[]` when there are none. Update its comment: no longer "never a selection change" in effect, since strong pairs feed Step 4/6 and the explicit-list line; still removes nothing.
  - In `mcp-transport.md`, change step 1's written shape to `[{number, title, body, labels}]`.
  - Measure `wc -c` on both files before and after, keeping `queue-pull-script.md` under 50,000 bytes. If it would cross, move the reason-list bullet's extra wording into `neighbour-in-flight-report.md` and cite it.

- [ ] **Step 4: Verify.** `node --test tests/dispatch-near-dup-pairs-script.test.js tests/dispatch-neighbour-in-flight-mcp.test.js tests/specify-near-duplicate-prose.test.js` passes.

- [ ] **Step 5: Commit** the four files: `Wire near-duplicate pairs into dispatch's queue pull — title in the in-flight pool, strong pairs persisted (#3520)`.

### Task 5: Dispatch prose — Step 3, explicit list, report, drain-PR overlap, docs

Covers: AC6.1, AC6.2, AC7.1, AC7.2, AC10.1 (full `npm test` runs at Common Step 5)

**Files:**
- Create: `plugin/skills/dispatch/near-duplicate-pairs.md` (explicit-list predicted-conflict procedure)
- Modify: `plugin/skills/dispatch/SKILL.md` (Step 3 lines 162-167; `#N,#M` bullet line 182)
- Modify: `plugin/skills/dispatch/neighbour-in-flight-report.md`, `plugin/skills/dispatch/reporting.md`, `plugin/skills/dispatch/drain-pr-overlap.md`
- Modify: `plugin/skills/dispatch/next-ranking.md` (lines 12-13: "a direct file-sharing neighbour" becomes "a direct file-sharing or strong near-duplicate neighbour (#3520)"; keep the `neighbour-in-flight` reason token)
- Read-only: `plugin/bin/lib/console/resolve.js` (`DRAIN_OVERLAP_HOLD_RE` must match the new hold line unchanged; AC7's test proves it)
- Modify: `docs/plugin-structure.md` (line 28 `near-duplicate.js` entry, line 61 `in-flight-neighbours.js` entry plus the new module, line 112 dispatch sub-file row)
- Test: `tests/specify-near-duplicate-prose.test.js` (update the line-69 test), `tests/dispatch-drain-overlap-prose.test.js` (add pins), `tests/console-autoresolve-drain-overlap-carveout.test.js` (AC7); Create: `tests/dispatch-near-dup-neighbour-prose.test.js` (AC6)

**Interfaces:**
- Consumes: `predictedConflicts`, `drainNearDuplicateHits` (Task 3); `$DISPATCH_NEAR_DUP_PAIRS` (Task 4); `drainOverlapHoldPrs` (`plugin/bin/lib/console/resolve.js`, exported).
- Produces these exact templates, which the tests extract:
  - Predicted conflict (in `near-duplicate-pairs.md`): `` `#{A} / #{B} predicted to conflict (near-duplicate: {signals}; shared: {sharedAnchors}); dispatch order #{A} then #{B}, merge #{A} first` `` and `STAGED {time} — dispatch: predicted conflict #{A} / #{B} (near-duplicate: {signals}); merge #{A} first. Reversibility: n/a.`
  - Report render (in `neighbour-in-flight-report.md`): `#{m} (near-duplicate: {signals}; shared: {sharedAnchors})`.
  - Group report line (in `reporting.md`): `predicted conflict with #{partner} (PR #{pr}) — merge #{first} first`.
  - Step 4 suffix: `(near-duplicate of #{partner})`.
  - Step 6 hold: `AUTO {time} — Auto-merge gate: group [{issues}] held — overlaps drain PR #{pr} (near-duplicate of #{partner}); merge order is a human call. Reversibility: n/a.`

- [ ] **Step 1: Write the failing tests** (covers AC6.1, AC6.2, AC7.1, AC7.2; AC10.1 is Common Step 5's full `npm test`).
  - New `dispatch-near-dup-neighbour-prose.test.js`, covering AC6:
    - SKILL.md's `Near-duplicate candidate warning (refs #1944)` paragraph (sliced to the next `**` paragraph) does not match `/Warning\s+only, never a gate/`, does cite `#3520` and `near-duplicate-pairs.md`, and the `#N[,#M` bullet cites `near-duplicate-pairs.md`;
    - `near-duplicate-pairs.md` contains both predicted-conflict templates verbatim and names `predictedConflicts` and `dispatch-near-dup-pairs.json`;
    - `neighbour-in-flight-report.md` contains the render form;
    - `reporting.md` contains the group line;
    - `docs/plugin-structure.md` names `near-dup-pairs.js` and `near-duplicate-pairs.md`.
  - Update `specify-near-duplicate-prose.test.js`'s line-69 test to the new contract: the heading is still present, and the paragraph names strong pairs feeding the neighbour guard (match `/strong/`) rather than "Warning only".
  - `dispatch-drain-overlap-prose.test.js`: add pins for the Step 4 suffix, the Step 6 near-duplicate hold template, and `drainNearDuplicateHits` cited in `drain-pr-overlap.md`.
  - AC7, in `console-autoresolve-drain-overlap-carveout.test.js`: read `drain-pr-overlap.md`, extract the fenced template containing `(near-duplicate of #{partner})`, and substitute `{time}`, `{issues}`, `{pr}=4123`, `{partner}=77`. Wrap it as a `## /dispatch\n- ` line, and assert `drainOverlapHoldPrs(decisions)` deepStrictEqual `[4123]`. Go-red control: the same assertion on a line with the `held — ` prefix removed gives `[]`.

- [ ] **Step 2: Run to verify it fails.** `node --test tests/dispatch-near-dup-neighbour-prose.test.js tests/specify-near-duplicate-prose.test.js tests/dispatch-drain-overlap-prose.test.js tests/console-autoresolve-drain-overlap-carveout.test.js` FAILS on the new pins.

- [ ] **Step 3: Write the prose.**
  - SKILL.md Step 3 paragraph, at about its current length: weak pairs only warn (stderr `AUTO` line); strong pairs (`isStrongNearDuplicate`, #3520) feed the neighbour-in-flight guard, so a bare drain defers the later record while the partner's claim is live, and an explicit list prints the predicted-conflict line per `near-duplicate-pairs.md`.
  - `#N[,#M` bullet: one added sentence, "Before Step 4, print and log `near-duplicate-pairs.md`'s predicted-conflict line for every strong pair across selected groups; both still dispatch."
  - `near-duplicate-pairs.md`: a header line like `neighbour-in-flight-report.md`'s; read `$DISPATCH_NEAR_DUP_PAIRS` (re-run `queue-pull-script.md`'s opening `eval` for the path); call `predictedConflicts(pairs, selectedGroups)`; render and log the two templates; explain that dispatch order equals Step 5's order equals the merge order; omit when empty.
  - `neighbour-in-flight-report.md`: a near-duplicate element renders with the new form; a file element as today.
  - `reporting.md`: one paragraph with the group line, read from `near-duplicate-pairs.md`'s pairs and `dispatch-drain-prs.json`.
  - `drain-pr-overlap.md`: Step 4 and Step 6 each gain one paragraph, "also run `drainNearDuplicateHits(members, pairs, drainPrs)` (`bin/lib/dispatch/near-dup-pairs.js`) over `dispatch-near-dup-pairs.json`", with the two templates. Step 6 holds only while the PR is still open (`gh pr view`, the same self-healing rule). Keep the `held — overlaps drain PR #{pr}` prefix verbatim and note the second reader.
  - `docs/plugin-structure.md`: name the new consumers and module; add `near-duplicate-pairs.md` to the dispatch row's file list plus one sentence.
  - Check `wc -c plugin/skills/dispatch/SKILL.md` stays below 50,000.

- [ ] **Step 4: Verify.** The Step 2 command passes, then `node --test tests/dispatch-*.test.js tests/bin-lib/dispatch/*.test.js tests/bin-lib/issues/near-duplicate.test.js` passes.

- [ ] **Step 5: Commit** all touched files: `Document near-duplicate neighbour, predicted-conflict and drain-PR hold rules in dispatch — strong pairs no longer warning-only (#3520)`.
