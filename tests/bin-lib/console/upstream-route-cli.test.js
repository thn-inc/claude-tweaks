'use strict';
// #4621: console-resolve.js --upstream-route — the per-item shape that routes a U# under control mode at every
// ceiling (at `unattended` a repeat of the resolve shape's in-process route is idempotent). Fixture helpers copied
// from control-mode-cli.test.js, which stays byte-unmodified.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..', '..', '..');
const CLI = path.join(ROOT, 'plugin', 'bin', 'console-resolve.js');
const { run, EXIT_CARRY_FAILED } = require(CLI);
const { initRepo } = require('../../helpers/git-fixtures');

function mainCheckoutWithRun({ autonomy = 'unattended', staged = {}, decisions = '', policyExtra = '', consoleJson = null } = {}) {
  const root = fs.realpathSync(scratchDir('console-resolve-up-cli-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  initRepo(root, { name: 't', email: 't@example.invalid', cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); git('commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), `${autonomy === null ? '' : `autonomy: ${autonomy}\n`}${policyExtra}`);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), decisions);
  for (const [n, b] of Object.entries(staged)) fs.writeFileSync(path.join(runDir, 'staged', n), b);
  if (consoleJson !== null) fs.writeFileSync(path.join(runDir, 'console.json'), consoleJson);
  return { root, runDir };
}

// answers: an optional map from the whole command line (`git remote get-url origin`) to the stdout to return,
// or to an Error to throw; it is consulted before the defaults below.
function fakeExec(calls, root, answers = {}) {
  return (cmd, args) => {
    calls.push([cmd, ...args]);
    const answer = answers[`${cmd} ${args.join(' ')}`];
    if (answer instanceof Error) throw answer;
    if (answer !== undefined) return answer;
    if (cmd === 'git' && args[0] === 'rev-parse') return `${root}\n`;
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
}

function baseDeps(fx, calls, over = {}) {
  let out = '';
  let err = '';
  const d = { cwd: () => fx.root, mainRoot: fx.root, stdout: (s) => { out += s; }, stderr: (s) => { err += s; }, now: () => Date.parse('2026-09-06T12:00:00Z'), execFile: fakeExec(calls, fx.root), ...over };
  return { d, out: () => out, err: () => err };
}

const CM = 'control-mode: on\n';
const BASE_POLICY_KEY = 'git show origin/main:.claude-tweaks/policy.yml';
const ownershipAnswers = (over = {}) => ({
  'git remote get-url origin': 'https://github.com/thn-inc/claude-tweaks.git\n',
  'git rev-parse --abbrev-ref origin/HEAD': 'origin/main\n',
  [BASE_POLICY_KEY]: 'owned-owners: obra\n',
  ...over,
});
const upstreamDraft = (target) => `<!-- upstream-target: ${target} -->\nTitle: dispatch: x\n\nbody of the draft\n`;
const OWNED = 'wrap-up-upstream-1.md';
const EXTERNAL = 'wrap-up-upstream-2.md';
const STAGED = { [OWNED]: upstreamDraft('thn-inc/claude-tweaks'), [EXTERNAL]: upstreamDraft('acme/widgets') };
const FACT_ID = (id) => `decision:upstream:${id}`;
const FACTS = (fx) => path.join(fx.runDir, 'packet-facts', 'decisions.json');
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const decisionsOf = (fx) => fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
const consolePath = (fx) => path.join(fx.runDir, 'console.json');
const consoleOf = (items) => `${JSON.stringify({ resolved: true, mode: 'auto-resolve', at: '2026-09-06T12:00:00.000Z', ceiling: 'unattended', items, filings: [] }, null, 2)}\n`;
const filedItem = (id) => ({ id, section: 'Upstream feedback', resolution: 'filed', reason: 'unattended files upstream feedback like M#/Q# (#347)' });
const fixture = ({ autonomy = 'trusted', policyExtra = CM, ...extra } = {}) => mainCheckoutWithRun({ autonomy, policyExtra, staged: STAGED, ...extra });

async function route(fx, args, answers = ownershipAnswers(), over = {}) {
  const calls = [];
  const b = baseDeps(fx, calls, { execFile: fakeExec(calls, fx.root, answers), ...over });
  const code = await run(['--run', fx.runDir, '--upstream-route', ...args], b.d);
  return { code, calls, out: b.out(), err: b.err() };
}
const routeId = (fx, id, ...more) => route(fx, [id, ...more]);
const upstreamLines = (fx) => decisionsOf(fx).split('\n').filter((l) => /Upstream filing:/.test(l));
const snapshotFiles = (fx) => ({
  decisions: decisionsOf(fx),
  console: fs.existsSync(consolePath(fx)) ? fs.readFileSync(consolePath(fx), 'utf8') : null,
  packetFacts: fs.existsSync(path.join(fx.runDir, 'packet-facts')),
});

test('AC8.2: autonomy trusted with control mode on routes an owned target to file and writes nothing', async () => {
  const fx = fixture();
  const before = snapshotFiles(fx);
  const r = await routeId(fx, OWNED);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, `console-resolve.js: upstream-route ${OWNED} file target thn-inc/claude-tweaks reason none\n`);
  assert.deepStrictEqual(snapshotFiles(fx), before, 'a file verdict writes nothing');
  assert.ok(!r.calls.some((c) => c[0] === 'gh'), JSON.stringify(r.calls));
});

test('an external target at trusted holds, writes the decision fact and logs one line', async () => {
  const fx = fixture();
  const r = await routeId(fx, EXTERNAL);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, `console-resolve.js: upstream-route ${EXTERNAL} hold target acme/widgets reason external fact ${FACT_ID(EXTERNAL)}\n`);
  const facts = readJson(FACTS(fx));
  assert.deepStrictEqual(facts.map((f) => f.id), [FACT_ID(EXTERNAL)]);
  assert.strictEqual(facts[0].kind, 'decision');
  assert.strictEqual(facts[0].origin, 'upstream');
  assert.match(facts[0].summary, /acme\/widgets/);
  assert.match(facts[0].summary, /external/);
  const lines = upstreamLines(fx);
  assert.strictEqual(lines.length, 1, decisionsOf(fx));
  assert.match(lines[0], new RegExp(`^- AUTO \\d\\d:\\d\\d:\\d\\d — Review Console: Upstream filing: ${EXTERNAL} held for the acceptance packet as ${FACT_ID(EXTERNAL)} — external\\. Reversibility: n/a\\.$`));
  assert.ok(!fs.existsSync(consolePath(fx)), 'no console.json is created');
});

for (const [reason, detail, prefix] of [['filing-failed', 'gh: permission denied', 'AC9.1'], ['scrub-hit', 'internal path', 'AC9.2']]) {
  test(`${prefix}: --hold ${reason} on an owned item carries it to the packet naming the reason and rewrites its filed console item`, async () => {
    const fx = fixture({ consoleJson: consoleOf([filedItem(OWNED), filedItem(EXTERNAL)]) });
    const r = await routeId(fx, OWNED, '--hold', reason, '--reason', detail);
    assert.strictEqual(r.code, 0, r.err);
    assert.strictEqual(r.out, `console-resolve.js: upstream-route ${OWNED} hold target thn-inc/claude-tweaks reason ${reason} fact ${FACT_ID(OWNED)}\n`);
    const facts = readJson(FACTS(fx));
    assert.strictEqual(facts.length, 1);
    assert.ok(facts[0].summary.includes(reason), facts[0].summary);
    // A scrub hit's detail names what the scanner matched, so it stays out of the packet fact (it is in decisions.md).
    assert.strictEqual(facts[0].summary.includes(detail), reason !== 'scrub-hit', facts[0].summary);
    assert.match(facts[0].suggestedResolution, /^fix the cause, then file the draft at /);
    const items = Object.fromEntries(readJson(consolePath(fx)).items.map((i) => [i.id, i]));
    assert.strictEqual(items[OWNED].resolution, 'carried');
    assert.strictEqual(items[OWNED].rewrittenFrom, 'filed');
    assert.ok(items[OWNED].reason.includes(FACT_ID(OWNED)) && items[OWNED].reason.includes(reason), items[OWNED].reason);
    assert.strictEqual(items[EXTERNAL].resolution, 'filed', 'another item is untouched');
    const lines = upstreamLines(fx);
    assert.strictEqual(lines.length, 1, decisionsOf(fx));
    assert.ok(lines[0].includes(`Upstream filing: ${OWNED} held for the acceptance packet as ${FACT_ID(OWNED)} — ${reason}: ${detail}.`), lines[0]);
    assert.ok(!r.calls.some((c) => c.join(' ') === BASE_POLICY_KEY), '--hold reads no ownership');
  });
}

test('AC4.3: --filed logs the owned filing naming repo and URL, at trusted and at unattended, leaving a filed console item filed', async () => {
  const url = 'https://github.com/thn-inc/claude-tweaks/issues/9';
  const trusted = fixture();
  const t = await routeId(trusted, OWNED, '--filed', url);
  assert.strictEqual(t.code, 0, t.err);
  const tLines = upstreamLines(trusted);
  assert.strictEqual(tLines.length, 1, decisionsOf(trusted));
  assert.ok(tLines[0].includes(`Upstream filing: ${OWNED} filed into thn-inc/claude-tweaks as ${url} (control mode: owned target, no prompt)`), tLines[0]);
  assert.match(tLines[0], /^- AUTO /);
  assert.ok(!fs.existsSync(path.join(trusted.runDir, 'packet-facts')), 'a filing writes no fact');

  const unattended = fixture({ autonomy: 'unattended', consoleJson: consoleOf([filedItem(OWNED)]) });
  const before = fs.readFileSync(consolePath(unattended), 'utf8');
  const u = await routeId(unattended, OWNED, '--filed', url);
  assert.strictEqual(u.code, 0, u.err);
  assert.strictEqual(upstreamLines(unattended).length, 1);
  assert.strictEqual(fs.readFileSync(consolePath(unattended), 'utf8'), before, 'console.json is not rewritten');
  assert.strictEqual(readJson(consolePath(unattended)).items[0].resolution, 'filed');
});

const skipLinesOf = (fx) => decisionsOf(fx).split('\n').filter((l) => /^- SKIP .*Upstream ownership/.test(l));

const stagedFile = (fx, id) => path.join(fx.runDir, 'staged', id);

test('--filed needs no staged file: after feedback --pre-confirmed deleted it, an owned URL still logs the filing naming the repo', async () => {
  const fx = fixture({ consoleJson: consoleOf([filedItem(OWNED)]) });
  fs.rmSync(stagedFile(fx, OWNED));
  const url = 'https://github.com/thn-inc/claude-tweaks/issues/9';
  const r = await routeId(fx, OWNED, '--filed', url);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, `console-resolve.js: upstream-route ${OWNED} file target thn-inc/claude-tweaks reason none\n`);
  const lines = upstreamLines(fx);
  assert.strictEqual(lines.length, 1, decisionsOf(fx));
  assert.ok(lines[0].includes(`Upstream filing: ${OWNED} filed into thn-inc/claude-tweaks as ${url} (control mode: owned target, no prompt)`), lines[0]);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
});

test('the URL, not the staged draft, names the target of a --filed call', async () => {
  const fx = fixture();
  // EXTERNAL's draft names acme/widgets, but the issue was filed into the owned repo: the URL decides.
  const owned = await routeId(fx, EXTERNAL, '--filed', 'https://github.com/obra/superpowers/issues/3');
  assert.strictEqual(owned.code, 0, owned.err);
  assert.ok(upstreamLines(fx)[0].includes(`Upstream filing: ${EXTERNAL} filed into obra/superpowers as https://github.com/obra/superpowers/issues/3`), decisionsOf(fx));
  // OWNED's draft names the owned repo, but the issue went elsewhere: hold verdict.
  const elsewhere = await routeId(fx, OWNED, '--filed', 'https://github.com/acme/widgets/issues/4');
  assert.strictEqual(elsewhere.code, 5, elsewhere.err);
  assert.ok(upstreamLines(fx)[1].includes(`Upstream filing: ${OWNED} filed as https://github.com/acme/widgets/issues/4 against a hold verdict (external)`), decisionsOf(fx));
});

test('--filed with an external URL exits 5 and logs the filing against the hold verdict, with no fact and no console rewrite', async () => {
  const fx = fixture({ consoleJson: consoleOf([filedItem(EXTERNAL)]) });
  fs.rmSync(stagedFile(fx, EXTERNAL));
  const consoleBefore = fs.readFileSync(consolePath(fx), 'utf8');
  const url = 'https://github.com/acme/widgets/issues/1';
  const r = await routeId(fx, EXTERNAL, '--filed', url);
  assert.strictEqual(r.code, 5, r.err);
  assert.match(r.err, /hold/);
  const lines = upstreamLines(fx);
  assert.strictEqual(lines.length, 1, decisionsOf(fx));
  assert.match(lines[0], /^- AUTO /);
  assert.ok(lines[0].includes(`Upstream filing: ${EXTERNAL} filed as ${url} against a hold verdict (external). Reversibility: n/a.`), lines[0]);
  assert.ok(!lines[0].includes('route changed'), 'the wording claims no earlier file route');
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')), 'no fact is written');
  assert.strictEqual(fs.readFileSync(consolePath(fx), 'utf8'), consoleBefore, 'console.json is untouched');
});

test('--filed with a URL that is not a strict issue URL is an unresolved target: exit 5, logged, no ownership read', async () => {
  for (const url of [
    'https://github.com/thn-inc/claude-tweaks/pull/9',
    'http://github.com/thn-inc/claude-tweaks/issues/9',
    'https://github.com/thn-inc/claude-tweaks/issues/9/extra',
    'https://github.com/thn-inc/claude-tweaks/issues/9?x=1',
    'https://github.com/thn-inc/claude-tweaks/issues/9#issuecomment-1',
    'https://github.com/thn-inc/claude-tweaks/issues/9x',
    'https://github.com/thn-inc/claude-tweaks/issues/0',
    'https://github.com/thn-inc/claude-tweaks/issues/09',
    'https://github.com/thn-inc/claude-tweaks/issues/',
    'https://github.com.evil.example/thn-inc/claude-tweaks/issues/9',
    'https://evilgithub.com/thn-inc/claude-tweaks/issues/9',
    'https://gist.github.com/thn-inc/claude-tweaks/issues/9',
    'https://github.com/-bad/claude-tweaks/issues/9',
    'https://github.com/thn-inc/../issues/9',
    'github.com/thn-inc/claude-tweaks/issues/9',
  ]) {
    const fx = fixture();
    const r = await routeId(fx, OWNED, '--filed', url);
    assert.strictEqual(r.code, 5, `${url}: ${r.err}`);
    const lines = upstreamLines(fx);
    assert.strictEqual(lines.length, 1, `${url}: ${decisionsOf(fx)}`);
    assert.ok(lines[0].includes(`Upstream filing: ${OWNED} filed as ${url} against a hold verdict (external)`), lines[0]);
    assert.ok(!r.calls.some((c) => c.includes('get-url') || c[1] === 'show'), `${url}: ownership read for an unresolved target`);
    assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')), url);
  }
});

test('a decisions.md entry that cannot be written on the hold-verdict --filed path exits 3 and says the issue was filed', async () => {
  const fx = fixture();
  fs.rmSync(path.join(fx.runDir, 'decisions.md'));
  fs.mkdirSync(path.join(fx.runDir, 'decisions.md'));
  const url = 'https://github.com/acme/widgets/issues/1';
  const r = await routeId(fx, EXTERNAL, '--filed', url);
  assert.strictEqual(r.code, 3, r.err);
  assert.ok(r.err.includes(`${url} was filed`), r.err);
  assert.match(r.err, /decisions\.md entry could not be written/);
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
});

test('a decisions.md entry that cannot be written on the owned --filed path exits 3', async () => {
  const fx = fixture();
  fs.rmSync(path.join(fx.runDir, 'decisions.md'));
  fs.mkdirSync(path.join(fx.runDir, 'decisions.md'));
  const r = await routeId(fx, OWNED, '--filed', 'https://github.com/thn-inc/claude-tweaks/issues/9');
  assert.strictEqual(r.code, 3, r.err);
  assert.match(r.err, /decisions\.md entry could not be written/);
});

test('--hold and the no-modifier route still need the staged draft, and --filed still needs a valid id', async () => {
  const fx = fixture();
  const url = 'https://github.com/thn-inc/claude-tweaks/issues/9';
  fs.rmSync(stagedFile(fx, OWNED));
  assert.strictEqual((await routeId(fx, OWNED, '--hold', 'filing-failed', '--reason', 'x')).code, 5);
  assert.strictEqual((await routeId(fx, OWNED)).code, 5);
  for (const id of ['../x', 'upstream-draft-1.md', 'wrap-up-upstream-a/b', 'wrap-up-upstream-a b', 'wrap-up-upstream-']) {
    const r = await routeId(fx, id, '--filed', url);
    assert.strictEqual(r.code, 5, `${id}: ${r.err}`);
    assert.strictEqual(upstreamLines(fx).length, 0, id);
  }
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
});

test('a route that flips between the route call and --filed still logs the real filing, with the ownership notes once', async () => {
  const fx = fixture();
  const url = 'https://github.com/thn-inc/claude-tweaks/issues/9';
  const first = await routeId(fx, OWNED);
  assert.strictEqual(first.code, 0, first.err);
  assert.match(first.out, / file target /);
  assert.strictEqual(upstreamLines(fx).length, 0, 'the route call alone logs no filing');
  // origin moved to another owner in between: the same item now routes to hold.
  const flipped = await route(fx, [OWNED, '--filed', url], ownershipAnswers({ 'git remote get-url origin': 'https://github.com/zeta/app.git\n', [BASE_POLICY_KEY]: new Error('fatal: gone') }));
  assert.strictEqual(flipped.code, 5, flipped.err);
  const lines = upstreamLines(fx);
  assert.strictEqual(lines.length, 1, decisionsOf(fx));
  assert.ok(lines[0].includes(`Upstream filing: ${OWNED} filed as ${url} against a hold verdict (external)`), lines[0]);
  assert.strictEqual(skipLinesOf(fx).length, 1, 'the hold-verdict path logs what the ownership read could not do');
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
});

test('ownership notes are logged as SKIP lines here too, once per filing, in the same call as the decision line', async () => {
  const fx = fixture();
  const r = await routeId(fx, OWNED, '--filed', 'https://github.com/thn-inc/claude-tweaks/issues/9');
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(skipLinesOf(fx).length, 0, 'a clean read logs nothing');

  // The route call logs the notes; the --filed call that follows reads ownership again and logs none of them.
  const noisy = fixture();
  const failing = ownershipAnswers({ [BASE_POLICY_KEY]: new Error('fatal: path does not exist in origin/main') });
  const n = await route(noisy, [OWNED], failing);
  assert.strictEqual(n.code, 0, n.err);
  const skips = skipLinesOf(noisy);
  assert.strictEqual(skips.length, 1, decisionsOf(noisy));
  assert.match(skips[0], /condition: base-branch policy origin\/main:\.claude-tweaks\/policy\.yml could not be read .* → fallback: owned-owners read as \[\]/);
  assert.match(skips[0], /Reversibility: n\/a\.$/);
  const f = await route(noisy, [OWNED, '--filed', 'https://github.com/thn-inc/claude-tweaks/issues/9'], failing);
  assert.strictEqual(f.code, 0, f.err);
  assert.strictEqual(skipLinesOf(noisy).length, 1, `one filing, one set of notes: ${decisionsOf(noisy)}`);
  assert.strictEqual(upstreamLines(noisy).length, 1);

  const unresolved = fixture();
  const h = await route(unresolved, [OWNED], ownershipAnswers({ 'git remote get-url origin': new Error('fatal: No such remote origin') }));
  assert.strictEqual(h.code, 0, h.err);
  assert.match(h.out, /hold target thn-inc\/claude-tweaks reason owner-unresolved fact /);
  assert.strictEqual(decisionsOf(unresolved).split('\n').filter((l) => /^- SKIP .*Upstream ownership/.test(l)).length, 1);
  assert.match(upstreamLines(unresolved)[0], /— owner-unresolved\./);
});

test('control mode off prints unchanged and touches no file, for every modifier', async () => {
  for (const policyExtra of ['', 'control-mode: off\n']) {
    const fx = fixture({ autonomy: 'unattended', policyExtra, consoleJson: consoleOf([filedItem(EXTERNAL)]) });
    const before = snapshotFiles(fx);
    for (const args of [[EXTERNAL], [EXTERNAL, '--hold', 'filing-failed', '--reason', 'x'], [EXTERNAL, '--filed', 'https://github.com/acme/widgets/issues/1']]) {
      const r = await route(fx, args);
      assert.strictEqual(r.code, 0, r.err);
      assert.strictEqual(r.out, `console-resolve.js: upstream-route ${EXTERNAL} unchanged (control mode off)\n`);
      assert.ok(!r.calls.some((c) => c.includes('get-url') || c[1] === 'show'), 'no ownership read');
    }
    assert.deepStrictEqual(snapshotFiles(fx), before);
  }
});

test('a policy that cannot be read exits 3 with a stderr line and writes nothing, for every modifier (fail closed)', async () => {
  const unreadable = [
    ['policy.yml', (fx) => path.join(fx.root, '.claude-tweaks', 'policy.yml')],
    ['run config.yml', (fx) => path.join(fx.runDir, 'config.yml')],
  ];
  for (const [label, where] of unreadable) {
    const fx = fixture({ consoleJson: consoleOf([filedItem(EXTERNAL)]) });
    const p = where(fx);
    fs.rmSync(p, { force: true });
    fs.mkdirSync(p);
    const before = snapshotFiles(fx);
    for (const args of [[EXTERNAL], [EXTERNAL, '--hold', 'filing-failed', '--reason', 'x'], [EXTERNAL, '--filed', 'https://github.com/acme/widgets/issues/1']]) {
      const r = await route(fx, args);
      assert.strictEqual(r.code, 3, `${label} ${JSON.stringify(args)}: ${r.err}`);
      assert.strictEqual(r.out, '', `${label}: never prints unchanged`);
      assert.ok(r.err.startsWith(`console-resolve.js: upstream-route ${EXTERNAL} policy unreadable (`), r.err);
      assert.ok(!r.calls.some((c) => c.includes('get-url') || c[1] === 'show'), 'no ownership read');
    }
    assert.deepStrictEqual(snapshotFiles(fx), before, label);
  }
});

test('an absent policy.yml is not unreadable: it reads as control mode off, exit 0 unchanged', async () => {
  const fx = fixture();
  fs.rmSync(path.join(fx.root, '.claude-tweaks', 'policy.yml'));
  const before = snapshotFiles(fx);
  const r = await route(fx, [EXTERNAL], {}, { execFile: () => { throw new Error('git is gone'); } });
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, `console-resolve.js: upstream-route ${EXTERNAL} unchanged (control mode off)\n`);
  assert.deepStrictEqual(snapshotFiles(fx), before);
});

test('exit 5 under --filed is told apart by stdout: a hold verdict prints its line, a refused id prints nothing', async () => {
  const fx = fixture();
  const url = 'https://github.com/acme/widgets/issues/1';
  const held = await routeId(fx, EXTERNAL, '--filed', url);
  assert.strictEqual(held.code, 5, held.err);
  assert.strictEqual(held.out, `console-resolve.js: upstream-route ${EXTERNAL} hold target acme/widgets reason external filed ${url}\n`);
  const unparsed = await routeId(fx, OWNED, '--filed', 'https://github.com/thn-inc/claude-tweaks/pull/9');
  assert.strictEqual(unparsed.code, 5, unparsed.err);
  assert.strictEqual(unparsed.out, `console-resolve.js: upstream-route ${OWNED} hold target none reason external filed https://github.com/thn-inc/claude-tweaks/pull/9\n`);
  assert.strictEqual(upstreamLines(fx).length, 2, 'both hold-verdict filings are logged');
  const refused = await routeId(fx, '../x', '--filed', url);
  assert.strictEqual(refused.code, 5, refused.err);
  assert.strictEqual(refused.out, '', 'a refused id prints nothing on stdout');
  assert.strictEqual(upstreamLines(fx).length, 2, 'a refused id logs nothing');
});

test('a crafted target marker is never echoed: stdout reads target none and the fact reads unresolved', async () => {
  const crafted = 'x reason none fact y';
  const fx = mainCheckoutWithRun({ autonomy: 'trusted', policyExtra: CM, staged: { [OWNED]: `<!-- upstream-target: ${crafted} -->\nTitle: x\n\nbody\n` } });
  const r = await routeId(fx, OWNED);
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, `console-resolve.js: upstream-route ${OWNED} hold target none reason external fact ${FACT_ID(OWNED)}\n`);
  const [fact] = readJson(FACTS(fx));
  assert.ok(fact.summary.includes('target unresolved'), fact.summary);
  for (const field of ['summary', 'text', 'suggestedResolution']) assert.ok(!fact[field].includes(crafted), `${field}: ${fact[field]}`);
  assert.ok(!decisionsOf(fx).includes(crafted), decisionsOf(fx));
});

test('at unattended a route call after the resolve shape is idempotent: owned reads file and writes nothing, carried holds with no second fact', async () => {
  const carried = { ...filedItem(EXTERNAL), resolution: 'carried', carriedFrom: 'filed', reason: `carried to the acceptance packet as ${FACT_ID(EXTERNAL)} — held: external` };
  const fx = fixture({ autonomy: 'unattended', consoleJson: consoleOf([filedItem(OWNED), carried]) });
  const consoleBefore = fs.readFileSync(consolePath(fx), 'utf8');
  const before = snapshotFiles(fx);
  const owned = await routeId(fx, OWNED);
  assert.strictEqual(owned.code, 0, owned.err);
  assert.match(owned.out, / file target thn-inc\/claude-tweaks reason none\n$/);
  assert.deepStrictEqual(snapshotFiles(fx), before, 'an owned repeat writes nothing');
  for (let i = 0; i < 2; i++) {
    const held = await routeId(fx, EXTERNAL);
    assert.strictEqual(held.code, 0, held.err);
    assert.match(held.out, / hold target acme\/widgets reason external fact /);
  }
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), [FACT_ID(EXTERNAL)], 'one fact, however many calls');
  assert.strictEqual(fs.readFileSync(consolePath(fx), 'utf8'), consoleBefore, 'a carried item is not rewritten again');
});

test('a repeated --hold writes one fact (merge by id, first copy wins) and logs again', async () => {
  const fx = fixture();
  assert.strictEqual((await routeId(fx, OWNED, '--hold', 'filing-failed', '--reason', 'first failure')).code, 0);
  assert.strictEqual((await routeId(fx, OWNED, '--hold', 'scrub-hit', '--reason', 'second failure')).code, 0);
  const facts = readJson(FACTS(fx));
  assert.strictEqual(facts.length, 1);
  assert.ok(facts[0].summary.includes('first failure'), facts[0].summary);
  assert.strictEqual(upstreamLines(fx).length, 2);
});

test('--hold rewrites only a console item held as filed: a pending item, a missing item and a PR-rendered console are left alone', async () => {
  const pending = { ...filedItem(OWNED), resolution: 'pending' };
  const a = fixture({ consoleJson: consoleOf([pending]) });
  const aBefore = fs.readFileSync(consolePath(a), 'utf8');
  assert.strictEqual((await routeId(a, OWNED, '--hold', 'filing-failed', '--reason', 'x')).code, 0);
  assert.strictEqual(fs.readFileSync(consolePath(a), 'utf8'), aBefore);

  const b = fixture({ consoleJson: consoleOf([filedItem(EXTERNAL)]) });
  const bBefore = fs.readFileSync(consolePath(b), 'utf8');
  assert.strictEqual((await routeId(b, OWNED, '--hold', 'filing-failed', '--reason', 'x')).code, 0);
  assert.strictEqual(fs.readFileSync(consolePath(b), 'utf8'), bBefore);

  const prRendered = `${JSON.stringify({ resolved: false, prNumber: 7, items: [filedItem(OWNED)] })}\n`;
  const c = fixture({ consoleJson: prRendered });
  assert.strictEqual((await routeId(c, OWNED, '--hold', 'filing-failed', '--reason', 'x')).code, 0);
  assert.strictEqual(fs.readFileSync(consolePath(c), 'utf8'), prRendered);
  for (const fx of [a, b, c]) assert.strictEqual(readJson(FACTS(fx)).length, 1, 'the fact lands whatever the console holds');
});

test('a staged file with no upstream-target line holds as external with target none', async () => {
  const fx = mainCheckoutWithRun({ autonomy: 'trusted', policyExtra: CM, staged: { 'wrap-up-upstream-9.md': 'Title: old\n\nbody\n' } });
  const r = await route(fx, ['wrap-up-upstream-9.md'], ownershipAnswers({ [BASE_POLICY_KEY]: new Error('unreadable') }));
  assert.strictEqual(r.code, 0, r.err);
  assert.strictEqual(r.out, `console-resolve.js: upstream-route wrap-up-upstream-9.md hold target none reason external fact ${FACT_ID('wrap-up-upstream-9.md')}\n`);
  // The verdict is `external` from the target alone, so ownership is neither read nor logged about.
  assert.ok(!r.calls.some((c) => c.includes('get-url') || c[1] === 'show'), JSON.stringify(r.calls));
  assert.strictEqual(skipLinesOf(fx).length, 0, decisionsOf(fx));

  const malformed = mainCheckoutWithRun({ autonomy: 'trusted', policyExtra: CM, staged: { [OWNED]: '<!-- upstream-target: not a repo -->\nTitle: x\n\nbody\n' } });
  const m = await route(malformed, [OWNED], ownershipAnswers({ [BASE_POLICY_KEY]: new Error('unreadable') }));
  assert.strictEqual(m.code, 0, m.err);
  assert.match(m.out, / hold target none reason external fact /);
  assert.ok(!m.calls.some((c) => c.includes('get-url') || c[1] === 'show'), JSON.stringify(m.calls));
  assert.strictEqual(skipLinesOf(malformed).length, 0);
});

test('a fact that cannot be written exits 6 and leaves console.json and decisions.md untouched', async () => {
  const fx = fixture({ consoleJson: consoleOf([filedItem(OWNED)]) });
  fs.mkdirSync(path.join(fx.runDir, 'packet-facts'), { recursive: true });
  fs.writeFileSync(FACTS(fx), '{ not json');
  const before = snapshotFiles(fx);
  const r = await routeId(fx, OWNED, '--hold', 'filing-failed', '--reason', 'x');
  assert.strictEqual(r.code, EXIT_CARRY_FAILED, r.err);
  assert.match(r.err, new RegExp(OWNED.replace(/\./g, '\\.')));
  assert.deepStrictEqual(snapshotFiles(fx), before);
  assert.strictEqual(fs.readFileSync(FACTS(fx), 'utf8'), '{ not json', 'an unreadable facts file is never overwritten');
});

test('a decisions.md entry that cannot be written exits 3 and names what was written', async () => {
  const fx = fixture({ consoleJson: consoleOf([filedItem(OWNED)]) });
  fs.rmSync(path.join(fx.runDir, 'decisions.md'));
  fs.mkdirSync(path.join(fx.runDir, 'decisions.md'));
  const r = await routeId(fx, OWNED, '--hold', 'filing-failed', '--reason', 'x');
  assert.strictEqual(r.code, 3, r.err);
  assert.match(r.err, /decisions\.md entry could not be written/);
  assert.match(r.err, /console item carried/);
  assert.ok(fs.existsSync(FACTS(fx)));
  const item = readJson(consolePath(fx)).items[0];
  assert.strictEqual(item.resolution, 'carried', 'the message claims the console item carried, so it is');
  assert.strictEqual(item.rewrittenFrom, 'filed');
});

// A fresh copy of the CLI whose rewriteItemResolution is `fake`: the write that throws or refuses after the
// pre-read cannot be provoked deterministically from outside (it is a race), so the seam is the module export.
function runWithRewrite(fake, argv, deps) {
  const itemResolution = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'item-resolution'));
  const real = itemResolution.rewriteItemResolution;
  itemResolution.rewriteItemResolution = fake;
  delete require.cache[CLI];
  try {
    return require(CLI).run(argv, deps);
  } finally {
    itemResolution.rewriteItemResolution = real;
    delete require.cache[CLI];
  }
}

test('a console.json rewrite that throws after the fact landed exits 3 and says the fact is in decisions.json', async () => {
  const fx = fixture({ consoleJson: consoleOf([filedItem(OWNED)]) });
  const b = baseDeps(fx, []);
  const code = await runWithRewrite(() => { throw new Error('disk full'); }, ['--run', fx.runDir, '--upstream-route', OWNED, '--hold', 'filing-failed', '--reason', 'x'], b.d);
  assert.strictEqual(code, 3, b.err());
  assert.match(b.err(), /disk full/);
  assert.ok(b.err().includes(`the decision fact ${FACT_ID(OWNED)} is in decisions.json`), b.err());
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), [FACT_ID(OWNED)]);
  assert.strictEqual(upstreamLines(fx).length, 0, 'no line claims the item held');
  assert.strictEqual(readJson(consolePath(fx)).items[0].resolution, 'filed');
});

test('a console.json rewrite that is refused after the fact landed exits 5 and says the fact is in decisions.json', async () => {
  const fx = fixture({ consoleJson: consoleOf([filedItem(OWNED)]) });
  const b = baseDeps(fx, []);
  const code = await runWithRewrite(() => ({ status: 'refused', why: 'item changed under us' }), ['--run', fx.runDir, '--upstream-route', OWNED, '--hold', 'scrub-hit', '--reason', 'x'], b.d);
  assert.strictEqual(code, 5, b.err());
  assert.match(b.err(), /item changed under us/);
  assert.ok(b.err().includes(`the decision fact ${FACT_ID(OWNED)} is in decisions.json`), b.err());
  assert.deepStrictEqual(readJson(FACTS(fx)).map((f) => f.id), [FACT_ID(OWNED)]);
  assert.strictEqual(upstreamLines(fx).length, 0);
});

test('--hold without --reason exits 2, as do a --hold value outside filing-failed|scrub-hit, --hold with --filed, and --reason or --filed misuse', async () => {
  const fx = fixture();
  const before = snapshotFiles(fx);
  const url = 'https://github.com/thn-inc/claude-tweaks/issues/9';
  for (const args of [
    [OWNED, '--hold', 'filing-failed'],
    [OWNED, '--hold', 'external', '--reason', 'x'],
    [OWNED, '--hold', 'owner-unresolved', '--reason', 'x'],
    [OWNED, '--hold', 'filing-failed', '--reason', 'x', '--filed', url],
    [OWNED, '--reason', 'x'],
    [OWNED, '--filed', 'two words'],
    [OWNED, '--filed', 'line\nbreak'],
    [OWNED, '--filed', ''],
    [OWNED, '--hold', 'filing-failed', '--reason', ''],
    ['', '--hold', 'filing-failed', '--reason', 'x'],
  ]) {
    const r = await route(fx, args);
    assert.strictEqual(r.code, 2, `${JSON.stringify(args)}: ${r.err}`);
    assert.ok(r.out === '', r.out);
  }
  assert.deepStrictEqual(snapshotFiles(fx), before);
});

test('--upstream-route takes no other shape flag, and --hold / --filed need --upstream-route', async () => {
  const fx = fixture();
  const items = path.join(fx.root, 'items.json');
  fs.writeFileSync(items, '[]');
  for (const args of [
    ['--run', fx.runDir, '--upstream-route', OWNED, '--ceiling'],
    ['--run', fx.runDir, '--upstream-route', OWNED, '--policy', 'console-auto'],
    ['--run', fx.runDir, '--upstream-route', OWNED, '--set-item', OWNED, '--resolution', 'carried', '--reason', 'x'],
    ['--run', fx.runDir, '--upstream-route', OWNED, '--converge', items],
    ['--run', fx.runDir, '--upstream-route', OWNED, '--check-repair', items],
    ['--run', fx.runDir, '--upstream-route', OWNED, '--memory-write', 'a', '--memory-dir', fx.root, '--content-file', items],
    ['--run', fx.runDir, '--upstream-route', OWNED, '--dry-run'],
    ['--run', fx.runDir, '--upstream-route', OWNED, '--json'],
    ['--run', fx.runDir, '--upstream-route', OWNED, '--ledger', items],
    ['--run', fx.runDir, '--hold', 'filing-failed', '--reason', 'x', '--policy', 'console-auto'],
    ['--run', fx.runDir, '--filed', 'https://github.com/a/b/issues/1', '--ceiling'],
    ['--run', fx.runDir, '--hold', 'filing-failed', '--set-item', OWNED, '--resolution', 'carried', '--reason', 'x'],
  ]) {
    const b = baseDeps(fx, []);
    assert.strictEqual(await run(args, b.d), 2, `${JSON.stringify(args)}: ${b.err()}`);
  }
});

test('an id outside wrap-up-upstream-* or naming no staged file exits 5, even with control mode off', async () => {
  const fx = fixture({ staged: { ...STAGED, 'upstream-draft-1.md': 'x', 'ledger-record-1.md': 'x' } });
  fs.mkdirSync(path.join(fx.runDir, 'staged', 'wrap-up-upstream-dir'));
  // Any whitespace in an id is refused (the hold line collapses every \s), so a real file named so still exits 5.
  fs.writeFileSync(path.join(fx.runDir, 'staged', 'wrap-up-upstream-sp ace.md'), upstreamDraft('thn-inc/claude-tweaks'));
  fs.writeFileSync(path.join(fx.root, 'outside.md'), 'x');
  fs.symlinkSync(path.join(fx.root, 'outside.md'), path.join(fx.runDir, 'staged', 'wrap-up-upstream-link.md'));
  const before = snapshotFiles(fx);
  for (const id of ['../x', '../staged/wrap-up-upstream-1.md', 'wrap-up-upstream-../x', 'wrap-up-upstream-a/b', 'wrap-up-upstream-a\\b', 'upstream-draft-1.md', 'ledger-record-1.md', 'wrap-up-upstream-absent.md', 'wrap-up-upstream-dir', 'wrap-up-upstream-link.md', 'wrap-up-upstream-sp ace.md', 'wrap-up-upstream-']) {
    const r = await routeId(fx, id);
    assert.strictEqual(r.code, 5, `${id}: ${r.err}`);
    assert.strictEqual(r.out, '', `${id}: ${r.out}`);
  }
  const off = fixture({ autonomy: 'unattended', policyExtra: '' });
  assert.strictEqual((await routeId(off, '../x')).code, 5, 'the id check runs before the policy read');
  assert.deepStrictEqual(snapshotFiles(fx), before);
});

test('an unanchored --run exits 3 and writes nothing', async () => {
  const fx = fixture();
  const b = baseDeps(fx, [], { mainRoot: path.join(fx.root, 'elsewhere') });
  assert.strictEqual(await run(['--run', fx.runDir, '--upstream-route', EXTERNAL], b.d), 3, b.err());
  assert.ok(!fs.existsSync(path.join(fx.runDir, 'packet-facts')));
});

test('a staged file written with CRLF line endings still routes by its target', async () => {
  const fx = mainCheckoutWithRun({ autonomy: 'trusted', policyExtra: CM, staged: { [OWNED]: upstreamDraft('thn-inc/claude-tweaks').replace(/\n/g, '\r\n') } });
  const r = await routeId(fx, OWNED);
  assert.strictEqual(r.out, `console-resolve.js: upstream-route ${OWNED} file target thn-inc/claude-tweaks reason none\n`);
});
