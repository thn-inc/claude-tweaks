# Dispatch shipped-candidate release-time downgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A merged PR that predates the record's latest claim release never rates `strong`, so a partly shipped record stays dispatchable.

**Architecture:** `classifyShipped` stays pure and takes `opts.lastReleasedAt`. A new small I/O module reads the release times from the claims-registry tombstones in the queue pull's first pass and hands them to the second pass through a session temp file. Both `classifyShipped` call sites pass the value.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-03T015843-record-4432/work/4432-spec.md`

## Global Constraints

- `classifyShipped` stays pure: "Keep `classifyShipped` pure: the caller passes `opts.lastReleasedAt` (ISO or null) the same way it already passes `opts.prFiles`."
- "Compare instants, not strings: `mergedAt` and `releasedAt` are both ISO, but normalize through `Date` as the existing createdAt checks do."
- "A missing or unreadable release time never downgrades and never upgrades (the prior behavior holds)."
- The code comment must say a shaping-only release after a merge also downgrades, that this is the safe direction, and that the build's shipped-exit check still catches a truly shipped record.
- `plugin/skills/dispatch/queue-pull-script.md` is 52,091 B against `RAIL_BYTES` 52,500 B (409 B headroom); `plugin/skills/dispatch/SKILL.md` is 51,877 B (623 B headroom). Neither may cross the rail. Task 3 cuts restating comment text in the shipped-candidate section of the script to make room; the cuts keep each comment's consequence. Measure with `wc -c` after editing.
- Governing skill `parse-signal-discipline`, quoted: "When the check hits an input it cannot confidently parse, that outcome must be distinguishable from \"this input legitimately does not need this check\"". A blob with no release (never released, or a live claim) is doesn't-apply; a blob that does not parse, or a tombstone whose `releasedAt` is missing or unparseable, is could-not-read and gets logged. Neither downgrades.
- Governing skill `skill-prose-conformance-tests`, quoted: "the mechanism this repo converged on three times is to freeze the bytes the change *replaced* as a fixture constant inside the test". The extract-and-run test in Task 3 follows `tests/dispatch-named-target-exclusion-fixture.test.js`'s anchored extraction instead, since it runs the shipped snippet rather than matching prose.
- Governing skill `gh-api-module-pattern`: the new module takes its reader through a `deps` parameter so tests never touch real `git` or `gh`.
- Commits: `{Verb} {what} — {detail}`, write `refs #4432`, never a closing keyword.

## Review Focus

1. A pre-release mention and a post-release mention on one record: the later PR is independent evidence and must still rate `strong`. Pinned in Task 1.
2. A release at the exact merge instant: "earlier than" is strict, so no downgrade. Pinned in Task 1.
3. A pre-release mention listed first must not spend the record's one files probe ahead of a later plain mention. Pinned in Task 1 (selection order) and Task 3 (probe skip).
4. A corrupt claim blob or a failed read must be logged and must not stop the queue pull. Pinned in Task 2.
5. A missing or corrupt release-times file in the second pass must not stop the queue pull or downgrade. Pinned in Task 2.

---

### Task 1: Release-time downgrade in `classifyShipped`

**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/issues/shipped-candidate.js`
- Test: `tests/bin-lib/issues/shipped-candidate.test.js`

**Interfaces:**
- Produces: `classifyShipped(record, mentions, { prFiles, lastReleasedAt })`. A mention whose `mergedAt` is strictly earlier than `lastReleasedAt` carries the signal `'predates-claim-release'` and rates `weak` at most. Export `PREDATES_CLAIM_RELEASE = 'predates-claim-release'` alongside `classifyShipped`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/issues/shipped-candidate.test.js`, reusing `withKeyFiles`:

```js
// ── #4432: a merged PR that predates the record's latest claim release ─────
const HALF_RECORD = {
  number: 4432,
  title: 'dispatch pre-build check for shipped records',
  createdAt: '2026-10-01T00:00:00Z',
  body: withKeyFiles(['a.js']),
};
const HALF_MENTION = {
  number: 500,
  title: 'dispatch pre-build check for shipped records',
  state: 'MERGED',
  merged: true,
  mergedAt: '2026-10-02T12:00:00Z',
};

test('AC1.1: title-similar merged mention with a claim release after its merge classifies weak', () => {
  const r = classifyShipped(HALF_RECORD, [HALF_MENTION], { lastReleasedAt: '2026-10-02T13:00:00Z' });
  assert.strictEqual(r.tier, 'weak');
  assert.strictEqual(r.pr, 500);
  assert.ok(r.signals.includes('predates-claim-release'));
  assert.ok(r.signals.includes('title-similarity'));
});

test('#4432: key-files coverage with a release after the merge also classifies weak', () => {
  const record = { ...HALF_RECORD, title: 'Completely different wording' };
  const prFiles = new Map([[500, ['a.js']]]);
  const r = classifyShipped(record, [HALF_MENTION], { prFiles, lastReleasedAt: '2026-10-02T13:00:00Z' });
  assert.strictEqual(r.tier, 'weak');
  assert.ok(r.signals.includes('key-files-covered'));
});

test('AC2.1: the same record with no release after the merge still classifies strong', () => {
  assert.strictEqual(classifyShipped(HALF_RECORD, [HALF_MENTION]).tier, 'strong');
  assert.strictEqual(classifyShipped(HALF_RECORD, [HALF_MENTION], { lastReleasedAt: null }).tier, 'strong');
});

test('AC3.1: a release before the PR merged does not downgrade', () => {
  const r = classifyShipped(HALF_RECORD, [HALF_MENTION], { lastReleasedAt: '2026-10-02T11:00:00Z' });
  assert.strictEqual(r.tier, 'strong');
  assert.ok(!r.signals.includes('predates-claim-release'));
});

test('AC4.1: an unparseable release time never downgrades and never upgrades', () => {
  assert.strictEqual(classifyShipped(HALF_RECORD, [HALF_MENTION], { lastReleasedAt: 'not-a-date' }).tier, 'strong');
  const plain = { ...HALF_MENTION, title: 'totally unrelated wording' };
  const r = classifyShipped(HALF_RECORD, [plain], { lastReleasedAt: 'not-a-date' });
  assert.strictEqual(r.tier, 'weak');
  assert.deepStrictEqual(r.signals, ['merged-pr-mention-after-created']);
});

test('#4432: a release at the exact merge instant is not after it, so no downgrade', () => {
  assert.strictEqual(classifyShipped(HALF_RECORD, [HALF_MENTION], { lastReleasedAt: '2026-10-02T12:00:00.000Z' }).tier, 'strong');
});

test('#4432: instants are compared, not strings (a timezone offset that sorts the other way)', () => {
  // 13:00+02:00 is 11:00Z, before the 12:00Z merge; as strings it sorts after it.
  assert.strictEqual(classifyShipped(HALF_RECORD, [HALF_MENTION], { lastReleasedAt: '2026-10-02T13:00:00+02:00' }).tier, 'strong');
});

test('#4432: a merged mention with no mergedAt is not downgraded', () => {
  const noMergedAt = { ...HALF_MENTION };
  delete noMergedAt.mergedAt;
  assert.strictEqual(classifyShipped(HALF_RECORD, [noMergedAt], { lastReleasedAt: '2026-10-02T13:00:00Z' }).tier, 'strong');
});

test('#4432: the downgrade is per mention -- a PR merged after the release still classifies strong', () => {
  const later = { ...HALF_MENTION, number: 501, mergedAt: '2026-10-05T00:00:00Z' };
  const r = classifyShipped(HALF_RECORD, [HALF_MENTION, later], { lastReleasedAt: '2026-10-02T13:00:00Z' });
  assert.strictEqual(r.tier, 'strong');
  assert.strictEqual(r.pr, 501);
});

test('#4432: a plain weak mention merged after the release outranks a downgraded one, whatever the order', () => {
  const later = { ...HALF_MENTION, number: 501, title: 'totally unrelated wording', mergedAt: '2026-10-05T00:00:00Z' };
  for (const mentions of [[HALF_MENTION, later], [later, HALF_MENTION]]) {
    const r = classifyShipped(HALF_RECORD, mentions, { lastReleasedAt: '2026-10-02T13:00:00Z' });
    assert.strictEqual(r.tier, 'weak');
    assert.strictEqual(r.pr, 501);
    assert.ok(!r.signals.includes('predates-claim-release'));
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/issues/shipped-candidate.test.js`
Expected: FAIL (`AC1.1` reports tier `strong`).

- [ ] **Step 3: Implement the rule in `plugin/bin/lib/issues/shipped-candidate.js`**

Parse `opts.lastReleasedAt` once with `new Date(...).getTime()` (a falsy value becomes `NaN`, never `new Date(null)`, which is epoch 0). For each qualifying mention, `mention.mergedAt` parsed the same way, `predatesRelease = mergedAtMs < lastReleasedAtMs`, so any `NaN` leaves it false. Push `PREDATES_CLAIM_RELEASE` after the other signals, and rate `strong` only with `(titleMatch || filesCoverAll) && !predatesRelease`. Selection order: `strong`, then a `weak` without the signal, then a `weak` with it, first in array order within a rank; a non-predating `weak` replaces a predating `best`. Extend the header comment with the rule and with the Global Constraints' shaping-release sentence, naming `tests/build-already-shipped-exit.test.js`'s shipped-exit check.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/issues/shipped-candidate.test.js`
Expected: PASS, every test including the unchanged ones.

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/issues/shipped-candidate.js tests/bin-lib/issues/shipped-candidate.test.js
git commit -m "Downgrade a mention that predates the claim release — refs #4432"
```

### Task 2: Read release times from the claims registry

**Files:**
- Modify: `plugin/bin/lib/issues/claims.js`
- Create: `plugin/bin/lib/dispatch/shipped-releases.js`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/dispatch/` row, line 68: add the module; the `issues/` row naming `classifyShipped`, line 29: add the release-time rule)
- Test: `tests/bin-lib/dispatch/shipped-releases.test.js`

Waived `plugin/bin/lib/issues/linked-prs.js`: the release time is read from claim blobs, so the batched GraphQL is untouched; the spec lists it "only if the release time is read via the batched GraphQL".
Waived `tests/build-already-shipped-exit.test.js`: read-only citation in Task 1's code comment; the shipped-exit behavior does not change.

**Interfaces:**
- Consumes: `createClaimReader()` from `plugin/bin/lib/issues/claim-store.js` (`read(n)` returns `{content}` with null for absent, or `{failure}`); `releasePayload` from `claims.js`.
- Produces, in `claims.js`: `releaseTimeFromClaim(content) -> { releasedAt: string|null, unreadable: boolean }`. Absent or live claim: `{releasedAt: null, unreadable: false}`. Tombstone with a parseable `releasedAt`: that value. Unparseable JSON, a non-object, or a tombstone whose `releasedAt` is missing or does not parse: `{releasedAt: null, unreadable: true}`.
- Produces, in `shipped-releases.js`: `writeReleaseTimes(file, candidates, linkedPRs, deps = {}) -> { [number]: isoString }` and `readReleaseTimes(file) -> { [number]: isoString }`. `deps`: `{ reader, log }`, defaulting to `createClaimReader()` and `console.error`.

- [ ] **Step 1: Write the failing tests**

Create `tests/bin-lib/dispatch/shipped-releases.test.js` with a temp dir per test (`fs.mkdtempSync(path.join(os.tmpdir(), ...))`), a fake `reader` `{ read: (n) => answers[n] }` and a capturing `log`. Fixtures come from the real writer: `releasePayload({ issueNumber: 7, runId: 'r', reason: 'merged: x', now: Date.parse('2026-10-02T13:00:00Z') }).tombstoneContent`, and `claimPayload({ issueNumber: 8, runId: 'r', sessionId: 's', now: Date.parse('2026-10-02T13:00:00Z') }).fileContent` for a live claim. Assertions:

```js
test('releaseTimeFromClaim tells released, not released and unreadable apart', () => {
  assert.deepStrictEqual(releaseTimeFromClaim(TOMBSTONE), { releasedAt: '2026-10-02T13:00:00.000Z', unreadable: false });
  assert.deepStrictEqual(releaseTimeFromClaim(LIVE), { releasedAt: null, unreadable: false });
  assert.deepStrictEqual(releaseTimeFromClaim(null), { releasedAt: null, unreadable: false });
  assert.deepStrictEqual(releaseTimeFromClaim('{not json'), { releasedAt: null, unreadable: true });
  assert.deepStrictEqual(releaseTimeFromClaim('[]'), { releasedAt: null, unreadable: true });
  assert.deepStrictEqual(releaseTimeFromClaim('{"released":true}'), { releasedAt: null, unreadable: true });
  assert.deepStrictEqual(releaseTimeFromClaim('{"released":true,"releasedAt":"nope"}'), { releasedAt: null, unreadable: true });
});

test('writeReleaseTimes reads only candidates with a merged mention, and round-trips through readReleaseTimes', () => {
  // candidates 7 (merged mention, tombstone), 8 (merged mention, live claim),
  // 9 (open mention only), 10 (no linkedPRs entry). Only 7 and 8 are read.
  assert.deepStrictEqual(reads, [7, 8]);
  assert.deepStrictEqual(returned, { 7: '2026-10-02T13:00:00.000Z' });
  assert.deepStrictEqual(readReleaseTimes(file), { 7: '2026-10-02T13:00:00.000Z' });
  assert.deepStrictEqual(logged, []);
});

test('writeReleaseTimes builds no reader when no candidate has a merged mention', () => {
  // deps.reader is a getter that throws; still writes {} and returns {}.
});

test('a failed read, a throwing read and a corrupt blob are logged and yield no release time', () => {
  // answers: 7 -> {failure:'network-failure'}, 8 -> read throws, 9 -> {content:'{not json'}
  assert.deepStrictEqual(returned, {});
  assert.strictEqual(logged.length, 1);
  assert.match(logged[0], /#7, #8, #9/);
  assert.match(logged[0], /release time unknown/);
});

test('readReleaseTimes returns {} for a missing, corrupt or non-object file', () => {
  // missing path; a file holding '{not json'; a file holding '[1]'
});

test('an unwritable release-times file is logged and the in-memory map still returned', () => {
  // file path under a regular file, so the write throws.
});
```

Write the commented bodies out as real code in the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/dispatch/shipped-releases.test.js`
Expected: FAIL with `Cannot find module`.

- [ ] **Step 3: Implement `releaseTimeFromClaim` in `claims.js` and the module**

`writeReleaseTimes` log line, exact text: `'AUTO — dispatch: shipped-candidate claim read failed for #' + unreadable.join(', #') + '; release time unknown, no downgrade'`. A candidate qualifies when `linkedPRs[c.number].mentions` has an entry with `merged` truthy. Use `fs.writeFileSync` and `fs.readFileSync` inside `try`; no `fs.existsSync` (`tests/path-guard-conformance.test.js`). `readReleaseTimes` returns `{}` for an array or null parse. Add the module to the `docs/plugin-structure.md` rows named in Files, with `(#4432 — ...)` in the row's existing style.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/dispatch/shipped-releases.test.js tests/bin-lib/issues/claim-store.test.js tests/path-guard-conformance.test.js`
Expected: PASS.

- [ ] **Step 5: Probe against real tombstones**

Run a scratch `node -e` (not committed) calling `writeReleaseTimes` with the real reader over real records, a scratch file under the session temp dir, and candidates `[4813, 4899, 4818, 999999]`, each with one merged mention.
Expected: `4813` -> `2026-11-02T20:16:53.103Z`, `4899` -> `2026-11-02T20:17:03.554Z`, `4818` -> `2026-11-02T20:34:22.147Z` (the values the plan-time blob read printed, the independent count), `999999` absent, nothing logged. Record the output in `$PIPELINE_RUN_DIR/evidence/real-tombstone-probe.txt` and one `AC evidence` decision line.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/issues/claims.js plugin/bin/lib/dispatch/shipped-releases.js tests/bin-lib/dispatch/shipped-releases.test.js docs/plugin-structure.md
git commit -m "Read shipped-candidate release times from claim tombstones — refs #4432"
```

### Task 3: Wire the queue pull and update the prose

**Review risk:** high

**Files:**
- Modify: `plugin/skills/dispatch/queue-pull-script.md` (temp-path block near line 39; shipped-candidate section, lines 500-588)
- Modify: `plugin/skills/dispatch/SKILL.md` (False-positive posture, lines 117-131)
- Modify: `docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md` (new step 2e, `files:`, Origin line)
- Test: `tests/dispatch-shipped-candidate-prose.test.js`

**Interfaces:**
- Consumes: Task 1's `lastReleasedAt` option and `'predates-claim-release'` signal; Task 2's `writeReleaseTimes` and `readReleaseTimes`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/dispatch-shipped-candidate-prose.test.js`:

```js
test('AC5.2: both classifyShipped call sites pass the release time', () => {
  assert.match(QUEUE_PULL, /classifyShipped\(c, mentions, \{ lastReleasedAt: releases\[c\.number\] \}\)/);
  assert.match(QUEUE_PULL, /classifyShipped\(c, mentions, \{ prFiles, lastReleasedAt: releases\[c\.number\] \}\)/);
  assert.match(QUEUE_PULL, /writeReleaseTimes\(process\.argv\[4\], groups\.flat\(\), linkedPRs\)/);
  assert.match(QUEUE_PULL, /readReleaseTimes\(process\.argv\[5\]\)/);
});

test('#4432: a mention predating the release spends no files probe', () => {
  assert.match(QUEUE_PULL, /result\.tier === 'weak' && !result\.signals\.includes\('predates-claim-release'\)/);
});

test('#4432: SKILL.md states the release rule and its accepted false negative', () => {
  assert.match(DISPATCH_SKILL, /#4432/);
  assert.match(DISPATCH_SKILL, /latest claim release/);
});

test('both queue-pull files stay under the read-limit rail', () => {
  const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
  assert.ok(Buffer.byteLength(QUEUE_PULL) <= RAIL_BYTES);
  assert.ok(Buffer.byteLength(DISPATCH_SKILL) <= RAIL_BYTES);
});
```

Add the extract-and-run test, anchored like `tests/dispatch-named-target-exclusion-fixture.test.js`: start anchor is the second-pass `if node ... "$DISPATCH_SHIPPED_PR_FILES" "$DISPATCH_SHIPPED_RELEASES" > "${DISPATCH_GROUPS}.tmp" <<NODE_EVAL_EOF` line, end anchor `  console.log(JSON.stringify(finalGroups));\nNODE_EVAL_EOF`. Strip the leading `if `, substitute `${CLAUDE_PLUGIN_ROOT}` with forward-slash `plugin` root, run through `bash -c` with the four files' env vars set and stdout redirected, over one group holding record 7 (the #4432 shape) and record 8 (the same PR shape, no release):

```js
test('AC1.1: the second pass keeps a downgraded record, excludes the unreleased one, and logs the downgrade', () => {
  // releases file: { "7": "2026-10-02T13:00:00.000Z" }
  assert.deepStrictEqual(finalGroups.flat().map((c) => c.number), [7]);
  assert.deepStrictEqual(readExclusions(exclusionsFile).map((e) => e.records[0]), [8]);
  assert.match(stderr, /#7 kept: merged PR #500 predates claim release at 2026-10-02T13:00:00\.000Z/);
  assert.match(stderr, /#8 excluded, shipped by merged PR #500/);
});

test('AC4.1: a missing release-times file leaves the second pass at the prior behavior', () => {
  // no releases file: record 7 is excluded, the pass exits 0.
});
```

An excluded entry is what the staging loop turns into `staged/shipped-close-N.md`, so no exclusion entry means no staged proposal; that is AC1.1's "no `shipped-close-N.md` staged".

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-shipped-candidate-prose.test.js`
Expected: FAIL (`AC5.2` finds no `lastReleasedAt`).

- [ ] **Step 3: Edit `queue-pull-script.md`**

Add after the `DISPATCH_SHIPPED_PR_FILES=` line:

```bash
DISPATCH_SHIPPED_RELEASES="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value dispatch-shipped-releases.json)"
```

First pass: add `"$DISPATCH_SHIPPED_RELEASES"` as the fourth argument, and inside the heredoc, after `linkedPRs`:

```js
  const releases = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/shipped-releases.js').writeReleaseTimes(process.argv[4], groups.flat(), linkedPRs);
```

then `const result = classifyShipped(c, mentions, { lastReleasedAt: releases[c.number] });` and `if (result.tier === 'weak' && !result.signals.includes('predates-claim-release')) toProbe.push(result.pr);`.

Second pass: add `"$DISPATCH_SHIPPED_RELEASES"` as the last argument (`process.argv[5]`), after `prFiles`:

```js
  const releases = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/shipped-releases.js').readReleaseTimes(process.argv[5]);
```

then `classifyShipped(c, mentions, { prFiles, lastReleasedAt: releases[c.number] })`, and replace the weak log's message with a ternary so the downgrade is auditable:

```js
        console.error('AUTO — dispatch: #' + c.number + (result.signals.includes('predates-claim-release')
          ? ' kept: merged PR #' + result.pr + ' predates claim release at ' + releases[c.number] + ' — remaining work assumed'
          : ' mentioned by merged PR #' + result.pr + ' without a closing keyword; dispatching anyway'));
```

Comment edits, in the #1984 header: drop `— order matters, see this record's own Gotchas`; add

```
# #4432: a mention merged before the record's latest claim release rates weak
# at most (a run saw the merge and left the record open). An unreadable claim
# never downgrades.
```

and shorten the `Reuses $DISPATCH_LINKED_PRS's` sentence to `Reuses $DISPATCH_LINKED_PRS's mentions (every same-repo PR that ever cross-referenced the candidate, closing keyword or not), so the base signal costs no second network round trip.` Shorten the First pass, Second pass and Stage one Close proposal comments until `wc -c` is under 52,500, keeping these consequences: only a `weak` result is a probe candidate, the 5-call cap, `strong` is excluded with a staged proposal and dispatch never closes on GitHub itself, `weak` stays eligible, `none` is silent.

- [ ] **Step 4: Edit `SKILL.md` and the journey**

In the False-positive posture, after the `#4314` sentence, add: `A mention whose PR merged before the record's latest claim release rates `weak` at most (#4432): a run saw that merge and left the record open. A shaping-only release downgrades too, the safe direction, since the build's already-shipped exit still catches a truly shipped record.`

Journey: add `### 2e. A partly shipped record you released is not "shipped"` after 2d in the file's Action/Should feel/Should understand/Red flags shape, using this log line and a later PR still marking the record shipped as the red-flag inverse; add `plugin/bin/lib/dispatch/shipped-releases.js` to `files:`; append `- Updated during build of #4432: ...` to Origin; add `#4432` to step 2d's posture citation only if 2e cites the same URL line.

- [ ] **Step 5: Run tests and measure**

Run: `node --test tests/dispatch-shipped-candidate-prose.test.js tests/node-eval-file-heredoc-syntax.test.js tests/session-tmp-root-migration.test.js tests/dispatch-named-target-exclusion-fixture.test.js`
Expected: PASS.

Run: `wc -c plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/SKILL.md`
Expected: both at or under 52,500.

- [ ] **Step 6: Commit**

```bash
git add plugin/skills/dispatch/queue-pull-script.md plugin/skills/dispatch/SKILL.md docs/journeys/learn-why-a-named-record-wont-dispatch-3084.md tests/dispatch-shipped-candidate-prose.test.js
git commit -m "Feed claim release times to the shipped-candidate pass — refs #4432"
```

## Spec coverage

| Spec item | Task |
|---|---|
| Deliverable 1 | Task 1, Task 2 |
| Deliverable 2 | Task 2, Task 3 |
| Deliverable 3 | Task 3 |
| AC1.1 | Task 1, Task 3 |
| AC2.1 | Task 1 |
| AC3.1 | Task 1 |
| AC4.1 | Task 1, Task 2, Task 3 |
| AC5.1 | Task 1 (four-case coverage in `tests/bin-lib/issues/shipped-candidate.test.js`) |
| AC5.2 | Task 3 |
