# plan-audit task-marker annotations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `plan-audit.js --task-markers` recognizes `**Review risk:** high (reason)` / `**Role:** judgment — why` by their leading token, warns on stderr for every unrecognized marker value, and `/build`'s tier forwarding logs those findings instead of silently ignoring them.

**Architecture:** `extractTaskMarkers` keeps capturing the raw line value and derives the recognized value from its leading whitespace-delimited token; `checkTaskMarkers` reports a finding iff the raw value is present and the recognized value is null. The `--task-markers` CLI branch writes one stderr warning per finding before its unchanged stdout JSON (exit stays 0). Three skill-prose files document the shape and the findings handling; a conformance test pins `dispatch.md`'s findings sentence.

**Tech Stack:** Node 18+ CommonJS, `node --test`.

**Spec:** `.claude-tweaks/pipelines/2026-10-31T234859-record-4640/work/4640-spec.md`

## Global Constraints

- Recognition splits on whitespace only (`raw.split(/\s/, 1)[0]`): `high (x)`, `high — x`, `high\t(x)` → `high`; `high-ish`, `high,`, `medium`, `hgih` → `null`.
- `roleRaw`/`riskRaw` and every finding's `value` keep the full raw trimmed line value.
- Matchers stay same-line-only (`[ \t]*`, never `\s*`); `ROLE_MARKER_RE`/`RISK_MARKER_RE` are unchanged.
- `--task-markers` exit code stays 0 with findings; stdout JSON shape unchanged.
- `markers` semantics unchanged: a recognized key with an unrecognized value still sets `markers: true`.
- `dispatch.md`'s `markers: false` sentence stays byte-for-byte.
- `plugin/skills/build/plan-authoring-checks.md` is 52495 bytes against `RAIL_BYTES` 52500: its edit must shrink it (the replacement below nets −8 bytes; measured, see Task 3).
- Existing #3378 tests in `parser.test.js` / `checks.test.js` / `cli.test.js` stay unmodified (AC3.1).

## Review Focus

- An empty marker value (`**Review risk:**` with nothing after it) — raw `''` is non-null, so it must still yield `risk: null` plus a finding with `value: ''` (not crash on `split`). Test in Task 1.
- A tab between value and annotation (`high\t(x)`) must recognize `high`. Test in Task 1.
- A directly attached separator (`high,`) must stay unrecognized, with a finding. Test in Task 1.
- A task title containing a double quote must not break the stderr line — title and value are rendered with `JSON.stringify`. Test in Task 2.
- Two findings on one task (Role and Review risk both unrecognized) produce two stderr lines, Role first. Test in Task 2.

---

### Task 1: Leading-token recognition in the parser and check

**Role:** integration

**Files:**
- Modify: `plugin/bin/lib/plan-audit/parser.js` (`extractTaskMarkers`, ~line 497, and its header comment ~483)
- Modify: `plugin/bin/lib/plan-audit/checks.js` (`checkTaskMarkers`, ~line 666, and its import line ~17 / comment ~656)
- Test: `tests/bin-lib/plan-audit/parser.test.js`
- Test: `tests/bin-lib/plan-audit/checks.test.js`

**Interfaces:**
- Produces: `extractTaskMarkers(text)` unchanged signature/return shape `{ markers, tasks: [{ index, title, role, risk, roleRaw, riskRaw }] }`, with `role`/`risk` now the recognized leading token. `checkTaskMarkers(text)` unchanged shape `{ ok, findings: [{ taskIndex, title, field, value }] }`.

- [ ] **Step 1: Append failing tests**

Append to `tests/bin-lib/plan-audit/parser.test.js` (after the #3378 block):

```js
// ── #4640: trailing annotation after a recognized marker value ──────────────

test('AC1.1: extractTaskMarkers reads "**Review risk:** high (reason)" as risk high, raw kept', () => {
  const raw = 'high (a read-once/write-last ordering, and branching on computed state)';
  const { markers, tasks } = extractTaskMarkers(`### Task 1: X\n**Review risk:** ${raw}\n`);
  assert.strictEqual(markers, true);
  assert.deepStrictEqual(tasks, [{ index: 1, title: 'X', role: null, risk: 'high', roleRaw: null, riskRaw: raw }]);
});

test('AC2.1: extractTaskMarkers reads parenthesized and em-dash annotations on Role and Review risk', () => {
  const text = [
    '### Task 1: A', '**Role:** judgment (needs design judgment)', '',
    '### Task 2: B', '**Review risk:** high — reason', '**Role:** integration — two files',
    '### Task 3: C', '**Review risk:** high\t(tabbed)',
  ].join('\n');
  const { tasks } = extractTaskMarkers(text);
  assert.deepStrictEqual(tasks.map((t) => [t.role, t.risk]), [['judgment', null], ['integration', 'high'], [null, 'high']]);
});

test('AC4.1: extractTaskMarkers keeps unrecognized leading tokens null (medium, high-ish, high,, trivial, empty)', () => {
  const text = [
    '### Task 1: A', '**Review risk:** medium',
    '### Task 2: B', '**Review risk:** high-ish',
    '### Task 3: C', '**Review risk:** high, because',
    '### Task 4: D', '**Role:** trivial (x)',
    '### Task 5: E', '**Review risk:**',
  ].join('\n');
  const { markers, tasks } = extractTaskMarkers(text);
  assert.strictEqual(markers, true);
  assert.deepStrictEqual(tasks.map((t) => [t.role, t.risk, t.roleRaw, t.riskRaw]), [
    [null, null, null, 'medium'], [null, null, null, 'high-ish'], [null, null, null, 'high, because'],
    [null, null, 'trivial (x)', null], [null, null, null, ''],
  ]);
});
```

Append to `tests/bin-lib/plan-audit/checks.test.js` (after the #3378 block):

```js
// ── #4640: annotated valid values are not findings ──────────────────────────

test('AC1.1: checkTaskMarkers reports no finding for an annotated valid Review risk / Role', () => {
  const text = '### Task 1: A\n**Review risk:** high (why)\n**Role:** judgment — why\n';
  assert.deepStrictEqual(checkTaskMarkers(text), { ok: true, findings: [] });
});

test('AC4.1: checkTaskMarkers reports the full raw value for an unrecognized annotated or empty value', () => {
  const text = '### Task 1: A\n**Role:** trivial (x)\n**Review risk:** high-ish\n\n### Task 2: B\n**Review risk:**\n';
  assert.deepStrictEqual(checkTaskMarkers(text), {
    ok: false,
    findings: [
      { taskIndex: 1, title: 'A', field: 'Role', value: 'trivial (x)' },
      { taskIndex: 1, title: 'A', field: 'Review risk', value: 'high-ish' },
      { taskIndex: 2, title: 'B', field: 'Review risk', value: '' },
    ],
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js`
Expected: FAIL after Step 1 — the AC1.1 and AC2.1 tests fail (`risk: null` where `'high'` expected; checks reports `high (why)` / `judgment — why` as findings). The AC4.1 tests already pass (they pin unchanged behavior).

- [ ] **Step 3: Implement leading-token recognition**

In `parser.js`, add a module-private `recognizeMarker(raw, allowed)` returning `null` for a null raw, else the leading token `raw.split(/\s/, 1)[0]` when `allowed.includes(lead)`, else `null`. Use it for `role` (`TASK_MARKER_ROLES`) and `risk` (`TASK_MARKER_RISKS`) in `extractTaskMarkers`. Update the header comment: `role`/`risk` are the recognized leading token (text after the value and whitespace is an ignored annotation, #4640); `roleRaw`/`riskRaw` the full raw value.

In `checks.js`, change both conditions to `t.roleRaw !== null && t.role === null` / `t.riskRaw !== null && t.risk === null`, so the check uses the parser's own recognition rule. Drop `TASK_MARKER_ROLES, TASK_MARKER_RISKS` from the import if nothing else in `checks.js` uses them; adjust the comment above `checkTaskMarkers` to say a recognized key whose leading token is outside the closed set is a finding.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js`
Expected: PASS (every test, including the unmodified #3378 cases — AC3.1).

- [ ] **Step 5: Go-red proof (AC8.1)**

Temporarily restore the old exact-match expressions (`TASK_MARKER_ROLES.includes(roleRaw)` / `TASK_MARKER_RISKS.includes(riskRaw)`) in `extractTaskMarkers` by hand (never `git stash`), run Step 4's command, confirm the AC1.1/AC2.1 parser tests fail, then re-apply the change. Quote the failing test names in the report.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/lib/plan-audit/parser.js plugin/bin/lib/plan-audit/checks.js tests/bin-lib/plan-audit/parser.test.js tests/bin-lib/plan-audit/checks.test.js
git commit -m "Recognize annotated task-marker values by leading token — high (reason) reads as high (refs #4640)"
```

### Task 2: stderr warning per finding in `--task-markers`

**Role:** integration

**Files:**
- Modify: `plugin/bin/plan-audit.js` (the `parsed.taskMarkers` branch, ~line 112, and its comment ~106)
- Test: `tests/bin-lib/plan-audit/cli.test.js`

**Interfaces:**
- Consumes: Task 1's `extractTaskMarkers` / `checkTaskMarkers` (shapes above).
- Produces: stderr line format, exactly: `plan-audit.js: warning: task ${taskIndex} ${JSON.stringify(title)} — unrecognized ${field} value ${JSON.stringify(value)}; the task reads as unmarked\n`.

- [ ] **Step 1: Append failing tests**

Add `spawnSync` to the existing `node:child_process` require, then append after the #3378 `--task-markers` block:

```js
// ── #4640 — annotated markers and stderr warnings ───────────────────────────

function spawnTaskMarkers(planFile) {
  const r = spawnSync('node', [CLI, planFile, '--task-markers'], { encoding: 'utf8' });
  return { exitCode: r.status, stdout: r.stdout, stderr: r.stderr };
}

test('AC1.1: --task-markers reports risk high for "**Review risk:** high (reason)", no findings, exit 0', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, '### Task 1: X\n**Review risk:** high (a read-once/write-last ordering, and branching on computed state)\n');
    const r = spawnTaskMarkers(plan);
    assert.deepStrictEqual(r, {
      exitCode: 0,
      stdout: `${JSON.stringify({ markers: true, tasks: [{ index: 1, title: 'X', role: null, risk: 'high' }] })}\n`,
      stderr: '',
    });
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('AC2.1: --task-markers reports role judgment and an em-dash-annotated risk high', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, '### Task 1: A\n**Role:** judgment (needs design judgment)\n**Review risk:** high — reason\n');
    const r = spawnTaskMarkers(plan);
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout), { markers: true, tasks: [{ index: 1, title: 'A', role: 'judgment', risk: 'high' }] });
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('AC4.1 AC4.2: --task-markers warns once per finding on stderr, exit 0, findings unchanged', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: A', '**Review risk:** medium', '',
      '### Task 2: B', '**Review risk:** high-ish', '',
      '### Task 3: Say "hi"', '**Role:** trivial', '**Review risk:** low',
    ].join('\n'));
    const r = spawnTaskMarkers(plan);
    assert.strictEqual(r.exitCode, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout).findings, [
      { taskIndex: 1, title: 'A', field: 'Review risk', value: 'medium' },
      { taskIndex: 2, title: 'B', field: 'Review risk', value: 'high-ish' },
      { taskIndex: 3, title: 'Say "hi"', field: 'Role', value: 'trivial' },
      { taskIndex: 3, title: 'Say "hi"', field: 'Review risk', value: 'low' },
    ]);
    assert.strictEqual(r.stderr, [
      'plan-audit.js: warning: task 1 "A" — unrecognized Review risk value "medium"; the task reads as unmarked',
      'plan-audit.js: warning: task 2 "B" — unrecognized Review risk value "high-ish"; the task reads as unmarked',
      'plan-audit.js: warning: task 3 "Say \\"hi\\"" — unrecognized Role value "trivial"; the task reads as unmarked',
      'plan-audit.js: warning: task 3 "Say \\"hi\\"" — unrecognized Review risk value "low"; the task reads as unmarked',
      '',
    ].join('\n'));
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});

test('AC5.1: --task-markers writes nothing to stderr for a plan with no findings (negative control)', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, '### Task 1: A\n**Role:** transcription\n**Review risk:** high\n\n### Task 2: B\nbody\n');
    const r = spawnTaskMarkers(plan);
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.stderr, '');
  } finally { fs.rmSync(repo, { recursive: true, force: true }); }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: FAIL after Step 1 — the AC4.1 AC4.2 test fails (`stderr` is `''`); the AC1.1/AC2.1/AC5.1 tests already pass once Task 1 is in.

- [ ] **Step 3: Write the warnings**

In the `parsed.taskMarkers` branch of `plan-audit.js`, after `checkTaskMarkers(text)` and before the stdout write, write one line per finding to `process.stderr` in the Interfaces format above. Leave `process.exitCode` untouched. Extend the branch comment: each finding is also warned on stderr (#4640) so a mis-parsed marker is never silent.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/bin-lib/plan-audit/cli.test.js`
Expected: PASS.

- [ ] **Step 5: Go-red proof (AC8.1)**

Temporarily remove the stderr write, re-run Step 4's command, confirm the AC4.1 AC4.2 test fails and the AC5.1 control still passes; then temporarily restore exact-match recognition in `parser.js` and confirm the AC1.1/AC2.1 CLI tests fail. Re-apply both and quote the failing test names.

- [ ] **Step 6: Commit**

```bash
git add plugin/bin/plan-audit.js tests/bin-lib/plan-audit/cli.test.js
git commit -m "Warn on stderr for every unrecognized task-marker value in plan-audit --task-markers (refs #4640)"
```

### Task 3: Skill prose — findings handling in dispatch.md, accepted shape in plan-authoring-checks.md and plan-audit.md

**Role:** integration

**Files:**
- Modify: `plugin/skills/build/dispatch.md` (the `**Per-task role/review-risk tier forwarding (#3378).**` paragraph, line 19)
- Modify: `plugin/skills/build/plan-authoring-checks.md` (the `**Per-task role/review-risk markers (#3378).**` paragraph, line 99)
- Modify: `plugin/skills/build/plan-audit.md` (the `--task-markers {plan-file}` paragraph, line 17)
- Test: `tests/plan-task-markers-conformance.test.js`

**Interfaces:**
- Consumes: Task 2's stderr behavior and the unchanged `findings` shape.

- [ ] **Step 1: Append failing conformance tests**

Append to `tests/plan-task-markers-conformance.test.js`:

```js
// Paragraph-scoped slices: from the paragraph's bold lead to the end of its line.
const paragraph = (text, lead) => {
  const start = text.indexOf(lead);
  assert.ok(start >= 0, `paragraph ${lead} not found`);
  const end = text.indexOf('\n', start);
  return text.slice(start, end === -1 ? undefined : end);
};

test('AC6.1 AC6.2: dispatch.md tier forwarding logs --task-markers findings and continues with those tasks unmarked (#4640)', () => {
  const p = paragraph(read('plugin', 'skills', 'build', 'dispatch.md'), '**Per-task role/review-risk tier forwarding (#3378).**');
  assert.match(p, /carries `findings`/);
  assert.match(p, /log-decision\.js" --run "\$PIPELINE_RUN_DIR" --status SKIP --section "\/build" --step "Per-task tier forwarding \(degraded\)" --text-file/);
  assert.match(p, /treated as unmarked, never a stop/);
});

test('AC7.1: plan-authoring-checks.md and plan-audit.md state a trailing annotation after the marker value is ignored (#4640)', () => {
  const authoring = paragraph(read('plugin', 'skills', 'build', 'plan-authoring-checks.md'), '**Per-task role/review-risk markers (#3378).**');
  assert.match(authoring, /trailing annotation after the value is ignored/);
  assert.match(authoring, /on stderr/);
  const audit = read('plugin', 'skills', 'build', 'plan-audit.md');
  const auditPara = audit.slice(audit.indexOf('`--task-markers {plan-file}` (#3378)'));
  assert.match(auditPara.slice(0, auditPara.indexOf('\n')), /trailing annotation after the value is ignored/);
  assert.match(auditPara.slice(0, auditPara.indexOf('\n')), /warning line per finding to stderr/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/plan-task-markers-conformance.test.js`
Expected: FAIL after Step 1 — both new tests fail (no `findings` sentence, no annotation sentence yet); every #3378 test passes.

- [ ] **Step 3: Edit dispatch.md**

Insert one sentence (plus its leading space) immediately after the sentence ending `nothing here applies — this is today's forwarded text, byte-for-byte.` and before `Markers are also ignored outside`, leaving that `markers: false` sentence itself byte-for-byte:

```text
When that output carries `findings` (a recognized key whose value is outside its closed set — possible only with `markers: true`, and logged whether or not the exclusions below fire), log one line per finding with `node "${CLAUDE_PLUGIN_ROOT}/bin/log-decision.js" --run "$PIPELINE_RUN_DIR" --status SKIP --section "/build" --step "Per-task tier forwarding (degraded)" --text-file "{note}" --reversibility n/a`, `{note}` holding `condition: task {taskIndex} "{title}" {field} value "{value}" unrecognized → fallback: task dispatched as unmarked` written with the Write tool (the value is plan-authored text — `_shared/auto-decision-log.md`'s Text from git or a user rule; standalone `/build` lists it in the handoff), and continue with those tasks treated as unmarked, never a stop.
```

- [ ] **Step 4: Edit plan-authoring-checks.md (shrinking edit)**

In the marker paragraph, replace exactly this text (the paragraph's last two sentences):

```text
A marker overrides the header's `size:` mapping for its own task in both directions — intended, since the author sees the full task text, not one run-level estimate. `plan-audit.js --task-markers {plan}` reports a recognized key's unrecognized value (e.g. `**Role:** trivial`) as a warn-only `findings` entry to fix before dispatch; a misspelled key is undetectable and reads as unmarked.
```

with:

```text
A marker overrides the header's `size:` mapping for its task in both directions. A trailing annotation after the value is ignored (`high (why)` reads as `high`). `plan-audit.js --task-markers {plan}` flags a recognized key's unrecognized value (e.g. `**Role:** trivial`) on stderr and as a warn-only `findings` entry — fix it before dispatch; a misspelled key reads as unmarked.
```

Measured at authoring time: old 390 bytes, new 382 bytes → file 52495 → 52487 ≤ 52500. Verify after the edit: `wc -c plugin/skills/build/plan-authoring-checks.md` prints at most `52500`.

- [ ] **Step 5: Edit plan-audit.md**

In the `--task-markers {plan-file}` paragraph, immediately after the text `` `markers` is `true` iff any task carries a recognized marker key at all (even with an unrecognized value); `` insert:

```text
a value is recognized by its leading whitespace-delimited token, so a trailing annotation after the value is ignored (`high (reason)` reads as `high`; `high-ish` stays unrecognized); 
```

and replace `and is warn-only — it never changes the exit code.` with:

```text
and is warn-only — it never changes the exit code; the CLI also writes one warning line per finding to stderr (`plan-audit.js: warning: task {n} "{title}" — unrecognized {field} value "{value}"; the task reads as unmarked`).
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/plan-task-markers-conformance.test.js tests/bin-lib/skill-audit/bloat.test.js tests/bin-lib/skill-audit/context-cost.test.js`
Expected: PASS (no `rail:` failure for the three edited files).

- [ ] **Step 7: Commit**

```bash
git add plugin/skills/build/dispatch.md plugin/skills/build/plan-authoring-checks.md plugin/skills/build/plan-audit.md tests/plan-task-markers-conformance.test.js
git commit -m "Document annotated task markers and log --task-markers findings in tier forwarding (refs #4640)"
```

### Task 4: Full verification

Folded into `/build` Common Step 5 — no new code.

Waived AC9.1: verified by `/build` Common Step 5's runner (`npm test` through `verify.js`), not a plan test step.
Waived AC8.1: proven by the go-red steps (Task 1 Step 5, Task 2 Step 5) — a revert-and-observe check, not a committed test.
