# closing-tally counts apply-refine-labels writes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `bin/closing-tally.js` reports the true per-type counts for a `/claude-tweaks:backlog refine` run whose writes went through `bin/apply-refine-labels.js`, counts each write once when both log forms exist, and flags any unmatched `/backlog` AUTO/FAILED line as `unclassified`.

**Architecture:** `closing-tally.js` (the lib) becomes the authoritative side. `apply-refine-labels.js` stays unchanged: it logs per action, by label (`#{n}: applied +auto:build +priority:medium`), and has no lane field, so the tally derives the write type(s) from the labels each action applied. One action can carry two writes (a grant row that also sets a priority). Counts are distinct records per field, which collapses a template line and an apply line for the same write into one. The `unclassified` scan tracks the `## {section}` heading and also reports every `AUTO`/`FAILED` line under `## /backlog` that matched nothing and is not known narration.

**Tech Stack:** Node 18+, CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-16T191540-record-2719/spec-3267/work/3267-spec.md` (record #3267)

## Global Constraints

- Make one side authoritative and don't double-count when both forms exist in one `decisions.md` (spec Deliverable 1). Chosen side: `closing-tally.js`. Rationale: `apply-refine-labels.js`'s action JSON has no lane field (`plugin/bin/apply-refine-labels.js` `validateAction`: `issue`/`addLabels`/`removeLabels`/`commentFile` only), so emitting template lines would need a new producer field threaded through five lanes in `refine-lanes.md`/`grant-lane-decision.md`; the labels already identify the write type.
- Widen `unclassified` to any `/backlog`-section AUTO/FAILED line that is neither a counted pattern nor an `IGNORED_PATTERNS` entry (spec Deliverable 2).
- The tally field set (`FIELDS`/`LABELS`) does not change — `refine-closing-summary.md` says a new field must be added there first; no new field is needed.
- Real recorded input (the incident run): `/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-16T172830-backlog-standalone/decisions.md` — its full text is inlined in Task 1's test as `REAL_RUN_2026_10_16`. Independent hand-count of that file: 2 grants (#3226, #3242), 1 priority (#3242), 1 needs-decision (#3225), 0 everything else; the pre-fix CLI rendered all zeros only because the file also carries template lines — the apply-only subset rendered zeros too.
- Producer line shapes (verified in `plugin/bin/apply-refine-labels.js` + `plugin/bin/lib/log-decision/append.js` `formatEntry`):
  - edit success: `- AUTO HH:MM:SS — apply-refine-labels: #{n}: applied {+a +b, -c}. Reversibility: high.`
  - comment success: `- AUTO HH:MM:SS — apply-refine-labels: #{n}: comment posted. Reversibility: high.`
  - edit failure: `- FAILED HH:MM:SS — apply-refine-labels: #{n}: {+a, -c} failed: {message}.`
  - comment failure: `- FAILED HH:MM:SS — apply-refine-labels: #{n}: comment failed: {message}.`
- Other `/backlog`-section producers that must NOT surface as unclassified: `refine-lanes.md`'s `Backlog refine: batch auto-applied …` (already ignored), `merge-lane-reset.md`'s `Backlog refine: merge-lane circuit breaker RESET …` (already ignored), `refine-record.md` Step 5's `Backlog refine #{n}: {choices} — …` (Resolve-lane per-record line; no tally field exists for it — newly ignored here), and apply-refine-labels' `comment posted` line (half of a flag-back/needs-decision write already counted by its label line).
- Commit message style `{Verb} {what} — {detail}`, `refs #3267`, never a closing keyword.

## Review Focus

1. A single apply line carrying two writes (`+auto:build +priority:medium`) must count one grant AND one priority (pinned by the real-input test).
2. A flag-back's `comment posted` line must not count as a second write nor surface as unclassified (pinned in the apply-only test).
3. A template FAILED line and an apply FAILED line for the same record count one failure (pinned in the both-forms test).
4. A `## /flow` (or any non-`/backlog`) AUTO line stays out of `unclassified` — the existing "ignores non-Backlog-refine decisions.md lines" test keeps pinning it.
5. A `/backlog` `SKIP`/`STAGED` line is not an AUTO/FAILED write and must not surface as unclassified (pinned in the unclassified test).

---

### Task 1: closing-tally classifies apply-refine-labels lines, dedups, widens unclassified

**Files:**
- Modify: `plugin/bin/lib/closing-tally/closing-tally.js` (whole classification section and `computeClosingTally`)
- Modify: `plugin/bin/closing-tally.js:9-11` (header comment only)
- Test: `tests/bin-lib/closing-tally/closing-tally.test.js` (append)

**Interfaces:**
- Consumes: `run(argv, deps)` from `plugin/bin/apply-refine-labels.js` (test only, with injected fakes — no `gh`).
- Produces: unchanged exports `{ FIELDS, LABELS, computeClosingTally, renderTallyLine }`; `computeClosingTally(text) -> { counts, unclassified }` keeps its shape.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/closing-tally/closing-tally.test.js` (it already imports `{ test }`, `assert` from `node:assert/strict`, and `{ FIELDS, computeClosingTally, renderTallyLine }` — reuse them; add only the one new `require` shown):

```js
// #3267: apply-refine-labels.js logs its own per-action lines, by label, not by lane.
const { run: applyRefineLabels } = require('../../../plugin/bin/apply-refine-labels');

// Drive the real apply-refine-labels.js with fake gh/fs and capture exactly the
// decisions.md lines it writes, so the fixture is the producer's output, not a guess.
function applyLines(actions, { failIssue = null } = {}) {
  const entries = [];
  const code = applyRefineLabels(['actions.json', '--run', '/repo/.claude-tweaks/pipelines/x'], {
    gh: (args) => {
      if (failIssue !== null && args[2] === String(failIssue)) throw new Error('gh exited 1');
      return '';
    },
    ghAvailable: () => true,
    remoteUrl: () => 'https://github.com/acme/widgets.git',
    readFile: () => JSON.stringify(actions),
    cwd: () => '/repo',
    mainRoot: () => '/repo',
    isAnchored: () => true,
    now: () => 1700000000000,
    appendEntry: ({ entry }) => { entries.push(entry); },
    stdout: () => {},
    stderr: () => {},
  });
  assert.equal(code, 0);
  return `## /backlog\n${entries.join('\n')}\n`;
}

// The incident run (#3267's Current State), verbatim: apply-refine-labels lines
// AND the refine-closing-summary template lines for the same writes.
const REAL_RUN_2026_10_16 = `## /backlog
- AUTO 19:32:41 — refine confirm-gate: Backlog refine: batch auto-applied — 3 rows across 2 lanes, all recommended values. Reversibility: high. [lever: autonomy=unattended (policy)]
- AUTO 19:32:46 — apply-refine-labels: #3226: applied +auto:build. Reversibility: high.
- AUTO 19:32:50 — apply-refine-labels: #3242: applied +auto:build +priority:medium. Reversibility: high.
- AUTO 19:32:55 — apply-refine-labels: #3225: applied +needs:decision. Reversibility: high.
- AUTO 19:32:58 — apply-refine-labels: #3225: comment posted. Reversibility: high.
- AUTO 19:33:16 — refine apply: Backlog refine: granted auto:build to #3226 (risk:low, size:medium). Rationale: well-specified fail-closed repairable classification; edits agent-instruction prose in dispatch two-call-gate.md and sequential-execution.md, so merge stays human. Reversibility: high.
- AUTO 19:33:16 — refine apply: Backlog refine: granted auto:build to #3242 (risk:low, size:low). Rationale: probe-first, structural-field keyed, falls back to today; edits flow steps-and-gates.md, so merge stays human. Blocked by #3225. Reversibility: high.
- AUTO 19:33:17 — refine apply: Backlog refine: set priority:medium on #3242. Reversibility: high.
- AUTO 19:33:17 — refine apply: Backlog refine: stamped needs:decision on #3225 — PreToolUse deny gate spec carries a contradicted ordering premise (materialize commit precedes config.yml in clean first calls); amend before granting. Reversibility: high.
`;

const ZERO = { priority: 0, related: 0, granted: 0, flaggedBack: 0, dependencyRepair: 0, needsDecision: 0, skipped: 0, failed: 0 };

test('#3267 AC1: a decisions.md written only by apply-refine-labels.js reports the true per-type counts', () => {
  const text = applyLines([
    { issue: 31, addLabels: ['auto:build', 'auto:merge'] },
    { issue: 32, addLabels: ['priority:high'] },
    { issue: 33, addLabels: ['needs:decision'], commentFile: 'nd.md' },
    { issue: 34, removeLabels: ['ready'], commentFile: 'fb.md' },
    { issue: 35, addLabels: ['auto:build'], removeLabels: ['bot:blocked'] },
  ]);
  assert.match(text, /#34: comment posted/);
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, granted: 2, priority: 1, needsDecision: 1, flaggedBack: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC1: an apply-refine-labels FAILED line counts as failed, never unclassified', () => {
  const text = applyLines([
    { issue: 41, addLabels: ['priority:low'] },
    { issue: 42, addLabels: ['auto:build'] },
  ], { failIssue: 42 });
  assert.match(text, /- FAILED .*apply-refine-labels: #42: /);
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, priority: 1, failed: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC1 (real input): the incident run\'s apply-only lines report 2 granted, 1 priority, 1 needs-decision', () => {
  const applyOnly = REAL_RUN_2026_10_16.split('\n')
    .filter((l) => !/Backlog refine:/.test(l))
    .join('\n');
  const { counts, unclassified } = computeClosingTally(applyOnly);
  assert.deepEqual(counts, { ...ZERO, granted: 2, priority: 1, needsDecision: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC2 (real input): apply lines and template lines for the same writes count each write once', () => {
  const { counts, unclassified } = computeClosingTally(REAL_RUN_2026_10_16);
  assert.deepEqual(counts, { ...ZERO, granted: 2, priority: 1, needsDecision: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC2: a template FAILED line and an apply FAILED line for the same record count one failure', () => {
  const text = `## /backlog
- FAILED 10:00:00 — apply-refine-labels: #50: +priority:high failed: gh exited 1.
- FAILED 10:00:01 — Backlog refine: priority write failed on #50: gh exited 1.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, { ...ZERO, failed: 1 });
  assert.deepEqual(unclassified, []);
});

test('#3267 AC3: an unknown /backlog AUTO line with no "Backlog refine:" prefix is listed in unclassified', () => {
  const text = `## /backlog
- AUTO 10:00:00 — refine apply: rewired blocked-by on #60 by hand. Reversibility: high.
- SKIP 10:00:01 — refine apply: no Manual Steps. Reversibility: n/a.
## /flow
- AUTO 10:00:02 — Step 2.8: claimed #61. Reversibility: high.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, ZERO);
  assert.equal(unclassified.length, 1);
  assert.match(unclassified[0], /rewired blocked-by on #60/);
});

test('#3267: known /backlog narration (Resolve-lane "Backlog refine #N:" lines) is not reported as unclassified', () => {
  const text = `## /backlog
- AUTO 10:00:00 — refine #70: Backlog refine #70: keep — no labels changed. Reversibility: high.
`;
  const { counts, unclassified } = computeClosingTally(text);
  assert.deepEqual(counts, ZERO);
  assert.deepEqual(unclassified, []);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/closing-tally/closing-tally.test.js`
Expected: FAIL — exactly 4 failures: the three AC1 tests (apply-only fixture, apply FAILED line, real-input apply-only subset) report zeros instead of the expected counts, and the AC3 test reports an empty `unclassified`. The two AC2 tests and the Resolve-lane test pass already: pre-change code ignores apply lines entirely, so it can neither double-count nor flag them — those three pin the no-double-count / no-false-drift properties the new classifier must keep (verified at plan time: RED = 11 pass / 4 fail).

- [ ] **Step 3: Implement — replace the classification section of `plugin/bin/lib/closing-tally/closing-tally.js`**

Replace everything from the `// Matched against a decisions.md line's text after its` comment through the end of `computeClosingTally` (keep the file header, `FIELDS`, `LABELS`, `renderTallyLine`, and `module.exports` exactly as they are) with:

```js
// Matched against a decisions.md line's text after its `- {STATUS} {HH:MM:SS}
// — ` prefix (if any) — order matters only in that each pattern is tried in
// turn and the first match wins; the patterns are mutually exclusive by
// construction (each names a distinct fixed phrase from
// refine-closing-summary.md's templates), so ordering never changes a result.
const PATTERNS = [
  { field: 'priority', re: /Backlog refine: set priority:/ },
  { field: 'related', re: /Backlog refine: updated \*\*Related:\*\*/ },
  { field: 'granted', re: /Backlog refine: granted auto:build/ },
  { field: 'granted', re: /Backlog refine: re-authorized #/ },
  { field: 'flaggedBack', re: /Backlog refine: flagged back #/ },
  { field: 'dependencyRepair', re: /Backlog refine: repaired dependency on/ },
  { field: 'needsDecision', re: /Backlog refine: stamped needs:decision on/ },
  { field: 'skipped', re: /Backlog refine: skipped #/ },
  { field: 'failed', re: /Backlog refine: .* write failed on #/ },
];

// bin/apply-refine-labels.js's own per-action lines (#3267). That CLI logs by
// label, not by lane — its actions JSON has no lane field — so the write
// type is derived from the labels it applied. One action can carry two writes
// (a grant row that also sets a priority: `applied +auto:build +priority:medium`).
const APPLY_EDIT_RE = /apply-refine-labels: #(\d+): applied (.+?)\. Reversibility:/;
const APPLY_FAILED_RE = /^- FAILED .*apply-refine-labels: #(\d+): .*failed: /;

// Lines under `## /backlog` (or anywhere, for the "Backlog refine:" prefix)
// written by OTHER steps of the same skill, not per-write outcome lines this
// tally counts — recognized and excluded so they don't surface as false
// `unclassified` drift: refine-lanes.md's unattended batch-summary line,
// merge-lane-reset.md's circuit-breaker reset, apply-refine-labels' own
// `comment posted` line (the second half of a flag-back/needs-decision write
// its label line already counts), and refine-record.md Step 5's Resolve-lane
// per-record line (`Backlog refine #{n}: …` — no tally field exists for it).
const IGNORED_PATTERNS = [
  /Backlog refine: batch auto-applied/,
  /Backlog refine: merge-lane circuit breaker RESET/,
  /apply-refine-labels: #\d+: comment posted/,
  /Backlog refine #\d+:/,
];

function isIgnoredLine(line) {
  return IGNORED_PATTERNS.some((re) => re.test(line));
}

// `+a +b, -c` (apply-refine-labels' label summary) -> the tally fields it
// represents. Empty when the labels name no known write type.
function fieldsForLabels(summary) {
  const tokens = summary.match(/[+-][^\s,]+/g) || [];
  const added = tokens.filter((t) => t[0] === '+').map((t) => t.slice(1));
  const removed = tokens.filter((t) => t[0] === '-').map((t) => t.slice(1));
  const fields = [];
  if (added.includes('auto:build') || added.includes('auto:merge')) fields.push('granted');
  if (added.some((l) => l.startsWith('priority:'))) fields.push('priority');
  if (added.includes('needs:decision')) fields.push('needsDecision');
  if (removed.includes('ready')) fields.push('flaggedBack');
  return fields;
}

// One decisions.md line -> [{field, issue}] — empty when the line is not a
// recognized tally line. `issue` is the record the write targeted (the first
// `#N` after the template prefix), or null when the line names none.
function classifyLine(line) {
  const template = line.indexOf('Backlog refine:');
  if (template !== -1) {
    for (const { field, re } of PATTERNS) {
      if (re.test(line)) {
        const m = line.slice(template).match(/#(\d+)/);
        return [{ field, issue: m ? Number(m[1]) : null }];
      }
    }
    return [];
  }
  const failed = line.match(APPLY_FAILED_RE);
  if (failed) return [{ field: 'failed', issue: Number(failed[1]) }];
  const edit = line.match(APPLY_EDIT_RE);
  if (edit) return fieldsForLabels(edit[2]).map((field) => ({ field, issue: Number(edit[1]) }));
  return [];
}

// decisions.md text -> { counts: {field: n, ...}, unclassified: [line, ...] }.
// A write is counted once per (field, record), so the template line and the
// apply-refine-labels line for the same write collapse into one (#3267).
// `unclassified` carries every line that reads as a Backlog-refine entry
// ("Backlog refine:" anywhere) or is an AUTO/FAILED line under `## /backlog`,
// and matched no known pattern — a vocab drift signal (AC 2: no tally field
// may appear outside this file's own enumerated set without this file being
// updated first), never silently dropped.
function computeClosingTally(decisionsText) {
  const seen = Object.fromEntries(FIELDS.map((f) => [f, new Set()]));
  const anonymous = Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const unclassified = [];
  let section = null;
  const lines = String(decisionsText || '').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const heading = line.match(/^## (.+)$/);
    if (heading) { section = heading[1].trim(); continue; }
    if (isIgnoredLine(line)) continue;
    const hits = classifyLine(line);
    if (hits.length) {
      for (const { field, issue } of hits) {
        if (issue === null) anonymous[field] += 1;
        else seen[field].add(issue);
      }
      continue;
    }
    const backlogWrite = section === '/backlog' && /^- (AUTO|FAILED) /.test(line);
    if (backlogWrite || /Backlog refine:/.test(line)) unclassified.push(line);
  }
  const counts = Object.fromEntries(FIELDS.map((f) => [f, seen[f].size + anonymous[f]]));
  return { counts, unclassified };
}
```

Then in `plugin/bin/closing-tally.js`, replace the header comment lines

```
// tally line); `unclassified` lists every "Backlog refine:" line that didn't
// match a known tally field — a vocabulary-drift signal, never silently
// dropped.
```

with

```
// tally line); `unclassified` lists every "Backlog refine:" line, and every
// AUTO/FAILED line under `## /backlog`, that didn't match a known tally
// field — a vocabulary-drift signal, never silently dropped. Writes logged
// by bin/apply-refine-labels.js count too, once per (field, record) (#3267).
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/closing-tally/closing-tally.test.js tests/bin-lib/closing-tally/cli.test.js tests/apply-refine-labels.test.js`
Expected: PASS (all — including the pre-existing #2729 fixture tests and the #2719 skip-line test)

Real-input probe (record the printed JSON in the report):

Run: `node plugin/bin/closing-tally.js --run "/Users/thomasholknielsen/Code Workspaces/claude-tweaks/.claude-tweaks/pipelines/2026-10-16T172830-backlog-standalone"`
Expected: `"line": "1 priority set · 0 Related updated · 2 granted · 0 flagged back · 0 dependency-repair · 1 needs-decision · 0 skipped · 0 failed"` and `"unclassified": []`

- [ ] **Step 5: Commit**

```bash
git add plugin/bin/lib/closing-tally/closing-tally.js plugin/bin/closing-tally.js tests/bin-lib/closing-tally/closing-tally.test.js
git commit -m "Count apply-refine-labels writes in closing-tally — refs #3267" -m "Classify apply-refine-labels lines by applied labels, count each (field, record) once, and report unmatched /backlog AUTO/FAILED lines as unclassified."
```

### Task 2: Docs follow the new tally contract

**Files:**
- Modify: `plugin/skills/backlog/refine-closing-summary.md:52-56` (the `unclassified` sentence in item 1)
- Modify: `docs/plugin-structure.md:36` and `docs/plugin-structure.md:160`

**Interfaces:**
- Consumes: Task 1's behavior (apply lines counted, dedup per record, widened `unclassified`).
- Produces: nothing.

- [ ] **Step 1: Edit `refine-closing-summary.md`**

Replace

```
   inventing a field ad hoc in the rendered text. The envelope's `unclassified` array lists any
   `decisions.md` line that reads as a Backlog-refine action but matched no known field — a
   drifted log template or a genuinely new write type; surface it as a one-line caveat under the
```

with

```
   inventing a field ad hoc in the rendered text. The CLI counts both forms a write can be logged
   in — the templates above and `bin/apply-refine-labels.js`'s own per-action lines (`#{n}:
   applied {labels}`, typed by the labels applied) — once per record per field, so a write logged
   both ways counts once (#3267). The envelope's `unclassified` array lists any `decisions.md`
   line that reads as a Backlog-refine action, or any `AUTO`/`FAILED` line under `## /backlog`,
   that matched no known field — a drifted log template or a genuinely new write type; surface it
   as a one-line caveat under the
```

- [ ] **Step 2: Edit `docs/plugin-structure.md` line 36**

Replace

```
computeClosingTally (classifies each `decisions.md` "Backlog refine: ..." line into one of refine-closing-summary.md's enumerated tally fields; an unrecognized line surfaces in `unclassified` rather than being silently dropped or miscounted, #2729)
```

with

```
computeClosingTally (classifies each `decisions.md` "Backlog refine: ..." line, and each `apply-refine-labels: #N: applied ...` line by the labels it applied, into one of refine-closing-summary.md's enumerated tally fields, counting each write once per record per field; an unrecognized "Backlog refine:" line or `/backlog` AUTO/FAILED line surfaces in `unclassified` rather than being silently dropped or miscounted, #2729/#3267)
```

- [ ] **Step 3: Edit `docs/plugin-structure.md` line 160**

Replace

```
unclassified lists any "Backlog refine:" line matching no known field)
```

with

```
unclassified lists any "Backlog refine:" line or `/backlog` AUTO/FAILED line matching no known field; apply-refine-labels.js's per-action lines are counted, #3267)
```

- [ ] **Step 4: Run the prose/structure suites that read these files**

Run: `node --test tests/backlog-refine-closing-render.test.js tests/backlog-refine-grant-divergence.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add plugin/skills/backlog/refine-closing-summary.md docs/plugin-structure.md
git commit -m "Document closing-tally's apply-refine-labels counting — refs #3267"
```
