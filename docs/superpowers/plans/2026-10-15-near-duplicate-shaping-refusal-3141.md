# Near-duplicate shaping refusal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/specify` shaping refuses a record as a near-duplicate only when the title-similarity signal fires against a `ready` candidate with real in-flight evidence (a live claim or an open linked PR), and generic backticked tokens stop counting as body anchors.

**Architecture:** Two pure functions join `plugin/bin/lib/issues/near-duplicate.js`. `buildShapingState` turns raw per-candidate inputs (labels, claim blob content, linked-PR GraphQL data) into `stateByNumber`. `shapingRefusal` decides refusal from finder hits plus that state. `extractCurrentStateAnchors` gains a generic-token filter. `shaping-mode.md`'s stop rule becomes a `node -e` snippet that does the I/O and calls both. The finder's three signals and scoring are unchanged.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-10-15T181219-spec-3141/work/3141-spec.md`

**Scope keywords:** near-duplicate, shapingRefusal, buildShapingState, body-anchor, generic anchor

## Global Constraints

- `bot:in-progress` is never an input to the refusal decision.
- A claim counts as live only when `classifyClaimBlob(content, now).state === 'live'`. A tombstone, a stale claim, an absent file, an unreadable blob and a failed read are all not live.
- A failed claim read or a failed linked-PR query degrades to "not in flight", which means do not refuse.
- An open linked PR counts as in flight at any age. No freshness threshold.
- The finder (`findNearDuplicates`) keeps all three signals and its scoring.
- The refusal outcome string `refused — proposed Absorb into #{candidate}` is unchanged.
- Commit style: `{Verb} {what} — {detail}`, with `refs #3141` (never `closes`/`fixes`).

## Review Focus

1. A candidate that is `ready` and title-similar but has no claim file and no linked PR: must not refuse.
2. A claim blob whose JSON is unparseable: must not count as live, so no refusal on that basis.
3. A backticked `file.js:42` location (a dot in the part before the colon) must still be an anchor. Only `family:value` with a dot-free, slash-free family is a label.
4. A skill invocation with arguments (`/claude-tweaks:flow #3124 build`) must be dropped like a bare one.
5. Hits ordered by score: `shapingRefusal` must return the first qualifying hit in the given order, not the highest-scored non-qualifying one.

---

### Task 1: Pure predicate, state builder and anchor filter

**Files:**
- Modify: `plugin/bin/lib/issues/near-duplicate.js:84-111` (anchor filter), `:172-179` (exports), plus new functions after `findNearDuplicates`
- Test: `tests/bin-lib/issues/near-duplicate.test.js`

**Interfaces:**
- Consumes: `classifyClaimBlob(content, now)` from `plugin/bin/lib/issues/claims.js`, returning `{ state: 'absent'|'unreadable'|'tombstone'|'stale'|'live', reclaimable }`; `partitionByOpenLinkedPR(candidates, repoData)` from `plugin/bin/lib/issues/record.js`, returning `{ eligible, excludedByOpenPR: [{ number, pr }] }`; `normalizeLabelNames(labels)` from `record.js` (already imported).
- Produces:
  - `isGenericAnchor(value: string) -> boolean`
  - `buildShapingState({ numbers: number[], labelsByNumber: {[n]: Array<string|{name}>}, claimContentByNumber: {[n]: string|null|undefined}, linkedPRRepoData: object|null, now: number }) -> {[n]: { ready: boolean, liveClaim: boolean, claimRunId: string|null, openLinkedPR: number|null }}`
  - `shapingRefusal(hits: Array<{number, signals}>, stateByNumber) -> hit | null` (returns the same hit object reference)

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/issues/near-duplicate.test.js`, and extend the require block at the top to also import `extractCurrentStateAnchors, isGenericAnchor, shapingRefusal, buildShapingState`:

```js
// ── #3141: generic tokens are not body anchors ──────────────────────────────

test('extractCurrentStateAnchors drops flag, skill-invocation and label-name spans', () => {
  const body = '## Current State\n\nRuns `--run-dir` and `-x` and `--run <dir>`; see `/claude-tweaks:dispatch`, `/claude-tweaks:flow #3124 build`; labels `bot:in-progress`, `risk:low`, `ready`, `parked`.\n\n## Deliverables\n';
  assert.deepStrictEqual([...extractCurrentStateAnchors(body)], []);
});

test('extractCurrentStateAnchors keeps file paths, symbols and file:line locations', () => {
  const body = '## Current State\n\n`plugin/skills/simplify/SKILL.md`, `classifyClaimBlob`, `near-duplicate.js:92`, `## Current State`.\n';
  assert.deepStrictEqual(
    [...extractCurrentStateAnchors(body)].sort(),
    ['## Current State', 'classifyClaimBlob', 'near-duplicate.js:92', 'plugin/skills/simplify/SKILL.md'],
  );
});

test('isGenericAnchor classifies each shape', () => {
  for (const g of ['--run-dir', '-x', '--run <dir>', '--key=value', '/claude-tweaks:dispatch', '/claude-tweaks:flow #3124 build', 'bot:in-progress', 'needs:decision', 'ready', 'parked']) {
    assert.strictEqual(isGenericAnchor(g), true, g);
  }
  for (const k of ['plugin/bin/lib/issues/claims.js', 'classifyClaimBlob', 'near-duplicate.js:92', 'origin/main:claims/issue-1.json', 'readiness']) {
    assert.strictEqual(isGenericAnchor(k), false, k);
  }
});

test('a flag-only shared anchor no longer fires body-anchor-overlap; a shared file path still does', () => {
  const subject = { number: 1, title: 'Materialize docs drift', body: '## Current State\n\nUses `--run-dir` and `bin/lib/x.js`.\n' };
  const flagOnly = { number: 2, title: 'Wrap-up verify checks', labels: [], body: '## Current State\n\nPasses `--run-dir`.\n' };
  const fileToo = { number: 3, title: 'Unrelated title words', labels: [], body: '## Current State\n\nEdits `bin/lib/x.js`.\n' };
  const hits = findNearDuplicates(subject, [flagOnly, fileToo]);
  assert.deepStrictEqual(hits.map((h) => [h.number, h.signals]), [[3, ['body-anchor-overlap']]]);
});

// ── #3141: shapingRefusal ───────────────────────────────────────────────────

const LIVE = { ready: true, liveClaim: true, claimRunId: 'run-a', openLinkedPR: null };
const IDLE = { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: null };

test('the four 2026-10-15 refusals are not refused (no title-similarity)', () => {
  const cases = [
    { number: 2552, signals: ['body-anchor-overlap'] },
    { number: 2552, signals: ['body-anchor-overlap'] },
    { number: 2634, signals: ['key-files-overlap', 'body-anchor-overlap'] },
    { number: 2789, signals: ['key-files-overlap', 'body-anchor-overlap'] },
  ];
  for (const hit of cases) {
    assert.strictEqual(shapingRefusal([hit], { [hit.number]: LIVE }), null, String(hit.number));
  }
});

test('a true duplicate (title-similarity, ready, live claim) is refused', () => {
  const hit = { number: 9, signals: ['title-similarity'] };
  assert.strictEqual(shapingRefusal([hit], { 9: LIVE }), hit);
});

test('the same duplicate with only bot:in-progress (stale claim) is not refused', () => {
  const hit = { number: 9, signals: ['title-similarity', 'key-files-overlap'] };
  assert.strictEqual(shapingRefusal([hit], { 9: IDLE }), null);
});

test('an open linked PR with no live claim is refused', () => {
  const hit = { number: 9, signals: ['title-similarity'] };
  assert.strictEqual(shapingRefusal([hit], { 9: { ...IDLE, openLinkedPR: 77 } }), hit);
});

test('a non-ready candidate is not refused even with a live claim', () => {
  const hit = { number: 9, signals: ['title-similarity'] };
  assert.strictEqual(shapingRefusal([hit], { 9: { ...LIVE, ready: false } }), null);
});

test('a candidate missing from stateByNumber is not refused', () => {
  assert.strictEqual(shapingRefusal([{ number: 9, signals: ['title-similarity'] }], {}), null);
});

test('shapingRefusal returns the first qualifying hit in the given order', () => {
  const a = { number: 1, signals: ['key-files-overlap', 'body-anchor-overlap', 'title-similarity'] };
  const b = { number: 2, signals: ['title-similarity'] };
  assert.strictEqual(shapingRefusal([a, b], { 1: IDLE, 2: LIVE }), b);
  assert.strictEqual(shapingRefusal([], {}), null);
  assert.strictEqual(shapingRefusal(null, {}), null);
});

// ── #3141: buildShapingState ────────────────────────────────────────────────

const NOW = Date.parse('2026-10-15T12:00:00Z');
const liveBlob = JSON.stringify({ issue: 5, runId: 'run-live', claimedAt: '2026-10-15T11:00:00Z', ttlHours: 72 });
const staleBlob = JSON.stringify({ issue: 6, runId: 'run-old', claimedAt: '2026-10-01T11:00:00Z', ttlHours: 72 });
const tombstone = JSON.stringify({ issue: 7, runId: 'run-done', released: true });

test('buildShapingState reads ready from labels, liveness from classifyClaimBlob, and the open linked PR', () => {
  const state = buildShapingState({
    numbers: [5, 6, 7, 8, 9],
    labelsByNumber: { 5: ['ready'], 6: [{ name: 'ready' }, { name: 'bot:in-progress' }], 7: ['ready'], 8: [], 9: ['ready'] },
    claimContentByNumber: { 5: liveBlob, 6: staleBlob, 7: tombstone, 8: null, 9: '{not json' },
    linkedPRRepoData: { i9: { closedByPullRequestsReferences: { nodes: [{ number: 41, state: 'OPEN' }] } }, i6: { closedByPullRequestsReferences: { nodes: [{ number: 40, state: 'MERGED' }] } } },
    now: NOW,
  });
  assert.deepStrictEqual(state[5], { ready: true, liveClaim: true, claimRunId: 'run-live', openLinkedPR: null });
  assert.deepStrictEqual(state[6], { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: null });
  assert.deepStrictEqual(state[7], { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: null });
  assert.deepStrictEqual(state[8], { ready: false, liveClaim: false, claimRunId: null, openLinkedPR: null });
  assert.deepStrictEqual(state[9], { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: 41 });
});

test('buildShapingState degrades a missing claim map and a null linked-PR response to not in flight', () => {
  const state = buildShapingState({ numbers: [5], labelsByNumber: { 5: ['ready'] }, claimContentByNumber: undefined, linkedPRRepoData: null, now: NOW });
  assert.deepStrictEqual(state[5], { ready: true, liveClaim: false, claimRunId: null, openLinkedPR: null });
});
```

The fixture blobs use the real claim fields (`claimPayload` in `claims.js:26` writes `runId`, `claimedAt`, `ttlHours`; `isStale` at `claims.js:73` reads `claimedAt` + `ttlHours`).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js`
Expected: FAIL. `isGenericAnchor`, `shapingRefusal` and `buildShapingState` are not functions, and the anchor-drop tests fail because `--run-dir` etc. are still returned.

- [ ] **Step 3: Implement**

In `plugin/bin/lib/issues/near-duplicate.js`:

Add after line 18's `require` lines:

```js
const { classifyClaimBlob } = require('./claims');
const { partitionByOpenLinkedPR } = require('./record');
```

(Merge `partitionByOpenLinkedPR` into the existing `require('./record')` destructuring instead of a second require line.)

Add above `extractCurrentStateAnchors`:

```js
// #3141: backticked spans that are generic vocabulary, not identity
// anchors — widely cited across unrelated records, so a shared one says
// nothing about two records describing the same work. Three shapes:
// a flag (`--run-dir`, `-x`, optionally followed by a value placeholder),
// a skill invocation (`/plugin:skill`, optionally with arguments), and a
// label name (`family:value` whose family has no `.` or `/`, so a
// `file.js:42` location stays an anchor; or a bare stage label).
const FLAG_ANCHOR_RE = /^--?[A-Za-z][\w-]*(?:[ =].*)?$/;
const SKILL_ANCHOR_RE = /^\/[\w-]+:[\w-]+(?:\s.*)?$/;
const LABEL_ANCHOR_RE = /^[a-z][a-z0-9-]*:[^\s/]+$/;
const STAGE_LABELS = new Set(['ready', 'parked']);

function isGenericAnchor(value) {
  return FLAG_ANCHOR_RE.test(value) || SKILL_ANCHOR_RE.test(value)
    || LABEL_ANCHOR_RE.test(value) || STAGE_LABELS.has(value);
}
```

In `extractCurrentStateAnchors`, change `if (value) anchors.add(value);` to `if (value && !isGenericAnchor(value)) anchors.add(value);`. Extend the function's header comment with one line: `Generic vocabulary spans (isGenericAnchor) are skipped (#3141).`

Add after `findNearDuplicates`:

```js
// #3141: the refusal decision /specify shaping applies on top of the
// finder's screen (shaping-mode.md's Near-duplicate candidate check).
// stateByNumber[n]: { ready, liveClaim, claimRunId, openLinkedPR } — built
// by buildShapingState below. Returns the first hit (in the given order)
// whose signals include title-similarity AND whose candidate is ready AND
// in flight (a live claim or an open linked PR); null otherwise. File and
// anchor overlap alone never refuse — they are build-collision signals,
// which /flow and /dispatch already handle. bot:in-progress is not read.
function shapingRefusal(hits, stateByNumber) {
  for (const hit of hits || []) {
    if (!hit || !Array.isArray(hit.signals) || !hit.signals.includes('title-similarity')) continue;
    const state = stateByNumber && stateByNumber[hit.number];
    if (!state || state.ready !== true) continue;
    if (state.liveClaim === true || state.openLinkedPR) return hit;
  }
  return null;
}

// #3141: pure assembly of shapingRefusal's stateByNumber from raw reads —
// labels (the session snapshot), claim blob content (claims/issue-{n}.json
// on claims-registry; null/undefined = absent or unread), and the
// linked-PR GraphQL repository{} object (record.js's buildLinkedPRQuery
// shape; null = query failed or not run). Every missing or failed input
// degrades to "not in flight" — the finder is a screen, so a read failure
// must never cause a refusal.
function buildShapingState({ numbers, labelsByNumber, claimContentByNumber, linkedPRRepoData, now }) {
  const { excludedByOpenPR } = partitionByOpenLinkedPR((numbers || []).map((number) => ({ number })), linkedPRRepoData || null);
  const prByNumber = new Map(excludedByOpenPR.map((e) => [e.number, e.pr]));
  const state = {};
  for (const n of numbers || []) {
    const ready = normalizeLabelNames((labelsByNumber && labelsByNumber[n]) || []).includes('ready');
    const content = claimContentByNumber ? claimContentByNumber[n] : null;
    const liveClaim = classifyClaimBlob(content === undefined ? null : content, now).state === 'live';
    let claimRunId = null;
    if (liveClaim) {
      try { claimRunId = JSON.parse(content).runId || null; } catch { claimRunId = null; }
    }
    state[n] = { ready, liveClaim, claimRunId, openLinkedPR: prByNumber.get(n) ?? null };
  }
  return state;
}
```

Add `isGenericAnchor`, `shapingRefusal`, `buildShapingState` to `module.exports`. Update the module header's last paragraph: replace "a candidate that is itself `ready` with an in-flight build." with "a title-similar candidate that is itself `ready` with an in-flight build — `shapingRefusal` below (#3141)."

Check that `partitionByOpenLinkedPR` accepts `repoData = null` without throwing (it reads `repoData && repoData['i' + n]`). If it throws on `null`, pass `{}` instead.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test tests/bin-lib/issues/near-duplicate.test.js tests/specify-near-duplicate-prose.test.js`
Expected: PASS, 0 failures.

- [ ] **Step 5: Prove discrimination**

Temporarily delete `|| !hit.signals.includes('title-similarity')` from `shapingRefusal` and run `node --test tests/bin-lib/issues/near-duplicate.test.js`. Expected: "the four 2026-10-15 refusals are not refused" FAILS. Restore the line and re-run (PASS). Report both raw summaries.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/near-duplicate.js tests/bin-lib/issues/near-duplicate.test.js
git commit -m "Add shapingRefusal and generic-anchor filter to near-duplicate finder — refs #3141"
```

### Task 2: Stop rule prose calls the predicate

**Files:**
- Modify: `plugin/skills/specify/shaping-mode.md:101-122` (stop rule, decision-comment `**Why:**`, closing paragraph)
- Modify: `plugin/skills/specify/next-mode-shape.md:208-216` (headless note)
- Modify: `docs/journeys/shape-several-records-in-one-specify-call.md:39` (the refusal clause's trigger wording; the outcome string stays)
- Test: `tests/specify-near-duplicate-prose.test.js`

**Interfaces:**
- Consumes: `shapingRefusal`, `buildShapingState` (Task 1); `readClaimBlobGit({ issueNumber })` from `plugin/bin/lib/issues/claims-git-cas.js` → `{ content, absent, failure }`; `buildLinkedPRQuery(numbers)` from `record.js`.
- Produces: prose only.

- [ ] **Step 1: Write the failing prose tests**

Add to `tests/specify-near-duplicate-prose.test.js`:

```js
test('shaping-mode.md decides refusal with shapingRefusal, not bot:in-progress (#3141)', () => {
  const start = SHAPING_MODE.indexOf('Near-duplicate candidate check (#1944)');
  const end = SHAPING_MODE.indexOf('### Dependency-narration check', start);
  assert.ok(start !== -1 && end !== -1, 'Near-duplicate section anchors must exist');
  const section = SHAPING_MODE.slice(start, end);
  assert.match(section, /shapingRefusal/);
  assert.match(section, /buildShapingState/);
  assert.match(section, /title-similarity/);
  assert.match(section, /classifyClaimBlob/);
  assert.doesNotMatch(section, /carries `bot:in-progress` or has an open linked PR/);
  assert.doesNotMatch(section, /in-flight build \(open PR \/ `bot:in-progress`\)/);
  assert.match(section, /\*\*Why:\*\* near-duplicate finder found `title-similarity` against #\{candidate\}.*\{evidence\}/s);
});

test('next-mode-shape.md describes the same refusal condition (#3141)', () => {
  const start = NEXT_MODE_SHAPE.indexOf('Near-duplicate candidate check also runs headlessly');
  assert.ok(start !== -1);
  const section = NEXT_MODE_SHAPE.slice(start, start + 900);
  assert.match(section, /shapingRefusal/);
  assert.match(section, /title-similar/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test tests/specify-near-duplicate-prose.test.js`
Expected: FAIL on both new tests.

- [ ] **Step 3: Rewrite the prose**

In `plugin/skills/specify/shaping-mode.md`, replace the paragraph starting "Then check each candidate's own current state. When any candidate is **both** `ready` **and**" through "**stop shaping this record here** — do not compose, stamp, or write `ready` for it." with:

````markdown
Then decide refusal with `shapingRefusal` (`bin/lib/issues/near-duplicate.js`, #3141). It refuses
only on a hit whose signals include `title-similarity` and whose candidate is `ready` **and** in
flight: a live claim (`classifyClaimBlob` reads its `claims/issue-{n}.json` blob as `live`) or an
open linked PR (the same `closedByPullRequestsReferences` connection dispatch's open-PR exclusion
reads — `record.js`'s `buildLinkedPRQuery` / `partitionByOpenLinkedPR`). File and anchor overlap
alone never refuse, and `bot:in-progress` is not evidence: it is a projection that outlives the
build. Build the state and decide in one call, with `{hits}` the finder's output and `{snapshot}`
the candidates' snapshot entries:

```bash
node -e "
const { shapingRefusal, buildShapingState } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/near-duplicate.js');
const { readClaimBlobGit } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/claims-git-cas.js');
const { buildLinkedPRQuery } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js');
const { execFileSync } = require('child_process');
const [hits, snapshot] = [JSON.parse(process.argv[1]), JSON.parse(process.argv[2])];
const numbers = hits.map((h) => h.number);
const labelsByNumber = Object.fromEntries(snapshot.map((r) => [r.number, r.labels]));
const claimContentByNumber = {};
for (const n of numbers) { const r = readClaimBlobGit({ issueNumber: n }); claimContentByNumber[n] = r.failure || r.absent ? null : r.content; }
let linkedPRRepoData = null;
try { linkedPRRepoData = JSON.parse(execFileSync('gh', ['api', 'graphql', '-f', 'query=' + buildLinkedPRQuery(numbers), '-F', 'owner={owner}', '-F', 'repo={repo}'], { encoding: 'utf8' })).data.repository; } catch {}
const state = buildShapingState({ numbers, labelsByNumber, claimContentByNumber, linkedPRRepoData, now: Date.now() });
const hit = shapingRefusal(hits, state);
console.log(JSON.stringify(hit ? { refuse: true, hit, evidence: state[hit.number] } : { refuse: false }));
" '{hits}' '{snapshot}'
```

A failed claim read or linked-PR query leaves that candidate "not in flight" — never a refusal.
Under the MCP transport (no `gh`), read the claim blob and run the linked-PR query through
`_shared/github-write-transport.md`'s read path instead, and pass the results to
`buildShapingState` the same way. When the result is `refuse: true`, **stop shaping this record
here** — do not compose, stamp, or write `ready` for it.
````

Keep the sentence that follows ("Instead, add the `needs:decision` label …") unchanged.

Replace the decision comment's `**Why:**` line (two lines today) with:

```
**Why:** near-duplicate finder found `title-similarity` against #{candidate} (signals: {signals}), which is `ready` with an
in-flight build: {evidence — "live claim by run {claimRunId}" or "open PR #{openLinkedPR}"}
```

In the closing paragraph, replace "every other candidate (no `ready` + in-flight-build match)" with "every other candidate (no title-similar, `ready`, in-flight match per `shapingRefusal`)".

In `plugin/skills/specify/next-mode-shape.md`, replace "When it stops shaping (a `ready`, in-flight-build candidate found)" with "When it stops shaping (`shapingRefusal` found a title-similar, `ready` candidate with a live claim or an open linked PR)", and add "and the in-flight evidence" after "with the candidate's number and its firing signals".

In `docs/journeys/shape-several-records-in-one-specify-call.md` line 39, replace "found a `ready`, in-flight-build candidate for this record" with "found a title-similar, `ready` candidate with a live claim or an open linked PR (`shapingRefusal`, #3141)". Append to that journey's change log list (near line 73) one bullet: `- Step 3 updated for #3141 (refusal needs title similarity plus a live claim or open linked PR; bot:in-progress no longer counts)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/specify-near-duplicate-prose.test.js tests/bin-lib/issues/near-duplicate.test.js`
Expected: PASS. Then run every suite that reads the edited files: `grep -rl "shaping-mode.md\|next-mode-shape.md\|shape-several-records" tests` and run each result with `node --test`. Expected: PASS.

- [ ] **Step 5: Smoke the snippet**

From the worktree, run the Step 3 snippet with `CLAUDE_PLUGIN_ROOT=plugin`, `{hits}` = `[{"number":2552,"signals":["body-anchor-overlap"]}]` and `{snapshot}` = `[{"number":2552,"labels":["ready","bot:in-progress"]}]`. Expected output: `{"refuse":false}`. Report the raw output.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/specify/shaping-mode.md plugin/skills/specify/next-mode-shape.md docs/journeys/shape-several-records-in-one-specify-call.md tests/specify-near-duplicate-prose.test.js
git commit -m "Route the shaping near-duplicate stop rule through shapingRefusal — refs #3141"
```
