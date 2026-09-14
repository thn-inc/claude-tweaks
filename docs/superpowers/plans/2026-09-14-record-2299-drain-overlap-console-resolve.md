# Drain-PR overlap hold visible to console-resolve.js (#2299) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give `console-resolve.js`'s `mergeResolution()` a way to recognize a *live* drain-PR-overlap hold (#1985) and resolve to `leave-open` for it, self-healing once the overlapping PR merges or closes — so `unattended`'s auto-resolver never silently defeats the hold.

**Architecture:** `plugin/skills/dispatch/drain-pr-overlap.md`'s Step 6 already logs `AUTO {time} — Auto-merge gate: group [{issues}] held — overlaps drain PR #{pr} on {files}; merge order is a human call.` to `decisions.md` whenever this group's PR overlaps a still-open PR from earlier in the same drain firing. `plugin/bin/lib/console/resolve.js`'s `mergeResolution()` will parse that line for the overlapping PR number, then re-verify (never trust as permanent) that PR's *current* state via a new injected `deps.checkPrState(prNumber)` — mirroring the existing `deps.readGrants` injection pattern. Still `OPEN` → `leave-open` (hold is live). `MERGED`/`CLOSED` → the hold has self-healed; fall through to the existing grant-check logic unchanged. A `checkPrState` failure fails closed to `leave-open`, the same posture `grants-unreadable` already uses.

**Tech Stack:** Node.js (`node --test`), the existing `deps`-injection pattern in `plugin/bin/lib/console/resolve.js` and `plugin/bin/console-resolve.js`.

**Spec:** `.claude-tweaks/pipelines/2026-09-14T003846-record-2299/work/2299-spec.md` (materialized from GitHub issue #2299)

## Global Constraints

- Never make the hold's `decisions.md` line match the existing `needs-human`+`merge-check` regex (`needsHumanVerdict`) — that carve-out is permanent by design; this one is not (spec Gotchas).
- The drain-overlap carve-out must re-verify live PR state every time it runs — a historical `decisions.md` line alone must never be trusted as still-current (spec Deliverables).
- `needsHumanVerdict`'s carve-out still takes precedence when both are present (checked first, unchanged ordering).
- Existing `tests/bin-lib/console/resolve.test.js` cases must remain green, unmodified in behavior (spec AC3).

---

### Task 1: Recognize a live drain-overlap hold in `mergeResolution()`, with re-verification

**Files:**
- Modify: `plugin/bin/lib/console/resolve.js`
- Modify: `plugin/bin/console-resolve.js`
- Test: `tests/bin-lib/console/resolve.test.js`

**Interfaces:**
- Consumes: `decisionLines(decisions)` (existing helper in `resolve.js`, already used by `needsHumanVerdict`/`refusedStagedNames`) — returns every `- {STATUS} ...` line from `decisions.md`.
- Produces: `drainOverlapHoldPr(decisions)` — `(decisions: string) => number | null`, the most-recently-logged overlapping PR number from a `held — overlaps drain PR #{pr}` line, or `null` when none exists. Exported alongside the module's existing named exports for direct unit testing. `mergeResolution(snapshot, deps)`'s signature is unchanged; it now also reads `deps.checkPrState` (a new required-when-used dep: `(prNumber: number) => 'OPEN' | 'CLOSED' | 'MERGED'`, throws on a transport/lookup failure — mirrors `deps.readGrants`'s throw-on-failure contract already handled by the `grantsError` branch).

- [ ] **Step 1: Write the failing tests**

Add to `tests/bin-lib/console/resolve.test.js`, after the existing `'readGrants throwing resolves the merge half to leave-open with reason grants-unreadable (#1932 AC3)'` test (so the new drain-overlap tests sit next to the other merge-half carve-out tests):

```javascript
test('a live drain-overlap hold (overlapping PR still OPEN) resolves the merge half to leave-open, even with auto:merge granted (#2299)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const calls = [];
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: (n) => { calls.push(n); return 'OPEN'; } }),
  });
  assert.deepStrictEqual(calls, [4001]);
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /drain-overlap hold/);
  assert.match(r.merge.reason, /#4001/);
});

test('a drain-overlap hold whose PR has since merged self-heals: falls through to the ordinary grant check (#2299)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => 'MERGED' }),
  });
  assert.deepStrictEqual(r.merge, { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' });
});

test('a drain-overlap hold whose PR has since closed self-heals the same as merged (#2299)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => 'CLOSED' }),
  });
  assert.strictEqual(r.merge.resolution, 'merge');
});

test('checkPrState failing on a drain-overlap hold fails closed to leave-open, same posture as grants-unreadable (#2299)', () => {
  const decisions = '## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => { throw new Error('gh: rate limited'); } }),
  });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /drain-overlap hold/);
  assert.match(r.merge.reason, /gh: rate limited/);
});

test('a needs-human verdict still takes precedence over a live drain-overlap hold (#2299)', () => {
  const decisions = '## /wrap-up\n- AUTO 08:00:00 — Auto-merge short-circuit: #7 assess-agent-autonomy verdict needs-human — Review Console renders normally. Reversibility: n/a.\n## /dispatch\n- AUTO 09:00:00 — Auto-merge gate: group [7] held — overlaps drain PR #4001 on src/a.js; merge order is a human call. Reversibility: n/a.\n';
  const r = resolveAll({
    runDir: fixture({ decisions, staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => { throw new Error('should never be called'); } }),
  });
  assert.strictEqual(r.merge.resolution, 'leave-open');
  assert.match(r.merge.reason, /needs-human/);
});

test('no drain-overlap hold line means checkPrState is never consulted (#2299)', () => {
  const r = resolveAll({
    runDir: fixture({ staged: { 'reflect-1.md': 'x' }, headers: [7] }),
    policy: 'console-auto',
    deps: deps({ checkPrState: () => { throw new Error('should never be called'); } }),
  });
  assert.strictEqual(r.merge.resolution, 'merge');
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: FAIL — the six new tests fail (`drainOverlapHoldPr` doesn't exist / `mergeResolution` never consults `deps.checkPrState`, so the `OPEN`/fail-closed cases wrongly resolve to `merge` since `checkPrState` is never called and grants are otherwise satisfied, and the "never be called" cases don't yet throw because nothing calls `checkPrState`). The last two tests (needs-human precedence, no-hold-line) may already pass by coincidence — that's fine, they're regression guards for the new code, not proof of a red state on their own.

- [ ] **Step 3: Implement `drainOverlapHoldPr` and wire it into `mergeResolution`**

In `plugin/bin/lib/console/resolve.js`, add the following after the existing `needsHumanVerdict` function (around line 163, right before `function mergeResolution`):

```javascript
// The Auto-merge gate's own drain-PR-overlap hold (dispatch/drain-pr-overlap.md
// Step 6, #1985) logs this line when this group's PR overlaps a still-open PR
// opened earlier by the same drain firing. Unlike needsHumanVerdict's carve-out
// (an assess-agent-autonomy verdict, permanent), this hold is explicitly NOT
// persisted — drain-pr-overlap.md re-reads the overlapping PR's live state every
// time the Auto-merge gate runs and self-heals once that PR merges or closes.
// A historical decisions.md line alone is therefore not enough to resolve
// leave-open forever after — mergeResolution re-verifies the named PR's current
// state (below) before trusting it. When multiple hold lines exist (a group
// held more than once across retries), the most recent one wins.
const DRAIN_OVERLAP_HOLD_RE = /Auto-merge gate: group \[.*?\] held — overlaps drain PR #(\d+)/;

function drainOverlapHoldPr(decisions) {
  let last = null;
  for (const line of decisionLines(decisions)) {
    const m = DRAIN_OVERLAP_HOLD_RE.exec(line);
    if (m) last = Number(m[1]);
  }
  return last;
}
```

Then modify `mergeResolution` — insert the drain-overlap check immediately after the existing `needsHumanVerdict` check and before the `!snapshot.members.length` check:

```javascript
function mergeResolution(snapshot, deps) {
  const verdict = needsHumanVerdict(snapshot.decisions);
  if (verdict) return { resolution: 'leave-open', reason: `merge-check verdict needs-human takes precedence: ${verdict.replace(/^- /, '')}` };
  const holdPr = drainOverlapHoldPr(snapshot.decisions);
  if (holdPr !== null) {
    let state;
    try {
      state = deps.checkPrState(holdPr);
    } catch (err) {
      return { resolution: 'leave-open', reason: `drain-overlap hold: could not re-verify PR #${holdPr}'s current state (${err && err.message ? err.message : err}) — failing closed, same posture as grants-unreadable` };
    }
    if (state === 'OPEN') {
      return { resolution: 'leave-open', reason: `drain-overlap hold: PR #${holdPr} is still open — merge order is a human call (re-checked live against current PR state, not a persisted hold — see dispatch/drain-pr-overlap.md Step 6)` };
    }
    // MERGED or CLOSED: the hold has self-healed — fall through to the ordinary grant check below.
  }
  if (!snapshot.members.length) return { resolution: 'leave-open', reason: 'members-unresolved' };
  if (snapshot.grantsError) return { resolution: 'leave-open', reason: 'grants-unreadable' };
  for (const n of snapshot.members) {
    const g = snapshot.grants[n] || { labels: [], pendingSince: null };
    const labels = g.labels || [];
    const mat = evaluateMaturation({
      hasMergeLabel: labels.includes('auto:merge'),
      hasPendingLabel: labels.includes('auto:merge-pending'),
      pendingSince: g.pendingSince || null,
      vetoWindowHours: deps.vetoWindowHours,
      now: deps.now(),
    });
    if (!mat.mature) return { resolution: 'leave-open', reason: `#${n} lacks auto:merge and a matured auto:merge-pending (${mat.reason})` };
  }
  return { resolution: 'merge', reason: 'every member carries auto:merge or a matured auto:merge-pending; no needs-human verdict' };
}
```

Add `drainOverlapHoldPr` to the module's `module.exports` line (currently `module.exports = { SECTIONS, SECTION_MAP, SECTION_STANCES, classifyStagedItem, readSnapshot, resolveAll, renderTable, renderStoredTable };`) so the test file can import it directly if needed — append it to the existing list:

```javascript
module.exports = { SECTIONS, SECTION_MAP, SECTION_STANCES, classifyStagedItem, readSnapshot, resolveAll, renderTable, renderStoredTable, drainOverlapHoldPr };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/console/resolve.test.js`
Expected: PASS — all tests, including the 6 new ones and every pre-existing one.

- [ ] **Step 5: Wire a real `checkPrState` into the CLI**

In `plugin/bin/console-resolve.js`, add a new helper function after the existing `gitApplyCheck` function (around line 94):

```javascript
// Live PR state for a drain-overlap hold's re-verification (resolve.js's
// mergeResolution) — mirrors ghReadGrants's shape: one execFile call, thrown
// errors propagate so resolve.js can fail closed to leave-open on a
// transport failure rather than silently treating it as resolved.
function ghCheckPrState(execFile, cwd) {
  return (prNumber) => {
    const raw = execFile('gh', ['pr', 'view', String(prNumber), '--json', 'state'], { cwd });
    return JSON.parse(raw).state;
  };
}
```

Then add `checkPrState: ghCheckPrState(execFile, cwd()),` to the `resolverDeps` object literal (around line 161-169), alongside the existing `readGrants: ghReadGrants(execFile, cwd()),` line:

```javascript
  const resolverDeps = {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
    gitApplyCheck: gitApplyCheck(execFile, cwd()),
    readGrants: ghReadGrants(execFile, cwd()),
    checkPrState: ghCheckPrState(execFile, cwd()),
    vetoWindowHours,
    now,
    ...(deps.resolverDeps || {}),
  };
```

No test file exists for `console-resolve.js` itself (it is exercised only via `resolve.js`'s unit tests and the skill-level integration documented in `wrap-up/review-console.md`) — this step has no test-first cycle of its own; `node --test` (Step 6 below) is this step's verification.

- [ ] **Step 6: Run the full test suite**

Run: `npm test`
Expected: PASS — no regressions anywhere else in the suite.

- [ ] **Step 7: Commit**

```bash
git add plugin/bin/lib/console/resolve.js plugin/bin/console-resolve.js tests/bin-lib/console/resolve.test.js
git commit -m "$(cat <<'EOF'
Give console-resolve.js's mergeResolution a live drain-overlap-hold carve-out

refs #2299
EOF
)"
```

---

### Task 2: Document the new consumer in the two prose files the spec names

**Files:**
- Modify: `plugin/skills/dispatch/drain-pr-overlap.md`
- Modify: `plugin/skills/wrap-up/review-console.md`

**Interfaces:**
- Consumes: nothing new — this task only adds prose pointing at Task 1's already-shipped code path.
- Produces: nothing new — no new named export or behavior; purely documentation of an existing carve-out for the next reader of either file.

- [ ] **Step 1: Note the new reader in `drain-pr-overlap.md`'s Step 6**

In `plugin/skills/dispatch/drain-pr-overlap.md`, the Step 6 section currently ends (line 72):

```
This check re-reads the overlapping PR's *current* state every time it runs — it is not a
persisted hold — so once that PR has merged or closed, the next evaluation of this gate (a later
firing, or a retry) finds no live overlap and proceeds normally through Authorization and Content
judgment. No hit, or a hit only against a PR that has already merged/closed: proceed to
Authorization immediately, unaffected.
```

Append one paragraph after it:

```markdown

**This log line has a second reader (#2299).** `bin/lib/console/resolve.js`'s `mergeResolution()`
parses this exact line (`drainOverlapHoldPr()`) when a group reaches the Wrap-Up Review Console's
`unattended` auto-resolver (`wrap-up/review-console.md`'s Auto-resolution short-circuit) without
ever having its merge decision reach this Auto-merge gate at all — the hold above only runs from
*this* skill's own Auto-merge gate, but the log line it writes outlives that one evaluation. The
resolver applies the identical self-healing rule this section already states: it re-verifies the
named PR's live state (`gh pr view`) rather than trusting the historical line as permanent, so a
console evaluated after the overlapping PR has since merged or closed resolves normally, exactly
as a fresh Auto-merge gate evaluation would.
```

- [ ] **Step 2: Add the third carve-out to `review-console.md`'s Auto-resolution short-circuit**

In `plugin/skills/wrap-up/review-console.md`, the bullet list under "Auto-resolution short-circuit" (starting at line 87) currently documents the needs-human carve-out and the ungranted-member carve-out (`#1802`) inside one long bullet. Insert a new sentence into that same bullet, immediately after the existing "**Ungranted-member carve-out (#1802):**" sentence and before "Every non-merge item still auto-resolves exactly as this section states." — so the three carve-outs read as one coherent list rather than splitting the drain-overlap one into its own bullet (matching the existing bullet's own structure, which already folds two carve-outs into one sentence-per-carve-out flow):

```markdown
**Drain-overlap-hold carve-out (#2299):** the same leave-open resolution also applies when
`dispatch/drain-pr-overlap.md`'s own Auto-merge-gate hold (#1985) logged this group as overlapping
a still-open PR from earlier in the same drain firing — `console-resolve.js`'s `mergeResolution()`
re-verifies that PR's *live* state (never trusting the historical `decisions.md` line as
permanent) and resolves `leave-open` only while it is still genuinely open; once that PR merges or
closes, this carve-out no longer applies and the group's merge decision resolves normally on its
next evaluation.
```

- [ ] **Step 3: Commit**

```bash
git add plugin/skills/dispatch/drain-pr-overlap.md plugin/skills/wrap-up/review-console.md
git commit -m "$(cat <<'EOF'
Document console-resolve.js as a second reader of the drain-overlap hold log line

refs #2299
EOF
)"
```

---

## Self-review

- **Spec coverage:** Deliverable 1 (give `console-resolve.js` a drain-overlap carve-out, self-healing not permanent) → Task 1. Deliverable 2 (tests: held+open → leave-open; held+merged/closed → merge) → Task 1 Step 1's new tests. AC1 (never auto-merged while overlapping PR open) → the `OPEN` test. AC2 (resolves normally once overlapping PR merges/closes, no permanent lockout) → the `MERGED`/`CLOSED` tests. AC3 (`npm test` green, existing cases unaffected) → Task 1 Step 6, and every pre-existing test in the file is left untouched, only new tests appended. The two Gotchas (never match the `needs-human` regex; #2298 unaffected since none of #1944/#1984/#1985 carry `auto:merge`) are honored structurally — the new code path is a wholly separate regex/function from `needsHumanVerdict`, and a run with no drain-overlap hold line never calls `checkPrState` at all (the "no drain-overlap hold line" test pins this).
- **Placeholders:** none — every step shows the actual diff/code, not a description of it.
- **Type consistency:** `checkPrState(prNumber): 'OPEN' | 'CLOSED' | 'MERGED'` is used identically in the test fixtures (Task 1 Step 1), the implementation (Task 1 Step 3), and the CLI wiring (Task 1 Step 5) — same three string values, same throw-on-failure contract as `readGrants`.
