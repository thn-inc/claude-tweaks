# Singleton Merge-Verdict Backstop (#2941) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The single-record auto-merge fast lane (`wrap-up/auto-merge-short-circuit.md`) refuses to merge unless a passing `merge-check` verdict for this record is mechanically confirmed in `decisions.md`, using one shared helper that the bundle path (`dispatch/settle-and-merge.md`) also uses.

**Architecture:** A new pure module `plugin/bin/lib/dispatch/merge-verdict.js` owns the verdict-marker strings (`Auto-merge gate` / `Auto-merge short-circuit`) and the "latest verdict per record must be `auto-merge`" check. The skill prose writes the passing line through `bin/log-decision.js` and re-reads it through a `node -e` snippet requiring that module, immediately before every merge call. `settle-and-merge.md`'s two inline snippets migrate to the same module, so its local-merge fallback also accepts the singleton's marker (record Gotcha 4).

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill files.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T172743-record-2941/work/2941-spec.md`

**Scope keywords:** merge-verdict, confirmFromFile, Verdict backstop, Auto-merge short-circuit: #

## Global Constraints

- `tests/console-resolve-conformance.test.js` and `tests/pr-first-merge.test.js` must pass **unchanged**.
- `npm test` passes in full.
- `plugin/skills/dispatch/settle-and-merge.md` is 46027 bytes against the 50 KB (51200 B) shared ceiling (`plugin/bin/lib/skill-audit/context-cost.js` `CEILING_BYTES`) — Task 2 must not grow it by more than ~200 bytes; measure with `wc -c` after editing.
- The existing `needs-human` line (`auto-merge-short-circuit.md` "Any layer fails") stays byte-identical.
- The new passing-verdict line must not contain `needs-human`; the refusal line must contain both `merge-check` and `needs-human` (so `bin/lib/console/resolve.js`'s `needsHumanVerdict` resolves `leave-open`).
- The pre-merge marker must be distinct from the post-merge `Fast-lane auto-merge: issue #{n}, assess-agent-autonomy verdict auto-merge` line, which must never satisfy the check.
- In `auto-merge-short-circuit.md`, do not add a new `**\`integration-model: local-merge\`:**` heading after the existing last one: `tests/pr-first-merge.test.js` splits on that literal and requires `require('$RUN_DIR/run-state.json').worktree` within the first 4000 chars of the LAST part.
- In `auto-merge-short-circuit.md`, keep the literal ``run `_shared/pr-first-merge.md`'s procedure now`` (pinned by `tests/pr-first-merge.test.js`).
- Commit style: `{Verb} {what} — {detail}`, ending with `Refs #2941` (never a closing keyword) and the line `Claude-Session: https://claude.ai/code/session_01NHSHnidCMBb9jpekgwXTWt`.

## Review Focus

1. Record-number scoping: `#29`'s passing line must never satisfy a check for `#2941` (and vice versa) — pinned in Task 1.
2. Latest-verdict-wins: a `needs-human` line written after an `auto-merge` line for the same record must make the check fail — pinned in Task 1.
3. Missing/unreadable `decisions.md` must fail closed (unconfirmed), not throw a stack trace the agent might misread — pinned in Task 1 (`confirmFromFile` on a nonexistent path).
4. A `--spec` location prefix (`spec #N — Auto-merge short-circuit: ...`) written by `log-decision.js` must still be recognized — pinned in Task 1.
5. The local-merge fallback in `settle-and-merge.md` must accept a singleton's `Auto-merge short-circuit:` marker — pinned in Task 1 (module accepts both steps) and Task 2 (fallback cites the module).

---

### Task 1: `merge-verdict.js` module

**Files:**
- Create: `plugin/bin/lib/dispatch/merge-verdict.js`
- Test: `tests/bin-lib/dispatch/merge-verdict.test.js`
- Modify: `docs/plugin-structure.md` (the `plugin/bin/lib/dispatch/` line, ~line 58)

**Interfaces:**
- Produces:
  - `VERDICT_STEPS` — frozen `{ gate: 'Auto-merge gate', shortCircuit: 'Auto-merge short-circuit' }`
  - `PASS_VERDICT` — `'auto-merge'`
  - `verdictText(n, verdict = PASS_VERDICT) -> string` — `#${n} assess-agent-autonomy verdict ${verdict}` (exactly what goes in `log-decision.js --text`)
  - `verdictMarker(step, n, verdict = PASS_VERDICT) -> string` — `${step}: ${verdictText(n, verdict)}`
  - `confirmPassingVerdicts(content: string, members: Array<string|number>) -> { [n]: { confirmed: boolean, latest: string|null } }`
  - `confirmFromFile(file: string, members) -> same shape`; on read failure every member is `{ confirmed: false, latest: null, error: <message> }`

- [ ] **Step 1: Write the failing test**

Create `tests/bin-lib/dispatch/merge-verdict.test.js`:

```js
'use strict';
// #2941: the shared merge-verdict backstop used by wrap-up/auto-merge-short-circuit.md (singleton)
// and dispatch/settle-and-merge.md (bundle + local-merge fallback).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  VERDICT_STEPS, PASS_VERDICT, verdictText, verdictMarker, confirmPassingVerdicts, confirmFromFile,
} = require('../../../plugin/bin/lib/dispatch/merge-verdict');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');

const NOW = new Date('2026-10-16T12:00:00Z');
const line = (step, text, extra = {}) => formatEntry({ status: 'AUTO', now: NOW, step, text, ...extra });

test('marker strings are the documented ones', () => {
  assert.strictEqual(PASS_VERDICT, 'auto-merge');
  assert.strictEqual(verdictText(2941), '#2941 assess-agent-autonomy verdict auto-merge');
  assert.strictEqual(verdictMarker(VERDICT_STEPS.shortCircuit, 2941), 'Auto-merge short-circuit: #2941 assess-agent-autonomy verdict auto-merge');
  assert.strictEqual(verdictMarker(VERDICT_STEPS.gate, '{n}'), 'Auto-merge gate: #{n} assess-agent-autonomy verdict auto-merge');
});

test('no passing line (Layer 2 skipped) -> unconfirmed', () => {
  const content = `${line('Step 2.8', 'claimed #2941 (bin/claim-targets.js, transport: git)')}\n`;
  assert.deepStrictEqual(confirmPassingVerdicts(content, [2941]), { 2941: { confirmed: false, latest: null } });
});

test('passing short-circuit line -> confirmed', () => {
  const content = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941))}\n`;
  assert.deepStrictEqual(confirmPassingVerdicts(content, ['2941']), { 2941: { confirmed: true, latest: 'auto-merge' } });
});

test('bundle gate marker also satisfies (settle-and-merge local-merge fallback accepts either)', () => {
  const content = `${line(VERDICT_STEPS.gate, verdictText(7))}\n${line(VERDICT_STEPS.shortCircuit, verdictText(8))}\n`;
  const r = confirmPassingVerdicts(content, [7, 8]);
  assert.strictEqual(r[7].confirmed, true);
  assert.strictEqual(r[8].confirmed, true);
});

test('latest verdict wins: needs-human after auto-merge -> unconfirmed', () => {
  const content = [
    line(VERDICT_STEPS.shortCircuit, verdictText(2941)),
    line(VERDICT_STEPS.shortCircuit, '#2941 assess-agent-autonomy verdict needs-human — Review Console renders normally'),
  ].join('\n');
  assert.deepStrictEqual(confirmPassingVerdicts(content, [2941]), { 2941: { confirmed: false, latest: 'needs-human' } });
});

test("another record's passing line never satisfies (prefix numbers included)", () => {
  const content = `${line(VERDICT_STEPS.shortCircuit, verdictText(29))}\n${line(VERDICT_STEPS.gate, verdictText(29410))}\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].confirmed, false);
  assert.strictEqual(confirmPassingVerdicts(`${line(VERDICT_STEPS.shortCircuit, verdictText(2941))}\n`, [29])[29].confirmed, false);
});

test('post-merge Fast-lane line never satisfies the pre-merge check', () => {
  const content = `${line('Fast-lane auto-merge', 'issue #2941, assess-agent-autonomy verdict auto-merge (see RATIONALE), pr-first-merge outcome merged')}\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].confirmed, false);
});

test('refusal line is not itself a passing verdict', () => {
  const content = [
    line(VERDICT_STEPS.shortCircuit, verdictText(2941)),
    line(VERDICT_STEPS.shortCircuit, '#2941 merge-check verdict not confirmed in decisions.md (latest: none) — treated as needs-human, Review Console renders normally'),
  ].join('\n');
  // The refusal does not parse as a verdict line, so the earlier pass is still the latest verdict.
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].latest, 'auto-merge');
});

test('a --spec location prefix is still recognized', () => {
  const content = `${line(VERDICT_STEPS.shortCircuit, verdictText(2941), { spec: 2941 })}\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [2941])[2941].confirmed, true);
});

test('CRLF content is handled', () => {
  const content = `${line(VERDICT_STEPS.gate, verdictText(5))}\r\n`;
  assert.strictEqual(confirmPassingVerdicts(content, [5])[5].confirmed, true);
});

test('confirmFromFile reads the file; a missing file fails closed with an error', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-verdict-'));
  const file = path.join(dir, 'decisions.md');
  fs.writeFileSync(file, `${line(VERDICT_STEPS.shortCircuit, verdictText(3))}\n`);
  assert.deepStrictEqual(confirmFromFile(file, [3]), { 3: { confirmed: true, latest: 'auto-merge' } });
  const missing = confirmFromFile(path.join(dir, 'nope.md'), [3, 4]);
  assert.strictEqual(missing[3].confirmed, false);
  assert.strictEqual(missing[4].confirmed, false);
  assert.match(missing[3].error, /ENOENT/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/bin-lib/dispatch/merge-verdict.test.js`
Expected: FAIL with "Cannot find module '../../../plugin/bin/lib/dispatch/merge-verdict'"

- [ ] **Step 3: Write minimal implementation**

Create `plugin/bin/lib/dispatch/merge-verdict.js`:

```js
// The merge-check verdict backstop (#2429 bundle path, #2941 singleton path): one place that
// owns the decisions.md marker a passing `assess-agent-autonomy merge-check` verdict is logged
// under, and the check every merge site re-runs against decisions.md before merging — so the
// bundle path (dispatch/settle-and-merge.md) and the singleton path
// (wrap-up/auto-merge-short-circuit.md) cannot drift apart on the marker text.
//
// A verdict line is `{step}: #{n} assess-agent-autonomy verdict {verdict}` with {step} one of
// VERDICT_STEPS — exactly what `bin/log-decision.js --step "{step}" --text "{verdictText}"`
// writes. The LATEST verdict line per record wins, so a needs-human logged after an auto-merge
// is never overridden by the earlier pass. Record numbers are matched exactly (`#29` never
// satisfies `#2941`). The post-merge `Fast-lane auto-merge: issue #{n}, ...` line deliberately
// does not match.
'use strict';

const fs = require('fs');

const VERDICT_STEPS = Object.freeze({ gate: 'Auto-merge gate', shortCircuit: 'Auto-merge short-circuit' });
const PASS_VERDICT = 'auto-merge';

const STEP_ALT = Object.values(VERDICT_STEPS).map((s) => s.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&')).join('|');
const VERDICT_RE = new RegExp(`(?:${STEP_ALT}): #(\\d+) assess-agent-autonomy verdict ([a-z][a-z-]*[a-z])`, 'g');

function verdictText(n, verdict = PASS_VERDICT) {
  return `#${n} assess-agent-autonomy verdict ${verdict}`;
}

function verdictMarker(step, n, verdict = PASS_VERDICT) {
  return `${step}: ${verdictText(n, verdict)}`;
}

function latestVerdicts(content) {
  const latest = new Map();
  for (const ln of String(content).split(/\r?\n/)) {
    for (const m of ln.matchAll(VERDICT_RE)) latest.set(Number(m[1]), m[2]);
  }
  return latest;
}

function confirmPassingVerdicts(content, members) {
  const latest = latestVerdicts(content);
  const out = {};
  for (const raw of members) {
    const n = Number(raw);
    const v = latest.has(n) ? latest.get(n) : null;
    out[n] = { confirmed: v === PASS_VERDICT, latest: v };
  }
  return out;
}

// Fails closed: an unreadable decisions.md confirms nothing.
function confirmFromFile(file, members) {
  let content;
  try {
    content = fs.readFileSync(file, 'utf8');
  } catch (err) {
    const out = {};
    for (const raw of members) out[Number(raw)] = { confirmed: false, latest: null, error: err.message };
    return out;
  }
  return confirmPassingVerdicts(content, members);
}

module.exports = { VERDICT_STEPS, PASS_VERDICT, verdictText, verdictMarker, confirmPassingVerdicts, confirmFromFile };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/bin-lib/dispatch/merge-verdict.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Register the module in `docs/plugin-structure.md`**

On the line starting `plugin/bin/lib/dispatch/          → exclusions.js (#1752`, append to the end of that line (before the newline):

```
; merge-verdict.js (#2941 — the merge-check verdict backstop: VERDICT_STEPS/verdictText/verdictMarker own the `Auto-merge gate:`/`Auto-merge short-circuit:` decisions.md marker, and confirmPassingVerdicts/confirmFromFile re-read decisions.md before any merge, latest verdict per record wins, fail closed on an unreadable file. Consumed by plugin/skills/wrap-up/auto-merge-short-circuit.md's Verdict backstop and plugin/skills/dispatch/settle-and-merge.md's Content judgment check and local-merge fallback)
```

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/dispatch/merge-verdict.js tests/bin-lib/dispatch/merge-verdict.test.js docs/plugin-structure.md
git commit -m "Add merge-verdict.js — shared merge-check verdict backstop for singleton and bundle merge paths" -m "Refs #2941" -m "Claude-Session: https://claude.ai/code/session_01NHSHnidCMBb9jpekgwXTWt"
```

---

### Task 2: Migrate `settle-and-merge.md` to the shared module

**Files:**
- Modify: `plugin/skills/dispatch/settle-and-merge.md:288-301` (the `node -e` one-read snippet) and `:364-371` (local-merge fallback re-check paragraph)
- Modify: `tests/dispatch-mechanical-enforcement.test.js:34-35` (marker-literal pins)

**Interfaces:**
- Consumes: `confirmFromFile(file, members)` from Task 1 (`plugin/bin/lib/dispatch/merge-verdict.js`).

- [ ] **Step 1: Update the failing test pins**

In `tests/dispatch-mechanical-enforcement.test.js`, replace these two lines:

```js
  assert.match(t, /marker = 'Auto-merge gate: #' \+ n \+ ' assess-agent-autonomy verdict auto-merge'/);
  assert.doesNotMatch(t, /grep -c "Auto-merge gate: #\{n\} assess-agent-autonomy verdict auto-merge"/);
```

with:

```js
  // #2941: the marker and the check moved into one shared module, so the singleton
  // short-circuit and this bundle path cannot drift apart on the marker text.
  assert.match(t, /require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/dispatch\/merge-verdict\.js'\)/);
  assert.match(t, /confirmFromFile\(process\.argv\[1\], process\.argv\.slice\(2\)\)/);
  assert.doesNotMatch(t, /marker = 'Auto-merge gate: #' \+ n/);
  assert.doesNotMatch(t, /grep -c "Auto-merge gate: #\{n\} assess-agent-autonomy verdict auto-merge"/);
```

And inside the same test, after the existing `assert.match(localMergeSection, /one-read-per-group, checked-in-memory-per-member check above/);` line, add:

```js
  assert.match(localMergeSection, /accepts the singleton short-circuit's `Auto-merge short-circuit:` marker too/);
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/dispatch-mechanical-enforcement.test.js`
Expected: FAIL on the `merge-verdict\.js` require pattern.

- [ ] **Step 3: Edit `settle-and-merge.md`**

Replace the fenced snippet (currently):

```bash
   node -e "
     const fs = require('fs');
     const content = fs.readFileSync(process.argv[1], 'utf8');
     const members = process.argv.slice(2);
     for (const n of members) {
       const marker = 'Auto-merge gate: #' + n + ' assess-agent-autonomy verdict auto-merge';
       console.log(n + '=' + (content.includes(marker) ? 1 : 0));
     }
   " "{run-dir}/decisions.md" {n1} {n2} ...
```

with (same indentation, three spaces):

```bash
   node -e "
     const { confirmFromFile } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/merge-verdict.js');
     for (const [n, v] of Object.entries(confirmFromFile(process.argv[1], process.argv.slice(2)))) console.log(n + '=' + (v.confirmed ? 1 : 0) + ' latest=' + (v.latest || 'none'));
   " "{run-dir}/decisions.md" {n1} {n2} ...
```

In the paragraph right after it, replace `A count of 0 for any member — the entry is missing, whatever the reason — means` with `A 0 for any member — the entry is missing, or a later verdict line for that member overrides it, whatever the reason — means`.

In the `## Dispatching-session merge execution` section, replace:

```
against `{run-dir}/decisions.md`, for every group member. A count of 0 for any member means do
not merge — fall the group back to the normal pending-review path instead.
```

with:

```
against `{run-dir}/decisions.md`, for every group member — it accepts the singleton short-circuit's `Auto-merge short-circuit:` marker too (`wrap-up/auto-merge-short-circuit.md`, #2941), since a dispatched singleton under `local-merge` relays `OUTCOME: ready-to-merge` to this section. A 0 for any member means do
not merge — fall the group back to the normal pending-review path instead.
```

- [ ] **Step 4: Run tests and measure bytes**

Run: `node --test tests/dispatch-mechanical-enforcement.test.js tests/pr-first-merge.test.js tests/merge-subject-composer-conformance.test.js`
Expected: PASS

Run: `wc -c plugin/skills/dispatch/settle-and-merge.md`
Expected: at most 46300 (under the 51200 B ceiling).

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/dispatch/settle-and-merge.md tests/dispatch-mechanical-enforcement.test.js
git commit -m "Route settle-and-merge.md verdict re-reads through merge-verdict.js — fallback accepts the singleton marker" -m "Refs #2941" -m "Claude-Session: https://claude.ai/code/session_01NHSHnidCMBb9jpekgwXTWt"
```

---

### Task 3: Singleton backstop in `auto-merge-short-circuit.md` + conformance suite

**Files:**
- Modify: `plugin/skills/wrap-up/auto-merge-short-circuit.md:57` (Layer 2), `:124` (new paragraph before the Dispatch-claim branch), `:141` (dispatch-claim local-merge relay), `:153` (pr-first branch), `:168` (local-merge branch)
- Test: `tests/auto-merge-short-circuit-verdict-backstop.test.js`

**Interfaces:**
- Consumes: `VERDICT_STEPS`, `verdictText`, `confirmFromFile` from Task 1.

- [ ] **Step 1: Write the failing conformance test**

Create `tests/auto-merge-short-circuit-verdict-backstop.test.js`:

```js
'use strict';
// Conformance suite for record #2941: wrap-up/auto-merge-short-circuit.md's singleton fast lane
// merged PR #2938 with no merge-check verdict ever produced — prose discipline alone. This pins
// the #2429-equivalent mechanical backstop: the passing verdict is logged at Layer 2, and a
// one-read re-check of decisions.md (plugin/bin/lib/dispatch/merge-verdict.js) sits before the
// merge call on both the pr-first and local-merge branches.
//
// Live-corpus read (skill-prose-conformance-tests: a documented convention this project wants
// enforced). Go-red proof [IL-105]: each pattern also runs against a frozen pre-change excerpt.
// Whitespace collapsed on haystack and needle [IL-66].

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { VERDICT_STEPS, verdictText } = require('../plugin/bin/lib/dispatch/merge-verdict');

const ROOT = path.join(__dirname, '..');
const collapse = (s) => s.replace(/\s+/g, ' ');
const FLAT = collapse(fs.readFileSync(path.join(ROOT, 'plugin/skills/wrap-up/auto-merge-short-circuit.md'), 'utf8'));

// Frozen pre-change excerpts — Layer 2, the pr-first branch opener, and the local-merge branch
// opener exactly as they read before #2941.
const PRE_CHANGE = collapse([
  '2. **Content judgment** — invoke `/claude-tweaks:assess-agent-autonomy` in `merge-check` mode '
  + '(`Skill(skill: "claude-tweaks:assess-agent-autonomy", args: "merge-check #{n} --pack {run-dir}/wrap-up-pack.json")`), '
  + 'which weighs the diff\'s content, `/review`\'s findings, and a test-exclusion-aware blast-radius summary holistically. '
  + 'The verdict must be `auto-merge` to proceed.',
  '**Dispatch-claim branch — check this before merging anything.**',
  '**`integration-model: local-merge`:** the checkout restriction is real — do not run the merge procedure below. '
  + 'Stop here instead: report `OUTCOME: ready-to-merge` per `task-prompt.md`\'s second-call template',
  '**`integration-model: pr-first` (`_shared/integration-model.md`):** run `_shared/pr-first-merge.md`\'s procedure now',
  '**`integration-model: local-merge`:** before merging, clear this run\'s worktree assignment',
  'git merge --no-ff {branch} -m "$SUBJECT_TITLE',
].join('\n\n'));

function assertPinned(pattern, label) {
  assert.match(FLAT, pattern, `${label}: missing from live prose`);
  assert.doesNotMatch(PRE_CHANGE, pattern, `${label}: pattern matches the pre-change text — cannot go red`);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

test('Layer 2 logs the passing verdict through log-decision.js, byte-matching the module marker', () => {
  const pattern = new RegExp(
    `--step "${esc(VERDICT_STEPS.shortCircuit)}" --reversibility n/a --text "${esc(verdictText('{n}'))}"`,
  );
  assertPinned(pattern, 'passing-verdict log step');
  assert.ok(!/needs-human/.test(verdictText('{n}')), 'passing line must not contain needs-human');
});

test('the Verdict backstop re-reads decisions.md through the shared module', () => {
  assertPinned(/\*\*Verdict backstop — re-read before any merge \(#2941\)\.\*\*/, 'backstop heading');
  assertPinned(
    /require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/dispatch\/merge-verdict\.js'\)[\s\S]{0,200}?confirmFromFile\(process\.argv\[1\], process\.argv\.slice\(2\)\)[\s\S]{0,200}?"\$PIPELINE_RUN_DIR\/decisions\.md" \{n\}/,
    'backstop one-read snippet',
  );
});

test('the refusal line resolves the console to leave-open (carries merge-check AND needs-human)', () => {
  const m = FLAT.match(/--text "(#\{n\} merge-check verdict not confirmed[^"]*)"/);
  assert.ok(m, 'refusal log line missing');
  assert.match(m[1], /needs-human/);
  assert.match(m[1], /merge-check/);
  assert.doesNotMatch(PRE_CHANGE, /merge-check verdict not confirmed/);
});

test('pr-first: the backstop precedes the _shared/pr-first-merge.md invocation', () => {
  assertPinned(
    /\*\*`integration-model: pr-first` \(`_shared\/integration-model\.md`\):\*\* run the Verdict backstop above first[\s\S]{0,300}?run `_shared\/pr-first-merge\.md`'s procedure now/,
    'pr-first branch ordering',
  );
});

test('local-merge: the backstop precedes the merge, and the dispatch-claim relay', () => {
  assertPinned(
    /\*\*`integration-model: local-merge`:\*\* run the Verdict backstop above first[\s\S]{0,300}?before merging, clear this run's worktree/,
    'local-merge branch ordering',
  );
  assertPinned(
    /\*\*`integration-model: local-merge`:\*\* the checkout restriction is real — run the Verdict backstop above first/,
    'dispatch-claim local-merge relay ordering',
  );
  const backstop = FLAT.indexOf('**Verdict backstop — re-read before any merge (#2941).**');
  const merge = FLAT.indexOf('git merge --no-ff {branch}');
  const prFirst = FLAT.indexOf("run `_shared/pr-first-merge.md`'s procedure now");
  assert.ok(backstop > -1 && backstop < merge && backstop < prFirst, 'backstop paragraph must precede both merge calls');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/auto-merge-short-circuit-verdict-backstop.test.js`
Expected: FAIL on "passing-verdict log step: missing from live prose" (and the other live-prose assertions).

- [ ] **Step 3: Edit `auto-merge-short-circuit.md` — Layer 2 (line 57)**

Immediately after the line ending `The verdict must be \`auto-merge\` to proceed.` insert (blank line before, indented three spaces as a continuation of list item 2):

````markdown

   **Log the verdict on either outcome, before anything else (#2941)** — the same "log a passing verdict too" rule `dispatch/settle-and-merge.md` applies on the group path (#2429). A pass gets its own line — the marker the Verdict backstop below re-reads:

   ```bash
   node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "Auto-merge short-circuit" --reversibility n/a --text "#{n} assess-agent-autonomy verdict auto-merge"
   ```

   A `needs-human` verdict logs the existing line under "Any layer fails" below, unchanged.
````

- [ ] **Step 4: Edit — new Verdict backstop paragraph (before line 124)**

Immediately before the line `**Dispatch-claim branch — check this before merging anything.** Read the claim blob at` insert:

````markdown
**Verdict backstop — re-read before any merge (#2941).** Layer 2 having been prescribed is not
evidence it ran: a dispatched singleton once went straight from Authorization to the merge and
merged PR #2938 with no `merge-check` at all. Every branch below that merges, or relays
`OUTCOME: ready-to-merge`, runs this one-read check of `decisions.md` first, immediately before
its merge call — the same check `dispatch/settle-and-merge.md` runs on the group path, backed by
the same module:

```bash
node -e "
  const { confirmFromFile } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/dispatch/merge-verdict.js');
  for (const [n, v] of Object.entries(confirmFromFile(process.argv[1], process.argv.slice(2)))) console.log(n + '=' + (v.confirmed ? 1 : 0) + ' latest=' + (v.latest || 'none'));
" "$PIPELINE_RUN_DIR/decisions.md" {n}
```

`{n}=1` — this record's latest logged `merge-check` verdict is `auto-merge`; proceed. `{n}=0` —
the passing line is absent, or a later verdict line for this record overrides it (`latest=`
names which). Do not merge: log the refusal, then fall through to "Any layer fails" below
exactly as a `needs-human` verdict does. The refusal carries both `merge-check` and
`needs-human`, so `console-resolve.js` resolves this record's merge to `leave-open`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status AUTO --step "Auto-merge short-circuit" --reversibility n/a --text "#{n} merge-check verdict not confirmed in decisions.md (latest: {latest}) — treated as needs-human, Review Console renders normally"
```

````

- [ ] **Step 5: Edit — the three branch openers**

(a) Replace `**\`integration-model: local-merge\`:** the checkout restriction is real — do not run the merge` (line 141) with `**\`integration-model: local-merge\`:** the checkout restriction is real — run the Verdict backstop above first (on \`{n}=0\`, fall through instead of relaying). Then do not run the merge` — keep the rest of that paragraph unchanged.

(b) Replace `**\`integration-model: pr-first\` (\`_shared/integration-model.md\`):** run \`_shared/pr-first-merge.md\`'s` (line 153) with `**\`integration-model: pr-first\` (\`_shared/integration-model.md\`):** run the Verdict backstop above first (on \`{n}=0\`, stop here and fall through). Then run \`_shared/pr-first-merge.md\`'s` — the following `procedure now` text stays as-is.

(c) Replace `**\`integration-model: local-merge\`:** before merging, clear this run's worktree` (line 168) with `**\`integration-model: local-merge\`:** run the Verdict backstop above first (on \`{n}=0\`, stop here and fall through). Then, before merging, clear this run's worktree` — keep the rest unchanged.

- [ ] **Step 6: Run tests**

Run: `node --test tests/auto-merge-short-circuit-verdict-backstop.test.js tests/auto-merge-short-circuit-ledger-deletion.test.js tests/pr-first-merge.test.js tests/console-resolve-conformance.test.js tests/merge-subject-composer-conformance.test.js tests/wrap-up-pack-conformance.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/wrap-up/auto-merge-short-circuit.md tests/auto-merge-short-circuit-verdict-backstop.test.js
git commit -m "Add singleton verdict backstop to auto-merge-short-circuit.md — log pass, re-read before merge" -m "Refs #2941" -m "Claude-Session: https://claude.ai/code/session_01NHSHnidCMBb9jpekgwXTWt"
```

---

### Task 4: Full suite

- [ ] **Step 1:** Run `npm test > /tmp/claude-2941-npm-test.log 2>&1; echo "exit=$?"` then `tail -30 /tmp/claude-2941-npm-test.log`.
Expected: `exit=0`, `ℹ fail 0`. A failure in a file this plan did not touch: re-run that file alone with `node --test <file>` before concluding (load-flake tolerance, CLAUDE.md Commands).
