'use strict';
// #6060: /build reuses a plan reviewed at specify. Pins build/plan-reuse.md, runs its probe fence, and round-trips plan-store.js write → materialize → check.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf } = require('./helpers/conformance-asserts');
const { originWithTwoClones, cleanGitEnv } = require('./helpers/git-fixtures');
const { runCliSync } = require('./helpers/run-cli');
const { composePlanLine, specHash } = require('../plugin/bin/lib/issues/plan-line');
const { composeFile, composeHeader } = require('../plugin/bin/lib/issues/materialize-format');
const { CHECK_ORDER } = require('../plugin/bin/lib/plan-store/check');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'plugin', 'skills', 'build', 'plan-reuse.md');
const PLAN_STORE = path.join(ROOT, 'plugin', 'bin', 'plan-store.js');
const PLUGIN_ROOT = path.join(ROOT, 'plugin').split(path.sep).join('/');
const text = readText(FILE);

// The first ```bash fence after the `## Probe` heading.
function probeFenceOf(doc) {
  const m = /\n## Probe\n[\s\S]*?\n```bash\n([\s\S]*?)\n```/.exec(`\n${doc}`);
  if (!m) throw new Error('probe fence extraction is out of sync');
  return m[1];
}

const COMMIT = 'a'.repeat(40);
const LINE = composePlanLine({ record: 7, commit: COMMIT, specHash: 'b'.repeat(64) });
const SPEC = ['## Overview', 'The overview says one thing.', '', '## Non-Goals', 'Nothing else.', ''].join('\n');
const metaBody = (meta, rest) => ['Surface: infra', ...meta, '', rest].join('\n');
const fileWith = (body) => composeFile({ header: composeHeader({ record: 7, origin: 'human', ceremony: 'standard', grants: {} }), n: 7, title: 'T', body });

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-plan-reuse-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

// Run the extracted fence under a shell with {spec} and {line-file} substituted by temp paths.
function runProbe(fence, specPath, lineFile, shell = ['bash', '--noprofile', '--norc']) {
  const script = fence.split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN_ROOT).split('{spec}').join(specPath).split('{line-file}').join(lineFile);
  return spawnSync(shell[0], [...shell.slice(1), '-c', script], { encoding: 'utf8', env: { ...process.env, PLUGIN_ROOT } });
}

function probeOf(t, content, { specDir = '', shell } = {}) {
  const dir = scratch(t);
  const specParent = path.join(dir, specDir);
  fs.mkdirSync(specParent, { recursive: true });
  const spec = path.join(specParent, '6060-spec.md');
  const lineFile = path.join(dir, 'line.txt');
  fs.writeFileSync(spec, content);
  const r = runProbe(probeFenceOf(text), spec, lineFile, shell);
  return { r, lineFile, out: r.stdout.trim() };
}

const withLine = fileWith(metaBody([LINE], SPEC));

test('AC1.1: the probe reports absent for a spec with no Plan: line, or one only below the first ## heading', (t) => {
  const assertAbsent = (content) => {
    const p = probeOf(t, content);
    assert.strictEqual(p.r.status, 0, p.r.stderr);
    assert.strictEqual(p.out, '{"plan":"absent"}');
    assert.ok(!fs.existsSync(p.lineFile), 'line file must not be created');
  };
  assertAbsent(fileWith(metaBody([], SPEC)));
  assertAbsent(fileWith(metaBody([], `## Current State\n${LINE}\n\n${SPEC}`)));
});

test('AC2.1: the probe writes the Plan: line to the line file and prints its record and commit', (t) => {
  const expected = JSON.stringify({ plan: 'present', ok: true, record: 7, commit: COMMIT });
  const plain = probeOf(t, withLine);
  assert.strictEqual(plain.r.status, 0, plain.r.stderr);
  assert.strictEqual(plain.out, expected);
  assert.strictEqual(fs.readFileSync(plain.lineFile, 'utf8'), `${LINE}\n`);
  assert.strictEqual(probeOf(t, withLine.replace(/\n/g, '\r\n')).out, expected, 'CRLF spec');
  assert.strictEqual(probeOf(t, withLine, { specDir: "o'brien spec" }).out, expected, 'hostile spec path');
});

test('AC3.1: a Plan: line that does not parse is reported present but not ok', (t) => {
  const garbage = probeOf(t, fileWith(metaBody(['Plan:garbage'], SPEC)));
  assert.strictEqual(garbage.out, '{"plan":"present","ok":false,"reason":"shape"}');
  const badCommit = probeOf(t, fileWith(metaBody([`Plan: refs/claude-tweaks/plans/7 nothex spec-sha256:${'b'.repeat(64)}`], SPEC)));
  assert.strictEqual(badCommit.out, '{"plan":"present","ok":false,"reason":"bad-commit"}');
});

test('the probe fence runs the same under zsh -f', (t) => {
  if (spawnSync('zsh', ['--version']).error) return t.skip('zsh not on PATH');
  const p = probeOf(t, withLine, { shell: ['zsh', '-f'] });
  assert.strictEqual(p.r.status, 0, p.r.stderr);
  assert.strictEqual(p.out, JSON.stringify({ plan: 'present', ok: true, record: 7, commit: COMMIT }));
});

test('go-red: dropping the heading bound makes a quoted Plan: line read as the record line', (t) => {
  const fence = probeFenceOf(text);
  const doctored = fence.replace('lines.slice(0,end===-1?lines.length:end)', 'lines');
  assert.notStrictEqual(doctored, fence);
  const dir = scratch(t);
  const spec = path.join(dir, 'spec.md');
  fs.writeFileSync(spec, fileWith(metaBody([], `## Current State\n${LINE}\n\n${SPEC}`)));
  const r = runProbe(doctored, spec, path.join(dir, 'line.txt'));
  assert.match(r.stdout, /"plan":"present"/);
});

test('AC2.1/AC3.1: a stored plan checks valid against the materialized spec, and an edited spec fails hash', (t) => {
  const fx = originWithTwoClones('ct-plan-reuse-');
  t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));
  const env = cleanGitEnv(fx.env);
  const BASENAME = '2026-11-22-plan-reuse-7.md';
  const PLAN = ['# Plan', '', '### Task 1: x', '', '**Files:**', '- Modify: `base`', '', 'Body.', ''].join('\n');
  const specBody = ['Surface: infra', '', SPEC].join('\n');
  fs.mkdirSync(path.join(fx.work, 'p'), { recursive: true });
  fs.mkdirSync(path.join(fx.work, 'work'), { recursive: true });
  fs.writeFileSync(path.join(fx.work, 'p', BASENAME), PLAN);
  fs.writeFileSync(path.join(fx.work, 'spec.md'), specBody);
  const w = runCliSync(PLAN_STORE, ['write', '--record', '7', '--plan-file', `p/${BASENAME}`, '--base', 'HEAD', '--spec-file', 'spec.md'], { cwd: fx.work, env });
  assert.strictEqual(w.code, 0, w.stderr);
  const { commit } = JSON.parse(w.stdout);
  assert.strictEqual(specHash(specBody), specHash(fileWith(specBody)), 'materialize does not change the hash');
  const line = composePlanLine({ record: 7, commit, specHash: specHash(specBody) });
  const materialized = fileWith(['Surface: infra', line, '', SPEC].join('\n'));
  assert.ok(materialized.includes(`\n${line}\n`), 'composeFile keeps the Plan: line');
  const specPath = path.join(fx.work, 'work', '7-spec.md');
  fs.writeFileSync(specPath, materialized);

  const lineFile = path.join(fx.work, 'line.txt');
  const probe = runProbe(probeFenceOf(text), specPath, lineFile);
  assert.strictEqual(probe.stdout.trim(), JSON.stringify({ plan: 'present', ok: true, record: 7, commit }), probe.stderr);
  const check = () => runCliSync(PLAN_STORE, ['check', '--line-file', lineFile, '--spec-file', specPath, '--base', 'HEAD'], { cwd: fx.work, env });
  const ok = check();
  assert.strictEqual(ok.code, 0, ok.stderr);
  assert.strictEqual(ok.stdout.trim(), '{"valid":true,"failed":null}');

  // Check 3: read prints {"path": …}, and that path holds the stored plan under its own basename.
  const rd = runCliSync(PLAN_STORE, ['read', '--record', '7', '--commit', commit, '--out', path.join(fx.work, 'read')], { cwd: fx.work, env });
  assert.strictEqual(rd.code, 0, rd.stderr);
  const readPath = JSON.parse(rd.stdout).path;
  assert.strictEqual(path.basename(readPath), BASENAME);
  assert.strictEqual(fs.readFileSync(readPath, 'utf8'), PLAN);

  fs.writeFileSync(specPath, materialized.replace('The overview says one thing.', 'The overview now says another.'));
  const bad = check();
  assert.strictEqual(bad.code, 1);
  assert.strictEqual(bad.stdout.trim(), '{"valid":false,"failed":"hash"}');
});

const FACTS = [
  [/--values plan-at-specify/, 'gate names the policy read'],
  [/prints `on`/, 'gate fires only on on'],
  [/plan-store\.js" check --line-file "\{line-file\}" --spec-file "\{spec\}" --base \{base\}/, 'check invocation'],
  [/git merge-base HEAD origin\/\{integration-branch\}/, 'base resolution'],
  [/plan-store\.js" read --record \{n\} --commit \{commit\} --out/, 'read invocation'],
  [/plan-audit\.js" "\{read-path\}" --spec "\{spec\}" --repo-root/, 'audit invocation'],
  [/Add the plan reviewed at specify \(\{commit\}\)/, 'commit subject'],
  [/--step "Spec Step 3" --text "condition: plan reviewed at specify \(\{commit\}\)/, 'Spec Step 3 SKIP'],
  [/--step "Common Step 1\.6 \(plan review\)" --text "condition: plan reviewed at specify \(\{commit\}\)/, 'Common Step 1.6 SKIP'],
  [/--status AUTO[^\n]*--step "Spec Step 2 \(plan reuse\)"/, 'reuse AUTO line'],
  [/condition: plan-reuse failed: \{reason\}/, 'failure SKIP'],
  [/names another record/, 'record mismatch fails ref'],
  [/`Settled at planning:`[^\n]*`Decided by the user at planning:`/, 'planning-decision lines feed the re-plan'],
  [/planning decision departed:/, 'departure log'],
  [/ASSUMPTION — verify at build:/, 'premise probes still run'],
  [/logs nothing/, 'absent line logs nothing (AC1.1)'],
  [/Common Step 1\.5 runs as today/, 'plan audit still runs'],
  [/infrastructure fault \(an unreadable spec[^\n]*a BLOCKED stop[^\n]*log no reuse verdict/, 'non-zero probe exit is a BLOCKED stop, logs no verdict'],
  [/copy of `\{run-dir\}\/work\/\{n\}-spec\.md`[^\n]*`spec-\{N\}\/`/, 'spec path is the worktree copy of the run-dir file, multi-spec aware'],
  [/`\{worktree\}` is the worktree root/, 'worktree defined'],
  [/neither re-probes nor re-logs/, 'premise probes not repeated at Spec Step 3'],
  [/git log --diff-filter=A --format=%s -1 -- "\{plan\}"/, 'stale-plan exclusion command'],
  [/starting with `Add the plan reviewed at specify`[^\n]*return to Spec Step 3, logging nothing/, 'a plan this check committed goes to Spec Step 3 silently'],
  [/`template\.changed: true`/, 'template-changed precondition'],
  [/condition: template changed since filing → fallback: new plan written at Spec Step 3/, 'template-changed SKIP text'],
  [/mkdir -p "docs\/superpowers\/plans"/, 'plans directory created before the copy'],
  [/failed `mkdir`, copy, `git add` or commit is an infrastructure fault[^\n]*a BLOCKED stop[^\n]*log no reuse verdict/, 'a failed commit step is a BLOCKED stop, logs no verdict'],
];

test('AC2.2/AC3.1: plan-reuse.md states every check, log line and failure reason', () => {
  const missing = missingFactsOf(FACTS);
  assert.deepStrictEqual(missing(text), []);
  assertEachPatternGoesRed(text, FACTS, missing);
});

test('AC3.1: every failure reason is named in ## A check failed', () => {
  const REASON_FACTS = [
    [/`malformed Plan line`/, 'malformed reason'],
    [/`plan-audit`/, 'plan-audit reason'],
    [/`premise`/, 'premise reason'],
  ];
  const missing = missingFactsOf(REASON_FACTS);
  const section = sectionOf(text, '## A check failed');
  assert.deepStrictEqual(missing(section), []);
  assertEachPatternGoesRed(section, REASON_FACTS, missing);
  for (const c of CHECK_ORDER) assert.ok(section.includes(`\`${c}\``), `reason ${c} missing`);
});

test('AC5.1: plan-reuse.md says a resumed build takes the existing-plan branch and never re-runs this check', () => {
  const section = () => sectionOf(text, '## Resumed build');
  assert.match(section(), /existing-plan branch/);
  assert.match(section(), /never runs again/);
  const moved = text.replace(/[^\n]*never runs again[^\n]*/, '').replace('## Probe\n', '## Probe\nThis file never runs again for a resumed build; the existing-plan branch decides.\n');
  assert.notStrictEqual(moved, text);
  const inSection = sectionOf(moved, '## Resumed build');
  assert.throws(() => assert.match(inSection, /never runs again/), /never runs again/);
});

test('AC5.1: the Resumed build section says a stale committed plan goes to Spec Step 3 with no reuse verdict', () => {
  const CLAIM = /A stale plan this check committed[^\n]*goes to Spec Step 3 as written[^\n]*logs no reuse verdict/;
  assert.match(sectionOf(text, '## Resumed build'), CLAIM);
  const moved = text.replace(/[^\n]*A stale plan this check committed[^\n]*/, '').replace('## Probe\n', '## Probe\nA stale plan this check committed goes to Spec Step 3 as written, and this file logs no reuse verdict.\n');
  assert.notStrictEqual(moved, text);
  assert.throws(() => assert.match(sectionOf(moved, '## Resumed build'), CLAIM), /did not match/);
});

test('AC1.1: the template-changed skip comes after the probe outcomes, so an absent Plan: line logs nothing', () => {
  const ABSENT = '- `{"plan":"absent"}`';
  const TEMPLATE = '`template.changed: true`';
  const requireOrder = (doc) => {
    const a = doc.indexOf(ABSENT);
    const t = doc.indexOf(TEMPLATE);
    assert.notStrictEqual(a, -1, 'marker missing: absent outcome');
    assert.notStrictEqual(t, -1, 'marker missing: template check');
    assert.ok(t > a, 'the template check must come after the absent outcome');
    assert.ok(t > doc.indexOf('\n## Probe\n'), 'the template check must come after the probe heading');
    assert.ok(t < doc.indexOf('\n## Checks\n'), 'the template check must come before ## Checks');
  };
  requireOrder(text);
  const tLine = /[^\n]*`template\.changed: true`[^\n]*\n/.exec(text)[0];
  const permuted = text.replace(tLine, '').replace('## Probe\n', `## Probe\n${tLine}`);
  assert.notStrictEqual(permuted, text);
  assert.throws(() => requireOrder(permuted), /must come after the absent outcome/);
  const belowChecks = text.replace(tLine, '').replace('\n## Checks\n', `\n## Checks\n${tLine}`);
  assert.notStrictEqual(belowChecks, text);
  assert.throws(() => requireOrder(belowChecks), /must come before ## Checks/);
  const absent = text.replace(ABSENT, '- `{"plan":"none"}`');
  assert.notStrictEqual(absent, text);
  assert.throws(() => requireOrder(absent), /marker missing/);
});

// ---- Task 2: the SKILL.md pointer, Common Step 1.6 and plan-review.md skip text ----
const SKILL_FILE = path.join(ROOT, 'plugin', 'skills', 'build', 'SKILL.md');
const REVIEW_FILE = path.join(ROOT, 'plugin', 'skills', 'build', 'plan-review.md');
const skill = readText(SKILL_FILE);
const POINTER_HEAD = '#### Before Spec Step 3: a plan reviewed at specify (#6060)';
const STEP_2_5 = '### Spec Step 2.5';

// The text from a start marker to the next end marker; both must exist.
const between = (doc, from, to) => {
  const start = doc.indexOf(from);
  assert.notStrictEqual(start, -1, `heading not found: ${from}`);
  const end = doc.indexOf(to, start + from.length);
  assert.notStrictEqual(end, -1, `end marker not found: ${to}`);
  return doc.slice(start, end);
};
const pointerOf = (doc) => between(doc, POINTER_HEAD, `\n${STEP_2_5}`);
const step16Of = (doc) => between(doc, '### Common Step 1.6: Plan Review (Spec Mode only)', '\n### ');

test('AC2.1/AC5.1: SKILL.md points at plan-reuse.md only on the routes to Spec Step 3', () => {
  const POINTER_FACTS = [
    [/plan-reuse\.md/, 'names the sub-file'],
    [/--values plan-at-specify/, 'policy read'],
    [/prints `on`/, 'on only'],
    [/Spec Step 3 and Common Step 1\.6/, 'what reuse skips'],
    [/logs nothing/, 'AC1.1 silence'],
    [/existing-plan branch/, 'resume takes the existing-plan branch'],
    [/not added by an `Add the plan reviewed at specify` commit/, 'stale reused plan is excluded'],
  ];
  const missing = missingFactsOf(POINTER_FACTS);
  const pointer = pointerOf(skill);
  assert.deepStrictEqual(missing(pointer), []);
  assertEachPatternGoesRed(pointer, POINTER_FACTS, missing);
});

test('AC5.1: the pointer sits after the existing-plan branch and before Spec Step 2.5, and the resume branch is unchanged', () => {
  const ORDER = ['#### If a plan exists:', '#### If no plan exists:', POINTER_HEAD, STEP_2_5];
  const requireOrder = (doc) => {
    let last = -1;
    for (const marker of ORDER) {
      const idx = doc.indexOf(`\n${marker}`);
      assert.notStrictEqual(idx, -1, `marker missing: ${marker}`);
      assert.ok(idx > last, `${marker} must come after the previous marker`);
      last = idx;
    }
  };
  requireOrder(skill);
  const RESUME = 'If the plan is still valid and work remains, resume at Common Step 1.5, not Common Step 2 (#3666)';
  assert.ok(skill.includes(`- ${RESUME}`), 'resume bullet changed');
  // Permutation control: the pointer block moved above the existing-plan branch.
  const block = between(skill, `\n${POINTER_HEAD}`, `\n${STEP_2_5}`);
  const permuted = skill.replace(block, '').replace('\n#### If a plan exists:', `${block}\n#### If a plan exists:`);
  assert.notStrictEqual(permuted, skill);
  assert.throws(() => requireOrder(permuted), /must come after the previous marker/);
  // Existence control, matched to its own message.
  const absent = skill.replace(POINTER_HEAD, '#### Something else');
  assert.notStrictEqual(absent, skill);
  assert.throws(() => requireOrder(absent), /marker missing/);
});

test('AC2.2: the Common Step 1.6 stub and plan-review.md name the reuse skip', () => {
  const STUB = /Spec Step 2 reused a plan reviewed at specify/;
  const LOG = /\| plan reviewed at specify \(\{commit\}\)/;
  const review = readText(REVIEW_FILE);
  assert.match(step16Of(skill), STUB);
  assert.match(sectionOf(review, '## Skip logging'), LOG);
  // Move-out controls: the clause moved into a different section no longer satisfies its section check.
  const stubMoved = skill.replace(/, or Spec Step 2 reused a plan reviewed at specify/, '').replace(POINTER_HEAD, `${POINTER_HEAD}\nSpec Step 2 reused a plan reviewed at specify.`);
  assert.notStrictEqual(stubMoved, skill);
  assert.throws(() => assert.match(step16Of(stubMoved), STUB), /did not match/);
  const logMoved = review.replace(LOG, '').replace('## Skip logging\n', '## Skip logging\n\n## Other\n| plan reviewed at specify ({commit})\n\n## Skip logging 2\n');
  assert.notStrictEqual(logMoved, review);
  assert.throws(() => assert.match(sectionOf(logMoved, '## Skip logging'), LOG), /did not match/);
});

test('AC1.1: the SKILL.md additions keep build/SKILL.md under the Read rail', () => {
  const { RAIL_BYTES } = require('../plugin/bin/lib/skill-audit/budgets');
  assert.ok(Buffer.byteLength(skill) <= RAIL_BYTES, `build/SKILL.md is ${Buffer.byteLength(skill)} B against ${RAIL_BYTES}`);
});
