'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  checkA, checkB, checkC, checkD, headroomCheck, looksPassing, isGovernedMdPath,
} = require('../../../plugin/bin/lib/plan-audit/checks');
const { CEILING_BYTES, composedBytesReport } = require('../../../plugin/bin/lib/skill-audit/context-cost');

function makeTmpRepo() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'plan-audit-checks-'));
}

// ── Check A ──────────────────────────────────────────────────────────────

test('checkA fails when a Modify path does not exist', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Modify', path: 'nope.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['nope.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA passes for Create when the parent directory exists, even though the file itself does not', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'plugin', 'bin'), { recursive: true });
  try {
    const result = checkA([{ type: 'Create', path: 'plugin/bin/new.js' }], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA fails for Create when even the parent directory is missing', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Create', path: 'nowhere/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['nowhere/new.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA passes for an existing Delete path', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'gone.js'), '');
  try {
    const result = checkA([{ type: 'Delete', path: 'gone.js' }], repo);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA treats Test like Create — parent dir suffices for a brand-new test file', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  try {
    const result = checkA([{ type: 'Test', path: 'tests/new.test.js' }], repo);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// #1999: Check A gains plan-awareness — a Create:/Test: bullet's missing
// parent is satisfied by ANOTHER entry in the same plan (never by itself
// alone — see this plan's own Deviation note on AC1's "first creation"
// parenthetical, which would otherwise make every lone Create trivially
// pass and contradict the pinned "even the parent directory is missing"
// case above).
test('checkA passes a Create bullet whose missing parent is created by ANOTHER Create bullet in the same plan (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Create', path: 'newdir/nested/subdir/FILE.md' },
      { type: 'Create', path: 'newdir/nested/subdir/OTHER.md' },
    ], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.missing, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA still fails a lone, unsupported Create bullet with a missing parent (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Create', path: 'nowhere/new.js' }], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['nowhere/new.js']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA passes a two-new-level Create bullet supported by another bullet at the same deepest directory (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Create', path: 'newdir/nested/subdir/FILE.md' },
      { type: 'Test', path: 'newdir/nested/subdir/FILE.test.md' },
    ], repo);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA: a Modify under a plan-created directory still fails — Modify needs the file today (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([
      { type: 'Create', path: 'newdir/nested/subdir/A.md' },
      { type: 'Create', path: 'newdir/nested/subdir/OTHER.md' },
      { type: 'Modify', path: 'newdir/nested/subdir/FILE.md' },
    ], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing, ['newdir/nested/subdir/FILE.md']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkA missingDetail names the nearest existing ancestor for a still-missing parent (#1999)', () => {
  const repo = makeTmpRepo();
  try {
    const result = checkA([{ type: 'Create', path: 'nowhere/new.js' }], repo);
    assert.strictEqual(result.missingDetail.length, 1);
    assert.strictEqual(result.missingDetail[0].path, 'nowhere/new.js');
    assert.strictEqual(result.missingDetail[0].nearestExistingAncestor, '.');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Check B ──────────────────────────────────────────────────────────────

test('checkB is a no-op (ok, empty) when the plan declares no Scope keywords', () => {
  const repo = makeTmpRepo();
  try {
    assert.deepStrictEqual(checkB([], [], repo), { ok: true, unplanned: [] });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkB flags a matched file absent from the plan', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'unplanned.txt'), 'mentions PLAYWRIGHT_MCP here');
  try {
    const result = checkB(['PLAYWRIGHT_MCP'], [], repo);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.unplanned, ['unplanned.txt']);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkB does not flag a matched file that IS in the plan', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'planned.txt'), 'mentions PLAYWRIGHT_MCP here');
  try {
    const result = checkB(['PLAYWRIGHT_MCP'], ['planned.txt'], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.unplanned, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkB is case-insensitive', () => {
  const repo = makeTmpRepo();
  fs.writeFileSync(path.join(repo, 'x.txt'), 'lowercase playwright_mcp appears here');
  try {
    const result = checkB(['PLAYWRIGHT_MCP'], [], repo);
    assert.strictEqual(result.ok, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkB never descends into node_modules or .git (control match)', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'node_modules'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'node_modules', 'x.txt'), 'PLAYWRIGHT_MCP');
  fs.mkdirSync(path.join(repo, '.git'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.git', 'x.txt'), 'PLAYWRIGHT_MCP');
  try {
    const result = checkB(['PLAYWRIGHT_MCP'], [], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.unplanned, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Check C ──────────────────────────────────────────────────────────────

test('looksPassing: exit code 0 is always a passing signature', () => {
  assert.strictEqual(looksPassing(0, ''), true);
});

test('looksPassing: non-zero exit with failure markers is not a passing signature', () => {
  assert.strictEqual(looksPassing(1, 'FAIL: 1 test failed'), false);
});

test('looksPassing: non-zero exit is not a passing signature even with a stray "PASS" substring alongside a failure marker', () => {
  assert.strictEqual(looksPassing(1, 'PASS suite-a\nFAIL suite-b'), false);
});

test('checkC flags a task whose command already exits 0 despite declaring Expected: FAIL', () => {
  const calls = [];
  const deps = { run: (command, cwd) => { calls.push({ command, cwd }); return { exitCode: 0, output: '# tests 3\n# pass 3\n' }; } };
  const result = checkC(
    [{ taskNumber: '1', title: 'A', command: 'node --test a.test.js', expected: 'FAIL with "not defined"' }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].task, '1');
  assert.deepStrictEqual(calls, [{ command: 'node --test a.test.js', cwd: '/repo' }]);
});

test('checkC does not flag a command that errors or cleanly fails pre-dispatch', () => {
  const deps = { run: () => ({ exitCode: 1, output: 'Error: Cannot find module\n' }) };
  const result = checkC(
    [{ taskNumber: '5', title: 'Later task', command: 'node --test e.test.js', expected: 'FAIL with "not defined"' }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
});

test('checkC with no verification checks passes trivially', () => {
  const result = checkC([], '/repo', { run: () => { throw new Error('must not be called'); } });
  assert.strictEqual(result.ok, true);
});

test('checkC returns an empty warnings array when no unparseable Step 2s are passed', () => {
  const result = checkC([], '/repo', { run: () => { throw new Error('must not be called'); } });
  assert.deepStrictEqual(result.warnings, []);
});

test('checkC surfaces unparseable Step 2s as warnings without affecting ok or findings', () => {
  const unparseableStep2s = [
    { taskNumber: '3', title: 'Add the row', raw: '- [ ] **Step 2: Run it to confirm FAIL**\n\n```bash\nnode --test x.test.js\n```' },
  ];
  const result = checkC([], '/repo', {}, unparseableStep2s);
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].task, '3');
  assert.strictEqual(result.warnings[0].title, 'Add the row');
  assert.match(result.warnings[0].raw, /Step 2: Run it to confirm FAIL/);
});

test('checkC: a real finding and an unparseable warning coexist independently', () => {
  const deps = { run: () => ({ exitCode: 0, output: 'PASS\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'A', command: 'node -e "process.exit(0)"', expected: 'FAIL' }],
    '/repo', deps,
    [{ taskNumber: '2', title: 'B', raw: 'raw text' }],
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.warnings.length, 1);
  assert.strictEqual(result.warnings[0].task, '2');
});

// #1999: Check C's append-to-existing exception.
test('checkC: append-shaped task with a passing pre-run is not a finding — reported under appendShaped (#1999)', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'existing.test.js'), '// existing, passes today\n');
  const deps = { run: () => ({ exitCode: 0, output: '# pass 3\n' }) };
  const check = {
    taskNumber: '1', title: 'Append tests', command: 'node --test tests/existing.test.js', expected: 'FAIL',
    step1Text: 'Append cases to `tests/existing.test.js`.',
    taskFileEntries: [{ type: 'Modify', path: 'tests/existing.test.js' }],
    appendMarker: false,
  };
  try {
    const result = checkC([check], repo, deps);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.findings, []);
    assert.strictEqual(result.appendShaped.length, 1);
    assert.strictEqual(result.appendShaped[0].task, '1');
    assert.strictEqual(result.appendShaped[0].path, 'tests/existing.test.js');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkC: same shape without a matching Modify/Test bullet is still a finding (#1999)', () => {
  const repo = makeTmpRepo();
  fs.mkdirSync(path.join(repo, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'tests', 'existing.test.js'), '// existing\n');
  const deps = { run: () => ({ exitCode: 0, output: '# pass 3\n' }) };
  const check = {
    taskNumber: '1', title: 'No Files bullet', command: 'node --test tests/existing.test.js', expected: 'FAIL',
    step1Text: 'Append cases to `tests/existing.test.js`.',
    taskFileEntries: [],
    appendMarker: false,
  };
  try {
    const result = checkC([check], repo, deps);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.findings.length, 1);
    assert.deepStrictEqual(result.appendShaped, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkC: the explicit "FAIL after Step 1" marker passes without the path heuristic (#1999)', () => {
  const repo = makeTmpRepo();
  const deps = { run: () => ({ exitCode: 0, output: '# pass\n' }) };
  const check = {
    taskNumber: '1', title: 'Marked', command: 'node --test whatever.test.js', expected: 'FAIL after Step 1',
    step1Text: null,
    taskFileEntries: [],
    appendMarker: true,
  };
  try {
    const result = checkC([check], repo, deps);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.appendShaped.length, 1);
    assert.strictEqual(result.appendShaped[0].path, null);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('checkC: the existing AC6 non-discriminating fixture still fails (no append shape, no marker) (#1999)', () => {
  const deps = { run: () => ({ exitCode: 0, output: 'PASS\n' }) };
  const result = checkC(
    [{ taskNumber: '1', title: 'A', command: 'node -e "process.exit(0)"', expected: 'FAIL with "guard not present"' }],
    '/repo', deps,
  );
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.deepStrictEqual(result.appendShaped, []);
});

// ── Headroom ─────────────────────────────────────────────────────────────

test('isGovernedMdPath matches plugin/skills/**/*.md only', () => {
  assert.strictEqual(isGovernedMdPath('plugin/skills/build/SKILL.md'), true);
  assert.strictEqual(isGovernedMdPath('plugin/skills/build/plan-audit.md'), true);
  assert.strictEqual(isGovernedMdPath('docs/plugin-structure.md'), false);
  assert.strictEqual(isGovernedMdPath('plugin/bin/lib/plan-audit/checks.js'), false);
});

function writeFileOfSize(filePath, bytes) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, 'x'.repeat(bytes));
}

test('headroomCheck flags a near-ceiling governed file with < 1,024 B headroom (soft flag, ok stays true) — see #553', () => {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/build/plan-audit.md';
  writeFileOfSize(path.join(repo, rel), CEILING_BYTES - 500);
  try {
    const result = headroomCheck([{ type: 'Modify', path: rel }], repo);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.breaches.length, 0);
    assert.strictEqual(result.nearCeiling.length, 1);
    assert.strictEqual(result.nearCeiling[0].file, rel);
    assert.strictEqual(result.nearCeiling[0].headroom, 500);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck reports a breach (ok: false) for a governed file already over the ceiling', () => {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/build/SKILL.md';
  writeFileOfSize(path.join(repo, rel), CEILING_BYTES + 200);
  try {
    const result = headroomCheck([{ type: 'Modify', path: rel }], repo);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.breaches.length, 1);
    assert.strictEqual(result.breaches[0].file, rel);
    assert.strictEqual(result.breaches[0].bytes, CEILING_BYTES + 200);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck ignores a non-governed .md file even when near the ceiling', () => {
  const repo = makeTmpRepo();
  const rel = 'docs/plugin-structure.md';
  writeFileOfSize(path.join(repo, rel), CEILING_BYTES + 200);
  try {
    const result = headroomCheck([{ type: 'Modify', path: rel }], repo);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.nearCeiling, []);
    assert.deepStrictEqual(result.breaches, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck ignores Create entries — nothing to measure yet', () => {
  const repo = makeTmpRepo();
  try {
    const result = headroomCheck([{ type: 'Create', path: 'plugin/skills/build/new.md' }], repo);
    assert.deepStrictEqual(result, {
      ok: true, nearCeiling: [], breaches: [], composed: [], composedNearCeiling: [], composedErrors: [],
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('a clean plan (no missing paths, no scope keywords, no FAIL findings, no headroom issues) passes every check', () => {
  const repo = makeTmpRepo();
  const rel = 'plugin/skills/build/plan-audit.md';
  writeFileOfSize(path.join(repo, rel), 1000);
  try {
    const a = checkA([{ type: 'Modify', path: rel }], repo);
    const b = checkB([], [], repo);
    const c = checkC([], repo);
    const h = headroomCheck([{ type: 'Modify', path: rel }], repo);
    assert.ok(a.ok && b.ok && c.ok && h.ok);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Headroom — composed rows (#1997, the multi-spec pre-flight [IL-140] lacked) ──

// A synthetic plugin root: one skill file (`plugin/skills/x/SKILL.md`) carrying
// a real compose call site for step "demo", and two marker-bearing sources
// under `plugin/skills/_shared/`. `bBytes` lets the over-ceiling fixture pad
// one source past CEILING_BYTES without duplicating the whole layout.
// `bMarkerBroken` swaps source b for an unclosed `when:` marker (a malformed
// source #1997's `composedErrors` path exists to surface, rather than
// silently drop) — mutually exclusive with `bBytes`.
function writeComposeFixture(repo, { bBytes = null, bMarkerBroken = false } = {}) {
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
    'Compose call:',
    '',
    'node "${CLAUDE_PLUGIN_ROOT}/bin/compose-context.js" --run "$PIPELINE_RUN_DIR" --step demo "${CLAUDE_PLUGIN_ROOT}/skills/_shared/a.md" "${CLAUDE_PLUGIN_ROOT}/skills/_shared/b.md"',
    '',
  ].join('\n'));
  fs.writeFileSync(path.join(sharedDir, 'a.md'), [
    '<!-- when: mode=auto -->',
    'Source A body.',
    '<!-- /when -->',
    '',
  ].join('\n'));
  let bContent;
  if (bMarkerBroken) {
    bContent = '<!-- when: mode=auto -->\nSource B body, unclosed marker.\n';
  } else {
    bContent = bBytes === null ? 'Source B body.\n' : `${'x'.repeat(bBytes)}\n`;
  }
  fs.writeFileSync(path.join(sharedDir, 'b.md'), bContent);
}

test('headroomCheck reports a composed row for a call site whose source the plan touches, with over: 0 when small', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo);
    const expectedRows = composedBytesReport(path.join(repo, 'plugin'));
    const demoRow = expectedRows.find((r) => r.step === 'demo');
    assert.ok(demoRow, 'fixture must produce a demo call site');
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }], repo);
    assert.strictEqual(result.composed.length, 1);
    assert.strictEqual(result.composed[0].step, 'demo');
    assert.strictEqual(result.composed[0].max, demoRow.max);
    assert.strictEqual(result.composed[0].ceiling, CEILING_BYTES);
    assert.strictEqual(result.composed[0].over, 0);
    assert.strictEqual(result.ok, true);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck reports no composed rows when the plan touches neither source of a call site', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo);
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/x/SKILL.md' }], repo);
    assert.deepStrictEqual(result.composed, []);
    assert.deepStrictEqual(result.composedNearCeiling, []);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck fires the same composed row for two specs regardless of which one touches which source (multi-spec pre-flight, IL-140)', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo);
    // Two separate spec plans — modeled as two independent headroomCheck calls,
    // each naming only its own single touched source.
    const specA = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }], repo);
    const specB = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/b.md' }], repo);
    assert.strictEqual(specA.composed.length, 1);
    assert.strictEqual(specB.composed.length, 1);
    assert.strictEqual(specA.composed[0].step, 'demo');
    assert.strictEqual(specB.composed[0].step, 'demo');
    assert.strictEqual(specA.composed[0].max, specB.composed[0].max);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck flags an over-ceiling composed row and flips ok to false', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo, { bBytes: CEILING_BYTES + 2000 });
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }], repo);
    assert.strictEqual(result.composed.length, 1);
    assert.strictEqual(result.composed[0].step, 'demo');
    assert.ok(result.composed[0].over > 0, `expected over > 0, got ${result.composed[0].over}`);
    assert.strictEqual(result.ok, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck reports composedErrors (not composed) for a call site whose touched source is malformed, ok stays true (#1997)', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo, { bMarkerBroken: true });
    // The plan touches source a — a healthy source — but the call site's
    // OTHER source (b) carries the unclosed `when:` marker. The intersection
    // test is against the call site's full source list (same rule as the
    // multi-spec IL-140 fixture above), so this call site is in scope even
    // though the malformed file itself isn't the touched one.
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }], repo);
    assert.deepStrictEqual(result.composed, [], 'a call site that could not be measured must not appear in composed');
    assert.strictEqual(result.composedErrors.length, 1);
    assert.strictEqual(result.composedErrors[0].step, 'demo');
    assert.ok(typeof result.composedErrors[0].error === 'string' && result.composedErrors[0].error.length > 0);
    assert.strictEqual(result.ok, true, 'composedErrors is informational-but-visible — it never flips ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck surfaces a composed-bytes report that throws as a composedErrors row, never as a clean result (#1997)', () => {
  const repo = makeTmpRepo();
  try {
    writeComposeFixture(repo);
    // A report that crashes (a bug, EACCES, anything that isn't the documented
    // no-corpus case) must not render as "nothing to report": that is the
    // silent-fallback shape IL-146 names. Injected via `deps.report` so the
    // failure is deterministic rather than platform-dependent.
    const result = headroomCheck(
      [{ type: 'Modify', path: 'plugin/skills/_shared/a.md' }],
      repo,
      { report: () => { throw new Error('boom'); } },
    );
    assert.deepStrictEqual(result.composed, []);
    assert.strictEqual(result.composedErrors.length, 1, 'the crash must be visible as an unmeasured row');
    assert.strictEqual(result.composedErrors[0].step, null);
    assert.match(result.composedErrors[0].error, /report failed: boom/);
    assert.strictEqual(result.ok, true, 'composedErrors is informational-but-visible — it never flips ok');
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

test('headroomCheck yields composed: [] and unchanged per-file results when the repo has no plugin/ dir', () => {
  const repo = makeTmpRepo();
  try {
    const result = headroomCheck([{ type: 'Modify', path: 'plugin/skills/build/plan-audit.md' }], repo);
    assert.deepStrictEqual(result, {
      ok: true, nearCeiling: [], breaches: [], composed: [], composedNearCeiling: [], composedErrors: [],
    });
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

// ── Check D — control-byte scan (#2000) ─────────────────────────────────

test('checkD flags a raw NUL mid-line with its line, column, and codePoint', () => {
  const text = 'line one\nsecond\0line\n';
  const result = checkD(text);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 1);
  assert.strictEqual(result.findings[0].line, 2);
  assert.strictEqual(result.findings[0].column, 7);
  assert.strictEqual(result.findings[0].codePoint, 'U+0000');
});

test('checkD flags a form feed and an escape byte as findings', () => {
  const text = 'a\x0Cb\x1Bc';
  const result = checkD(text);
  assert.strictEqual(result.ok, false);
  assert.deepStrictEqual(result.findings.map((f) => f.codePoint), ['U+000C', 'U+001B']);
});

test('checkD does not flag tab, LF, or CR', () => {
  const result = checkD('a\tb\nc\rd');
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
});

test('checkD does not flag multi-byte UTF-8 text or a literal backslash-zero escape', () => {
  const result = checkD('café 中文 test("\\0")');
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.findings, []);
});

test('checkD caps findings at 20 and sets truncated: true beyond that', () => {
  const text = '\0'.repeat(25);
  const result = checkD(text);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.findings.length, 20);
  assert.strictEqual(result.truncated, true);
});
