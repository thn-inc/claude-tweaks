'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  computeLevers, writeManifesto, renderFyi, mergeAuthorizationRefusal, AdoptedRunError, ManifestoInputError, POLICY_REQUEST_KEYS,
} = require('../../../plugin/bin/lib/flow/manifesto-write');
const { run } = require('../../../plugin/bin/manifesto-write');
const { MANIFESTO_LEVERS } = require('../../../plugin/bin/lib/set-config/write');
const { formatEntry } = require('../../../plugin/bin/lib/log-decision/append');
const { classifyDecisions } = require('../../../plugin/bin/lib/log-decision/claim-log');
const { computeAdoption, LEVER_KEYS } = require('../../../plugin/bin/lib/flow/preflight');
const logDecision = require('../../../plugin/bin/log-decision');
const { gitRepo, harnessWorktreeOf } = require('../../helpers/git-fixtures');

const RUN_ID = '2026-10-25T172400-record-4027';
const NOW = new Date(2026, 9, 25, 17, 24, 30).getTime();
const CLAIM = '## /flow\n- AUTO 17:24:24 — Step 2.8: claimed #4027 (bin/claim-targets.js, transport: git). Reversibility: high.\n';

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

// A run dir under a real git main checkout's .claude-tweaks/pipelines/ — the
// CLI anchors --run strictly (stage-item's resolveTarget), so a run dir
// outside every checkout is refused, not accepted.
function fixture({ decisions = null, config = null, runState = null } = {}) {
  const root = gitRepo();
  created.push(root);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  if (decisions !== null) fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  if (config !== null) fs.writeFileSync(path.join(runDir, 'config.yml'), config);
  if (runState !== null) fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  return { root, runDir };
}

function resolved(over = {}) {
  return {
    'scope-creep': { value: 'add-to-plan', source: 'default' },
    overlap: { value: 'companion', source: 'default' },
    'design-intent': { value: 'none', source: 'default' },
    'leftover-default': { value: 'defer', source: 'default' },
    'auto-fix-threshold': { value: 'lint+type', source: 'default' },
    'review-auto-apply-ceiling': { value: 'low', source: 'default' },
    'tidy-aggressiveness': { value: 'moderate', source: 'default' },
    'model-stance': { value: 'default', source: 'default' },
    'merge-verification': { value: 'merge-when-green', source: 'default' },
    'design-critique': { value: 'auto', source: 'default' },
    autonomy: { value: 'supervised', source: 'default' },
    'integration-model': { value: 'pr-first', source: 'default' },
    ...over,
  };
}

const ONE_STANDARD = [{ n: 4027, ceremony: 'standard', ceremonySource: 'label' }];
const lever = (levers, key) => levers.find((l) => l.key === key);

function cliDeps(fx, over = {}) {
  const out = []; const err = [];
  return {
    out, err,
    deps: {
      cwd: () => fx.root,
      mainRoot: fx.root,
      resolvePolicy: () => resolved(),
      now: () => NOW,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      ...over,
    },
  };
}

function snapshot(dir) {
  const files = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    files[name] = fs.statSync(p).isDirectory() ? '<dir>' : fs.readFileSync(p, 'utf8');
  }
  return files;
}

// --- computeLevers -----------------------------------------------------------

test('computeLevers returns all 13 levers in canonical order with value and source', () => {
  const levers = computeLevers({ mode: 'auto', modeSource: 'default', records: ONE_STANDARD, resolved: resolved() });
  assert.deepStrictEqual(levers.map((l) => l.key), [...MANIFESTO_LEVERS]);
  assert.deepStrictEqual(lever(levers, 'mode'), { key: 'mode', value: 'auto', source: 'default' });
  assert.deepStrictEqual(lever(levers, 'design-critique'), { key: 'design-critique', value: 'auto', source: 'default' });
  for (const l of levers) assert.ok(typeof l.value === 'string' && typeof l.source === 'string', l.key);
});

test('review-auto-apply-ceiling: unattended + default -> medium; unattended + policy low -> low; attended + default -> low', () => {
  const unattended = { autonomy: { value: 'unattended', source: 'policy' } };
  const a = computeLevers({ mode: 'auto', modeSource: 'default', records: ONE_STANDARD, resolved: resolved(unattended) });
  assert.deepStrictEqual(lever(a, 'review-auto-apply-ceiling'), { key: 'review-auto-apply-ceiling', value: 'medium', source: 'default' });
  const b = computeLevers({
    mode: 'auto', modeSource: 'default', records: ONE_STANDARD,
    resolved: resolved({ ...unattended, 'review-auto-apply-ceiling': { value: 'low', source: 'policy' } }),
  });
  assert.deepStrictEqual(lever(b, 'review-auto-apply-ceiling'), { key: 'review-auto-apply-ceiling', value: 'low', source: 'policy' });
  for (const autonomy of ['supervised', 'trusted']) {
    const c = computeLevers({ mode: 'auto', modeSource: 'default', records: ONE_STANDARD, resolved: resolved({ autonomy: { value: autonomy, source: 'policy' } }) });
    assert.deepStrictEqual(lever(c, 'review-auto-apply-ceiling'), { key: 'review-auto-apply-ceiling', value: 'low', source: 'default' }, autonomy);
  }
});

test('ceremony-profile folds with AND: [fast-lane, standard] -> standard, [fast-lane, fast-lane] -> fast-lane; source header', () => {
  const fold = (cs) => lever(computeLevers({
    mode: 'auto', modeSource: 'default', resolved: resolved(),
    records: cs.map((ceremony, i) => ({ n: 10 + i, ceremony, ceremonySource: 'label' })),
  }), 'ceremony-profile');
  assert.deepStrictEqual(fold(['fast-lane', 'standard']), { key: 'ceremony-profile', value: 'standard', source: 'header' });
  assert.deepStrictEqual(fold(['fast-lane', 'fast-lane']), { key: 'ceremony-profile', value: 'fast-lane', source: 'header' });
  assert.deepStrictEqual(fold(['standard']), { key: 'ceremony-profile', value: 'standard', source: 'header' });
});

test('merge-authorization is ask unless pre-authorize-merge is passed, whatever the resolved map holds; never resolved from policy', () => {
  const levers = computeLevers({
    mode: 'auto', modeSource: 'arg', records: ONE_STANDARD,
    resolved: resolved({ 'merge-authorization': { value: 'pre-authorized', source: 'run-config' } }),
  });
  assert.deepStrictEqual(lever(levers, 'merge-authorization'), { key: 'merge-authorization', value: 'ask', source: 'default' });
  assert.ok(!POLICY_REQUEST_KEYS.includes('merge-authorization'), 'never resolved from policy');
});

test('pre-authorize-merge: pre-authorized (arg) on a fresh single-record run; ask with a named refusal when dispatch-bound or multi-record', () => {
  const two = [...ONE_STANDARD, { n: 4031, ceremony: 'standard', ceremonySource: 'label' }];
  const ma = (records, dispatched) => lever(computeLevers({ mode: 'auto', modeSource: 'default', records, resolved: resolved(), preAuthorizeMerge: true, dispatched }), 'merge-authorization');
  assert.deepStrictEqual(ma(ONE_STANDARD, false), { key: 'merge-authorization', value: 'pre-authorized', source: 'arg' });
  assert.deepStrictEqual(ma(ONE_STANDARD, true), { key: 'merge-authorization', value: 'ask', source: 'default' });
  assert.deepStrictEqual(ma(two, false), { key: 'merge-authorization', value: 'ask', source: 'default' });
  assert.strictEqual(mergeAuthorizationRefusal({ preAuthorizeMerge: true, dispatched: false, records: ONE_STANDARD }), null);
  assert.strictEqual(mergeAuthorizationRefusal({ preAuthorizeMerge: true, dispatched: true, records: ONE_STANDARD }), 'dispatch-bound');
  assert.strictEqual(mergeAuthorizationRefusal({ preAuthorizeMerge: true, dispatched: false, records: two }), 'multi-record');
  assert.strictEqual(mergeAuthorizationRefusal({ preAuthorizeMerge: false, dispatched: true, records: two }), null, 'no token, nothing refused');
});

test('computeLevers runs only the auto FYI path: confirm, hybrid and interactive are refused', () => {
  for (const mode of ['confirm', 'hybrid', 'interactive']) {
    assert.throws(() => computeLevers({ mode, modeSource: 'arg', records: ONE_STANDARD, resolved: resolved() }), (e) => e instanceof ManifestoInputError, mode);
  }
});

test('POLICY_REQUEST_KEYS is preflight\'s LEVER_KEYS minus the two non-policy levers, plus autonomy and the run pin', () => {
  const policyLevers = LEVER_KEYS.filter((k) => k !== 'ceremony-profile' && k !== 'merge-authorization');
  assert.deepStrictEqual(POLICY_REQUEST_KEYS, [...policyLevers, 'autonomy', 'integration-model']);
});

test('computeLevers refuses an unresolved policy lever rather than guessing', () => {
  assert.throws(
    () => computeLevers({ mode: 'auto', modeSource: 'default', records: ONE_STANDARD, resolved: resolved({ 'model-stance': { error: 'unknown-key' } }) }),
    /model-stance/,
  );
});

// --- writeManifesto ----------------------------------------------------------

function write(fx, { records = ONE_STANDARD, res = resolved(), integrationModel = 'pr-first', deps } = {}) {
  const levers = computeLevers({ mode: 'auto', modeSource: 'default', records, resolved: res });
  return { levers, out: writeManifesto({ runDir: fx.runDir, records, levers, integrationModel, now: NOW }, deps) };
}

test('a decisions.md holding Step 2.8 claim lines keeps them byte-for-byte below the new snapshot header', () => {
  const fx = fixture({ decisions: CLAIM });
  const { levers } = write(fx);
  const text = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  const header = [
    `# Auto-Decision Log — pipeline ${RUN_ID}`,
    '',
    'Pipeline config snapshot:',
    ...levers.map((l) => `- ${l.key}: ${l.value}`),
    '- integration-model: pr-first',
    '',
    '',
  ].join('\n');
  assert.ok(text.startsWith(header + CLAIM), text);
  assert.strictEqual(text.split(CLAIM.split('\n')[1]).length, 2, 'the claim line appears exactly once');
});

test('config.yml holds the 13 levers in canonical order, then the run pin, then spec (lowest n) and created (basename timestamp)', () => {
  const fx = fixture();
  const records = [{ n: 4031, ceremony: 'fast-lane', ceremonySource: 'label' }, { n: 4027, ceremony: 'fast-lane', ceremonySource: 'label' }];
  const { levers, out } = write(fx, { records });
  const configPath = path.join(fx.runDir, 'config.yml');
  assert.strictEqual(out.configPath, configPath);
  const expected = [...levers.map((l) => `${l.key}: ${l.value}`), 'integration-model: pr-first', 'spec: 4027', 'created: 2026-10-25T172400', ''].join('\n');
  assert.strictEqual(fs.readFileSync(configPath, 'utf8'), expected);
  assert.ok(fs.statSync(path.join(fx.runDir, 'staged')).isDirectory(), 'staged/ created');
});

test('an existing config.yml -> AdoptedRunError and nothing in the run dir changes', () => {
  const fx = fixture({ decisions: CLAIM, config: 'mode: auto\n' });
  const before = snapshot(fx.runDir);
  assert.throws(() => write(fx), (e) => e instanceof AdoptedRunError);
  assert.deepStrictEqual(snapshot(fx.runDir), before);
});

test('a judged record logs the ceremony-check line; a label record logs none; then the levers line names the absolute config.yml path', () => {
  const fx = fixture({ decisions: CLAIM });
  const records = [{ n: 4027, ceremony: 'standard', ceremonySource: 'judged' }, { n: 4031, ceremony: 'fast-lane', ceremonySource: 'label' }];
  write(fx, { records });
  const flow = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8').split('## /flow\n')[1].split('\n').filter(Boolean);
  // The exact argv flow/manifesto.md dictates for bin/log-decision.js, through
  // the same formatEntry call that CLI makes (log-decision.js line: formatEntry({status, now, step, spec, text, reversibility, lever})).
  const viaCli = (step, text, reversibility = 'n/a') => formatEntry({ status: 'AUTO', now: NOW, step, spec: null, text, reversibility, lever: null });
  assert.deepStrictEqual(flow, [
    CLAIM.split('\n')[1],
    viaCli('Manifesto ceremony-check', '#4027 carries no ceremony:* label -> CEREMONY: standard'),
    viaCli('Manifesto', `levers written to ${path.join(fx.runDir, 'config.yml')}`),
    viaCli('Manifesto', 'design-critique resolved to auto (source: default)', 'n/a (a policy read, not a code mutation)'),
  ]);
  assert.ok(!flow.some((l) => l.includes('#4031 carries no ceremony')), 'a labeled record logs no ceremony-check line');
});

test('an empty integration-model resolve omits the pin, still writes the 13 levers, and logs a SKIP', () => {
  const fx = fixture();
  write(fx, { integrationModel: null });
  const config = fs.readFileSync(path.join(fx.runDir, 'config.yml'), 'utf8');
  assert.ok(!/^integration-model:/m.test(config), config);
  for (const key of MANIFESTO_LEVERS) assert.match(config, new RegExp(`^${key}: `, 'm'), key);
  const text = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.ok(!text.includes('- integration-model:'), 'the snapshot header lists no pin either');
  assert.match(text, /^- SKIP 17:24:30 — Manifesto: condition: integration-model resolved empty .*→ fallback: .*unpinned.*\. Reversibility: n\/a\.$/m);
});

test('a config.yml write that fails mid-batch removes the partial config.yml, so the run reads as case 3, never case 1', () => {
  const fx = fixture({ decisions: CLAIM });
  let n = 0;
  const { setConfigLever } = require('../../../plugin/bin/lib/set-config/write');
  const flaky = (args) => { if (++n === 5) throw new Error('EIO: simulated'); return setConfigLever(args); };
  assert.throws(() => write(fx, { deps: { setConfigLever: flaky } }), /EIO/);
  assert.ok(!fs.readdirSync(fx.runDir).includes('config.yml'), 'partial config.yml rolled back');
  const text = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.ok(text.includes('Pipeline config snapshot:'), 'the snapshot header stays, for case 3\'s recovery to read');
});

test('a decisions.md that already carries a snapshot header is refused: it is a case-3 recovery, not a fresh Manifesto', () => {
  const headed = `# Auto-Decision Log — pipeline ${RUN_ID}\n\nPipeline config snapshot:\n- mode: auto\n\n${CLAIM}`;
  const fx = fixture({ decisions: headed });
  const before = snapshot(fx.runDir);
  assert.throws(() => write(fx), /case 3/);
  assert.deepStrictEqual(snapshot(fx.runDir), before);
});

test('a headerless case-3 decisions.md is NOT detected: it gets a header prepended (callers route case 3 elsewhere)', () => {
  const case3 = `${CLAIM}\n## /build\n- AUTO 18:50:00 — Common Step 1: worktree created. Reversibility: high.\n`;
  const fx = fixture({ decisions: case3 });
  write(fx);
  const text = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.ok(text.startsWith(`# Auto-Decision Log — pipeline ${RUN_ID}\n\nPipeline config snapshot:\n`), text);
  // The Manifesto's own lines land inside the existing `## /flow` section, so
  // the old content stays in place: the claim right below the header, and the
  // `## /build` section verbatim at the end.
  // (appendEntry inserts at the section's end, after its trailing blank line.)
  assert.ok(text.includes(`\n\n${CLAIM}`), 'the claim block follows the header');
  assert.ok(text.endsWith('\n## /build\n- AUTO 18:50:00 — Common Step 1: worktree created. Reversibility: high.\n'), text);
});

test('a staged/ mkdir failure after the header landed names what landed: the run dir now reads as case 3', () => {
  const fx = fixture({ decisions: CLAIM });
  const mkdir = () => { const e = new Error('EACCES: simulated'); e.code = 'EACCES'; throw e; };
  assert.throws(() => write(fx, { deps: { mkdir } }), (e) => /EACCES/.test(e.message)
    && /decisions\.md snapshot header was already written/.test(e.message)
    && /config\.yml was not written/.test(e.message)
    && /case 3/.test(e.message));
  assert.ok(!fs.readdirSync(fx.runDir).includes('config.yml'));
  assert.ok(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8').includes('Pipeline config snapshot:'));
});

test('a refused pre-authorize-merge logs manifesto.md\'s SKIP line verbatim; a granted one writes pre-authorized to config, header and table', () => {
  const two = [...ONE_STANDARD, { n: 4031, ceremony: 'standard', ceremonySource: 'label' }];
  for (const [records, dispatched, which] of [[ONE_STANDARD, true, 'dispatch-bound'], [two, false, 'multi-record']]) {
    const fx = fixture({ decisions: CLAIM });
    const levers = computeLevers({ mode: 'auto', modeSource: 'default', records, resolved: resolved(), preAuthorizeMerge: true, dispatched });
    const mergeRefusal = mergeAuthorizationRefusal({ preAuthorizeMerge: true, dispatched, records });
    writeManifesto({ runDir: fx.runDir, records, levers, integrationModel: 'pr-first', mergeRefusal, now: NOW });
    const text = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
    const skip = formatEntry({ status: 'SKIP', now: NOW, step: 'Manifesto merge-authorization', text: `condition: pre-authorize-merge on a ${which} run → fallback: merge-authorization written as ask`, reversibility: 'n/a' });
    assert.ok(text.split('\n').includes(skip), `${which}: ${text}`);
    assert.match(text, /^- merge-authorization: ask$/m);
    assert.match(fs.readFileSync(path.join(fx.runDir, 'config.yml'), 'utf8'), /^merge-authorization: ask$/m);
  }
  const fx = fixture({ decisions: CLAIM });
  const levers = computeLevers({ mode: 'auto', modeSource: 'default', records: ONE_STANDARD, resolved: resolved(), preAuthorizeMerge: true, dispatched: false });
  const { table } = writeManifesto({ runDir: fx.runDir, records: ONE_STANDARD, levers, integrationModel: 'pr-first', mergeRefusal: null, now: NOW });
  const text = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(text, /^- merge-authorization: pre-authorized$/m);
  assert.ok(!text.includes('Manifesto merge-authorization'), 'no SKIP when granted');
  assert.match(fs.readFileSync(path.join(fx.runDir, 'config.yml'), 'utf8'), /^merge-authorization: pre-authorized$/m);
  assert.match(table, /\| Merge authorization \| pre-authorized \| arg \|\n/);
});

test('a fresh-manifesto run dir classifies as case 1 afterwards; its decisions.md classifies as content, as any headed file does today', () => {
  const fx = fixture({ decisions: CLAIM });
  const preDeps = {
    readFile: (p) => fs.readFileSync(p, 'utf8'),
    readRunState: () => null,
    git: () => { throw new Error('no git'); },
    resolveTarget: ({ runDir }) => ({ ok: true, dir: fs.realpathSync.native(runDir) }),
  };
  assert.strictEqual(computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: preDeps }).case, 2, 'claim-log-only before');
  write(fx);
  assert.strictEqual(classifyDecisions(fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8')), 'content');
  assert.strictEqual(computeAdoption({ runDir: fx.runDir, mainRoot: fx.root, cwd: fx.root, deps: preDeps }).case, 1);
});

test('renderFyi prints the auto FYI table with a Source column and the proceeding line', () => {
  const levers = computeLevers({ mode: 'auto', modeSource: 'dispatch', records: ONE_STANDARD, resolved: resolved() });
  const table = renderFyi(levers);
  assert.ok(table.startsWith('### Pipeline Config (auto)\n\n| Lever | Value | Source |\n|---|---|---|\n| Mode | auto (dispatched run) | dispatch |\n| Scope-creep | add-to-plan | default |\n'), table);
  assert.match(table, /\| Ceremony profile \| standard \| header \|\n/);
  assert.match(table, /\| Merge authorization \| ask \| default \|\n\n→ proceeding \(no approval needed\) · run with `confirm` to review\/override\n$/);
  assert.strictEqual(table.split('\n').filter((l) => /^\| (?!Lever|---)/.test(l)).length, 13);
});

// --- CLI ---------------------------------------------------------------------

const ARGV = (fx, ...extra) => ['--run', fx.runDir, '--mode', 'auto', '--mode-source', 'default', '--ceremony', '4027=standard', ...extra];

test('CLI: success prints the FYI table and exits 0', () => {
  const fx = fixture({ decisions: CLAIM });
  const { out, err, deps } = cliDeps(fx);
  assert.strictEqual(run(ARGV(fx), deps), 0, err.join(''));
  const table = out.join('');
  assert.ok(table.startsWith('### Pipeline Config (auto)\n'), table);
  assert.ok(table.endsWith('→ proceeding (no approval needed) · run with `confirm` to review/override\n'), table);
});

test('CLI: an existing config.yml exits 3 and nothing changes', () => {
  const fx = fixture({ decisions: CLAIM, config: 'mode: auto\n' });
  const before = snapshot(fx.runDir);
  let resolveCalls = 0;
  const { out, err, deps } = cliDeps(fx, { resolvePolicy: () => { resolveCalls += 1; return resolved(); } });
  assert.strictEqual(run(ARGV(fx), deps), 3);
  assert.deepStrictEqual(snapshot(fx.runDir), before);
  assert.strictEqual(out.join(''), '');
  assert.match(err.join(''), /config\.yml already present/);
  assert.strictEqual(resolveCalls, 0, 'refused before resolving policy');
});

test('CLI: --ceremony :judged marks a judged record; several records parse', () => {
  const fx = fixture();
  const { err, deps } = cliDeps(fx);
  assert.strictEqual(run(['--run', fx.runDir, '--mode', 'auto', '--mode-source', 'arg', '--ceremony', '4031=fast-lane,4027=fast-lane:judged'], deps), 0, err.join(''));
  const text = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
  assert.match(text, /Manifesto ceremony-check: #4027 carries no ceremony:\* label -> CEREMONY: fast-lane\./);
  assert.ok(!text.includes('#4031 carries'));
  assert.match(fs.readFileSync(path.join(fx.runDir, 'config.yml'), 'utf8'), /^ceremony-profile: fast-lane\nmodel-stance:[^]*^spec: 4027$/m);
});

test('CLI: malformed invocations exit 2 and write nothing', () => {
  const cases = [
    ['--mode', 'turbo'],
    ['--mode-source', 'guess'],
    ['--ceremony', '4027=deluxe'],
    ['--ceremony', '4027'],
    ['--ceremony', '0=standard'],
    ['--ceremony', '4027=standard:guessed'],
    ['--ceremony', '4027=standard,4027=fast-lane'],
    ['--ceremony', ''],
    ['--bogus', 'x'],
    ['constructor', 'x'],
  ];
  for (const extra of cases) {
    const fx = fixture({ decisions: CLAIM });
    const before = snapshot(fx.runDir);
    const { deps } = cliDeps(fx);
    // Later flags override earlier ones, so each case swaps in its bad value.
    assert.strictEqual(run([...ARGV(fx), ...extra], deps), 2, JSON.stringify(extra));
    assert.deepStrictEqual(snapshot(fx.runDir), before, JSON.stringify(extra));
  }
  const fx = fixture();
  const { deps } = cliDeps(fx);
  assert.strictEqual(run(['--run', fx.runDir, '--mode', 'auto', '--mode-source', 'default'], deps), 2, 'missing --ceremony');
  assert.strictEqual(run(['--run', fx.runDir, '--mode', 'auto', '--mode-source', 'default', '--ceremony'], deps), 2, 'trailing bare flag');
  assert.strictEqual(run(['--run', path.join(fx.root, 'nope'), '--mode', 'auto', '--mode-source', 'default', '--ceremony', '1=standard'], deps), 2, 'missing run dir');
  const odd = path.join(fx.root, 'not-a-run-id');
  fs.mkdirSync(odd);
  assert.strictEqual(run(['--run', odd, '--mode', 'auto', '--mode-source', 'default', '--ceremony', '1=standard'], deps), 2, 'basename is not a run id');
  assert.deepStrictEqual(fs.readdirSync(odd), []);
});

test('CLI: only --mode auto runs; confirm, hybrid and interactive exit 2 naming the manual manifesto.md path', () => {
  for (const mode of ['confirm', 'hybrid', 'interactive']) {
    const fx = fixture({ decisions: CLAIM });
    const before = snapshot(fx.runDir);
    const { err, deps } = cliDeps(fx);
    assert.strictEqual(run([...ARGV(fx), '--mode', mode], deps), 2, mode);
    assert.match(err.join(''), /flow\/manifesto\.md/, mode);
    assert.deepStrictEqual(snapshot(fx.runDir), before, mode);
  }
});

test('CLI: a run dir outside every checkout is refused with exit 2 (strict anchoring), nothing written', () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-manifesto-outside-'));
  created.push(outside);
  const runDir = path.join(outside, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  const fx = { root: outside, runDir };
  for (const mainRoot of [undefined, gitRepo()]) {
    if (mainRoot) created.push(mainRoot);
    const { err, deps } = cliDeps(fx, { mainRoot });
    assert.strictEqual(run(ARGV(fx), deps), 2, String(mainRoot));
    assert.match(err.join(''), /not anchored under the main checkout/);
    assert.deepStrictEqual(fs.readdirSync(runDir), []);
  }
});

test('CLI: --pre-authorize-merge writes pre-authorized (arg) on a fresh single-record run; a dispatch-bound or multi-record run keeps ask and logs the SKIP', () => {
  const fresh = fixture({ decisions: CLAIM });
  const a = cliDeps(fresh);
  assert.strictEqual(run([...ARGV(fresh), '--pre-authorize-merge'], a.deps), 0, a.err.join(''));
  assert.match(fs.readFileSync(path.join(fresh.runDir, 'config.yml'), 'utf8'), /^merge-authorization: pre-authorized$/m);
  assert.match(fs.readFileSync(path.join(fresh.runDir, 'decisions.md'), 'utf8'), /^- merge-authorization: pre-authorized$/m);
  assert.match(a.out.join(''), /\| Merge authorization \| pre-authorized \| arg \|\n/);

  const skipLine = (which) => formatEntry({ status: 'SKIP', now: NOW, step: 'Manifesto merge-authorization', text: `condition: pre-authorize-merge on a ${which} run → fallback: merge-authorization written as ask`, reversibility: 'n/a' });
  const bound = fixture({ decisions: CLAIM, runState: { dispatched: true } });
  const b = cliDeps(bound);
  assert.strictEqual(run([...ARGV(bound), '--pre-authorize-merge'], b.deps), 0, b.err.join(''));
  assert.match(fs.readFileSync(path.join(bound.runDir, 'config.yml'), 'utf8'), /^merge-authorization: ask$/m);
  assert.ok(fs.readFileSync(path.join(bound.runDir, 'decisions.md'), 'utf8').split('\n').includes(skipLine('dispatch-bound')));
  assert.match(b.out.join(''), /\| Merge authorization \| ask \| default \|\n/);

  const multi = fixture({ decisions: CLAIM });
  const c = cliDeps(multi);
  assert.strictEqual(run(['--run', multi.runDir, '--mode', 'auto', '--mode-source', 'default', '--ceremony', '4027=standard,4031=standard', '--pre-authorize-merge'], c.deps), 0, c.err.join(''));
  assert.match(fs.readFileSync(path.join(multi.runDir, 'config.yml'), 'utf8'), /^merge-authorization: ask$/m);
  assert.ok(fs.readFileSync(path.join(multi.runDir, 'decisions.md'), 'utf8').split('\n').includes(skipLine('multi-record')));

  const plain = fixture({ decisions: CLAIM, runState: { dispatched: true } });
  const d = cliDeps(plain);
  assert.strictEqual(run(ARGV(plain), d.deps), 0, d.err.join(''));
  assert.ok(!fs.readFileSync(path.join(plain.runDir, 'decisions.md'), 'utf8').includes('Manifesto merge-authorization'), 'no token, no SKIP');
});

test('CLI: a staged/ mkdir failure exits 1 and stderr names what already landed', () => {
  const fx = fixture({ decisions: CLAIM });
  const { err, deps } = cliDeps(fx, { mkdir: () => { throw new Error('EACCES: simulated'); } });
  assert.strictEqual(run(ARGV(fx), deps), 1);
  assert.match(err.join(''), /snapshot header was already written.*config\.yml was not written.*case 3/);
});

test('CLI: --help prints usage and exits 0 without touching the run dir', () => {
  const fx = fixture();
  const { out, deps } = cliDeps(fx);
  assert.strictEqual(run(['--help'], deps), 0);
  assert.match(out.join(''), /^usage: manifesto-write\.js --run <run-dir>/);
  assert.deepStrictEqual(fs.readdirSync(fx.runDir), []);
});

test('CLI: an invalid integration-model in policy.yml (resolves to null) still exits 0, unpinned, and says so on stderr', () => {
  const fx = fixture();
  const { err, deps } = cliDeps(fx, { resolvePolicy: () => resolved({ 'integration-model': { value: null, source: 'default', invalid: true } }) });
  assert.strictEqual(run(ARGV(fx), deps), 0, err.join(''));
  assert.ok(!/^integration-model:/m.test(fs.readFileSync(path.join(fx.runDir, 'config.yml'), 'utf8')));
  assert.match(err.join(''), /integration-model resolved empty — config\.yml written without the run pin/);
});

test('CLI: a policy-resolution failure exits 1 with nothing written', () => {
  const fx = fixture({ decisions: CLAIM });
  const before = snapshot(fx.runDir);
  const { deps } = cliDeps(fx, { resolvePolicy: () => { throw new Error('boom'); } });
  assert.strictEqual(run(ARGV(fx), deps), 1);
  assert.deepStrictEqual(snapshot(fx.runDir), before);
});

test('CLI from a linked-worktree cwd: writes the main-checkout run dir with the real policy resolution; a worktree shadow exits 2', () => {
  const main = gitRepo();
  created.push(main);
  const wt = harnessWorktreeOf(main);
  // The worktree's policy.yml is what `git rev-parse --show-toplevel` from its
  // cwd resolves — the same file bin/resolve-policy.js reads from there.
  fs.mkdirSync(path.join(wt, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(wt, '.claude-tweaks', 'policy.yml'), 'autonomy: unattended\ndesign-critique: full\n');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), CLAIM);
  const out = []; const err = [];
  const deps = { cwd: () => wt, now: () => NOW, stdout: (s) => out.push(s), stderr: (s) => err.push(s) };
  assert.strictEqual(run(['--run', runDir, '--mode', 'auto', '--mode-source', 'default', '--ceremony', '4027=standard:judged'], deps), 0, err.join(''));
  const config = fs.readFileSync(path.join(runDir, 'config.yml'), 'utf8');
  assert.match(config, /^review-auto-apply-ceiling: medium$/m, 'unattended + default ceiling');
  assert.match(config, /^design-critique: full$/m);
  assert.match(config, /^merge-verification: off$/m, 'no origin remote: local-merge, so off');
  assert.match(config, /^integration-model: local-merge$/m);
  assert.match(out.join(''), /\| Review auto-apply ceiling \| medium \| default \|\n/);
  assert.match(out.join(''), /\| Design critique \| full \| policy \|\n/);

  // Byte-match against the real bin/log-decision.js, run from the same cwd.
  const twin = path.join(main, '.claude-tweaks', 'pipelines', '2026-10-25T172401-record-4027');
  fs.mkdirSync(twin);
  const cliArgs = (step, text) => ['--run', twin, '--section', '/flow', '--status', 'AUTO', '--step', step, '--text', text, '--reversibility', 'n/a'];
  const ldDeps = { cwd: () => wt, mainRoot: undefined, now: () => NOW, stdout: () => {}, stderr: (s) => err.push(s) };
  assert.strictEqual(logDecision.run(cliArgs('Manifesto ceremony-check', '#4027 carries no ceremony:* label -> CEREMONY: standard'), ldDeps), 0, err.join(''));
  assert.strictEqual(logDecision.run(cliArgs('Manifesto', `levers written to ${path.join(runDir, 'config.yml')}`), ldDeps), 0, err.join(''));
  const twinLines = fs.readFileSync(path.join(twin, 'decisions.md'), 'utf8').split('\n').filter((l) => l.startsWith('- '));
  const ours = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8').split('\n');
  for (const line of twinLines) assert.ok(ours.includes(line), `missing byte-identical line: ${line}`);

  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(shadow, { recursive: true });
  const e2 = [];
  assert.strictEqual(run(['--run', shadow, '--mode', 'auto', '--mode-source', 'default', '--ceremony', '4027=standard'], { ...deps, stderr: (s) => e2.push(s) }), 2);
  assert.match(e2.join(''), /not anchored under the main checkout/);
  assert.deepStrictEqual(fs.readdirSync(shadow), []);
});
