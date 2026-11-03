'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { run } = require('../plugin/bin/risk-flags');
const record = require('../plugin/bin/lib/issues/record');
const { parseRiskFlags } = record;
const { gitRepo } = require('./helpers/git-fixtures');

// #4618 Task 4: bin/risk-flags.js classify | settle | confirm, in-process over tmp files.
const BIN = path.join(__dirname, '..', 'plugin', 'bin', 'risk-flags.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'risk-flags-cli-'));
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
function rawFile(text) {
  const file = path.join(TMP, `f${seq++}.txt`);
  fs.writeFileSync(file, text);
  return file;
}
const answers = (obj) => rawFile(JSON.stringify(obj));
const priorWith = (slug) => rawFile(`# t\n\nSurface: infra\nRisk-flags: ${slug}\n\n## Overview\n`);

// A repo root with no policy file: control mode off, whatever the checkout running the tests says.
const NO_POLICY_ROOT = fs.mkdtempSync(path.join(TMP, 'root-'));
function repoWithPolicy(policy) {
  const root = fs.mkdtempSync(path.join(TMP, 'root-'));
  fs.mkdirSync(path.join(root, '.claude-tweaks'));
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policy);
  return root;
}

// A git repo with a run directory under .claude-tweaks/pipelines, registered so exec() hands
// log-decision the repo as cwd and mainRoot (its anchoring check).
const repoOfRun = new Map();
function realAnchoredRunDirFixture() {
  const repo = gitRepo({ parent: TMP });
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', `run-${seq++}`);
  fs.mkdirSync(runDir, { recursive: true });
  repoOfRun.set(runDir, repo);
  return runDir;
}
function readDecisions(runDir) {
  try {
    return fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return '';
    throw error;
  }
}

function exec(argv, over = {}) {
  const outChunks = [];
  const errChunks = [];
  const runDir = argv.includes('--run') ? argv[argv.indexOf('--run') + 1] : null;
  const repo = runDir && repoOfRun.get(runDir);
  const deps = {
    stdout: (s) => outChunks.push(s),
    stderr: (s) => errChunks.push(s),
    ...(repo ? { cwd: () => repo, mainRoot: repo } : {}),
    ...over,
  };
  const code = run(argv, deps);
  const stdout = outChunks.join('');
  return { code, stdout, out: stdout.startsWith('{') ? JSON.parse(stdout) : null, stderr: errChunks.join(''), outChunks };
}
const withRoot = (args) => (args.includes('--repo-root') ? args : [...args, '--repo-root', NO_POLICY_ROOT]);
function viaFile(verb, body, args, over) {
  const file = rawFile(body);
  const r = exec([verb, '--body-file', file, ...withRoot(args)], over);
  return { ...r, file, body: fs.readFileSync(file, 'utf8') };
}
const settle = (body, args = [], over) => viaFile('settle', body, args, over);
const classify = (body, args = [], over) => viaFile('classify', body, args, over);
const confirm = (body, answersFile, extra = [], over) => viaFile('confirm', body, ['--answers-file', answersFile, ...extra], over);
const runCli = (argv) => exec(argv);

const SPEC_WITH_MIGRATIONS_PATH = [
  '# Add the orders table', '', 'Surface: infra', '', '## Overview', '', 'Store orders.', '',
  '## Deliverables', '', '- Create the orders storage', '', '## Key Files', '', '- `db/migrations/0001_orders.sql`', '',
].join('\n');
const CLEAN_SPEC = SPEC_WITH_MIGRATIONS_PATH.replace('db/migrations/0001_orders.sql', 'src/orders.js');
const withUnconfirmed = (body) => body.replace('Surface: infra\n', 'Surface: infra\nRisk-flags: migrations\nRisk-flags-unconfirmed: true\n');

test('AC3.1: headless shaping never drops a detected flag and writes the marker', () => {
  const { out, body, code } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--headless']);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual(out.flags, ['migrations']);
  assert.match(body, /^Risk-flags: migrations$/m);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
  assert.match(body, /Proof\(migrations\):/);
  assert.deepStrictEqual([out.removed, out.unconfirmed, out.status, out.refused, out.logged, out.logFailures], [[], true, 'unclassified', null, null, []]);
});

test('AC3.1: headless never removes a prior flag the new text no longer implies', () => {
  const { out, body } = settle(CLEAN_SPEC, ['--headless', '--prior-body-file', priorWith('auth')]);
  assert.deepStrictEqual(out.flags, ['auth']);
  assert.match(body, /^Risk-flags: auth$/m);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
});

test('AC2.1: a remove answer drops the flag and writes the removal entry to decisions.md', () => {
  const runDir = realAnchoredRunDirFixture();
  const { out, body } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', runDir]);
  assert.deepStrictEqual([out.flags, out.removed, out.logged, out.logFailures], [[], ['migrations'], true, []]);
  assert.match(body, /^Risk-flags: none$/m);
  assert.doesNotMatch(body, /Risk-flags-unconfirmed/);
  assert.doesNotMatch(body, /Risk proof required/);
  const log = readDecisions(runDir);
  assert.match(log, /^- KEPT-PROMPT \S+ — .*Risk flag migrations removed by the maintainer during shaping/m);
  assert.doesNotMatch(log, /^- AUTO .*removed by the maintainer/m);
  assert.match(log, /\/specify/);
});

test('a confirm removal is logged under /backlog refine, not /specify, with the same removal text', () => {
  const runDir = realAnchoredRunDirFixture();
  const { out, body } = confirm(withUnconfirmed(SPEC_WITH_MIGRATIONS_PATH), answers({ migrations: 'remove' }), ['--run', runDir]);
  assert.deepStrictEqual([out.removed, out.logged, out.logFailures], [['migrations'], true, []]);
  assert.match(body, /^Risk-flags: none$/m);
  const log = readDecisions(runDir);
  assert.match(log, /^## \/backlog$/m);
  assert.match(log, /^- KEPT-PROMPT \S+ — Refine risk flags: Risk flag migrations removed by the maintainer during shaping/m);
  assert.doesNotMatch(log, /\/specify/);
});

test('log-decision stays quiet: the JSON envelope is the only thing on stdout', () => {
  const runDir = realAnchoredRunDirFixture();
  const r = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', runDir]);
  assert.strictEqual(r.outChunks.length, 1);
  assert.strictEqual(r.stdout.trim().split('\n').length, 1);
  assert.strictEqual(r.out.logged, true);
});

test('AC2.2: a keep answer leaves the flag and clears the marker', () => {
  const { out, body } = settle(withUnconfirmed(SPEC_WITH_MIGRATIONS_PATH), ['--answers-file', answers({ migrations: 'keep' })]);
  assert.deepStrictEqual([out.flags, out.unconfirmed], [['migrations'], false]);
  assert.doesNotMatch(body, /Risk-flags-unconfirmed/);
  assert.match(body, /^Risk-flags: migrations$/m);
  assert.match(body, /Proof\(migrations\):/);
});

test('AC5.7: an unanswered, unreadable or malformed answer keeps the flag and marks it unconfirmed', () => {
  for (const a of [answers({}), answers({ migrations: 'perhaps' }), '/nope/missing.json', rawFile('not json'), rawFile('null'), rawFile('[]')]) {
    const { out, body, code, stderr } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', a]);
    assert.strictEqual(code, 0, a);
    assert.deepStrictEqual([out.flags, out.unconfirmed, out.removed], [['migrations'], true, []], a);
    assert.match(body, /^Risk-flags-unconfirmed: true$/m, a);
    assert.strictEqual(stderr.trim().split('\n').length, 1, `${a}: one stderr warning`);
  }
});

test('a partial answer set removes the answered flag, keeps the rest and keeps the marker', () => {
  const both = SPEC_WITH_MIGRATIONS_PATH.replace('- Create the orders storage', '- Create the orders storage\n- Permanently delete the old rows');
  const { out, body } = settle(both, ['--answers-file', answers({ migrations: 'remove' })]);
  assert.deepStrictEqual([out.flags, out.removed, out.unconfirmed], [['irreversible-side-effect'], ['migrations'], true]);
  assert.match(body, /^Risk-flags: irreversible-side-effect$/m);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
});

test('the Gotcha bullet narrows with the kept set and goes with the last flag', () => {
  const two = SPEC_WITH_MIGRATIONS_PATH.replace('- Create the orders storage', '- Create the orders storage\n- Permanently delete the old rows');
  const headless = settle(two, ['--headless']);
  assert.deepStrictEqual(headless.out.flags, ['migrations', 'irreversible-side-effect']);
  assert.match(headless.body, /Proof\(migrations\):.*Proof\(irreversible-side-effect\):/);
  const one = settle(two, ['--answers-file', answers({ migrations: 'remove', 'irreversible-side-effect': 'keep' })]);
  assert.match(one.body, /^- Risk proof required:.*Proof\(irreversible-side-effect\)/m);
  assert.doesNotMatch(one.body, /Proof\(migrations\)/);
  assert.strictEqual(one.body.match(/Risk proof required/g).length, 1);
  const none = settle(two, ['--answers-file', answers({ migrations: 'remove', 'irreversible-side-effect': 'remove' })]);
  assert.doesNotMatch(none.body, /Risk proof required/);
  assert.match(none.body, /^Risk-flags: none$/m);
});

test('an empty kept set writes none, no marker and no Gotcha', () => {
  for (const args of [['--headless'], ['--answers-file', answers({})]]) {
    const { out, body } = settle(CLEAN_SPEC, args);
    assert.deepStrictEqual([out.flags, out.unconfirmed, out.status], [[], false, 'unclassified']);
    assert.match(body, /^Risk-flags: none$/m);
    assert.doesNotMatch(body, /Risk-flags-unconfirmed|Risk proof required/);
  }
});

test('a removal with an unanchored --run is logged:false and still exits 0', () => {
  const { out, code, body } = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', '/not/a/run']);
  assert.deepStrictEqual([code, out.logged, out.logFailures, out.removed], [0, false, ['migrations'], ['migrations']]);
  assert.match(body, /^Risk-flags: none$/m);
});

test('a body write failure exits 3 and logs nothing', () => {
  const runDir = realAnchoredRunDirFixture();
  const file = rawFile(SPEC_WITH_MIGRATIONS_PATH);
  const r = exec(['settle', '--body-file', file, '--answers-file', answers({ migrations: 'remove' }), '--run', runDir, ...withRoot([])], {
    writeFile: () => { throw Object.assign(new Error('read-only'), { code: 'EROFS' }); },
  });
  assert.strictEqual(r.code, 3);
  assert.strictEqual(r.stdout, '');
  assert.match(r.stderr, /EROFS/);
  assert.strictEqual(readDecisions(runDir), '');
  assert.strictEqual(fs.readFileSync(file, 'utf8'), SPEC_WITH_MIGRATIONS_PATH);
});

test('AC6.1: confirm runs no classifier: a record with no flag lines stays byte-identical', () => {
  const { body, out } = confirm(SPEC_WITH_MIGRATIONS_PATH, answers({}));
  assert.strictEqual(body, SPEC_WITH_MIGRATIONS_PATH);
  assert.strictEqual(out.status, 'unclassified');
  assert.deepStrictEqual([out.flags, out.removed, out.refused], [[], [], null]);
});

test('a body that comes out byte-identical is not rewritten', () => {
  const writes = [];
  const writeFile = (file) => writes.push(file);
  confirm(SPEC_WITH_MIGRATIONS_PATH, answers({}), [], { writeFile });
  confirm(MALFORMED, answers({ auth: 'keep' }), [], { writeFile });
  confirm('Risk-flags: none\n', answers({}), [], { writeFile });
  assert.deepStrictEqual(writes, []);
});

test('confirm applies a remove and a keep to existing flags only', () => {
  const { out, body } = confirm('Risk-flags: auth, migrations\nRisk-flags-unconfirmed: true\n', answers({ auth: 'remove', migrations: 'keep' }));
  assert.deepStrictEqual([out.flags, out.unconfirmed, out.removed, out.status], [['migrations'], false, ['auth'], 'ok']);
  assert.match(body, /^Risk-flags: migrations$/m);
  assert.doesNotMatch(body, /Risk-flags-unconfirmed/);
  assert.match(body, /^- Risk proof required:.*Proof\(migrations\)/m);
  assert.doesNotMatch(body, /Proof\(auth\)/);
});

test('confirm adds no flag the floor would find: the migrations path stays unflagged', () => {
  const body = withUnconfirmed(SPEC_WITH_MIGRATIONS_PATH).replace('Risk-flags: migrations', 'Risk-flags: auth');
  const { out } = confirm(body, answers({ auth: 'keep' }));
  assert.deepStrictEqual(out.flags, ['auth']);
});

test('confirm with a missing answer keeps the flag and the marker', () => {
  const { out, body, code } = confirm('Risk-flags: auth\nRisk-flags-unconfirmed: true\n', answers({}));
  assert.deepStrictEqual([code, out.flags, out.unconfirmed], [0, ['auth'], true]);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
});

const ALL = ['migrations', 'auth', 'public-contract', 'irreversible-side-effect'];
const MALFORMED = 'Surface: infra\nRisk-flags: Auth\nRisk-flags-unconfirmed: true\n\n## Overview\n';
const UNKNOWN_SLUG = 'Surface: infra\nRisk-flags: auth, pii\nRisk-flags-unconfirmed: true\n\n## Overview\n';
// Reading A's one assertion: widened set kept, marker kept, nothing removed, no removal line.
function assertRefused({ out, body, code, stderr }, runDir, reason) {
  assert.strictEqual(code, 0);
  assert.deepStrictEqual([out.status, out.removed, out.unconfirmed, out.refused.reason], ['unknown', [], true, reason]);
  assert.deepStrictEqual(parseRiskFlags(body, { extraCategories: [] }).flags.slice(0, 4), ALL);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
  assert.doesNotMatch(readDecisions(runDir), /removed by the maintainer during shaping/);
  assert.strictEqual(out.logged, null, 'nothing was removed, so no log was attempted');
  assert.deepStrictEqual(out.logFailures, []);
  assert.strictEqual(stderr.trim().split('\n').length, 1, 'one stderr warning');
  assert.match(stderr, /unreadable/);
  assert.doesNotMatch(stderr, /risk[-_ ]?flags\s*:/i);
}

test('Reading A: settle refuses a remove answer on a malformed line and logs nothing', () => {
  const runDir = realAnchoredRunDirFixture();
  const r = settle(MALFORMED, ['--answers-file', answers({ auth: 'remove' }), '--run', runDir]);
  assertRefused(r, runDir, 'malformed');
  assert.deepStrictEqual(r.out.refused.answered, ['auth']);
  assert.strictEqual(r.out.refused.raw, 'Risk-flags: Auth');
});

test('Reading A: settle refuses a remove answer on a line naming an unknown slug', () => {
  const runDir = realAnchoredRunDirFixture();
  const r = settle(UNKNOWN_SLUG, ['--answers-file', answers({ pii: 'remove', auth: 'keep' }), '--run', runDir]);
  assertRefused(r, runDir, 'unknown-slug');
  assert.deepStrictEqual(r.out.refused.answered, ['pii', 'auth']);
  assert.match(r.body, /pii/);
});

test('Reading A: settle refuses when only the prior body reads unknown', () => {
  const runDir = realAnchoredRunDirFixture();
  assertRefused(settle(SPEC_WITH_MIGRATIONS_PATH, ['--prior-body-file', rawFile(MALFORMED), '--answers-file', answers({ migrations: 'remove' }), '--run', runDir]), runDir, 'malformed');
});

test('Reading A: a keep-all answer on an unknown line does not clear the marker', () => {
  const runDir = realAnchoredRunDirFixture();
  assertRefused(settle(MALFORMED, ['--answers-file', answers(Object.fromEntries(ALL.map((s) => [s, 'keep']))), '--run', runDir]), runDir, 'malformed');
});

test('Reading A: an unreadable answers file still refuses, naming no answered slug', () => {
  const runDir = realAnchoredRunDirFixture();
  const r = settle(MALFORMED, ['--answers-file', '/nope/missing.json', '--run', runDir]);
  assertRefused(r, runDir, 'malformed');
  assert.deepStrictEqual(r.out.refused.answered, []);
});

test('Reading A: --headless on an unknown line removes nothing and reports no refusal', () => {
  const { out, code } = settle(MALFORMED, ['--headless']);
  assert.deepStrictEqual([code, out.refused, out.removed, out.status, out.unconfirmed], [0, null, [], 'unknown', true]);
  assert.deepStrictEqual(out.flags.slice(0, 4), ALL);
});

test('Reading A: confirm with a partial answer on an unknown line keeps the widened set and the marker', () => {
  const runDir = realAnchoredRunDirFixture();
  const r = confirm(MALFORMED, answers({ auth: 'keep' }), ['--run', runDir]);
  assertRefused(r, runDir, 'malformed');
  assert.strictEqual(r.body, MALFORMED);
});

test('Reading A: confirm with a remove answer on an unknown line keeps the widened set and the marker', () => {
  const runDir = realAnchoredRunDirFixture();
  const r = confirm(UNKNOWN_SLUG, answers({ auth: 'remove' }), ['--run', runDir]);
  assertRefused(r, runDir, 'unknown-slug');
  assert.strictEqual(r.body, UNKNOWN_SLUG);
});

test('Reading A: confirm writes the marker on an unknown line that lacks one', () => {
  const runDir = realAnchoredRunDirFixture();
  assertRefused(confirm('Risk-flags: Auth\n', answers({ auth: 'remove' }), ['--run', runDir]), runDir, 'malformed');
});

// A writer refusing a line the entry read as ok cannot happen with real inputs, so the
// branch is driven by replacing the writer on the shared record module for one call.
function withThrowingRemover(fn) {
  const original = record.removeRiskFlag;
  record.removeRiskFlag = () => { throw Object.assign(new Error('refused'), { code: record.RISK_FLAGS_UNKNOWN }); };
  try {
    return fn();
  } finally {
    record.removeRiskFlag = original;
  }
}
function assertWriterRefused(r, runDir) {
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual([r.out.status, r.out.removed, r.out.unconfirmed, r.out.refused.reason], ['unknown', [], true, null]);
  assert.deepStrictEqual([r.out.logged, r.out.logFailures], [null, []]);
  assert.match(r.body, /^Risk-flags-unconfirmed: true$/m);
  assert.strictEqual(readDecisions(runDir), '');
  assert.strictEqual(r.stderr.trim().split('\n').length, 1, 'one stderr warning');
  assert.match(r.stderr, /writer refused/);
  assert.doesNotMatch(r.stderr, /unreadable|risk[-_ ]?flags\s*:/i);
}

test('Reading A: a RISK_FLAGS_UNKNOWN throw in settle is caught into the same refusal, status unknown, no invented reason', () => {
  const runDir = realAnchoredRunDirFixture();
  const r = withThrowingRemover(() => settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', runDir]));
  assertWriterRefused(r, runDir);
  assert.deepStrictEqual([r.out.flags, r.out.refused.answered], [['migrations'], ['migrations']]);
  assert.match(r.body, /^Risk-flags: migrations$/m);
  assert.match(r.body, /Proof\(migrations\):/);
});

test('Reading A: a RISK_FLAGS_UNKNOWN throw in confirm is caught likewise and writes the missing marker', () => {
  const runDir = realAnchoredRunDirFixture();
  const r = withThrowingRemover(() => confirm('Risk-flags: auth\n', answers({ auth: 'remove' }), ['--run', runDir]));
  assertWriterRefused(r, runDir);
  assert.deepStrictEqual([r.out.flags, r.out.refused.answered], [['auth'], ['auth']]);
  assert.match(r.body, /^Risk-flags: auth$/m);
  const marked = 'Risk-flags: auth\nRisk-flags-unconfirmed: true\n';
  const again = withThrowingRemover(() => confirm(marked, answers({ auth: 'remove' }), ['--run', runDir]));
  assert.strictEqual(again.body, marked, 'a body that already carries the marker stays byte-identical');
});

test('logged is null whenever no removal was attempted, true once a line was written', () => {
  const runDir = realAnchoredRunDirFixture();
  const headless = settle(SPEC_WITH_MIGRATIONS_PATH, ['--headless', '--run', runDir]);
  const keep = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'keep' }), '--run', runDir]);
  const unanswered = settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({}), '--run', runDir]);
  const clean = settle(CLEAN_SPEC, ['--answers-file', answers({}), '--run', runDir]);
  for (const r of [headless, keep, unanswered, clean]) assert.deepStrictEqual([r.out.logged, r.out.logFailures], [null, []]);
  assert.strictEqual(readDecisions(runDir), '');
  assert.strictEqual(settle(SPEC_WITH_MIGRATIONS_PATH, ['--answers-file', answers({ migrations: 'remove' }), '--run', runDir]).out.logged, true);
  assert.strictEqual(confirm('Risk-flags: auth\n', answers({ auth: 'keep' }), ['--run', runDir]).out.logged, null);
});

test('a hand-written marker beside an empty kept set survives a headless settle', () => {
  const stray = CLEAN_SPEC.replace('Surface: infra\n', 'Surface: infra\nRisk-flags: none\nRisk-flags-unconfirmed: true\n');
  const { out, body, code } = settle(stray, ['--headless']);
  assert.strictEqual(code, 0);
  assert.deepStrictEqual([out.flags, out.unconfirmed, out.status, out.removed], [[], true, 'ok', []]);
  assert.match(body, /^Risk-flags: none$/m);
  assert.match(body, /^Risk-flags-unconfirmed: true$/m);
  assert.doesNotMatch(body, /Risk proof required/);
  assert.strictEqual(body, stray);
});

test('settle needs exactly one of --headless and --answers-file; a missing body exits 1', () => {
  const tmp = rawFile(CLEAN_SPEC);
  assert.strictEqual(runCli(['settle', '--body-file', tmp]).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file', tmp, '--headless', '--answers-file', tmp]).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file', '/nope', '--headless']).code, 1);
  assert.strictEqual(runCli(['nope']).code, 2);
  assert.strictEqual(runCli(['settle', '--body-file']).code, 2);
  assert.strictEqual(runCli([]).code, 2);
});

test('malformed invocations exit 2 with a usage line and nothing on stdout', () => {
  const f = rawFile(CLEAN_SPEC);
  const bad = [
    ['settle', '--body-file', f, '--headless', '--headless'],
    ['settle', '--body-file', f, '--body-file', f, '--headless'],
    ['settle', '--body-file', '', '--headless'],
    ['settle', '--body-file', '--headless'],
    ['settle', '--body-file', f, '--headless', '--prior-body-file'],
    ['settle', '--body-file', f, '--headless', 'constructor', 'x'],
    ['settle', '--body-file', f, '--headless', '--add', 'Bad_Slug'],
    ['settle', '--body-file', f, '--headless', '--add', 'a,,b'],
    ['settle', '--body-file', f, '--headless', '--add', 'none'],
    ['settle', '--headless'],
    ['classify', '--body-file', f, '--headless'],
    ['classify', '--body-file', f, '--answers-file', f],
    ['confirm', '--body-file', f],
    ['confirm', '--body-file', f, '--answers-file', f, '--add', 'auth'],
    ['confirm', '--body-file', f, '--answers-file', f, '--headless'],
    ['confirm', '--body-file', f, '--answers-file', f, '--prior-body-file', f],
    ['classify'],
  ];
  for (const argv of bad) {
    const r = runCli(argv);
    assert.strictEqual(r.code, 2, argv.join(' '));
    assert.strictEqual(r.stdout, '', argv.join(' '));
    assert.match(r.stderr, /^risk-flags\.js: /, argv.join(' '));
    assert.match(r.stderr, /usage:/, argv.join(' '));
  }
});

test('an unreadable body or prior body file exits 1 on every verb, and --help exits 0', () => {
  const f = rawFile(CLEAN_SPEC);
  assert.strictEqual(runCli(['classify', '--body-file', '/nope/body.md']).code, 1);
  assert.strictEqual(runCli(['classify', '--body-file', f, '--prior-body-file', '/nope/prior.md']).code, 1);
  assert.strictEqual(runCli(['settle', '--body-file', f, '--headless', '--prior-body-file', '/nope/prior.md']).code, 1);
  assert.strictEqual(runCli(['confirm', '--body-file', '/nope/body.md', '--answers-file', f]).code, 1);
  const help = runCli(['settle', '--help']);
  assert.deepStrictEqual([help.code, /usage:/.test(help.stdout)], [0, true]);
});

test('--add widens the kept set; a slug outside the known categories exits 2', () => {
  const ok = settle(CLEAN_SPEC, ['--headless', '--add', 'public-contract,auth']);
  assert.deepStrictEqual(ok.out.flags, ['auth', 'public-contract']);
  const bad = settle(CLEAN_SPEC, ['--headless', '--add', 'pii']);
  assert.strictEqual(bad.code, 2);
  assert.match(bad.stderr, /pii/);
  assert.strictEqual(bad.body, CLEAN_SPEC);
});

const SAME_UNION_CASES = () => [
  ['floor only', SPEC_WITH_MIGRATIONS_PATH, []],
  ['floor plus a prior flag', SPEC_WITH_MIGRATIONS_PATH, ['--prior-body-file', priorWith('auth')]],
  ['prior flags out of canonical order, own line', withUnconfirmed(CLEAN_SPEC).replace('Risk-flags: migrations', 'Risk-flags: auth'), ['--prior-body-file', priorWith('irreversible-side-effect, migrations')]],
  ['clean plus --add', CLEAN_SPEC, ['--add', 'public-contract,auth']],
  ['an unknown prior line', CLEAN_SPEC, ['--prior-body-file', rawFile(MALFORMED)]],
  ['an unknown own line naming a slug', UNKNOWN_SLUG, []],
  ['nothing at all', CLEAN_SPEC, []],
];
test('classify prints exactly the kept set settle --headless writes, canonical order, entry status included', () => {
  for (const [label, body, args] of SAME_UNION_CASES()) {
    const c = classify(body, args);
    const s = settle(body, [...args, '--headless']);
    assert.strictEqual(c.code, 0, label);
    assert.deepStrictEqual(c.out.kept, s.out.flags, label);
    assert.strictEqual(c.out.entry.status, s.out.status, label);
    assert.strictEqual(c.body, body, `${label}: classify writes nothing`);
    assert.deepStrictEqual(parseRiskFlags(s.body).flags, s.out.flags, `${label}: the line reads back as reported`);
  }
});

test('classify prints the floor with evidence, the entry, the sections and the known categories', () => {
  const { out } = classify(SPEC_WITH_MIGRATIONS_PATH, []);
  assert.deepStrictEqual(out.flags.map((f) => [f.slug, f.via]), [['migrations', 'path']]);
  assert.strictEqual(out.flags[0].evidence.includes('migrations'), true);
  assert.deepStrictEqual(out.kept, ['migrations']);
  assert.deepStrictEqual(out.entry, { status: 'unclassified', reason: null, unconfirmed: false });
  assert.deepStrictEqual(out.missingSections, ['Acceptance Criteria']);
  assert.deepStrictEqual([out.controlMode, out.extraCategories, out.globsInvalid], [false, [], false]);
  assert.deepStrictEqual(out.known, ALL);
  assert.deepStrictEqual(classify('# t\n\n## Overview\n', []).out.missingSections, ['Deliverables', 'Acceptance Criteria', 'Key Files']);
  const unknown = classify(MALFORMED, []).out;
  assert.deepStrictEqual(unknown.entry, { status: 'unknown', reason: 'malformed', unconfirmed: true });
  assert.deepStrictEqual(unknown.flags, []);
  assert.deepStrictEqual(unknown.kept, ALL);
});

const PII_BY_WORD = CLEAN_SPEC.replace('- Create the orders storage', '- Mask pii in exports');
const PII_BY_GLOB = CLEAN_SPEC.replace('src/orders.js', 'src/vault/keys.js');
const POLICY_BODY = 'risk-categories: pii\nrisk-path-globs:\n  pii: [src/vault/**]\n';
test('control mode on: settle recognises a policy slug and a path glob; off, neither is consulted', () => {
  const on = repoWithPolicy(`control-mode: on\n${POLICY_BODY}`);
  const off = repoWithPolicy(POLICY_BODY);
  for (const body of [PII_BY_WORD, PII_BY_GLOB]) {
    const onRun = settle(body, ['--headless', '--repo-root', on]);
    assert.deepStrictEqual(onRun.out.flags, ['pii'], body);
    assert.match(onRun.body, /^Risk-flags: pii$/m);
    const offRun = settle(body, ['--headless', '--repo-root', off]);
    assert.deepStrictEqual(offRun.out.flags, [], body);
    assert.match(offRun.body, /^Risk-flags: none$/m);
  }
  const c = classify(PII_BY_GLOB, ['--repo-root', on]).out;
  assert.deepStrictEqual([c.controlMode, c.extraCategories, c.known, c.globsInvalid], [true, ['pii'], [...ALL, 'pii'], false]);
  assert.deepStrictEqual(c.flags.map((f) => [f.slug, f.via]), [['pii', 'path-glob']]);
  const cOff = classify(PII_BY_GLOB, ['--repo-root', off]).out;
  assert.deepStrictEqual([cOff.controlMode, cOff.extraCategories, cOff.known], [false, [], ALL]);
  assert.strictEqual(settle(CLEAN_SPEC, ['--headless', '--add', 'pii', '--repo-root', off]).code, 2);
  assert.deepStrictEqual(settle(CLEAN_SPEC, ['--headless', '--add', 'pii', '--repo-root', on]).out.flags, ['pii']);
});

test('control mode on: a policy slug can be answered remove, and an invalid glob block reads as globsInvalid', () => {
  const on = repoWithPolicy(`control-mode: on\n${POLICY_BODY}`);
  const { out, body } = settle(PII_BY_WORD, ['--answers-file', answers({ pii: 'remove' }), '--repo-root', on]);
  assert.deepStrictEqual([out.flags, out.removed], [[], ['pii']]);
  assert.match(body, /^Risk-flags: none$/m);
  const broken = repoWithPolicy('control-mode: on\nrisk-path-globs: x\n');
  assert.strictEqual(classify(CLEAN_SPEC, ['--repo-root', broken]).out.globsInvalid, true);
});

test('a policy that cannot be read or classified exits 2 with one stderr line and no stack', () => {
  const f = rawFile(CLEAN_SPEC);
  const unreadable = exec(['classify', '--body-file', f, '--repo-root', NO_POLICY_ROOT], {
    policy: () => { throw Object.assign(new Error('permission denied'), { code: 'EACCES' }); },
  });
  const badGlobs = exec(['settle', '--body-file', f, '--headless', '--repo-root', NO_POLICY_ROOT], {
    policy: () => ({ controlMode: true, extraCategories: [], pathGlobs: { nope: ['a/**'] }, globsInvalid: false }),
  });
  const badExtra = exec(['settle', '--body-file', f, '--headless', '--repo-root', NO_POLICY_ROOT], {
    policy: () => ({ controlMode: true, extraCategories: ['Not A Slug'], pathGlobs: {}, globsInvalid: false }),
  });
  for (const r of [unreadable, badGlobs, badExtra]) {
    assert.strictEqual(r.code, 2);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(r.stderr.trim().split('\n').length, 1);
    assert.doesNotMatch(r.stderr, /\n\s+at /);
  }
  assert.match(unreadable.stderr, /EACCES|permission denied/);
  assert.strictEqual(fs.readFileSync(f, 'utf8'), CLEAN_SPEC);
});

test('--repo-root defaults to the git top level through deps.execFile, falling back to cwd', () => {
  const f = rawFile(CLEAN_SPEC);
  const seen = [];
  const policy = (root) => { seen.push(root); return { controlMode: false, extraCategories: [], pathGlobs: {}, globsInvalid: false }; };
  const calls = [];
  exec(['classify', '--body-file', f], {
    policy,
    cwd: () => '/the/cwd',
    execFile: (file, args, cwd) => { calls.push([file, args, cwd]); return '/the/top\n'; },
  });
  exec(['classify', '--body-file', f], { policy, cwd: () => '/the/cwd', execFile: () => { throw new Error('not a repo'); } });
  exec(['classify', '--body-file', f, '--repo-root', '/explicit'], { policy, cwd: () => '/the/cwd', execFile: () => { throw new Error('must not run'); } });
  assert.deepStrictEqual(calls, [['git', ['rev-parse', '--show-toplevel'], '/the/cwd']]);
  assert.deepStrictEqual(seen.map((p) => path.resolve(p)), [path.resolve('/the/top'), path.resolve('/the/cwd'), path.resolve('/explicit')]);
});

test('a real spawn of the bin returns the JSON envelope on stdout and honours the exit codes', () => {
  const f = rawFile(SPEC_WITH_MIGRATIONS_PATH);
  const stdout = execFileSync(process.execPath, [BIN, 'classify', '--body-file', f, '--repo-root', NO_POLICY_ROOT], { encoding: 'utf8', windowsHide: true });
  const out = JSON.parse(stdout);
  assert.deepStrictEqual([out.flags.map((x) => x.slug), out.kept, out.entry.status], [['migrations'], ['migrations'], 'unclassified']);
  assert.strictEqual(stdout.trim().split('\n').length, 1);

  const settled = spawnSync(process.execPath, [BIN, 'settle', '--body-file', f, '--headless', '--repo-root', NO_POLICY_ROOT], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(settled.status, 0);
  assert.deepStrictEqual(JSON.parse(settled.stdout).flags, ['migrations']);
  assert.match(fs.readFileSync(f, 'utf8'), /^Risk-flags: migrations$/m);

  const bad = spawnSync(process.execPath, [BIN, 'settle', '--body-file', f], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(bad.status, 2);
  assert.strictEqual(bad.stdout, '');
  assert.match(bad.stderr, /^risk-flags\.js: /);

  const missing = spawnSync(process.execPath, [BIN, 'classify', '--body-file', path.join(TMP, 'absent.md')], { encoding: 'utf8', windowsHide: true });
  assert.strictEqual(missing.status, 1);
});
