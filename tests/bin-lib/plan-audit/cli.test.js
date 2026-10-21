'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'plan-audit.js');
const { RAIL_BYTES } = require(path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'skill-audit', 'budgets'));

function makeTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-audit-cli-'));
}

function writePlan(repo, text) {
  const p = path.join(repo, 'plan.md');
  fs.writeFileSync(p, text);
  return p;
}

function runCli(planFile, repoRoot) {
  try {
    const stdout = execFileSync('node', [CLI, planFile, '--repo-root', repoRoot], { encoding: 'utf8' });
    return { exitCode: 0, stdout };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '' };
  }
}

// AC1 — missing Files: path
test('AC1: a fixture plan naming a missing Files: path fails Check A and exits non-zero', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: Do a thing',
      '**Files:**',
      '- Modify: `does/not/exist.js`',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.notStrictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkA.ok, false);
    assert.deepStrictEqual(report.checkA.missing, ['does/not/exist.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// AC2 — Scope keywords match a file absent from the plan
test('AC2: a fixture plan with a Scope keywords match outside the plan fails Check B and exits non-zero', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'unswept.txt'), 'has SCOPE_TOKEN_XYZ inside');
  try {
    const plan = writePlan(repo, [
      'Scope keywords: SCOPE_TOKEN_XYZ',
      '### Task 1: Do a thing',
      '**Files:**',
      '- Modify: `plan.md`',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.notStrictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkB.ok, false);
    assert.deepStrictEqual(report.checkB.unplanned, ['unswept.txt']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// AC3 — near-ceiling file: soft flag, exit 0 when nothing else fails
test('AC3: a fixture plan adding prose to a near-ceiling governed file gets a soft nearCeiling flag and still exits 0', () => {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/build/plan-audit.md';
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x'.repeat(RAIL_BYTES - 500));
  try {
    const plan = writePlan(repo, [
      '### Task 1: Add prose',
      '**Files:**',
      `- Modify: \`${rel}\``,
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const [jsonLine, summaryLine] = stdout.split('\n');
    const report = JSON.parse(jsonLine);
    assert.strictEqual(report.headroom.ok, true);
    assert.strictEqual(report.headroom.nearCeiling.length, 1);
    assert.strictEqual(report.headroom.nearCeiling[0].file, rel);
    assert.match(summaryLine, /Headroom: 1 near rail/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// AC4 — breaching file: exit non-zero
test('AC4: a fixture plan adding prose to a governed file already over the ceiling fails headroom and exits non-zero', () => {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/build/SKILL.md';
  const abs = path.join(repo, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, 'x'.repeat(RAIL_BYTES + 1));
  try {
    const plan = writePlan(repo, [
      '### Task 1: Add prose',
      '**Files:**',
      `- Modify: \`${rel}\``,
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.notStrictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.headroom.ok, false);
    assert.strictEqual(report.headroom.breaches.length, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// AC5 — clean plan
test('AC5: a clean fixture plan has no failures, no flags, exits 0', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugin', 'bin', 'existing.js'), '// existing\n');
  try {
    const plan = writePlan(repo, [
      '### Task 1: Do a thing',
      '**Files:**',
      '- Modify: `plugin/bin/existing.js`',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.ok(report.checkA.ok && report.checkB.ok && report.checkC.ok && report.headroom.ok);
    assert.deepStrictEqual(report.checkA.missing, []);
    assert.deepStrictEqual(report.checkB.unplanned, []);
    assert.deepStrictEqual(report.checkC.findings, []);
    assert.deepStrictEqual(report.headroom.nearCeiling, []);
    assert.deepStrictEqual(report.headroom.breaches, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// AC6 — Check C fixture exercising its pinned failure shape
test('AC6: a fixture plan whose Step 2 command already passes despite declaring Expected: FAIL fails Check C and exits non-zero', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: Add a guard clause',
      '**Files:**',
      '- Modify: `plan.md`',
      '',
      '- [ ] **Step 2: Run test to verify it fails**',
      '',
      'Run: `node -e "process.exit(0)"`',
      'Expected: FAIL with "guard not present"',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.notStrictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkC.ok, false);
    assert.strictEqual(report.checkC.findings.length, 1);
    assert.strictEqual(report.checkC.findings[0].task, '1');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// AC1/AC2/AC3 from #1594's own spec — the real drift shape recovered from
// docs/superpowers/plans/2026-08-26-sweep-residue-needs-decision-marker.md
// (deleted at commit a9d11d408; recovered from commit 3abba9020) before its
// own regex-matching fix: a Step 2 heading worded "confirm FAIL" whose
// command sits in a fenced ```bash code block with no `Run:` label.
test('#1594: a fixture plan reproducing the real fenced-code-block Step 2 drift produces a checkC warning, not a silent no-op, and still exits 0', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: Add the needs:decision label',
      '**Files:**',
      '- Modify: `plan.md`',
      '',
      '- [ ] **Step 2: Run it to confirm FAIL**',
      '',
      '```bash',
      'node --test tests/work-record-needs-decision-conformance.test.js',
      '```',
      '',
      'Expected: FAIL on the first four tests (the go-red control test passes immediately).',
      '',
      '- [ ] **Step 3: Add the row**',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkC.ok, true);
    assert.deepStrictEqual(report.checkC.findings, []);
    assert.strictEqual(report.checkC.warnings.length, 1);
    assert.strictEqual(report.checkC.warnings[0].task, '1');
    assert.match(report.checkC.warnings[0].raw, /Step 2: Run it to confirm FAIL/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a task declaring Expected: FAIL whose command genuinely fails pre-dispatch is not a Check C finding', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: Later task in a dependent chain',
      '**Files:**',
      '- Modify: `plan.md`',
      '',
      '- [ ] **Step 2: Run test to verify it fails**',
      '',
      'Run: `node -e "process.exit(1)"`',
      'Expected: FAIL with "not defined"',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkC.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// AC1/AC2/AC4 — the production incident reproduced end-to-end through the CLI (#2593).
// `makeTmpRepo()` is a bare temp directory, not a git repository (no other
// test in this file runs `git init`) — proving "never executed" via a real
// `git stash list` before/after comparison would need its own git-repo setup
// this fixture doesn't otherwise need. The unit-level guarantee (a `run`
// fake that throws if called) is pinned directly by checks.test.js; this
// CLI-level test confirms the same refusal end-to-end through the real
// (non-faked) `run` default and the human-readable summary line.
test('#2593: a fixture plan whose Step 2 prose only mentions a forbidden git stash command is refused, never executed, and the CLI still exits 0', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, [
      '### Task 1: Remove the plan file',
      '**Files:**',
      '- Modify: `plan.md`',
      '',
      '- [ ] **Step 2: Run it to confirm FAIL**',
      '',
      'Run: never run `git stash push -u -m tag` here; use a WIP commit instead',
      'Expected: FAIL',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const [jsonLine, summaryLine] = stdout.split('\n');
    const report = JSON.parse(jsonLine);
    assert.strictEqual(report.checkC.ok, true);
    assert.deepStrictEqual(report.checkC.findings, []);
    assert.deepStrictEqual(report.checkC.executed, []);
    assert.strictEqual(report.checkC.warnings.length, 1);
    assert.strictEqual(report.checkC.warnings[0].reason, 'vcs-mutation-refusal');
    assert.strictEqual(report.checkC.warnings[0].verb, 'git stash');
    assert.match(summaryLine, /VCS-mutation refusal/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// #1997 — a compose call site the plan touches that could not be measured
// (here: a malformed `when:` marker on one of its two sources) is reported
// as `headroom.composedErrors` and surfaced in the human summary line as
// "Composed: N unmeasured" — informational-but-visible, never a failing
// exit code on its own (the plan touches a *different*, healthy source of
// the same call site here, so nothing else fails either).
test('AC7: a fixture plan touching a compose call site with a malformed sibling source reports composedErrors and "Composed: 1 unmeasured", still exits 0', () => {
  const repo = makeTmpRepo();
  const skillDir = path.join(repo, 'plugin', 'skills', 'x');
  const sharedDir = path.join(repo, 'plugin', 'skills', '_shared');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: x',
    'description: fixture',
    '---',
    '',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step demo "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/b.md"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(sharedDir, 'a.md'), 'Source A body.\n');
  fs.writeFileSync(path.join(sharedDir, 'b.md'), '<!-- when: mode=auto -->\nSource B body, unclosed marker.\n');
  try {
    const plan = writePlan(repo, [
      '### Task 1: Add prose',
      '**Files:**',
      '- Modify: `plugin/skills/_shared/a.md`',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const [jsonLine, summaryLine] = stdout.split('\n');
    const report = JSON.parse(jsonLine);
    assert.strictEqual(report.headroom.ok, true);
    assert.deepStrictEqual(report.headroom.composed, []);
    assert.strictEqual(report.headroom.composedErrors.length, 1);
    assert.strictEqual(report.headroom.composedErrors[0].step, 'demo');
    assert.match(summaryLine, /Composed: 1 unmeasured/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// #3310 — a composed bundle in the near band (>= 90% of RAIL_BYTES, not over)
// is a soft composedNearCeiling flag, named "near rail" in the summary.
test('AC7.1 (#3310): a fixture plan touching a compose call site whose bundle is near the rail reports "Composed: 1 near rail", still exits 0', () => {
  const repo = makeTmpRepo();
  const skillDir = path.join(repo, 'plugin', 'skills', 'x');
  const sharedDir = path.join(repo, 'plugin', 'skills', '_shared');
  fs.mkdirSync(skillDir, { recursive: true });
  fs.mkdirSync(sharedDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, 'SKILL.md'), [
    '---',
    'name: x',
    'description: fixture',
    '---',
    '',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step demo "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/b.md"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(sharedDir, 'a.md'), 'Source A body.\n');
  fs.writeFileSync(path.join(sharedDir, 'b.md'), `${'x'.repeat(RAIL_BYTES - 2000)}\n`);
  try {
    const plan = writePlan(repo, [
      '### Task 1: Add prose',
      '**Files:**',
      '- Modify: `plugin/skills/_shared/a.md`',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const [jsonLine, summaryLine] = stdout.split('\n');
    const report = JSON.parse(jsonLine);
    assert.strictEqual(report.headroom.ok, true);
    assert.strictEqual(report.headroom.composedNearCeiling.length, 1);
    assert.strictEqual(report.headroom.composedNearCeiling[0].ceiling, RAIL_BYTES);
    assert.match(summaryLine, /Composed: 1 near rail/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// #1999 — an append-shaped task (Step 1 appends to an existing, passing
// test file named by both a Modify: bullet and Step 2's Run: command)
test('AC8 (#1999): an append-shaped task reports appendShaped and the summary line names the count, still exits 0', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'existing.test.js'), '// existing, passes today\n');
  try {
    const plan = writePlan(repo, [
      '### Task 1: Append tests',
      '**Files:**',
      '- Modify: `tests/existing.test.js`',
      '',
      '- [ ] **Step 1: Append the new cases**',
      '',
      'Append cases to `tests/existing.test.js`.',
      '',
      '- [ ] **Step 2: Run test to verify it fails**',
      '',
      'Run: `node --test tests/existing.test.js`',
      'Expected: FAIL — new cases not yet true',
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const [jsonLine, summaryLine] = stdout.split('\n');
    const report = JSON.parse(jsonLine);
    assert.strictEqual(report.checkC.ok, true);
    assert.strictEqual(report.checkC.appendShaped.length, 1);
    assert.match(summaryLine, /append-shaped/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// #2000 — Check D wired into the full envelope and the --bytes verb
test('#2000: a fixture plan with a raw NUL fails checkD and exits 1 under both the full audit and --bytes', () => {
  const repo = makeTmpRepo();
  try {
    const plan = path.join(repo, 'plan.md');
    fs.writeFileSync(plan, Buffer.from(`### Task 1: X\n**Files:**\n- Modify: \`plan.md\`\n\nsecond${'\0'}line\n`));
    const full = runCli(plan, repo);
    assert.notStrictEqual(full.exitCode, 0);
    const fullReport = JSON.parse(full.stdout.split('\n')[0]);
    assert.strictEqual(fullReport.checkD.ok, false);
    assert.strictEqual(fullReport.checkD.findings[0].line, 5);

    let bytesResult;
    try {
      execFileSync('node', [CLI, plan, '--bytes'], { encoding: 'utf8' });
      assert.fail('expected --bytes to exit non-zero');
    } catch (err) {
      bytesResult = err;
    }
    assert.strictEqual(bytesResult.status, 1);
    const bytesReport = JSON.parse((bytesResult.stdout || '').split('\n')[0]);
    assert.strictEqual(bytesReport.checkD.ok, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#2000: a clean plan reports checkD.ok === true under the full audit and --bytes', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugin', 'bin', 'existing.js'), '// existing\n');
  try {
    const plan = writePlan(repo, ['### Task 1: Do a thing', '**Files:**', '- Modify: `plugin/bin/existing.js`'].join('\n'));
    const { stdout } = runCli(plan, repo);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkD.ok, true);
    const bytesOut = execFileSync('node', [CLI, plan, '--bytes'], { encoding: 'utf8' });
    assert.deepStrictEqual(JSON.parse(bytesOut.trim()), { checkD: { ok: true, findings: [] } });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('usage error on a missing plan-file argument exits 2', () => {
  try {
    execFileSync('node', [CLI], { encoding: 'utf8' });
    assert.fail('expected a non-zero exit');
  } catch (err) {
    assert.strictEqual(err.status, 2);
    assert.match(err.stderr, /usage: plan-audit\.js/);
  }
});

function runCount(planFile) {
  try {
    const stdout = execFileSync('node', [CLI, planFile, '--count-tasks'], { encoding: 'utf8' });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('--count-tasks prints {"tasks": 1, "batched": false} for a one-task plan, 3 for three, batched:true for a batched plan; exit 0 (#1926 AC2)', () => {
  const repo = makeTmpRepo();
  try {
    const one = writePlan(repo, '### Task 1: Only\n**Files:**\n- Modify: `a.js`\n');
    assert.deepStrictEqual(runCount(one), { exitCode: 0, stdout: '{"tasks": 1, "batched": false}\n', stderr: '' });
    const three = writePlan(repo, '### Task 1: A\n\n### Task 2: B\n\n### Task 3: C\n');
    assert.deepStrictEqual(runCount(three), { exitCode: 0, stdout: '{"tasks": 3, "batched": false}\n', stderr: '' });
    const batched = writePlan(repo, '# P\n\n**Execution:** batched\n\n### Task 1: A\n\n### Task 2: B\n');
    assert.deepStrictEqual(runCount(batched), { exitCode: 0, stdout: '{"tasks": 2, "batched": true}\n', stderr: '' });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--count-tasks exits 2 for a missing plan and for a readable plan with zero tasks (#1926 Gotchas)', () => {
  const repo = makeTmpRepo();
  try {
    const missing = runCount(path.join(repo, 'nope.md'));
    assert.strictEqual(missing.exitCode, 2);
    assert.match(missing.stderr, /cannot read plan file/);
    const empty = writePlan(repo, '# A plan with no tasks\n');
    const r = runCount(empty);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /no parseable tasks/);
    assert.strictEqual(r.stdout, '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('--count-tasks never runs Checks A/B/C — a plan naming a missing path still counts and exits 0 (#1926)', () => {
  const repo = makeTmpRepo();
  try {
    const plan = writePlan(repo, '### Task 1: X\n**Files:**\n- Modify: `does/not/exist.js`\n');
    assert.deepStrictEqual(runCount(plan), { exitCode: 0, stdout: '{"tasks": 1, "batched": false}\n', stderr: '' });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── #3099 — --spec and Check E in the envelope ──────────────────────────────
const CLI_E_SPEC = [
  '## Acceptance Criteria',
  '',
  '1. The report renders.',
  '2. Each recipient gets one row. A recipient with several instances counts once; the total equals the recipient count.',
  '',
].join('\n');

function cliEPlan(extraLines = []) {
  return [
    ...extraLines,
    '### Task 1: Do a thing',
    '**Files:**',
    '- Modify: `plugin/bin/existing.js`',
    '',
    '- [ ] **Step 1: Write the failing test**',
    '',
    "test('AC1.1 AC2.1 AC2.2: rows render', () => {});",
  ].join('\n');
}

function makeERepo() {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'plugin', 'bin', 'existing.js'), '// existing\n');
  return repo;
}

function runCliArgs(args) {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { exitCode: 0, stdout, stderr: '' };
  } catch (err) {
    return { exitCode: err.status, stdout: err.stdout || '', stderr: err.stderr || '' };
  }
}

test('AC1.1 + AC5.2 (#3099): --spec reports the dropped clause AC2.3 with its text, and the audit still exits 0', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_E_SPEC);
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkE.ok, true);
    assert.deepStrictEqual(report.checkE.uncovered, [{ id: 'AC2.3', clause: 'the total equals the recipient count.' }]);
    assert.strictEqual(stdout.split('\n')[1], 'plan-audit: Check E: 1 uncovered AC clause(s).');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC2.1 (#3099): with a Waived AC2.3 line the CLI reports AC2.3 under waived, not uncovered', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan(['Waived AC2.3: counted by the existing totals test', '']));
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_E_SPEC);
    const report = JSON.parse(runCliArgs([plan, '--repo-root', repo, '--spec', spec]).stdout.split('\n')[0]);
    assert.deepStrictEqual(report.checkE.waived, [{ id: 'AC2.3', reason: 'counted by the existing totals test' }]);
    assert.deepStrictEqual(report.checkE.uncovered, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC3.1 (#3099): a spec with no ## Acceptance Criteria section yields a non-empty checkE.unparsed and names it in the summary', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, '# 1: X\n\n## Deliverables\n\n- Do it.\n');
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkE.unparsed.length, 1);
    assert.deepStrictEqual(report.checkE.uncovered, []);
    assert.match(stdout.split('\n')[1], /Check E: 1 unparsed AC item\(s\)/);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC4.1 (#3099) + AC3.1 (#3602): without --spec the envelope carries checkE and checkF {ok: true, skipped: no-spec}; every other key, the summary, and the exit code match a --spec run', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, '## Acceptance Criteria\n\n1. The report renders.\n');
    const without = runCliArgs([plan, '--repo-root', repo]);
    const withSpec = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    const a = JSON.parse(without.stdout.split('\n')[0]);
    const b = JSON.parse(withSpec.stdout.split('\n')[0]);
    assert.deepStrictEqual(a.checkE, { ok: true, skipped: 'no-spec' });
    assert.deepStrictEqual(a.checkF, { ok: true, skipped: 'no-spec' });
    assert.deepStrictEqual(b.checkE.uncovered, []);
    const { checkE: dropA, checkF: dropFA, ...restA } = a;
    const { checkE: dropB, checkF: dropFB, ...restB } = b;
    assert.deepStrictEqual(restA, restB);
    assert.deepStrictEqual(Object.keys(restA), ['checkA', 'checkB', 'checkC', 'checkD', 'headroom', 'premiseRefs']);
    assert.strictEqual(without.exitCode, 0);
    assert.strictEqual(withSpec.exitCode, 0);
    assert.strictEqual(without.stdout.split('\n')[1], 'plan-audit: clean — no findings.');
    assert.strictEqual(withSpec.stdout.split('\n')[1], 'plan-audit: clean — no findings.');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC5.1 (#3099): uncovered clauses never fail the audit — a failing Check A still decides the exit code alone', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan().replace('plugin/bin/existing.js', 'does/not/exist.js'));
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_E_SPEC);
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkE.ok, true);
    assert.strictEqual(report.checkA.ok, false);
    assert.strictEqual(exitCode, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3099: an unreadable --spec exits 2 naming the file, never a silent skipped envelope', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const r = runCliArgs([plan, '--repo-root', repo, '--spec', path.join(repo, 'nope.md')]);
    assert.strictEqual(r.exitCode, 2);
    assert.match(r.stderr, /cannot read spec file/);
    assert.strictEqual(r.stdout, '');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3099: --spec with no value, or beside --bytes or --count-tasks, is a usage error (exit 2)', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_E_SPEC);
    for (const args of [[plan, '--spec'], [plan, '--spec', spec, '--bytes'], [plan, '--count-tasks', '--spec', spec]]) {
      const r = runCliArgs(args);
      assert.strictEqual(r.exitCode, 2, `expected exit 2 for ${args.slice(1).join(' ')}`);
      assert.match(r.stderr, /usage: plan-audit\.js .*--spec <spec-file>/);
    }
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

const CLI_F_SPEC = ['## Acceptance Criteria', '', '1. The report renders.', '', '## Technical Approach', '',
  'Read `src/a.js` and `src/b.js` back; change them only if they break.', ''].join('\n');

test('AC1.1 (#3602): --spec reports both unlisted Technical Approach paths in checkF and the summary line; exit stays 0', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan());
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_F_SPEC);
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkF.ok, true);
    assert.deepStrictEqual(report.checkF.unlisted, [
      { path: 'src/a.js', section: 'Technical Approach' },
      { path: 'src/b.js', section: 'Technical Approach' },
    ]);
    assert.strictEqual(stdout.split('\n')[1], 'plan-audit: Check F: 2 unlisted spec path(s).');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('AC3.1 (#3602): unlisted spec paths never decide the exit code — a failing Check A alone does', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan().replace('plugin/bin/existing.js', 'does/not/exist.js'));
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, CLI_F_SPEC);
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.checkF.ok, true);
    assert.strictEqual(report.checkF.unlisted.length, 2);
    assert.strictEqual(report.checkA.ok, false);
    assert.strictEqual(exitCode, 1);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('#3602: an unparsed Technical Approach line and an orphan path waiver each get their own summary part', () => {
  const repo = makeERepo();
  try {
    const plan = writePlan(repo, cliEPlan(['Waived src/typo.js: stale', '']));
    const spec = path.join(repo, 'spec.md');
    fs.writeFileSync(spec, '## Acceptance Criteria\n\n1. The report renders.\n\n## Technical Approach\n\nRead `src/a.js and stop.\n');
    const { exitCode, stdout } = runCliArgs([plan, '--repo-root', repo, '--spec', spec]);
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(stdout.split('\n')[1], 'plan-audit: Check F: 1 unparsed spec block(s); Check F: 1 orphan path waiver(s).');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── #3099 Task 7 — Check B excludes the audited plan file itself ───────────
test('#3099: Check B never reports the audited plan file itself as unplanned, but a real unplanned file still is', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'a.js'), '// zebrakeyword\n');
  try {
    const plan = writePlan(repo, [
      'Scope keywords: zebrakeyword',
      '### Task 1: Do a thing',
      '**Files:**',
      '- Modify: `a.js`',
    ].join('\n'));
    const first = runCli(plan, repo);
    const reportFirst = JSON.parse(first.stdout.split('\n')[0]);
    assert.deepStrictEqual(reportFirst.checkB.unplanned, []);
    assert.strictEqual(first.exitCode, 0);

    fs.writeFileSync(path.join(repo, 'stray.js'), '// zebrakeyword\n');
    const second = runCli(plan, repo);
    const reportSecond = JSON.parse(second.stdout.split('\n')[0]);
    assert.deepStrictEqual(reportSecond.checkB.unplanned, ['stray.js']);
    assert.notStrictEqual(second.exitCode, 0);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
