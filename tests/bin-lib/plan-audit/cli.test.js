'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'plan-audit.js');
const { CEILING_BYTES } = require(path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'skill-audit', 'context-cost'));

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
  fs.writeFileSync(abs, 'x'.repeat(CEILING_BYTES - 500));
  try {
    const plan = writePlan(repo, [
      '### Task 1: Add prose',
      '**Files:**',
      `- Modify: \`${rel}\``,
    ].join('\n'));
    const { exitCode, stdout } = runCli(plan, repo);
    assert.strictEqual(exitCode, 0);
    const report = JSON.parse(stdout.split('\n')[0]);
    assert.strictEqual(report.headroom.ok, true);
    assert.strictEqual(report.headroom.nearCeiling.length, 1);
    assert.strictEqual(report.headroom.nearCeiling[0].file, rel);
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
  fs.writeFileSync(abs, 'x'.repeat(CEILING_BYTES + 1));
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
