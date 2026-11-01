# plan-audit task-marker annotations (#4640) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plan-audit.js --task-markers` recognizes `**Review risk:** high (reason)` / `**Role:** judgment — why` as `high` / `judgment`, warns on stderr for every unrecognized marker value, and `/build`'s tier forwarding logs those findings instead of dropping them silently.

**Architecture:** `extractTaskMarkers` (parser.js) derives the recognized value from the raw line's leading whitespace-delimited token; `checkTaskMarkers` (checks.js) reports a finding iff the raw value is present and the recognized value is null (one rule, shared). The `--task-markers` CLI branch writes one stderr line per finding, leaving stdout and exit 0 unchanged. Skill prose (dispatch.md, plan-audit.md, plan-authoring-checks.md) documents the shape and the decision-log line.

**Tech Stack:** Node 18+ CommonJS, `node --test`, markdown skill prose.

**Spec:** `.claude-tweaks/pipelines/2026-11-01T165322-record-4640/work/4640-spec.md`

**Scope keywords:** extractTaskMarkers, checkTaskMarkers, TASK_MARKER_RISKS, task-markers

## Global Constraints

- Matcher stays same-line-only: `ROLE_MARKER_RE = /^\*\*Role:\*\*[ \t]*(.*)$/m` and `RISK_MARKER_RE = /^\*\*Review risk:\*\*[ \t]*(.*)$/m` are unchanged (`[ \t]*`, never `\s*`).
- `roleRaw`/`riskRaw` and every `findings[].value` keep the full raw trimmed line value.
- `markers` semantics unchanged: a recognized key with an unrecognized value still sets `markers: true`.
- `--task-markers` exit code stays `0` with findings; stdout JSON shape is byte-identical to today.
- Leading token = `raw.split(/\s/, 1)[0]`. A directly attached separator (`high,`, `high-ish`) is NOT accepted — it stays unrecognized and becomes a finding (decision for the spec's "decide in the build" point: whitespace-only keeps the closed set exact and the stderr warning makes the miss visible).
- `plugin/skills/build/plan-authoring-checks.md` is at 52,495 B against `RAIL_BYTES` 52,500 (headroom 5 B): Task 3's replacement is measured at −1 B (389 B replacing 390 B), leaving 6 B. Any other byte added to that file breaches the rail.
- Existing #3378 cases in `tests/bin-lib/plan-audit/parser.test.js`, `checks.test.js`, `cli.test.js` and `tests/plan-task-markers-conformance.test.js` stay unmodified and green.
- Governing project skill `parse-signal-discipline` (`.claude/skills/parse-signal-discipline/SKILL.md`), quoted verbatim: "When the check hits an input it cannot confidently parse, that outcome must be distinguishable from "this input legitimately does not need this check" — collapsing both into one `null`/skip return turns an unparseable input into a silent false negative: the check reports nothing, and nothing downstream ever learns the check didn't actually run." — applied here: an unrecognized value stays a `findings` entry (and now a stderr line), never folded into "unmarked" silently.
- `plan-audit-check-addition` (`.claude/skills/plan-audit-check-addition/SKILL.md`) does not apply: no check, envelope key or flag is added.
- Scope and edit discipline (verbatim): "Commit tests only where the task asks for them or the repo already keeps tests for this kind of change, sized like the neighboring test files; scratch checks stay scratch. Touch only what the task requires — a pre-existing bug you notice is a follow-up to report, not a fix to fold in, unless the task cannot work without it. Don't reformat or "improve" adjacent code; edit in place rather than rewrite when the result is the same."
- Never run `git stash` in any form.

## Scratch helpers (recreate verbatim if missing)

Two uncommitted scratch scripts back the go-red proofs and the real-input probe. They live at `{scratch}` = `/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-4593/5799247f-6f2c-45e0-9656-5044fb4c1207/scratchpad/`. If either file is missing (a resumed build in another session), recreate it from the block below with the Write tool in that session's own scratchpad directory and use that path — never skip the step that calls it.

`{scratch}go-red-4640.js` — swap one file to its base-revision content, run one test file, restore content and mode in `finally`:

```js
// Usage: node go-red-4640.js <repoRoot> <relPath> <baseRev> <testFile> [namePattern]
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const [repoRoot, relPath, baseRev, testFile, namePattern] = process.argv.slice(2);
const abs = path.join(repoRoot, relPath);
const original = fs.readFileSync(abs);
const mode = fs.statSync(abs).mode;
const base = execFileSync('git', ['-C', repoRoot, 'show', `${baseRev}:${relPath}`]);
let result;
try {
  fs.writeFileSync(abs, base);
  const args = ['--test'];
  if (namePattern) args.push(`--test-name-pattern=${namePattern}`);
  args.push(path.join(repoRoot, testFile));
  result = spawnSync(process.execPath, args, { cwd: repoRoot, encoding: 'utf8' });
} finally {
  fs.writeFileSync(abs, original);
  fs.chmodSync(abs, mode);
}
const restored = Buffer.compare(fs.readFileSync(abs), original) === 0;
const tail = (result.stdout || '').split('\n').filter((l) => /^# (tests|pass|fail)|^not ok/.test(l));
console.log(JSON.stringify({ swapped: relPath, exit: result.status, restored }));
for (const l of tail) console.log(l);
```

`{scratch}marker-probe-4640.js` — run `extractTaskMarkers`/`checkTaskMarkers` over every committed plan:

```js
// Usage: node marker-probe-4640.js <repoRoot>
const fs = require('fs');
const path = require('path');
const root = process.argv[2];
const { checkTaskMarkers } = require(path.join(root, 'plugin/bin/lib/plan-audit/checks.js'));
const { extractTaskMarkers } = require(path.join(root, 'plugin/bin/lib/plan-audit/parser.js'));
const dir = path.join(root, 'docs/superpowers/plans');
let plans = 0, marked = 0, high = 0, roles = 0; const findings = [];
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.md')).sort()) {
  const text = fs.readFileSync(path.join(dir, f), 'utf8');
  plans++;
  const m = extractTaskMarkers(text);
  if (m.markers) marked++;
  for (const t of m.tasks) { if (t.risk) high++; if (t.role) roles++; }
  for (const x of checkTaskMarkers(text).findings) findings.push(`${f} task ${x.taskIndex} ${x.field}=${JSON.stringify(x.value)}`);
}
console.log(JSON.stringify({ plans, marked, highRisk: high, roles, findings: findings.length }));
for (const l of findings) console.log(l);
```

## Review Focus

- An empty value (`**Review risk:**` with nothing after it) — must stay `risk: null` with a finding whose `value` is `""`, as today (leading token `""` is not in the set). Pinned in Task 1.
- An attached separator (`high,`, `high-ish`) — must stay unrecognized + finding, never read as `high`. Pinned in Task 1.
- A task with one valid and one invalid marker (`**Role:** judgment (why)` + `**Review risk:** medium`) — only the invalid field is a finding; role still recognized. Pinned in Task 1 (checks test).
- Titles containing `"` in the stderr warning — the line quotes the title verbatim; no escaping required, but the line must still be one line. Pinned in Task 2 (title `Say "hi"`).
- Real committed plans — the change must not alter any existing plan's recognized markers. Real-input probe over all 90 `docs/superpowers/plans/*.md` before the change printed `{"plans":90,"marked":53,"highRisk":95,"roles":116,"findings":0}`; Task 2's probe step must print the same numbers after it.

---

### Task 1: Leading-token recognition in extractTaskMarkers and checkTaskMarkers

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/bin/lib/plan-audit/parser.js` (`extractTaskMarkers`, its header comment, ~lines 470-517)
- Modify: `plugin/bin/lib/plan-audit/checks.js` (`checkTaskMarkers` and its header comment, ~lines 655-677)
- Test: `tests/bin-lib/plan-audit/parser.test.js` (append after the `#3378: TASK_MARKER_ROLES and TASK_MARKER_RISKS…` test)
- Test: `tests/bin-lib/plan-audit/checks.test.js` (append after the `#3378: checkTaskMarkers ignores an unknown value inside a fenced code block` test)

**Interfaces:**
- Produces: `extractTaskMarkers(text)` → unchanged shape `{ markers, tasks: [{ index, title, role, risk, roleRaw, riskRaw }] }`; `role`/`risk` now = leading token when in the closed set. `checkTaskMarkers(text)` → unchanged shape `{ ok, findings: [{ taskIndex, title, field, value }] }`; finding iff `raw !== null && recognized === null`.

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/plan-audit/parser.test.js`:

```js
test('AC1.1 AC2.1 (#4640): extractTaskMarkers recognizes a closed-set value followed by a trailing annotation', () => {
  const text = [
    '### Task 1: X',
    '**Review risk:** high (a read-once/write-last ordering, and branching on computed state)',
    '',
    '### Task 2: Y',
    '**Role:** judgment (needs design judgment)',
    '',
    '### Task 3: Z',
    '**Review risk:** high — reason',
    '**Role:** judgment — needs design judgment',
  ].join('\n');
  const { markers, tasks } = extractTaskMarkers(text);
  assert.strictEqual(markers, true);
  assert.deepStrictEqual(tasks, [
    { index: 1, title: 'X', role: null, risk: 'high', roleRaw: null, riskRaw: 'high (a read-once/write-last ordering, and branching on computed state)' },
    { index: 2, title: 'Y', role: 'judgment', risk: null, roleRaw: 'judgment (needs design judgment)', riskRaw: null },
    { index: 3, title: 'Z', role: 'judgment', risk: 'high', roleRaw: 'judgment — needs design judgment', riskRaw: 'high — reason' },
  ]);
});

test('AC4.1 (#4640): a leading token outside the closed set stays unrecognized, attached separators included', () => {
  const values = ['medium', 'high-ish', 'high,', 'hgih (typo)', 'medium (reason)', ''];
  for (const v of values) {
    const { tasks } = extractTaskMarkers(`### Task 1: A\n**Review risk:** ${v}\n`);
    assert.deepStrictEqual(
      { risk: tasks[0].risk, riskRaw: tasks[0].riskRaw },
      { risk: null, riskRaw: v },
      `Review risk value ${JSON.stringify(v)}`,
    );
  }
  const { tasks } = extractTaskMarkers('### Task 1: A\n**Role:** trivial (x)\n');
  assert.deepStrictEqual({ role: tasks[0].role, roleRaw: tasks[0].roleRaw }, { role: null, roleRaw: 'trivial (x)' });
});
```

Append to `tests/bin-lib/plan-audit/checks.test.js`:

```js
test('AC1.1 (#4640): checkTaskMarkers reports no finding for an annotated closed-set value', () => {
  const text = '### Task 1: A\n**Role:** judgment (why)\n**Review risk:** high — why\n';
  assert.deepStrictEqual(checkTaskMarkers(text), { ok: true, findings: [] });
});

test('AC4.1 (#4640): checkTaskMarkers flags only the unrecognized field, carrying the full raw value', () => {
  const text = [
    '### Task 1: A', '**Role:** judgment (why)', '**Review risk:** medium (reason)', '',
    '### Task 2: B', '**Review risk:** high-ish', '',
    '### Task 3: C', '**Review risk:**',
  ].join('\n');
  assert.deepStrictEqual(checkTaskMarkers(text), {
    ok: false,
    findings: [
      { taskIndex: 1, title: 'A', field: 'Review risk', value: 'medium (reason)' },
      { taskIndex: 2, title: 'B', field: 'Review risk', value: 'high-ish' },
      { taskIndex: 3, title: 'C', field: 'Review risk', value: '' },
    ],
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL after Step 1 — the two `AC1.1` tests fail (risk/role `null`, and a `Role`/`Review risk` finding for the annotated values); the `AC4.1` tests already pass (today's whole-value rule rejects them too), which is expected.

- [ ] **Step 3: Implement leading-token recognition**

In `parser.js`, add a module-private helper `recognizeMarkerValue(raw, closedSet)` → `string | null`: `null` when `raw === null`, else `const lead = raw.split(/\s/, 1)[0]` and return `lead` when `closedSet.includes(lead)`, else `null`. Use it for `role` (with `TASK_MARKER_ROLES`) and `risk` (with `TASK_MARKER_RISKS`) in `extractTaskMarkers`. Leave both regexes, `roleRaw`/`riskRaw`, and the `markers` computation untouched. Update the header comment's "`role`/`risk` are the recognized value or null (an absent line, or a present line whose value isn't in the closed set above)" to say the recognized value is the line's leading whitespace-delimited token when it is in the closed set, so a trailing annotation after it is ignored.

In `checks.js` `checkTaskMarkers`, replace the two `!TASK_MARKER_ROLES.includes(t.roleRaw)` / `!TASK_MARKER_RISKS.includes(t.riskRaw)` tests with `t.roleRaw !== null && t.role === null` / `t.riskRaw !== null && t.risk === null`. Drop `TASK_MARKER_ROLES, TASK_MARKER_RISKS` from checks.js's parser import only if nothing else in checks.js uses them (`grep -n "TASK_MARKER_" plugin/bin/lib/plan-audit/checks.js`). Update the header comment's "A recognised key (the line is present) with a value outside the closed set" to "…whose value's leading token is outside the closed set (`extractTaskMarkers` left it null)".

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js`
Expected: PASS (all tests, the existing #3378 cases included)

- [ ] **Step 5: Go-red proof for checks.js's rule (Guard-branch discrimination)**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-4593/5799247f-6f2c-45e0-9656-5044fb4c1207/scratchpad/go-red-4640.js" "{worktree}" plugin/bin/lib/plan-audit/checks.js 8d640e794 tests/bin-lib/plan-audit/checks.test.js "4640"`
Expected: JSON line with `"exit":1` and `"restored":true`, and a `not ok` line naming `AC1.1 (#4640): checkTaskMarkers reports no finding for an annotated closed-set value` — proves the checks.js switch, not only the parser, is load-bearing.

- [ ] **Step 6: Commit**

```bash
git -C "{worktree}" add plugin/bin/lib/plan-audit/parser.js plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js
git -C "{worktree}" commit -m "Recognize annotated task-marker values — leading token in the closed set, refs #4640"
```

### Task 2: One stderr warning line per --task-markers finding

**Role:** integration

**Files:**
- Modify: `plugin/bin/plan-audit.js` (the `parsed.taskMarkers` branch, ~lines 106-127, and its comment)
- Test: `tests/bin-lib/plan-audit/cli.test.js` (append after `--task-markers cannot be combined with --spec (#3378)`)

**Interfaces:**
- Consumes: `checkTaskMarkers(text).findings` from Task 1 (`{ taskIndex, title, field, value }`).
- Produces: stderr line format, exactly: `plan-audit.js: warning: task {taskIndex} "{title}" — unrecognized {field} value "{value}"; that field reads as unmarked\n` (one per finding, in `findings` order, written before the stdout JSON line).

- [ ] **Step 1: Write the failing tests**

Append to `tests/bin-lib/plan-audit/cli.test.js` (add `spawnSync` to the existing `child_process` require if it is not already imported):

```js
function runTaskMarkersCapture(planFile) {
  const r = spawnSync('node', [CLI, planFile, '--task-markers'], { encoding: 'utf8' });
  return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('AC1.1 AC2.1 (#4640): --task-markers reads annotated Review risk / Role values, with no findings and no stderr', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: X',
      '**Review risk:** high (a read-once/write-last ordering, and branching on computed state)',
      '',
      '### Task 2: Y',
      '**Role:** judgment (needs design judgment)',
      '**Review risk:** high — reason',
    ].join('\n'));
    assert.deepStrictEqual(runTaskMarkersCapture(plan), {
      exitCode: 0,
      stdout: `${JSON.stringify({
        markers: true,
        tasks: [
          { index: 1, title: 'X', role: null, risk: 'high' },
          { index: 2, title: 'Y', role: 'judgment', risk: 'high' },
        ],
      })}\n`,
      stderr: '',
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC4.1 AC4.2 (#4640): --task-markers writes one stderr warning per finding and still exits 0', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: A', '**Review risk:** medium', '',
      '### Task 2: Say "hi"', '**Review risk:** high-ish', '',
      '### Task 3: C', '**Role:** trivial',
    ].join('\n'));
    const r = runTaskMarkersCapture(plan);
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout).findings, [
      { taskIndex: 1, title: 'A', field: 'Review risk', value: 'medium' },
      { taskIndex: 2, title: 'Say "hi"', field: 'Review risk', value: 'high-ish' },
      { taskIndex: 3, title: 'C', field: 'Role', value: 'trivial' },
    ]);
    assert.strictEqual(r.stderr, [
      'plan-audit.js: warning: task 1 "A" — unrecognized Review risk value "medium"; that field reads as unmarked',
      'plan-audit.js: warning: task 2 "Say "hi"" — unrecognized Review risk value "high-ish"; that field reads as unmarked',
      'plan-audit.js: warning: task 3 "C" — unrecognized Role value "trivial"; that field reads as unmarked',
      '',
    ].join('\n'));
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC5.1 (#4640): --task-markers writes nothing to stderr for a plan with no findings (negative control)', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, '### Task 1: A\n**Role:** transcription\n**Review risk:** high\n\n### Task 2: B\n');
    const r = runTaskMarkersCapture(plan);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stderr, '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: FAIL after Step 1 — `AC4.1 AC4.2 (#4640)` fails (stderr is `''`); `AC1.1 AC2.1 (#4640)` and `AC5.1 (#4640)` pass already because Task 1 landed the parser change.

- [ ] **Step 3: Write the stderr warnings in `plan-audit.js`**

In the `parsed.taskMarkers` branch, after `const { findings } = checkTaskMarkers(text);` and before the `process.stdout.write`, write one line per finding to `process.stderr` in the Interfaces format above. Do not touch `process.exitCode`. Extend the branch's comment ("An unknown marker value is reported inline as a `findings` entry…") with: each finding is also warned on stderr, one line each, exit code unchanged.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: PASS (all tests; the existing #3378 `--task-markers includes a findings entry…` test stays green unmodified)

- [ ] **Step 5: Go-red proofs (AC8 Reading B)**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-4593/5799247f-6f2c-45e0-9656-5044fb4c1207/scratchpad/go-red-4640.js" "{worktree}" plugin/bin/lib/plan-audit/parser.js 8d640e794 tests/bin-lib/plan-audit/cli.test.js "4640"`
Expected: `"exit":1`, `"restored":true`, a `not ok` line for `AC1.1 AC2.1 (#4640)` (parser revert reddens the annotated CLI test).

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-4593/5799247f-6f2c-45e0-9656-5044fb4c1207/scratchpad/go-red-4640.js" "{worktree}" plugin/bin/plan-audit.js 8d640e794 tests/bin-lib/plan-audit/cli.test.js "4640"`
Expected: `"exit":1`, `"restored":true`, a `not ok` line for `AC4.1 AC4.2 (#4640)` (stderr-write revert reddens the warning test).

Run (parser go-red for the unit tests): `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-4593/5799247f-6f2c-45e0-9656-5044fb4c1207/scratchpad/go-red-4640.js" "{worktree}" plugin/bin/lib/plan-audit/parser.js 8d640e794 tests/bin-lib/plan-audit/parser.test.js "4640"`
Expected: `"exit":1`, `"restored":true`, a `not ok` line for `AC1.1 AC2.1 (#4640): extractTaskMarkers recognizes…`.

- [ ] **Step 6: Real-input probe**

Run: `node "/private/tmp/claude-501/-Users-thomasholknielsen-Code-Workspaces-claude-tweaks--claude-worktrees-dispatch-record-4593/5799247f-6f2c-45e0-9656-5044fb4c1207/scratchpad/marker-probe-4640.js" "{worktree}"`
Expected: exactly `{"plans":90,"marked":53,"highRisk":95,"roles":116,"findings":0}` plus — if this plan file itself is committed by then — `plans` 91 / `marked` 54 / `highRisk` 97 / `roles` 119, still `findings: 0`. (Independent count: `git -C "{worktree}" grep -c -E '^\*\*Review risk:\*\* high' -- docs/superpowers/plans` summed must equal `highRisk`.)

- [ ] **Step 7: Commit**

```bash
git -C "{worktree}" add plugin/bin/plan-audit.js tests/bin-lib/plan-audit/cli.test.js
git -C "{worktree}" commit -m "Warn on stderr for each --task-markers finding — exit code unchanged, refs #4640"
```

### Task 3: Document the annotation rule and log findings in /build's tier forwarding

**Role:** integration
**Review risk:** high

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (line 19, the `**Per-task role/review-risk tier forwarding (#3378).**` paragraph)
- Modify: `plugin/skills/build/plan-audit.md` (line 17, the `--task-markers {plan-file}` paragraph)
- Modify: `plugin/skills/build/plan-authoring-checks.md` (line 99, the `**Per-task role/review-risk markers (#3378).**` paragraph)
- Test: `tests/plan-task-markers-conformance.test.js` (append)

**Interfaces:**
- Consumes: Task 2's stderr line format (quoted in plan-audit.md).

- [ ] **Step 1: Write the failing conformance tests**

Append to `tests/plan-task-markers-conformance.test.js`:

```js
test('AC6.1 AC6.2 (#4640): dispatch.md\'s tier forwarding names `findings` and its one SKIP decision-log line, and continues unmarked', () => {
  const text = read('plugin', 'skills', 'build', 'dispatch.md');
  const section = text.slice(text.indexOf('**Per-task role/review-risk tier forwarding (#3378).**'));
  assert.match(section, /When that output carries `findings`/);
  assert.match(section, /--status SKIP --section "\/build" --step "Per-task tier forwarding \(degraded\)" --text-file "\{path\}"/);
  assert.match(section, /whichever exclusion below fires/);
  assert.match(section, /treated as unmarked for that field, never a stop/);
});

test('AC7.1 (#4640): plan-authoring-checks.md and plan-audit.md each state that a trailing annotation after the marker value is ignored', () => {
  const authoring = read('plugin', 'skills', 'build', 'plan-authoring-checks.md');
  const markers = authoring.slice(authoring.indexOf('**Per-task role/review-risk markers (#3378).**'));
  assert.match(markers, /A trailing annotation after the value and a space is ignored\./);
  assert.match(markers, /a stderr warning/);
  const audit = read('plugin', 'skills', 'build', 'plan-audit.md');
  const para = audit.slice(audit.indexOf('`--task-markers {plan-file}` (#3378)'));
  assert.match(para, /a trailing annotation after the value and a space is ignored/);
  assert.match(para, /each entry is also written to stderr as one warning line/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/plan-task-markers-conformance.test.js`
Expected: FAIL after Step 1 — both `#4640` tests fail (phrases absent); every existing #3378 test passes.

- [ ] **Step 3: Edit the three prose files exactly**

`plugin/skills/build/dispatch.md` — insert, immediately after the sentence ending `this is today's forwarded text, byte-for-byte.` and before `Markers are also ignored outside`, this sentence (one space separating it from each neighbor):

```
When that output carries `findings` (a recognized key whose value's leading token is outside its closed set), whichever exclusion below fires, log one `SKIP` line for that call naming every offending task, field and value: write `condition: unrecognized task-marker value(s) — task {index} "{title}" {field} "{value}"[; …] → fallback: dispatched with that field unmarked` with the Write tool to the path `node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" DECISION_TEXT=decision-text-{run-id}-per-task-tier-forwarding.md` prints, then run `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --section "/build" --step "Per-task tier forwarding (degraded)" --text-file "{path}" --reversibility n/a` (`_shared/auto-decision-log.md`'s Text from git or a user rule — the values are plan text; a standalone `/build` lists the line in the Step 7 handoff instead) — and continue dispatch with each such task treated as unmarked for that field, never a stop.
```

`plugin/skills/build/plan-audit.md` — in the `--task-markers {plan-file}` paragraph, replace the clause `` `findings` is present only when a recognized key carries a value outside its closed set, and is warn-only — it never changes the exit code. `` with:

```
a value is recognized when its leading whitespace-delimited token is in the closed set, so a trailing annotation after the value and a space is ignored (`**Review risk:** high (reason)` reads `high`), while `high-ish` or `high,` stays unrecognized; `findings` is present only when a recognized key's value is not recognized that way, and is warn-only — it never changes the exit code, and each entry is also written to stderr as one warning line (`plan-audit.js: warning: task {index} "{title}" — unrecognized {field} value "{value}"; that field reads as unmarked`), while a plan with no findings writes nothing to stderr.
```

`plugin/skills/build/plan-authoring-checks.md` — in the marker paragraph, replace exactly (390 B):

```
A marker overrides the header's `size:` mapping for its own task in both directions — intended, since the author sees the full task text, not one run-level estimate. `plan-audit.js --task-markers {plan}` reports a recognized key's unrecognized value (e.g. `**Role:** trivial`) as a warn-only `findings` entry to fix before dispatch; a misspelled key is undetectable and reads as unmarked.
```

with exactly (389 B):

```
A marker overrides the header's `size:` mapping for its own task in both directions, since the author sees the full task text. A trailing annotation after the value and a space is ignored. `plan-audit.js --task-markers {plan}` reports any other value (`trivial`, `high-ish`) as a warn-only `findings` entry plus a stderr warning, to fix before dispatch; a misspelled key reads as unmarked.
```

- [ ] **Step 4: Run tests and the rail check**

Run: `node --test tests/plan-task-markers-conformance.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS. Then `wc -c plugin/skills/build/plan-authoring-checks.md` prints `52494` (≤ 52,500).

- [ ] **Step 5: Behavior-change prose sweep**

Run: `git -C "{worktree}" grep -n -i -e "recognized key's unrecognized value" -e "carries a value outside its closed set" -e "value outside the closed set" -e "isn't in the closed set" -e "unknown marker value" -- plugin docs tests ':!docs/superpowers/plans' ':!docs/plans/*-ledger.md'`
At base this printed exactly six hits: `checks.js:661`, `parser.js:487`, `plan-audit.js:109`, `plan-audit.md:17`, `plan-authoring-checks.md:99`, `cli.test.js:540`. Expected after Tasks 1-3: only `plan-audit.js:109` ("An unknown marker value is reported inline as a `findings` entry" — still accurate, no change) and `cli.test.js:540` (an existing #3378 test name, kept unmodified per Global Constraints) remain; any other hit is a missed rewrite to fix before committing. (The exclusions were added per #4579; the control is the base run above, which matched all six.)

- [ ] **Step 6: Commit**

```bash
git -C "{worktree}" add plugin/skills/build/dispatch.md plugin/skills/build/plan-audit.md plugin/skills/build/plan-authoring-checks.md tests/plan-task-markers-conformance.test.js
git -C "{worktree}" commit -m "Document annotated task markers and log --task-markers findings in tier forwarding, refs #4640" -m "Prose sweep: plan-audit.js:109 and cli.test.js:540 still match the old phrasing and are no-change (accurate comment; unmodified #3378 test name)."
```

Waived AC3.1: covered by the unmodified existing #3378 cases staying green (Global Constraints), not a new test.
Waived AC8.1: AC8 is the go-red requirement itself — covered by Task 1 Step 5 and Task 2 Step 5.
Waived AC9.1: `npm test` runs at /build Common Step 5 (verify.js), not in a task.
