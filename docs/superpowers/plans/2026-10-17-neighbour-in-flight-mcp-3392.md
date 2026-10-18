# Neighbour-in-flight MCP Transport Branch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On a gh-absent `/dispatch` firing, the neighbour-in-flight pass lists the `bot:in-progress` pool through MCP `list_issues`, reads each neighbour's claim through `_shared/issue-claims.md`'s file-blob path, and writes the same `neighbour-in-flight` exclusions the gh branch writes.

**Architecture:** A Node subprocess cannot call MCP tools, so the agent fetches (pool list, then claim blobs) and Node computes. Two small pure helpers land in `plugin/bin/lib/dispatch/in-flight-neighbours.js`: `neighbourClaimTargets` (which in-flight records need a claim read) and `claimReaderFromMap` (turns an agent-written `{number: content|null|{failure}}` map into the `readClaimContent` callback `neighbourInFlightExclusions` already takes). `dispatch/mcp-transport.md`'s neighbour-in-flight section is rewritten from a documented gap into the mapping, carrying two `node-eval-file.js` heredocs. `queue-pull-script.md` gains only one session-tmp file key and a one-line pointer: it sits 1,755 bytes under the 51,200-byte ceiling.

**Tech Stack:** Node 18+ CommonJS, `node --test`, skill markdown.

**Spec:** `.claude-tweaks/pipelines/2026-10-17T193236-record-3392/work/3392-spec.md`

**Scope keywords:** neighbour-in-flight

**Premise-refs:** plugin/skills/dispatch/mcp-transport.md
**Premise-refs:** plugin/skills/dispatch/queue-pull-script.md
**Premise-refs:** plugin/skills/_shared/issue-claims.md
**Premise-refs:** plugin/skills/_shared/github-write-transport.md
**Premise-refs:** plugin/bin/lib/dispatch/in-flight-neighbours.js

## Global Constraints

- Fail open, same as the gh branch: a failed list or claim read prints one AUTO line and excludes nothing (spec Deliverable 2).
- Liveness comes from the claim blob only, never the `bot:in-progress` label (`in-flight-neighbours.js` header; spec AC2).
- The pool fetch failure line is the existing literal, unchanged: `AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull`.
- The claim read failure line is the existing literal shape: `AUTO — dispatch: neighbour-in-flight claim read failed for #{n}[, #{m}]; treated as not in flight`.
- Claim blob location: `claims/issue-{n}.json` on branch `claims-registry` (`plugin/bin/lib/issues/claims.js`'s `claimFilePath` / `CLAIMS_BRANCH`).
- MCP mappings cite their existing conventions rather than restating them: `list_issues` is `_shared/github-write-transport.md`'s "List open issues by label" row; the claim read is `_shared/issue-claims.md` "The lock" step 1's MCP bullet ("get file contents" against `claimPath` on `CLAIMS_BRANCH`, not-found = absent).
- `queue-pull-script.md` stays ≤ 51,200 bytes (`tests/dispatch-per-record-groups-prose.test.js` AC9.1 pin; current 49,445 B, this plan adds ≈150 B).
- `node-eval-file.js` heredoc bodies carry no `$` other than `${CLAUDE_PLUGIN_ROOT}` and no unescaped backtick (`bin/node-eval-file.js` header; swept by `tests/node-eval-file-heredoc-syntax.test.js`).

## Review Focus

- **Candidate with no neighbours / empty pool on MCP** — `neighbourClaimTargets` returns `[]`, the agent makes no claim reads, writes `{}`, and the exclusion snippet writes nothing. Pinned in Task 2's fixture test (empty map run).
- **Map entry missing for a target the agent never read** (agent skipped one, or the list of targets changed) — must count as a failed read (unreadable, AUTO line), never as "absent claim". Pinned in Task 1 (`claimReaderFromMap` missing key → `{failure}`).
- **Map keyed by string vs number** — JSON object keys are strings; the reader must look up `String(n)`. Pinned in Task 1 (map built via `JSON.parse`).
- **Expired / tombstoned claim behind a stale label on MCP** — no exclusion (AC2). Pinned in Task 1.
- **#3137 label truncation** — this pass reads no labels for any decision (pool membership is the server-side label filter, liveness is the claim blob), so the truncation gotcha does not apply; the prose must say so rather than prescribe the per-candidate label cross-check. Pinned in Task 2's prose test.

---

### Task 1: Map-backed claim reader and claim-target helper

**Files:**
- Modify: `plugin/bin/lib/dispatch/in-flight-neighbours.js`
- Test (create): `tests/bin-lib/dispatch/in-flight-neighbours-map-reader.test.js`

**Interfaces:**
- Consumes: existing `neighbourInFlightExclusions({ candidates, inFlight, readClaimContent, now, hubOptions })`, `findInFlightNeighbours` / `extractKeyFiles` from `../issues/grouping`.
- Produces (exported alongside `neighbourInFlightExclusions`):
  - `neighbourClaimTargets({ candidates, inFlight, hubOptions = {} }) -> number[]` — sorted, unique in-flight issue numbers that neighbour at least one candidate (exactly the set `neighbourInFlightExclusions` would call `readClaimContent` for).
  - `claimReaderFromMap(map) -> (number) => ({ content: string|null } | { failure: string })` — `map` is a plain object keyed by the issue number as a string. Value `null` → `{ content: null }` (absent blob); string → `{ content: value }`; object with a `failure` property → `{ failure: String(value.failure) }`; key absent → `{ failure: 'claim-not-read' }`; any other value → `{ failure: 'malformed-claim-entry' }`.

- [ ] **Step 1: Write the failing tests** in the new file — copy the `NOW`, `HOUR`, `rec`, `live`, `expired`, `tombstone`, `readerFrom` and `run` fixtures verbatim from `tests/bin-lib/dispatch/in-flight-neighbours.test.js` (a new file, so Step 2 genuinely fails before Step 3)

```js
const { neighbourClaimTargets, claimReaderFromMap } = require('../../../plugin/bin/lib/dispatch/in-flight-neighbours.js');

test('neighbourClaimTargets lists only in-flight records that neighbour a candidate, sorted and unique', () => {
  const candidates = [rec(1, ['a.js']), rec(2, ['a.js', 'b.js'])];
  const inFlight = [rec(9, ['a.js']), rec(8, ['b.js']), rec(7, ['z.js'])];
  assert.deepStrictEqual(neighbourClaimTargets({ candidates, inFlight }), [8, 9]);
  assert.deepStrictEqual(neighbourClaimTargets({ candidates, inFlight: [] }), []);
});

test('AC1.1: an MCP-read live claim (map-backed reader) produces the neighbour-in-flight exclusion', () => {
  const map = JSON.parse(JSON.stringify({ 9: live }));
  const result = run(claimReaderFromMap(map));
  assert.deepStrictEqual(result.exclusions, [
    { reason: 'neighbour-in-flight', records: [1], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } },
  ]);
  assert.deepStrictEqual(result.unreadable, []);
});

test('AC2.1: a stale bot:in-progress label with no live claim never excludes, on either transport', () => {
  const inFlight = [{ ...rec(9, ['a.js']), labels: [{ name: 'bot:in-progress' }] }];
  for (const blob of [null, expired, tombstone]) {
    const gh = run(readerFrom({ 9: { content: blob } }), { inFlight });
    const mcp = run(claimReaderFromMap({ 9: blob }), { inFlight });
    assert.deepStrictEqual(gh, { exclusions: [], unreadable: [] });
    assert.deepStrictEqual(mcp, { exclusions: [], unreadable: [] });
  }
});

test('AC3.1: a failed MCP claim read (failure entry or never-read key) writes no exclusion and is reported unreadable', () => {
  for (const map of [{ 9: { failure: 'HTTP 500' } }, {}, { 9: 42 }]) {
    const result = run(claimReaderFromMap(map));
    assert.deepStrictEqual(result, { exclusions: [], unreadable: [9] });
  }
});

test('claimReaderFromMap maps each entry shape', () => {
  const read = claimReaderFromMap({ 1: null, 2: 'x', 3: { failure: 'boom' }, 4: 7 });
  assert.deepStrictEqual(read(1), { content: null });
  assert.deepStrictEqual(read(2), { content: 'x' });
  assert.deepStrictEqual(read(3), { failure: 'boom' });
  assert.deepStrictEqual(read(4), { failure: 'malformed-claim-entry' });
  assert.deepStrictEqual(read(5), { failure: 'claim-not-read' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/dispatch/in-flight-neighbours-map-reader.test.js`
Expected: FAIL — `neighbourClaimTargets is not a function` / `claimReaderFromMap is not a function`

- [ ] **Step 3: Implement both helpers in `plugin/bin/lib/dispatch/in-flight-neighbours.js`**

`neighbourClaimTargets` calls `findInFlightNeighbours(candidates.map(toItem), (inFlight || []).map(toItem), hubOptions)` and collects every listed `number` into a sorted unique array — then have `neighbourInFlightExclusions` keep its own loop (do not refactor it). Use `Object.prototype.hasOwnProperty.call(map, String(n))` for the key check. Add one header-comment sentence: the MCP transport (`dispatch/mcp-transport.md`) reads claims agent-side and hands them in through `claimReaderFromMap`.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/dispatch/in-flight-neighbours-map-reader.test.js tests/bin-lib/dispatch/in-flight-neighbours.test.js`
Expected: PASS, all tests (existing AC4.x included)

- [ ] **Step 5: Prove discrimination** — temporarily make `claimReaderFromMap` return `{ content: null }` for a missing key; AC3.1 must go red; restore.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/dispatch/in-flight-neighbours.js tests/bin-lib/dispatch/in-flight-neighbours-map-reader.test.js
git commit -m "Add map-backed claim reader for neighbour-in-flight — MCP transport input (refs #3392)"
```

---

### Task 2: MCP branch in `mcp-transport.md`, wiring, and extract-and-run test

**Files:**
- Modify: `plugin/skills/dispatch/mcp-transport.md` (replace the whole `## Step 2 — neighbour-in-flight pool (#3278)` section, lines ~112-115)
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (files map at line ~33; pass comment at line ~609)
- Modify: `docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md` (line 32's last sentence)
- Create: `tests/dispatch-neighbour-in-flight-mcp.test.js`

**Interfaces:**
- Consumes: Task 1's `neighbourClaimTargets`, `claimReaderFromMap`; existing `appendExclusion(path, entry)` / `readExclusions(path)` from `plugin/bin/lib/dispatch/exclusions.js`.
- Produces: session-tmp key `DISPATCH_IN_FLIGHT_CLAIMS: 'dispatch-in-flight-claims.json'` in `queue-pull-script.md`'s files map (next to `DISPATCH_IN_FLIGHT_RAW`).

- [ ] **Step 1: Write the failing test** `tests/dispatch-neighbour-in-flight-mcp.test.js`

Follow `tests/dispatch-named-target-exclusion-fixture.test.js`'s extract-and-run shape: slice the section from `## Step 2 — neighbour-in-flight pool (#3278, #3392)` to the next `\n## `; extract each heredoc by anchors (start = the `node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" ...` line, end = `NODE_EVAL_EOF` line); run with `execFileSync('bash', ['-c', snippet], { env: { ...process.env, CLAUDE_PLUGIN_ROOT: path.join(ROOT, 'plugin'), DISPATCH_GROUPS, DISPATCH_IN_FLIGHT_RAW, DISPATCH_EXCLUSIONS, DISPATCH_IN_FLIGHT_CLAIMS } })` over fixture files in `fs.mkdtempSync`. Fixture records use the Key Files body shape from `tests/bin-lib/dispatch/in-flight-neighbours.test.js`'s `rec()`; groups = `[[rec(1,['a.js'])]]`, inFlight = `[rec(9,['a.js'])]`.

Tests (names carry the AC ids):
- `AC1.1: the MCP claim-target snippet prints [9] and the MCP exclusion snippet writes a neighbour-in-flight exclusion for a live MCP-read claim` — targets snippet stdout parses to `[9]`; with claims map `{"9": <live claim JSON string>}`, `readExclusions(DISPATCH_EXCLUSIONS)` deep-equals `[{ reason: 'neighbour-in-flight', records: [1], detail: { neighbours: [{ number: 9, files: ['a.js'] }] } }]`.
- `AC2.1: a tombstone claim read over MCP writes no exclusion` — map `{"9": "{\"released\":true}"}` → `readExclusions` is `[]`.
- `AC3.1: a failed MCP claim read prints the AUTO line and writes no exclusion` — map `{"9": {"failure":"HTTP 500"}}` → exclusions `[]`, captured stderr (use `spawnSync`) includes `AUTO — dispatch: neighbour-in-flight claim read failed for #9; treated as not in flight`.
- `AC3.1: a failed MCP pool list is documented to print the existing AUTO line and write []` — the section includes the literal `AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull` and the token `'[]'`; and an empty pool (`[]`) with map `{}` run through both snippets writes no exclusion.
- `the section maps the pool to list_issues and the claim read to issue-claims.md's file-blob path` — section includes `list_issues`, `bot:in-progress`, `_shared/github-write-transport.md`, `_shared/issue-claims.md`, `claims/issue-{n}.json`, `claims-registry`, `claimReaderFromMap`, `#3137`; and does NOT include `documented gap` or `Re-open when`.
- `queue-pull-script.md declares DISPATCH_IN_FLIGHT_CLAIMS and points gh-absent firings at mcp-transport.md` — includes `DISPATCH_IN_FLIGHT_CLAIMS: 'dispatch-in-flight-claims.json'` and, within 400 chars after `# #3278: neighbour-in-flight pass.`, the string `mcp-transport.md`.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-neighbour-in-flight-mcp.test.js`
Expected: FAIL — section heading anchor not found in mcp-transport.md

- [ ] **Step 3: Rewrite the `mcp-transport.md` section** — replace the whole old section with exactly this:

````markdown
## Step 2 — neighbour-in-flight pool (#3278, #3392)

`queue-pull-script.md`'s neighbour-in-flight pass needs `gh` for its pool list, its `gh repo view` slug and its claim-blob reads, so on this transport skip that pass's `gh issue list` line and its `node-eval-file.js` block and run these four steps in their place. A Node subprocess cannot call MCP tools, so the agent fetches and Node computes. Fail open exactly as the `gh` branch does: a failed list or read prints one AUTO line and excludes nothing.

**1. Pool.** List the open `bot:in-progress` records through `list_issues` (`_shared/github-write-transport.md`'s "List open issues by label" row: label `bot:in-progress`, state open, body included, up to 200 records). Omit `fields`. The #3137 label truncation above does not touch this pass: the label filter runs server-side, and liveness comes from the claim blob, never a label. Write `[{number, body, labels}]` to `$DISPATCH_IN_FLIGHT_RAW` with the Write tool. If the call fails, write `[]` there and print `AUTO — dispatch: neighbour-in-flight pool fetch failed; no neighbour-in-flight exclusions this pull`.

**2. Claim targets.** Print the in-flight records that neighbour some candidate, the only ones whose claim needs reading:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" <<NODE_EVAL_EOF
  const { neighbourClaimTargets } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/in-flight-neighbours.js');
  console.log(JSON.stringify(neighbourClaimTargets({ candidates: require(process.argv[1]).flat(), inFlight: require(process.argv[2]) })));
NODE_EVAL_EOF
```

**3. Claim reads.** For each printed number, read `claims/issue-{n}.json` on `claims-registry` through `_shared/issue-claims.md`'s file-blob path ("The lock" step 1's MCP bullet). Record the returned content as a string, a not-found response as `null`, and any other error as `{"failure": "{error}"}`. Write the object, keyed by number, to `$DISPATCH_IN_FLIGHT_CLAIMS` with the Write tool, `{}` when nothing was printed. A number left out of the map counts as a failed read.

**4. Exclusions.** Run the pass's computation over the map, through `claimReaderFromMap` (`bin/lib/dispatch/in-flight-neighbours.js`):

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/node-eval-file.js" "$DISPATCH_GROUPS" "$DISPATCH_IN_FLIGHT_RAW" "$DISPATCH_EXCLUSIONS" "$DISPATCH_IN_FLIGHT_CLAIMS" <<NODE_EVAL_EOF
  const { neighbourInFlightExclusions, claimReaderFromMap } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/in-flight-neighbours.js');
  const { appendExclusion } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/exclusions.js');
  const { exclusions, unreadable } = neighbourInFlightExclusions({
    candidates: require(process.argv[1]).flat(), inFlight: require(process.argv[2]),
    readClaimContent: claimReaderFromMap(require(process.argv[4])), now: Date.now(),
  });
  for (const e of exclusions) appendExclusion(process.argv[3], e);
  if (unreadable.length) console.error('AUTO — dispatch: neighbour-in-flight claim read failed for #' + unreadable.join(', #') + '; treated as not in flight');
NODE_EVAL_EOF
```

A non-zero exit stops the queue pull, the same as the `gh` branch's `NEIGHBOUR_RC` check.
````

- [ ] **Step 4: Wire `queue-pull-script.md`** — add `    DISPATCH_IN_FLIGHT_CLAIMS: 'dispatch-in-flight-claims.json',` on the line after `DISPATCH_IN_FLIGHT_RAW`; insert a new comment line `# gh-absent: mcp-transport.md's neighbour-in-flight section replaces this pass.` directly after the pass comment's line `# excludes nothing. Claim blobs chain one fetch via the first git-tip read.` Measure: `wc -c plugin/skills/dispatch/queue-pull-script.md` must print ≤ 51200.

- [ ] **Step 5: Update the journey** — in `docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md` line 32, replace `On a \`gh\`-absent firing the guard is off by design (\`dispatch/mcp-transport.md\`).` with `On a \`gh\`-absent firing the same guard runs over the MCP transport (\`dispatch/mcp-transport.md\`, #3392).`

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/dispatch-neighbour-in-flight-mcp.test.js tests/node-eval-file-heredoc-syntax.test.js tests/dispatch-per-record-groups-prose.test.js tests/dispatch-named-form-exclusion-reasons.test.js tests/dispatch-graphql-blocked-preflight.test.js`
Expected: PASS

- [ ] **Step 7: Prove discrimination** — temporarily change the exclusion heredoc's `claimReaderFromMap(require(process.argv[4]))` to `() => ({ content: null })`; AC1.1 must go red; restore. Grep for stale gap prose: `git grep -n "guard is off" -- plugin docs README.md` prints nothing.

- [ ] **Step 8: Commit**

```bash
git add plugin/skills/dispatch/mcp-transport.md plugin/skills/dispatch/queue-pull-script.md docs/journeys/drain-the-queue-past-a-chain-of-overlapping-records-3278.md tests/dispatch-neighbour-in-flight-mcp.test.js
git commit -m "Map the neighbour-in-flight pass onto the MCP transport — list_issues pool, file-blob claim reads (refs #3392)"
```

## Spec coverage map

| Spec item | Task |
|---|---|
| Deliverable 1 (list_issues pool, file-blob claim reads) | Task 2 Step 3 (prose + snippets), Task 1 (reader) |
| Deliverable 2 (same fail-open posture) | Task 1 AC3.1, Task 2 AC3.1 |
| Deliverable 3 (mcp-transport.md section rewritten) | Task 2 Step 3 + prose test |
| AC1.1 | Task 1 `AC1.1`, Task 2 `AC1.1` |
| AC2.1 | Task 1 `AC2.1`, Task 2 `AC2.1` |
| AC3.1 | Task 1 `AC3.1`, Task 2 `AC3.1` (both) |

**Unverified (no live MCP in the authoring session):** the `list_issues` / file-contents calls are agent-side tool calls, not runnable commands; their mappings are the already live-confirmed rows in `_shared/github-write-transport.md` and `_shared/issue-claims.md`. A live gh-absent firing is the remaining proof.
