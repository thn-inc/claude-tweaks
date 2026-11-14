'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runCliSync, spawnCli } = require('./helpers/run-cli');
const { gitRepo, fixtureGit } = require('./helpers/git-fixtures');
const { STUB_SKIP } = require('./helpers/path-stub');
const { chmodDenialSkip } = require('./helpers/root');
const { archiveRunDir } = require('../plugin/bin/lib/reconcile/archive-merged');
const { QA_STAMP_NAME } = require('../plugin/bin/lib/verify/qa-stamp');
const { readRecord, writeRecord, defaultFacets } = require('../plugin/bin/lib/issues/local-store');
const { LOCAL_START, LOCAL_END, MAX_PACKET_CHARS, PACKET_MARKER } = require('../plugin/bin/lib/wrap-up/packet-contract');

const BIN = path.join(__dirname, '..', 'plugin', 'bin', 'acceptance-packet.js');
const { run, parseArgs, droppedEntry } = require(BIN);

const H = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const MB = 'c'.repeat(40);
const HASH = 'f'.repeat(64);
const SCOPE_NOTE = 'verify-scope declaration not read — expected checks not derived';
const stagedLow = (loc) => `- STAGED 09:59:00 — Reproduction: lens "3a" finding ${loc} not reproduced. Staged to Review Console as low-confidence. Reversibility: high.`;
const elevated = (loc) => `- AUTO 10:00:00 — Reproduction: lens "3a" finding ${loc} elevated. Confirmed. Reversibility: high.`;

function tempDir(t) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-packet-')));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const writeJson = (file, value) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(value)); return file; };
const writeText = (file, text) => { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, text); return file; };
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

// A main checkout (`.git` is a directory) holding a run dir, plus an empty git dir.
function workspace(t) {
  const root = tempDir(t);
  fs.mkdirSync(path.join(root, '.git'));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  const gitDir = path.join(root, 'gitdir');
  fs.mkdirSync(gitDir);
  return { root, runDir, gitDir, file: (name) => path.join(root, 'work', name) };
}

function fakeGit({ revParse = {}, diff = null, log = '', mergeBase = null } = {}) {
  const calls = [];
  const git = (args) => {
    calls.push(args);
    if (args[0] === 'rev-parse') {
      const ref = args.at(-1);
      if (Object.hasOwn(revParse, ref)) return `${revParse[ref]}\n`;
      throw new Error(`unknown ref ${ref}`);
    }
    if (args[0] === 'diff') {
      if (diff === null) throw new Error('diff failed');
      return diff;
    }
    if (args[0] === 'log') return log;
    // The recording's destination check: exit 0 is ignored, so a stubbed run records as usual.
    if (args[0] === '-C' && args[2] === 'check-ignore') return '';
    if (args[0] === 'merge-base') {
      if (mergeBase === null) throw new Error('merge-base failed');
      return `${mergeBase}\n`;
    }
    throw new Error(`unexpected git ${args.join(' ')}`);
  };
  return { git, calls };
}

function harness(ws, overrides = {}) {
  const out = [];
  const err = [];
  const deps = {
    cwd: () => ws.root,
    mainRoot: ws.root,
    git: fakeGit().git,
    gh: (args) => { throw new Error(`unexpected gh ${args.join(' ')}`); },
    ghAvailable: () => true,
    gitDir: () => ws.gitDir,
    pinGhHost: () => {},
    stdout: (s) => out.push(s),
    stderr: (s) => err.push(s),
    ...overrides,
  };
  return { deps, stdout: () => out.join(''), stderr: () => err.join('') };
}

function gather(ws, extraArgs, overrides) {
  const h = harness(ws, overrides);
  const out = ws.file('facts.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const code = run(['gather', '--record', '7', '--out', out, ...extraArgs], h.deps);
  assert.equal(code, 0, h.stderr());
  return { facts: readJson(out), result: JSON.parse(h.stdout()), stderr: h.stderr() };
}

const idsOf = (facts, kind) => facts.facts.filter((f) => f.kind === kind).map((f) => f.id);
const factOf = (facts, id) => facts.facts.find((f) => f.id === id);
const REPORT = { checks: { tests: { command: 'npm test', exitCode: 0, summary: 'ok' } } };
const STALE_FACTS = '{"stale":"an earlier gather"}';

function writeStamp(gitDir, { sha = H, stories = [{ id: 'neg-x', file: 's.yaml', sha256: HASH }], reportPath } = {}) {
  writeJson(path.join(gitDir, QA_STAMP_NAME), { sha, dirty: false, stories, storiesDir: 'stories', ...(reportPath ? { reportPath } : {}) });
}

// ---- invocation ----

test('--help prints usage naming every exit code, and exits 0', () => {
  const out = [];
  assert.equal(run(['--help'], { stdout: (s) => out.push(s), stderr: () => {} }), 0);
  const usage = out.join('');
  for (const verb of ['snapshot', 'gather', 'render', 'post', 'local']) assert.match(usage, new RegExp(`acceptance-packet\\.js ${verb}`));
  assert.match(usage, /exit 4/);
});

test('--help after a subcommand prints usage with nothing else run', (t) => {
  const ws = workspace(t);
  const h = harness(ws);
  assert.equal(run(['post', '--help'], h.deps), 0);
  assert.match(h.stdout(), /usage:/);
});

test('run answers --help through the in-process runner', () => {
  const result = runCliSync(BIN, ['--help'], { fresh: true });
  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /usage:/);
});

test('a real subprocess refuses an unknown subcommand with exit 2 and the usage on stderr', () => {
  // real process: proves the script entry's exit code and stderr
  const result = spawnCli(BIN, ['frobnicate']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /acceptance-packet\.js: .*\n[\s\S]*usage:/);
});

for (const [name, argv] of [
  ['no subcommand', []],
  ['an unknown subcommand', ['frobnicate']],
  ['an inherited key as subcommand', ['constructor']],
  ['an unknown flag', ['local', '--record-file', 'a', '--body-file', 'b', '--nope']],
  ['a flag from another subcommand', ['local', '--record-file', 'a', '--body-file', 'b', '--record', '1']],
  ['a repeated flag', ['local', '--record-file', 'a', '--record-file', 'c', '--body-file', 'b']],
  ['a trailing value flag', ['local', '--record-file', 'a', '--body-file']],
  ['an empty value', ['local', '--record-file', '', '--body-file', 'b']],
  ['a flag as a value', ['local', '--record-file', '--pending', '--body-file', 'b']],
  ['a missing required flag', ['local', '--record-file', 'a']],
  ['a non-numeric --record', ['gather', '--record', 'x', '--out', 'o']],
  ['a zero --record', ['gather', '--record', '0', '--out', 'o']],
  ['a non-numeric --pr', ['post', '--record', '1', '--body-file', 'b', '--pr', '1x']],
]) {
  test(`${name} exits 2`, (t) => {
    const h = harness(workspace(t));
    assert.equal(run(argv, h.deps), 2);
    assert.match(h.stderr(), /usage:/);
  });
}

test('parseArgs returns the subcommand and its flags, integers as numbers', () => {
  const parsed = parseArgs(['post', '--record', '12', '--body-file', 'b', '--pr', '3']);
  assert.equal(parsed.command, 'post');
  assert.equal(parsed.opts.record, 12);
  assert.equal(parsed.opts.pr, 3);
  assert.equal(parsed.opts.bodyFile, 'b');
});

// ---- gather: verify, spec, declaration ----

test('gather joins a report and a spec into facts, and prints the counts', (t) => {
  const ws = workspace(t);
  const report = writeJson(ws.file('report.json'), REPORT);
  const spec = writeText(ws.file('spec.md'), '## Acceptance Criteria\n\n1. It works.\n');
  const { facts, result } = gather(ws, ['--report', report, '--spec', spec]);
  assert.equal(factOf(facts, 'check:tests').status, 'passed');
  assert.equal(factOf(facts, 'check:ac-1').status, 'not-run');
  assert.equal(facts.record, 7);
  assert.equal(result.out, ws.file('facts.json'));
  assert.equal(result.facts, facts.facts.length);
  assert.deepEqual(result.partial, facts.partial);
});

test('Q6: gather derives expected checks from the verify-scope declaration', (t) => {
  const ws = workspace(t);
  const report = writeJson(ws.file('report.json'), REPORT);
  const scope = writeJson(ws.file('scope.json'), { checks: { tests: { tests: 'npm test', journeys: 'x' }, lint: 'y' }, rules: [] });
  const { facts } = gather(ws, ['--report', report, '--scope', scope]);
  assert.equal(factOf(facts, 'check:tests').status, 'passed');
  assert.equal(factOf(facts, 'check:journeys').status, 'not-run');
  assert.equal(factOf(facts, 'check:lint').status, 'not-run');
});

test('Q6: with no --scope the declaration resolves against the cwd', (t) => {
  const ws = workspace(t);
  writeJson(path.join(ws.root, '.claude-tweaks', 'verify-scope.json'), { checks: { lint: 'y' }, rules: [] });
  const { facts } = gather(ws, []);
  assert.equal(factOf(facts, 'check:lint').status, 'not-run');
});

test('Q11: a missing verify-scope declaration expects no checks and states no partial', (t) => {
  const ws = workspace(t);
  const report = writeJson(ws.file('report.json'), REPORT);
  const { facts } = gather(ws, ['--report', report, '--scope', ws.file('absent.json')]);
  assert.deepEqual(idsOf(facts, 'check'), ['check:tests']);
  assert.ok(!facts.partial.includes(SCOPE_NOTE));
});

test('Q11: an invalid verify-scope declaration is a stated partial', (t) => {
  const ws = workspace(t);
  const scope = writeText(ws.file('scope.json'), '{not json');
  const { facts } = gather(ws, ['--scope', scope]);
  assert.ok(facts.partial.includes(SCOPE_NOTE));
});

// ---- gather: stories ----

test('Q13: only the QA report\'s stories become facts; the story file supplies the negative flag', (t) => {
  const ws = workspace(t);
  const stories = path.join(ws.root, 'stories');
  writeText(path.join(stories, 'a.yaml'), 'stories:\n  - id: neg-login\n  - id: happy\n  - id: other\n');
  const qa = writeJson(ws.file('qa.json'), { stories: [{ id: 'neg-login', status: 'PASS' }, { id: 'happy', status: 'FAIL', error: 'boom' }] });
  const { facts } = gather(ws, ['--stories-dir', stories, '--story-results', qa]);
  assert.deepEqual(idsOf(facts, 'story').sort(), ['story:happy', 'story:neg-login']);
  assert.equal(factOf(facts, 'story:neg-login').negative, true);
  assert.equal(factOf(facts, 'story:neg-login').status, 'passed');
  assert.equal(factOf(facts, 'story:happy').status, 'failed');
  assert.equal(factOf(facts, 'story:happy').reason, 'boom');
});

test('stories parse per file: a second file\'s tag still reaches its story, .yml included, other files ignored', (t) => {
  const ws = workspace(t);
  const stories = path.join(ws.root, 'stories');
  writeText(path.join(stories, 'a.yaml'), 'stories:\n  - id: first\n');
  writeText(path.join(stories, 'b.yml'), 'stories:\n  - id: tagged\n    tags: [negative]\n');
  writeText(path.join(stories, 'c.txt'), 'stories:\n  - id: plain\n    tags: [negative]\n');
  const qa = writeJson(ws.file('qa.json'), { stories: [{ id: 'tagged', status: 'PASS' }, { id: 'first', status: 'PASS' }, { id: 'plain', status: 'PASS' }] });
  const { facts } = gather(ws, ['--stories-dir', stories, '--story-results', qa]);
  assert.equal(factOf(facts, 'story:tagged').negative, true);
  assert.equal(factOf(facts, 'story:first').negative, false);
  assert.equal(factOf(facts, 'story:plain').negative, false);
});

test('a QA entry with no id lists no fact and is counted in the partial', (t) => {
  const ws = workspace(t);
  const qa = writeJson(ws.file('qa.json'), { stories: [{ status: 'PASS' }, { id: 'kept', status: 'PASS' }] });
  const { facts } = gather(ws, ['--story-results', qa]);
  assert.deepEqual(idsOf(facts, 'story'), ['story:kept']);
  assert.ok(facts.partial.includes('QA report entries with no story id, not listed: 1'));
});

test('an unreadable --story-results is a stated partial', (t) => {
  const ws = workspace(t);
  const qa = writeText(ws.file('qa.json'), '{not json');
  const { facts } = gather(ws, ['--story-results', qa]);
  assert.ok(facts.partial.includes('QA report not read — selected stories not listed'));
});

test('Q13: gather reads the QA pass stamp at HEAD', (t) => {
  const ws = workspace(t);
  const stories = path.join(ws.root, 'stories');
  writeText(path.join(stories, 's.yaml'), 'stories:\n  - id: neg-x\n  - id: other\n');
  writeStamp(ws.gitDir);
  const { git } = fakeGit({ revParse: { HEAD: H } });
  const { facts } = gather(ws, ['--stories-dir', stories], { git });
  assert.deepEqual(idsOf(facts, 'story'), ['story:neg-x']);
  assert.equal(factOf(facts, 'story:neg-x').status, 'passed');
  assert.equal(factOf(facts, 'story:neg-x').negative, true);
});

test('Q13: a stamp at another commit gives no story fact', (t) => {
  const ws = workspace(t);
  writeStamp(ws.gitDir);
  const { git } = fakeGit({ revParse: { HEAD: OTHER } });
  const { facts } = gather(ws, [], { git });
  assert.deepEqual(idsOf(facts, 'story'), []);
});

test('a gitDir that fails reads as no stamp, not a crash', (t) => {
  const ws = workspace(t);
  const { git } = fakeGit({ revParse: { HEAD: H } });
  const { facts } = gather(ws, [], { git, gitDir: () => { throw new Error('no git'); } });
  assert.deepEqual(idsOf(facts, 'story'), []);
});

// ---- gather: git ----

test('--head drives the diff, the log and the stamp comparison', (t) => {
  const ws = workspace(t);
  writeStamp(ws.gitDir, { sha: H });
  const { git, calls } = fakeGit({ revParse: { S: H, HEAD: OTHER }, diff: 'M\0a.js\0', log: `${H}\tsubject\n` });
  const { facts } = gather(ws, ['--base', 'B', '--head', 'S'], { git });
  assert.deepEqual(calls.find((c) => c[0] === 'diff'), ['diff', '--name-status', '-z', '--end-of-options', 'B...S']);
  assert.deepEqual(calls.find((c) => c[0] === 'log'), ['log', '--format=%H%x09%s', '--end-of-options', 'B..S']);
  assert.deepEqual(calls.find((c) => c[0] === 'rev-parse'), ['rev-parse', '--verify', '--end-of-options', 'S']);
  assert.ok(factOf(facts, 'story:neg-x'), 'a stamp at S yields its stories');
  assert.ok(factOf(facts, 'change:a.js'));
  assert.equal(factOf(facts, `change:commit-${H.slice(0, 7)}`).text, 'subject');
});

test('renames and unsafe paths survive, and the facts render', (t) => {
  const ws = workspace(t);
  const { git } = fakeGit({ diff: 'R100\0old.js\0new dir/+page.svelte\0C75\0src.js\0copy.js\0M\0b.js\0' });
  const { facts } = gather(ws, ['--base', 'B'], { git });
  const changes = idsOf(facts, 'change');
  assert.ok(changes.includes('change:new%20dir/%2Bpage.svelte'));
  assert.ok(changes.includes('change:copy.js'));
  assert.ok(changes.includes('change:b.js'));
  assert.ok(!changes.includes('change:old.js'));
  assert.ok(!changes.includes('change:src.js'));
  const narrative = writeJson(ws.file('narrative.json'), { schemaVersion: 1, claims: [] });
  const h = harness(ws);
  assert.equal(run(['render', '--facts', ws.file('facts.json'), '--narrative', narrative, '--out', ws.file('out.md')], h.deps), 0, h.stderr());
});

test('no base, a failed diff and a truncated diff each read as changes not gathered', (t) => {
  const note = 'git changes not gathered';
  const ws = workspace(t);
  assert.ok(gather(ws, []).facts.partial.includes(note));
  assert.ok(gather(ws, ['--base', 'B']).facts.partial.includes(note));
  const { git } = fakeGit({ diff: 'R100\0old.js\0' });
  const truncated = gather(ws, ['--base', 'B'], { git });
  assert.ok(truncated.facts.partial.includes(note));
  assert.deepEqual(idsOf(truncated.facts, 'change'), []);
});

// ---- gather: run dir ----

test('gather reads decisions and findings from --run, with no staged/ dir', (t) => {
  const ws = workspace(t);
  writeText(path.join(ws.runDir, 'decisions.md'), ['## /review', stagedLow('src/settled.js:4'), elevated('src/settled.js:4'), stagedLow('src/open.js:9'), ''].join('\n'));
  const { facts } = gather(ws, ['--run', ws.runDir]);
  const findings = facts.facts.filter((f) => f.kind === 'finding');
  assert.equal(findings.length, 1);
  assert.match(findings[0].text, /src\/open\.js:9/);
  assert.ok(!facts.partial.includes('review decisions log not found'));
});

test('a low-confidence item in the run dir reaches the rendered packet', (t) => {
  const ws = workspace(t);
  writeText(path.join(ws.runDir, 'decisions.md'), `${stagedLow('src/open.js:9')}\n`);
  writeText(path.join(ws.runDir, 'staged', 'review-unconfirmed-1.md'), 'Title: a staged doubt\n');
  const { facts } = gather(ws, ['--run', ws.runDir]);
  assert.equal(idsOf(facts, 'finding').length, 2);
  assert.ok(facts.facts.some((f) => f.text === 'a staged doubt'));
  const narrative = writeJson(ws.file('narrative.json'), {
    schemaVersion: 1,
    claims: [{ section: 'least-confident', text: 'the doubt to check first', refs: [idsOf(facts, 'finding')[0]] }],
  });
  const h = harness(ws);
  assert.equal(run(['render', '--facts', ws.file('facts.json'), '--narrative', narrative, '--out', ws.file('out.md')], h.deps), 0, h.stderr());
  assert.match(fs.readFileSync(ws.file('out.md'), 'utf8'), /### Least confident\n- the doubt to check first/);
});

test('a real read failure of the findings is a stated partial, never a clean empty section', (t) => {
  const ws = workspace(t);
  writeText(path.join(ws.runDir, 'decisions.md'), `${stagedLow('src/open.js:9')}\n`);
  const denied = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  const { facts } = gather(ws, ['--run', ws.runDir], { readdir: denied });
  assert.deepEqual(idsOf(facts, 'finding'), []);
  assert.ok(facts.partial.includes('review findings not read — low-confidence findings not listed'));
});

test('the real readdir reports a denied staged/ dir, where a missing one reads as empty', chmodDenialSkip('root: mode bits do not deny a read'), (t) => {
  const ws = workspace(t);
  writeText(path.join(ws.runDir, 'decisions.md'), `${stagedLow('src/open.js:9')}\n`);
  const staged = path.join(ws.runDir, 'staged');
  fs.mkdirSync(staged);
  fs.chmodSync(staged, 0o000);
  let facts;
  try {
    ({ facts } = gather(ws, ['--run', ws.runDir]));
  } finally {
    fs.chmodSync(staged, 0o755);
  }
  assert.ok(facts.partial.includes('review findings not read — low-confidence findings not listed'));
});

test('no --run reads no decisions log and no findings', (t) => {
  const ws = workspace(t);
  const { facts } = gather(ws, []);
  assert.ok(facts.partial.includes('review decisions log not found'));
  assert.deepEqual(idsOf(facts, 'finding'), []);
});

test('Q13: a logged selection with no QA record states the gap', (t) => {
  const ws = workspace(t);
  writeText(path.join(ws.runDir, 'decisions.md'), '- AUTO 10:00:00 — QA scoped: 2/9.\n');
  const { facts } = gather(ws, ['--run', ws.runDir]);
  assert.ok(facts.partial.includes('QA report not read — selected stories not listed'));
});

// ---- gather: pass-through inputs ----

test('--recordings is gone: an unknown argument, with no facts written', (t) => {
  const ws = workspace(t);
  const h = harness(ws);
  const out = ws.file('facts.json');
  const recordings = writeJson(ws.file('recordings.json'), [{ id: 'r1', text: 'walkthrough', url: 'https://videos.example/r1' }]);
  assert.equal(run(['gather', '--record', '7', '--out', out, '--recordings', recordings], h.deps), 2);
  assert.match(h.stderr(), /unknown argument: --recordings/);
  assert.throws(() => fs.statSync(out));
});

test('--flags, --decision-items, --links, the base urls, --surface, --deploy and --ac-results all reach the facts', (t) => {
  const ws = workspace(t);
  const flags = writeJson(ws.file('flags.json'), [{ id: 'f1', text: 'schema change' }]);
  const decisionItems = writeJson(ws.file('decisions.json'), [{ id: 'd1', text: 'pick one' }]);
  const links = writeJson(ws.file('links.json'), [
    { id: 'local', url: 'http://localhost:3000/a' },
    { id: 'dev', url: 'https://dev.example/b' },
    { id: 'off', url: 'https://elsewhere.example/c' },
  ]);
  const deploy = writeJson(ws.file('deploy.json'), { target: 'dev', live: true });
  const spec = writeText(ws.file('spec.md'), '## Acceptance Criteria\n\n1. It works.\n');
  const ac = writeJson(ws.file('ac.json'), { 1: 'met' });
  const { facts } = gather(ws, [
    '--flags', flags, '--decision-items', decisionItems, '--links', links,
    '--local-base-url', 'http://localhost:3000', '--dev-base-url', 'https://dev.example', '--surface', 'Web',
    '--deploy', deploy, '--spec', spec, '--ac-results', ac,
  ]);
  assert.equal(factOf(facts, 'flag:f1').text, 'schema change');
  assert.equal(factOf(facts, 'decision:d1').text, 'pick one');
  assert.ok(factOf(facts, 'link:local'));
  assert.ok(factOf(facts, 'link:dev'));
  assert.deepEqual(facts.refused.map((r) => r.id), ['link:off']);
  assert.equal(facts.surface, 'web');
  assert.equal(factOf(facts, 'deploy:status').text, 'target: dev, confirmed live');
  assert.equal(factOf(facts, 'check:ac-1').status, 'passed');
});

for (const flag of ['--flags', '--proofs', '--decision-items', '--links']) {
  test(`an unparseable or mis-shaped ${flag} file is a stated partial, not a crash`, (t) => {
    const ws = workspace(t);
    const note = `${flag} input not read — treated as absent`;
    assert.ok(gather(ws, [flag, writeText(ws.file('bad.json'), '{not json')]).facts.partial.includes(note));
    assert.ok(gather(ws, [flag, writeJson(ws.file('bad2.json'), [{ text: 'no id' }])]).facts.partial.includes(note));
    assert.ok(gather(ws, [flag, writeJson(ws.file('bad3.json'), [{ id: 'x', text: 5 }])]).facts.partial.includes(note));
  });
}

test('an unreadable --deploy or --ac-results is a stated partial', (t) => {
  const ws = workspace(t);
  const bad = writeText(ws.file('bad.json'), '[]');
  const { facts } = gather(ws, ['--deploy', bad, '--ac-results', bad]);
  assert.ok(facts.partial.includes('--deploy input not read — treated as absent'));
  assert.ok(facts.partial.includes('--ac-results input not read — treated as absent'));
  assert.equal(factOf(facts, 'deploy:status').target, 'local');
});

test('a story file that will not read is a stated partial', (t) => {
  const ws = workspace(t);
  const stories = path.join(ws.root, 'stories');
  fs.mkdirSync(path.join(stories, 'dir.yaml'), { recursive: true });
  const { facts } = gather(ws, ['--stories-dir', stories]);
  assert.ok(facts.partial.includes('--stories-dir input not read — treated as absent'));
});

const STORIES_NOTE = '--stories-dir input not read — treated as absent';

test('a stories dir gone with the worktree is a stated partial when a stamp lists a story', (t) => {
  const ws = workspace(t);
  writeStamp(ws.gitDir, { stories: [{ id: 'tag-only', file: 's.yaml', sha256: HASH }] });
  const { git } = fakeGit({ revParse: { HEAD: H } });
  const { facts } = gather(ws, ['--stories-dir', ws.file('none')], { git });
  assert.equal(factOf(facts, 'story:tag-only').status, 'passed');
  assert.ok(facts.partial.includes(STORIES_NOTE));
});

test('a stories dir gone with the worktree is a stated partial when the QA report lists a story', (t) => {
  const ws = workspace(t);
  const qa = writeJson(ws.file('qa.json'), { stories: [{ id: 'tag-only', status: 'PASS' }] });
  assert.ok(gather(ws, ['--stories-dir', ws.file('none'), '--story-results', qa]).facts.partial.includes(STORIES_NOTE));
});

test('a stories path that is a file reads as absent too', (t) => {
  const ws = workspace(t);
  const qa = writeJson(ws.file('qa.json'), { stories: [{ id: 'tag-only', status: 'PASS' }] });
  const file = writeText(ws.file('stories-file'), 'x');
  assert.ok(gather(ws, ['--stories-dir', path.join(file, 'stories'), '--story-results', qa]).facts.partial.includes(STORIES_NOTE));
});

test('Q13: a missing stories dir with nothing listed states no partial', (t) => {
  const ws = workspace(t);
  const { facts } = gather(ws, ['--stories-dir', ws.file('none')]);
  assert.ok(!facts.partial.includes(STORIES_NOTE));
});

test('a QA entry with no id does not count as a listed story', (t) => {
  const ws = workspace(t);
  const qa = writeJson(ws.file('qa.json'), { stories: [{ status: 'PASS' }] });
  assert.ok(!gather(ws, ['--stories-dir', ws.file('none'), '--story-results', qa]).facts.partial.includes(STORIES_NOTE));
});

test('an empty stories dir states the partial only when a story is listed, since its negative flag is lost', (t) => {
  const ws = workspace(t);
  const stories = path.join(ws.root, 'stories');
  fs.mkdirSync(stories);
  const qa = writeJson(ws.file('qa.json'), { stories: [{ id: 'x', status: 'PASS' }] });
  assert.ok(gather(ws, ['--stories-dir', stories, '--story-results', qa]).facts.partial.includes(STORIES_NOTE));
  assert.ok(!gather(ws, ['--stories-dir', stories]).facts.partial.includes(STORIES_NOTE));
});

test('a stories dir holding no story file counts as empty', (t) => {
  const ws = workspace(t);
  const stories = path.join(ws.root, 'stories');
  writeText(path.join(stories, 'README.md'), 'not a story file');
  const qa = writeJson(ws.file('qa.json'), { stories: [{ id: 'x', status: 'PASS' }] });
  assert.ok(gather(ws, ['--stories-dir', stories, '--story-results', qa]).facts.partial.includes(STORIES_NOTE));
});

test('a stories dir that is denied is a stated partial, with nothing listed', (t) => {
  const ws = workspace(t);
  const denied = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  assert.ok(gather(ws, ['--stories-dir', ws.file('none')], { listDir: denied }).facts.partial.includes(STORIES_NOTE));
});

test('gather with an unwritable --out exits 1', (t) => {
  const ws = workspace(t);
  const blocker = writeText(ws.file('blocker'), 'x');
  const h = harness(ws);
  assert.equal(run(['gather', '--record', '7', '--out', path.join(blocker, 'facts.json')], h.deps), 1);
  assert.match(h.stderr(), /--out/);
});

for (const [name, argsFor, overrides] of [
  ['a --run that is refused (exit 3)', (ws) => ['--run', path.join(ws.root, 'no-such-run')], {}],
  ['a facts write that fails (exit 1)', () => [], { writeFile: () => { throw new Error('disk full'); } }],
]) {
  test(`gather failing on ${name} removes an earlier --out`, (t) => {
    const ws = workspace(t);
    const out = writeText(ws.file('facts.json'), STALE_FACTS);
    const h = harness(ws, overrides);
    assert.notEqual(run(['gather', '--record', '7', '--out', out, ...argsFor(ws)], h.deps), 0);
    assert.throws(() => fs.statSync(out));
  });
}

test('gather that succeeds replaces an earlier --out rather than removing it', (t) => {
  const ws = workspace(t);
  writeText(ws.file('facts.json'), STALE_FACTS);
  assert.equal(gather(ws, []).facts.record, 7);
});

// ---- the run-dir boundary ----

function shadowFixture(t) {
  const root = tempDir(t);
  const main = path.join(root, 'main');
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  const wt = path.join(root, 'wt');
  fs.mkdirSync(wt);
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: elsewhere\n');
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', 'run-1');
  const decisions = writeText(path.join(shadow, 'decisions.md'), `${stagedLow('src/a.js:1')}\n`);
  return { main, shadow, decisions };
}

for (const [verb, extra] of [['gather', ['--record', '7']], ['snapshot', ['--base', 'B']]]) {
  test(`a run dir that fails the boundary check exits 3 for ${verb}, the shadow byte-unchanged`, (t) => {
    const ws = workspace(t);
    const { main, shadow, decisions } = shadowFixture(t);
    const before = fs.readFileSync(decisions, 'utf8');
    const { git, calls } = fakeGit({ revParse: { HEAD: H }, mergeBase: MB });
    const h = harness(ws, { mainRoot: main, git });
    const out = ws.file('facts.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const argv = [verb, '--run', shadow, ...extra, ...(verb === 'gather' ? ['--out', out] : [])];
    assert.equal(run(argv, h.deps), 3);
    assert.match(h.stderr(), /not anchored/);
    assert.equal(fs.readFileSync(decisions, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(shadow), ['decisions.md']);
    assert.deepEqual(calls, []);
    assert.throws(() => fs.statSync(out));
  });

  test(`a run dir that does not exist exits 3 for ${verb}`, (t) => {
    const ws = workspace(t);
    const h = harness(ws);
    const out = ws.file('facts.json');
    const argv = [verb, '--run', path.join(ws.root, 'nope'), ...extra, ...(verb === 'gather' ? ['--out', out] : [])];
    assert.equal(run(argv, h.deps), 3);
    assert.match(h.stderr(), /does not exist/);
  });
}

// ---- snapshot ----

function snapshot(ws, overrides, base = 'B') {
  const h = harness(ws, overrides);
  const code = run(['snapshot', '--run', ws.runDir, '--base', base], h.deps);
  return { code, stdout: h.stdout(), stderr: h.stderr() };
}
const inputs = (ws, name) => path.join(ws.runDir, 'packet-inputs', name);
const verifyReportAt = (gitDir) => path.join(gitDir, 'claude-tweaks-verify', 'report.json');

test('snapshot copies the reports into the run dir', (t) => {
  const ws = workspace(t);
  writeJson(verifyReportAt(ws.gitDir), REPORT);
  const qaPath = writeJson(ws.file('qa-report.json'), { stories: [{ id: 'neg-x', status: 'PASS' }] });
  writeStamp(ws.gitDir, { reportPath: qaPath });
  const { git } = fakeGit({ revParse: { HEAD: H }, mergeBase: MB });
  const { code, stdout, stderr } = snapshot(ws, { git });
  assert.equal(code, 0, stderr);
  const manifest = JSON.parse(stdout);
  assert.deepEqual(manifest, readJson(inputs(ws, 'manifest.json')));
  assert.deepEqual(manifest, {
    schemaVersion: 1,
    head: H,
    mergeBase: MB,
    files: { verifyReport: 'copied', qaReport: 'copied', qaStamp: 'copied' },
    recording: { status: 'not-run', reason: 'no-story' },
  });
  assert.deepEqual(readJson(inputs(ws, 'verify-report.json')), REPORT);
  assert.equal(readJson(inputs(ws, 'qa-stamp.json')).sha, H);
  assert.deepEqual(readJson(inputs(ws, 'qa-report.json')).stories[0].id, 'neg-x');
  assert.deepEqual(fs.readdirSync(path.join(ws.runDir, 'packet-inputs')).filter((n) => n.includes('.tmp-')), []);
});

test('snapshot passes the base through the end-of-options form', (t) => {
  const ws = workspace(t);
  const { git, calls } = fakeGit({ revParse: { HEAD: H }, mergeBase: MB });
  snapshot(ws, { git }, '-evil');
  assert.deepEqual(calls.find((c) => c[0] === 'merge-base'), ['merge-base', '--end-of-options', '-evil', 'HEAD']);
});

test('snapshot with nothing ahead of the base writes nothing', (t) => {
  const ws = workspace(t);
  const earlier = writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: OTHER });
  const before = fs.readFileSync(earlier, 'utf8');
  writeJson(verifyReportAt(ws.gitDir), REPORT);
  const { git } = fakeGit({ revParse: { HEAD: H }, mergeBase: H });
  const { code, stdout } = snapshot(ws, { git });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), { skipped: 'no commits ahead of base' });
  assert.equal(fs.readFileSync(earlier, 'utf8'), before);
  assert.deepEqual(fs.readdirSync(path.join(ws.runDir, 'packet-inputs')), ['manifest.json']);
});

const MAIN_RERUN = { skipped: 'snapshot exists, re-run from the main checkout' };

for (const [name, cwdOf, gitOpts] of [
  ['local main ahead of the base', (ws) => ws.root, { revParse: { HEAD: H }, mergeBase: MB }],
  ['a failed merge-base', (ws) => ws.root, { revParse: { HEAD: H } }],
  ['a cwd below the main root', (ws) => { const sub = path.join(ws.root, 'sub'); fs.mkdirSync(sub, { recursive: true }); return sub; }, { revParse: { HEAD: H }, mergeBase: MB }],
]) {
  test(`a re-run from the main checkout with ${name} leaves the earlier snapshot byte-unchanged`, (t) => {
    const ws = workspace(t);
    const earlier = writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: OTHER, mergeBase: MB, files: {} });
    const before = fs.readFileSync(earlier, 'utf8');
    writeJson(verifyReportAt(ws.gitDir), REPORT);
    const { code, stdout, stderr } = snapshot(ws, { git: fakeGit(gitOpts).git, cwd: () => cwdOf(ws) });
    assert.equal(code, 0, stderr);
    assert.deepEqual(JSON.parse(stdout), MAIN_RERUN);
    assert.equal(fs.readFileSync(earlier, 'utf8'), before);
    assert.deepEqual(fs.readdirSync(path.join(ws.runDir, 'packet-inputs')), ['manifest.json']);
  });
}

test('a re-run through a symlinked cwd still reads as the main checkout', (t) => {
  if (process.platform === 'win32') return t.skip('needs a symlink');
  const ws = workspace(t);
  const earlier = writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: OTHER });
  const before = fs.readFileSync(earlier, 'utf8');
  const link = path.join(tempDir(t), 'link');
  fs.symlinkSync(ws.root, link);
  const { stdout } = snapshot(ws, { git: fakeGit({ revParse: { HEAD: H }, mergeBase: MB }).git, cwd: () => link });
  assert.deepEqual(JSON.parse(stdout), MAIN_RERUN);
  assert.equal(fs.readFileSync(earlier, 'utf8'), before);
});

test('an unparseable earlier manifest still blocks a main-checkout overwrite', (t) => {
  const ws = workspace(t);
  const earlier = writeText(inputs(ws, 'manifest.json'), '{not json');
  const { stdout } = snapshot(ws, { git: fakeGit({ revParse: { HEAD: H }, mergeBase: MB }).git });
  assert.deepEqual(JSON.parse(stdout), MAIN_RERUN);
  assert.equal(fs.readFileSync(earlier, 'utf8'), '{not json');
});

test('a re-run from a linked worktree nested under the main root still refreshes', (t) => {
  const ws = workspace(t);
  writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: OTHER, mergeBase: MB, files: {} });
  writeJson(verifyReportAt(ws.gitDir), REPORT);
  const wt = path.join(ws.root, '.claude', 'worktrees', 'x');
  writeText(path.join(wt, '.git'), 'gitdir: elsewhere\n');
  const { code, stdout, stderr } = snapshot(ws, { git: fakeGit({ revParse: { HEAD: H }, mergeBase: MB }).git, cwd: () => wt });
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).head, H);
  assert.equal(readJson(inputs(ws, 'manifest.json')).head, H);
  assert.deepEqual(readJson(inputs(ws, 'verify-report.json')), REPORT);
});

test('a failed git read leaves head and mergeBase null, and still writes the manifest', (t) => {
  const ws = workspace(t);
  const { code, stdout } = snapshot(ws, { git: fakeGit().git });
  assert.equal(code, 0);
  const manifest = JSON.parse(stdout);
  assert.equal(manifest.head, null);
  assert.equal(manifest.mergeBase, null);
  assert.ok(readJson(inputs(ws, 'manifest.json')));
});

test('snapshot gates the newest QA report on a logged selection', (t) => {
  const ws = workspace(t);
  const qaRoot = path.join(ws.root, '.claude-tweaks', 'artifacts', 'screenshots', 'qa');
  writeJson(path.join(qaRoot, '2026-01-01', 'report.json'), { stories: [{ id: 'older', status: 'PASS' }] });
  writeJson(path.join(qaRoot, '2026-02-01', 'report.json'), { stories: [{ id: 'newer', status: 'PASS' }] });
  fs.mkdirSync(path.join(qaRoot, '2026-03-01'));
  const { git } = fakeGit({ revParse: { HEAD: H }, mergeBase: MB });
  assert.equal(JSON.parse(snapshot(ws, { git }).stdout).files.qaReport, 'absent');
  assert.throws(() => fs.statSync(inputs(ws, 'qa-report.json')));
  fs.rmSync(inputs(ws, 'manifest.json'));
  writeText(path.join(ws.runDir, 'decisions.md'), '- AUTO 10:00:00 — QA scoped: 2/9.\n');
  assert.equal(JSON.parse(snapshot(ws, { git }).stdout).files.qaReport, 'copied');
  assert.equal(readJson(inputs(ws, 'qa-report.json')).stories[0].id, 'newer');
});

test('snapshot takes the stamp only at head, and then not its report', (t) => {
  const ws = workspace(t);
  const qaPath = writeJson(ws.file('qa-report.json'), { stories: [] });
  writeStamp(ws.gitDir, { sha: OTHER, reportPath: qaPath });
  const { git } = fakeGit({ revParse: { HEAD: H }, mergeBase: MB });
  const { files } = JSON.parse(snapshot(ws, { git }).stdout);
  assert.equal(files.qaStamp, 'absent');
  assert.equal(files.qaReport, 'absent');
  assert.throws(() => fs.statSync(inputs(ws, 'qa-stamp.json')));
});

test('snapshot marks an unparseable source unreadable and does not copy it', (t) => {
  const ws = workspace(t);
  writeText(verifyReportAt(ws.gitDir), '{not json');
  writeText(path.join(ws.gitDir, QA_STAMP_NAME), '{not json');
  const qaRoot = path.join(ws.root, '.claude-tweaks', 'artifacts', 'screenshots', 'qa');
  writeText(path.join(qaRoot, 'r1', 'report.json'), 'null');
  writeText(path.join(ws.runDir, 'decisions.md'), '- AUTO 10:00:00 — QA skipped: 3 selected stories.\n');
  const { git } = fakeGit({ revParse: { HEAD: H }, mergeBase: MB });
  const { files } = JSON.parse(snapshot(ws, { git }).stdout);
  assert.deepEqual(files, { verifyReport: 'unreadable', qaReport: 'unreadable', qaStamp: 'unreadable' });
  assert.deepEqual(fs.readdirSync(path.join(ws.runDir, 'packet-inputs')), ['manifest.json']);
});

test('a snapshot write failure exits 3', (t) => {
  const ws = workspace(t);
  writeText(path.join(ws.runDir, 'packet-inputs'), 'a file in the way');
  const { git } = fakeGit({ revParse: { HEAD: H }, mergeBase: MB });
  const { code, stderr } = snapshot(ws, { git });
  assert.equal(code, 3);
  assert.match(stderr, /packet-inputs/);
});

// ---- the walkthrough recording ----

const GIF_BYTES = 'GIF';
const LIVE_GIF = '.claude-tweaks/pipelines/run-1/packet-inputs/walkthrough.gif';
const ARCHIVED_GIF = '.claude-tweaks/pipelines/archive/run-1/packet-inputs/walkthrough.gif';
const NO_FRAMES = { status: 'not-run', reason: 'no-happy-path-screenshots' };
const SELECTED = '- AUTO 10:00:00 — QA scoped: 1/1.\n';
const STORY_FILE = 'stories:\n  - id: sign-in\n    name: Sign in\n  - id: neg-bad\n    name: Bad\n';

// A finished QA run on disk: its report, the stories it read, and each story's screenshots.
function qaRun(ws, {
  stories = [
    { id: 'sign-in', name: 'Sign in', status: 'PASS', frames: ['00_open.png', '01_submit.png', '01_submit-raw.png'] },
    { id: 'neg-bad', name: 'Bad', status: 'PASS', frames: ['00_err.png'] },
  ],
  baseUrl = 'http://localhost:3000',
  storyFile = STORY_FILE,
} = {}) {
  const qaDir = path.join(ws.root, '.claude-tweaks', 'artifacts', 'screenshots', 'qa', 'r1');
  const entries = stories.map(({ frames = [], ...story }) => {
    const dir = path.join(qaDir, story.id);
    frames.forEach((name) => writeText(path.join(dir, name), 'png'));
    return { screenshot_dir: dir, ...story };
  });
  writeJson(path.join(qaDir, 'report.json'), { base_url: baseUrl, stories_dir: 'stories', stories: entries });
  if (storyFile !== null) writeText(path.join(ws.root, 'stories', 'app.yaml'), storyFile);
  writeText(path.join(ws.runDir, 'decisions.md'), SELECTED);
  return qaDir;
}

function encoderStub(impl = () => ({ buffer: Buffer.from(GIF_BYTES) })) {
  const calls = [];
  return {
    calls,
    encodeWalkthrough: (spec) => {
      calls.push(spec);
      return impl(spec);
    },
  };
}

const AHEAD = () => fakeGit({ revParse: { HEAD: H }, mergeBase: MB }).git;
const PRIVATE_REPO = () => JSON.stringify({ isPrivate: true });

function snapshotRecording(ws, overrides = {}) {
  const result = snapshot(ws, { git: AHEAD(), gh: PRIVATE_REPO, ...overrides });
  assert.equal(result.code, 0, result.stderr);
  return JSON.parse(result.stdout).recording;
}

function gatherRecording(ws, run = ws.runDir) {
  const { facts } = gather(ws, ['--run', run]);
  return factOf(facts, 'recording:walkthrough');
}

function recordingSection(ws) {
  const h = harness(ws);
  const narrative = writeJson(ws.file('narrative.json'), { schemaVersion: 1, claims: [] });
  assert.equal(run(['render', '--facts', ws.file('facts.json'), '--narrative', narrative, '--out', ws.file('out.md')], h.deps), 0, h.stderr());
  const lines = fs.readFileSync(ws.file('out.md'), 'utf8').split('\n');
  const rest = lines.slice(lines.indexOf('### Recording') + 1);
  return { section: rest.slice(0, rest.findIndex((line) => line.startsWith('### '))).join('\n'), markdown: lines.join('\n') };
}

test('AC1.2: snapshot encodes and gather links the path', (t) => {
  const ws = workspace(t);
  const qaDir = qaRun(ws);
  const stub = encoderStub();
  const recording = snapshotRecording(ws, { encodeWalkthrough: stub.encodeWalkthrough });

  assert.equal(stub.calls.length, 1);
  assert.deepEqual(stub.calls[0].framePaths, [
    path.join(qaDir, 'sign-in', '00_open.png'),
    path.join(qaDir, 'sign-in', '01_submit.png'),
  ]);
  assert.deepEqual(stub.calls[0].delays, [200, 400]);
  assert.equal(stub.calls[0].width, 960);
  assert.equal(stub.calls[0].budgetBytes, 8 * 1024 * 1024);
  assert.equal(fs.readFileSync(inputs(ws, 'walkthrough.gif'), 'utf8'), GIF_BYTES);
  assert.deepEqual(recording, {
    status: 'passed', file: 'walkthrough.gif', text: 'Walkthrough of Sign in', captions: ['open', 'submit'], exposure: 'local-only', frames: 2,
  });
  assert.deepEqual(readJson(inputs(ws, 'manifest.json')).recording, recording);

  const fact = gatherRecording(ws);
  assert.equal(fact.url_or_path, LIVE_GIF);
  assert.equal(fact.archive_path, ARCHIVED_GIF);
  assert.equal(fact.exposure, 'local-only');
  assert.equal(fact.redactions, 0);
  assert.deepEqual(fact.captions, ['open', 'submit']);

  const { section } = recordingSection(ws);
  assert.ok(section.includes(`- Walkthrough of Sign in: \`${LIVE_GIF}\` (local-only)`), section);
  assert.ok(section.includes(`once archived: \`${ARCHIVED_GIF}\``), section);
});

test("A1: snapshot's stdout carries the redacted strings, and the manifest on disk stays raw", (t) => {
  const ws = workspace(t);
  qaRun(ws, {
    stories: [{ id: 'sign-in', name: 'Sign in as bob@example.com', status: 'PASS', frames: ['00_sk_live_abc.png', '01_ghs_abc123def.png'] }],
  });
  const raws = ['bob@example.com', 'sk_live_abc', 'ghs_abc123def'];
  const passed = snapshot(ws, { git: AHEAD(), gh: PRIVATE_REPO, encodeWalkthrough: encoderStub().encodeWalkthrough });
  assert.equal(passed.code, 0, passed.stderr);
  for (const raw of raws) assert.ok(!passed.stdout.includes(raw), raw);
  assert.deepEqual(JSON.parse(passed.stdout).recording.captions, ['[redacted]', '[redacted]']);
  const manifest = readJson(inputs(ws, 'manifest.json')).recording;
  assert.deepEqual(manifest.captions, ['sk_live_abc', 'ghs_abc123def'], 'local input stays raw');
  assert.equal(manifest.text, 'Walkthrough of Sign in as bob@example.com');
  assert.ok(!Object.hasOwn(JSON.parse(passed.stdout).recording, 'redactions'), 'stdout mirrors the manifest entry');
});

test("A1: snapshot's stdout carries a redacted failure, and the manifest on disk stays raw", (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const secret = 'eyJhbGciOiJIUzI1NiJ9.e30.abc';
  const failed = snapshot(ws, {
    git: AHEAD(), gh: PRIVATE_REPO, encodeWalkthrough: encoderStub(() => { throw new Error(`bad ${secret}`); }).encodeWalkthrough,
  });
  assert.equal(failed.code, 0, failed.stderr);
  assert.ok(!failed.stdout.includes(secret));
  assert.equal(JSON.parse(failed.stdout).recording.failure, 'bad [redacted]');
  assert.equal(readJson(inputs(ws, 'manifest.json')).recording.failure, `bad ${secret}`);
});

test('a relative screenshot_dir resolves against the cwd, not the process', (t) => {
  const ws = workspace(t);
  const qaDir = qaRun(ws);
  const qaReport = path.join(qaDir, 'report.json');
  const report = readJson(qaReport);
  report.stories = report.stories.map((story) => ({ ...story, screenshot_dir: path.relative(ws.root, story.screenshot_dir) }));
  writeJson(qaReport, report);
  const stub = encoderStub();
  assert.equal(snapshotRecording(ws, { encodeWalkthrough: stub.encodeWalkthrough }).status, 'passed');
  assert.equal(stub.calls[0].framePaths[0], path.join(qaDir, 'sign-in', '00_open.png'));
});

for (const [name, gh] of [
  ['public', () => JSON.stringify({ isPrivate: false })],
  ['private', PRIVATE_REPO],
  ['failed', () => { throw new Error('gh failed'); }],
]) {
  test(`AC2.2: ${name} visibility stays local-only with nothing embedded`, (t) => {
    const ws = workspace(t);
    qaRun(ws);
    const calls = [];
    const recording = snapshotRecording(ws, {
      encodeWalkthrough: encoderStub().encodeWalkthrough,
      gh: (args) => {
        calls.push(args);
        return gh(args);
      },
    });
    assert.deepEqual(calls, [['repo', 'view', '--json', 'isPrivate']]);
    assert.equal(recording.exposure, 'local-only');
    gatherRecording(ws);
    const { section, markdown } = recordingSection(ws);
    assert.ok(section.includes(LIVE_GIF), section);
    assert.ok(!markdown.includes('!['), markdown);
    assert.ok(!markdown.includes('<img'), markdown);
  });
}

test('the stub throwing gives encoder-failed and exit 0', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const calls = [];
  const stub = encoderStub(() => { throw new Error('over budget'); });
  const recording = snapshotRecording(ws, {
    encodeWalkthrough: stub.encodeWalkthrough,
    gh: (args) => { calls.push(args); return PRIVATE_REPO(); },
  });
  assert.deepEqual(recording, { status: 'not-run', reason: 'encoder-failed', failure: 'over budget' });
  assert.deepEqual(calls, [], 'visibility is read only once a GIF exists');
  assert.throws(() => fs.statSync(inputs(ws, 'walkthrough.gif')));
  const fact = gatherRecording(ws);
  assert.equal(fact.status, 'not-run');
  assert.equal(fact.reason, 'encoder-failed');
  assert.equal(fact.failure, 'over budget');
  assert.ok(!Object.hasOwn(fact, 'url_or_path'));
});

test('a failed GIF write gives encoder-failed and exit 0', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  fs.mkdirSync(inputs(ws, 'walkthrough.gif'), { recursive: true });
  writeText(path.join(inputs(ws, 'walkthrough.gif'), 'in-the-way'), 'x');
  const recording = snapshotRecording(ws, { encodeWalkthrough: encoderStub().encodeWalkthrough });
  assert.equal(recording.status, 'not-run');
  assert.equal(recording.reason, 'encoder-failed');
  assert.ok(!recording.failure.includes(ws.root), recording.failure);
  assert.ok(readJson(inputs(ws, 'manifest.json')), 'the manifest still lands');
});

// A workspace whose checkout is a real git repository, for what only real git can answer.
function repoWorkspace(t) {
  const root = gitRepo();
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  const gitDir = path.join(root, 'gitdir');
  fs.mkdirSync(gitDir);
  return { root, runDir, gitDir, file: (name) => path.join(root, 'work', name) };
}

// The stub's answers for the refs, and real git for the question asked in the run's own directory.
const CHECK_IGNORE = ['check-ignore', '-q', '--', 'walkthrough.gif'];
const realGitInDir = (args) => fixtureGit(args, { env: realGitEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const realCheckIgnore = () => {
  const refs = AHEAD();
  return (args) => (args[0] === '-C' ? realGitInDir(args) : refs(args));
};

test('a destination git does not ignore gives encoder-failed naming it, with no encode and no GIF', (t) => {
  const ws = repoWorkspace(t);
  qaRun(ws);
  const earlier = writeText(inputs(ws, 'walkthrough.gif'), 'an earlier GIF');
  const stub = encoderStub();
  const recording = snapshotRecording(ws, { git: realCheckIgnore(), encodeWalkthrough: stub.encodeWalkthrough });
  assert.deepEqual(recording, {
    status: 'not-run', reason: 'encoder-failed', failure: `${LIVE_GIF} is not ignored by git, so the GIF was not written`,
  });
  assert.deepEqual(stub.calls, []);
  assert.throws(() => fs.statSync(earlier));
  const fact = gatherRecording(ws);
  assert.equal(fact.failure, recording.failure);
});

test('a destination git gives no answer for is held with no encode and no GIF, unless git says it is no repository', (t) => {
  const refs = AHEAD();
  const answering = (status, stderr) => (args) => {
    if (args[2] !== 'check-ignore') return refs(args);
    throw Object.assign(new Error('git could not answer'), { status, stderr });
  };
  const noAnswers = [[128, 'fatal: detected dubious ownership in repository'], [null, ''], [undefined, undefined], [2, 'fatal: not a git repository']];
  for (const [status, stderr] of noAnswers) {
    const ws = repoWorkspace(t);
    qaRun(ws);
    const stub = encoderStub();
    assert.deepEqual(snapshotRecording(ws, { git: answering(status, stderr), encodeWalkthrough: stub.encodeWalkthrough }), {
      status: 'not-run', reason: 'encoder-failed', failure: `git could not say whether ${LIVE_GIF} is ignored, so the GIF was not written`,
    }, String(status));
    assert.deepEqual(stub.calls, [], String(status));
    assert.throws(() => fs.statSync(inputs(ws, 'walkthrough.gif')), String(status));
  }
  const ws = repoWorkspace(t);
  qaRun(ws);
  const stub = encoderStub();
  const notARepository = answering(128, 'fatal: not a git repository (or any of the parent directories): .git');
  assert.equal(snapshotRecording(ws, { git: notARepository, encodeWalkthrough: stub.encodeWalkthrough }).status, 'passed');
});

test('an ignored destination records as usual', (t) => {
  const ws = repoWorkspace(t);
  qaRun(ws);
  writeText(path.join(ws.root, '.gitignore'), '.claude-tweaks/pipelines/*/*\n');
  const stub = encoderStub();
  assert.equal(snapshotRecording(ws, { git: realCheckIgnore(), encodeWalkthrough: stub.encodeWalkthrough }).status, 'passed');
  assert.equal(fs.readFileSync(inputs(ws, 'walkthrough.gif'), 'utf8'), GIF_BYTES);
});

test('a directory outside any git repository records as usual, since nothing can commit it', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  fs.mkdirSync(path.dirname(inputs(ws, 'walkthrough.gif')), { recursive: true });
  assert.throws(() => realGitInDir(['-C', ws.runDir, ...CHECK_IGNORE]), { status: 128 }, 'the fixture is no repository to git');
  const stub = encoderStub();
  assert.equal(snapshotRecording(ws, { git: realCheckIgnore(), encodeWalkthrough: stub.encodeWalkthrough }).status, 'passed');
  assert.equal(fs.readFileSync(inputs(ws, 'walkthrough.gif'), 'utf8'), GIF_BYTES);
});

test('a failed manifest write after a new GIF removes that GIF, and the exit stays 3', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const writeAtomic = (file, content) => {
    if (path.basename(file) === 'manifest.json') throw new Error('disk full');
    fs.writeFileSync(file, content);
  };
  const result = snapshot(ws, { git: AHEAD(), gh: PRIVATE_REPO, encodeWalkthrough: encoderStub().encodeWalkthrough, writeAtomic });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /could not write .*disk full/);
  assert.throws(() => fs.statSync(inputs(ws, 'walkthrough.gif')));
  assert.throws(() => fs.statSync(inputs(ws, 'manifest.json')));
});

test('a failed removal of that GIF is stated, and the exit stays 3', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const writeAtomic = (file, content) => {
    if (path.basename(file) === 'manifest.json') throw new Error('disk full');
    fs.writeFileSync(file, content);
  };
  const removeFile = () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); };
  const result = snapshot(ws, { git: AHEAD(), gh: PRIVATE_REPO, encodeWalkthrough: encoderStub().encodeWalkthrough, writeAtomic, removeFile });
  assert.equal(result.code, 3);
  assert.ok(result.stderr.includes(`could not remove ${inputs(ws, 'walkthrough.gif')}`), result.stderr);
});

test('a write failure ahead of the encode leaves the earlier snapshot\'s GIF', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const gif = writeText(inputs(ws, 'walkthrough.gif'), 'an earlier GIF');
  const result = snapshot(ws, { git: AHEAD(), mkdir: () => { throw new Error('denied'); } });
  assert.equal(result.code, 3);
  assert.equal(fs.readFileSync(gif, 'utf8'), 'an earlier GIF');
});

test('the no-commits skip leaves an earlier GIF byte-unchanged, with no encode', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const gif = writeText(inputs(ws, 'walkthrough.gif'), 'an earlier GIF');
  const stub = encoderStub();
  const result = snapshot(ws, { git: fakeGit({ revParse: { HEAD: H }, mergeBase: H }).git, encodeWalkthrough: stub.encodeWalkthrough });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { skipped: 'no commits ahead of base' });
  assert.deepEqual(stub.calls, []);
  assert.equal(fs.readFileSync(gif, 'utf8'), 'an earlier GIF');
});

test('no QA report gives no-story', (t) => {
  const ws = workspace(t);
  const stub = encoderStub();
  const recording = snapshotRecording(ws, {
    encodeWalkthrough: stub.encodeWalkthrough,
    gh: (args) => { throw new Error(`unexpected gh ${args.join(' ')}`); },
  });
  assert.deepEqual(recording, { status: 'not-run', reason: 'no-story' });
  assert.deepEqual(stub.calls, []);
  const fact = gatherRecording(ws);
  assert.equal(fact.reason, 'no-story');
  const { section, markdown } = recordingSection(ws);
  assert.equal(section.trim(), 'not recorded');
  assert.ok(!markdown.includes('recording:walkthrough'), 'no-story is no gap');
});

test('a non-local base url gives no-local-base-url and no encode', (t) => {
  const ws = workspace(t);
  qaRun(ws, { baseUrl: 'https://dev.example' });
  const stub = encoderStub();
  assert.deepEqual(snapshotRecording(ws, { encodeWalkthrough: stub.encodeWalkthrough }), { status: 'not-run', reason: 'no-local-base-url' });
  assert.deepEqual(stub.calls, []);
});

test('AC5: an unreadable QA report gives no-happy-path-screenshots', (t) => {
  const ws = workspace(t);
  const qaDir = qaRun(ws);
  writeText(path.join(qaDir, 'report.json'), '{not json');
  assert.deepEqual(snapshotRecording(ws), NO_FRAMES);
  gatherRecording(ws);
  const { markdown } = recordingSection(ws);
  assert.match(markdown, /recording:walkthrough/, 'a recording expected and impossible is a gap');
});

test('AC5: a report with no stories list gives no-happy-path-screenshots', (t) => {
  const ws = workspace(t);
  const qaDir = qaRun(ws);
  writeJson(path.join(qaDir, 'report.json'), { base_url: 'http://localhost:3000' });
  assert.deepEqual(snapshotRecording(ws), NO_FRAMES);
});

test('AC5: decisions.md selecting stories with no report gives no-happy-path-screenshots', (t) => {
  const ws = workspace(t);
  writeText(path.join(ws.runDir, 'decisions.md'), SELECTED);
  assert.deepEqual(snapshotRecording(ws), NO_FRAMES);
});

test('a stamp at head with no report gives no-happy-path-screenshots', (t) => {
  const ws = workspace(t);
  writeStamp(ws.gitDir);
  assert.deepEqual(snapshotRecording(ws), NO_FRAMES);
});

test('a missing stories directory with a report listing stories gives no-happy-path-screenshots', (t) => {
  const ws = workspace(t);
  qaRun(ws, { storyFile: null });
  assert.deepEqual(snapshotRecording(ws), NO_FRAMES);
});

test('a report with no stories_dir reads the default stories directory', (t) => {
  const ws = workspace(t);
  const qaDir = qaRun(ws);
  const qaReport = path.join(qaDir, 'report.json');
  const { stories_dir: _dropped, ...report } = readJson(qaReport);
  writeJson(qaReport, report);
  assert.equal(snapshotRecording(ws, { encodeWalkthrough: encoderStub().encodeWalkthrough }).status, 'passed');
});

test('AC2a.2: a tag-only negative story in the index stays out of the frames', (t) => {
  const ws = workspace(t);
  const qaDir = qaRun(ws, {
    stories: [
      { id: 'sign-in', name: 'Sign in', status: 'PASS', frames: ['00_open.png'] },
      { id: 'tagged', name: 'T', status: 'PASS', frames: ['00_err.png'] },
    ],
    storyFile: 'stories:\n  - id: sign-in\n  - id: tagged\n    tags: [negative]\n',
  });
  const stub = encoderStub();
  assert.equal(snapshotRecording(ws, { encodeWalkthrough: stub.encodeWalkthrough }).frames, 1);
  assert.deepEqual(stub.calls[0].framePaths, [path.join(qaDir, 'sign-in', '00_open.png')]);
});

test('AC2a: a passing story with no screenshot_dir gives no partial GIF', (t) => {
  const ws = workspace(t);
  qaRun(ws, {
    stories: [
      { id: 'sign-in', name: 'Sign in', status: 'PASS', frames: ['00_open.png'] },
      { id: 'second', name: 'Second', status: 'PASS', screenshot_dir: null },
    ],
    storyFile: 'stories:\n  - id: sign-in\n  - id: second\n',
  });
  const stub = encoderStub();
  assert.deepEqual(snapshotRecording(ws, { encodeWalkthrough: stub.encodeWalkthrough }), NO_FRAMES);
  assert.deepEqual(stub.calls, []);
});

test('AC2a: a gap in the second story gives no partial GIF', (t) => {
  const ws = workspace(t);
  qaRun(ws, {
    stories: [
      { id: 'sign-in', name: 'Sign in', status: 'PASS', steps_total: 2, frames: ['00_open.png', '01_submit.png'] },
      { id: 'second', name: 'Second', status: 'PASS', steps_total: 3, frames: ['00_open.png', '02_done.png'] },
    ],
    storyFile: 'stories:\n  - id: sign-in\n  - id: second\n',
  });
  const stub = encoderStub();
  assert.deepEqual(snapshotRecording(ws, { encodeWalkthrough: stub.encodeWalkthrough }), NO_FRAMES);
  assert.deepEqual(stub.calls, []);
});

test('AC5: a damaged stamp with no report gives no-happy-path-screenshots', (t) => {
  const ws = workspace(t);
  writeText(path.join(ws.gitDir, QA_STAMP_NAME), '{not json');
  assert.deepEqual(snapshotRecording(ws), NO_FRAMES);
});

test('a snapshot that passes then one that does not leaves no GIF', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  assert.equal(snapshotRecording(ws, { encodeWalkthrough: encoderStub().encodeWalkthrough }).status, 'passed');
  assert.equal(fs.readFileSync(inputs(ws, 'walkthrough.gif'), 'utf8'), GIF_BYTES);
  const wt = path.join(ws.root, '.claude', 'worktrees', 'x');
  writeText(path.join(wt, '.git'), 'gitdir: elsewhere\n');
  assert.deepEqual(snapshotRecording(ws, { cwd: () => wt }), NO_FRAMES);
  assert.throws(() => fs.statSync(inputs(ws, 'walkthrough.gif')));
});

test("the encoder's absolute frame path never reaches the fact", (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const stub = encoderStub(() => { throw new Error('failed at /abs/q/00_a.png'); });
  snapshotRecording(ws, { encodeWalkthrough: stub.encodeWalkthrough });
  assert.equal(gatherRecording(ws).failure, 'failed at 00_a.png');
});

test('a frame path holding a space never reaches the fact in pieces', (t) => {
  const ws = workspace(t);
  const qaDir = qaRun(ws);
  const qaReport = path.join(qaDir, 'report.json');
  const report = readJson(qaReport);
  const spaced = path.join(ws.root, 'Code Workspaces', 'sign-in');
  writeText(path.join(spaced, '00_open.png'), 'png');
  report.stories[0].screenshot_dir = spaced;
  writeJson(qaReport, report);
  const stub = encoderStub(({ framePaths }) => { throw new Error(`${framePaths[0]}: not a PNG file`); });
  const { failure } = snapshotRecording(ws, { encodeWalkthrough: stub.encodeWalkthrough });
  assert.equal(failure, '00_open.png: not a PNG file');
});

test('re-run from the main checkout keeps the GIF', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  assert.equal(snapshotRecording(ws, { encodeWalkthrough: encoderStub().encodeWalkthrough }).status, 'passed');
  const stub = encoderStub(() => ({ buffer: Buffer.from('OTHER') }));
  const result = snapshot(ws, { git: AHEAD(), encodeWalkthrough: stub.encodeWalkthrough });
  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), MAIN_RERUN);
  assert.deepEqual(stub.calls, []);
  assert.equal(fs.readFileSync(inputs(ws, 'walkthrough.gif'), 'utf8'), GIF_BYTES);
});

test('a manifest with no recording key adds no fact', (t) => {
  const ws = workspace(t);
  writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: H, mergeBase: MB, files: {} });
  const { facts } = gather(ws, ['--run', ws.runDir]);
  assert.deepEqual(idsOf(facts, 'recording'), []);
  assert.ok(!facts.partial.some((note) => note.includes('recording')), facts.partial.join(' | '));
});

for (const [name, recording] of [
  ['an unknown status', { status: 'weird' }],
  ['a free not-run reason', { status: 'not-run', reason: 'token=abc' }],
  ['a file other than the GIF', { status: 'passed', file: '../../secret', text: 'x', captions: [], exposure: 'local-only' }],
  ['captions that are not strings', { status: 'passed', file: 'walkthrough.gif', text: 'x', captions: [1], exposure: 'local-only' }],
  ['an unknown exposure', { status: 'passed', file: 'walkthrough.gif', text: 'x', captions: [], exposure: 'public' }],
  ['a value that is not an object', 'nope'],
]) {
  test(`a manifest recording with ${name} adds no fact and states the gap`, (t) => {
    const ws = workspace(t);
    writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: H, mergeBase: MB, files: {}, recording });
    const { facts } = gather(ws, ['--run', ws.runDir]);
    assert.deepEqual(idsOf(facts, 'recording'), []);
    assert.ok(facts.partial.includes('manifest recording entry not read — treated as absent'), facts.partial.join(' | '));
  });
}

test('Decision 2: a gather live and a gather after the real archive name the same two locations', (t) => {
  const ws = repoWorkspace(t);
  qaRun(ws);
  snapshotRecording(ws, { encodeWalkthrough: encoderStub().encodeWalkthrough });
  const live = gatherRecording(ws);
  const result = archiveRunDir(ws.root, ws.runDir);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.ok(result.movedEntries.includes('packet-inputs'), JSON.stringify(result));
  assert.throws(() => fs.statSync(ws.runDir), 'the archive took the whole run dir');
  const archived = gatherRecording(ws, path.join(ws.root, '.claude-tweaks', 'pipelines', 'archive', 'run-1'));
  assert.deepEqual(archived, live);
  assert.equal(fs.readFileSync(path.join(ws.root, ...archived.archive_path.split('/')), 'utf8'), GIF_BYTES);
});

test('the default encoder refusing a frame that is not a PNG gives encoder-failed', (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const recording = snapshotRecording(ws);
  assert.equal(recording.status, 'not-run');
  assert.equal(recording.reason, 'encoder-failed');
  assert.ok(!recording.failure.includes(ws.root), recording.failure);
});

// ---- gather over a snapshot ----

function writeSnapshot(ws, { files = { verifyReport: 'copied', qaReport: 'copied', qaStamp: 'copied' }, stamp = true } = {}) {
  writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: H, mergeBase: MB, files });
  writeJson(inputs(ws, 'verify-report.json'), REPORT);
  writeJson(inputs(ws, 'qa-report.json'), { stories: [{ id: 'reported', status: 'PASS' }] });
  if (stamp) writeJson(inputs(ws, 'qa-stamp.json'), { sha: H, dirty: false, stories: [{ id: 'neg-x', file: 's.yaml', sha256: HASH }], storiesDir: 'stories' });
}

test('gather after the worktree is gone reads the snapshot', (t) => {
  const ws = workspace(t);
  writeSnapshot(ws);
  writeText(path.join(ws.runDir, 'decisions.md'), '- AUTO 10:00:00 — QA scoped: 2/9.\n');
  const spec = writeText(ws.file('spec.md'), '## Acceptance Criteria\n\n1. It works.\n');
  const { git, calls } = fakeGit({ revParse: { [H]: H }, diff: 'M\0a.js\0', log: '' });
  const { facts } = gather(ws, ['--run', ws.runDir, '--spec', spec, '--base', 'origin/main'], { git });
  assert.equal(factOf(facts, 'check:tests').status, 'passed');
  assert.ok(factOf(facts, 'story:neg-x'));
  assert.ok(factOf(facts, 'story:reported'));
  assert.deepEqual(calls.find((c) => c[0] === 'diff').at(-1), `${MB}...${H}`);
  assert.deepEqual(calls.find((c) => c[0] === 'log').at(-1), `${MB}..${H}`);
  assert.deepEqual(facts.partial, []);
});

test('a null mergeBase in the manifest falls back to --base', (t) => {
  const ws = workspace(t);
  writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: H, mergeBase: null, files: {} });
  const { git, calls } = fakeGit({ diff: 'M\0a.js\0' });
  gather(ws, ['--run', ws.runDir, '--base', 'B'], { git });
  assert.equal(calls.find((c) => c[0] === 'diff').at(-1), `B...${H}`);
});

test('a report flag wins over the snapshot', (t) => {
  const ws = workspace(t);
  writeSnapshot(ws);
  const report = writeJson(ws.file('report.json'), { checks: { lint: { command: 'x', exitCode: 1, summary: 'bad' } } });
  const qa = writeJson(ws.file('qa.json'), { stories: [{ id: 'flagged', status: 'PASS' }] });
  const { facts } = gather(ws, ['--run', ws.runDir, '--report', report, '--story-results', qa]);
  assert.deepEqual(idsOf(facts, 'check'), ['check:lint']);
  assert.ok(factOf(facts, 'story:flagged'));
  assert.ok(!factOf(facts, 'story:reported'));
});

test('an unreadable report flag falls back to the snapshot', (t) => {
  const ws = workspace(t);
  writeSnapshot(ws);
  const report = writeText(ws.file('report.json'), '{not json');
  const qa = writeText(ws.file('qa.json'), '{not json');
  const { facts } = gather(ws, ['--run', ws.runDir, '--report', report, '--story-results', qa]);
  assert.equal(factOf(facts, 'check:tests').status, 'passed');
  assert.ok(factOf(facts, 'story:reported'));
  assert.ok(!facts.partial.includes('QA report not read — selected stories not listed'));
  assert.ok(facts.partial.includes('--report input not read — treated as absent'));
});

test('a --report that reads states no partial note', (t) => {
  const ws = workspace(t);
  const report = writeJson(ws.file('report.json'), REPORT);
  assert.ok(!gather(ws, ['--report', report]).facts.partial.some((note) => note.startsWith('--report')));
});

test('--head wins over the manifest head', (t) => {
  const ws = workspace(t);
  writeSnapshot(ws);
  const { git, calls } = fakeGit({ diff: 'M\0a.js\0' });
  gather(ws, ['--run', ws.runDir, '--head', 'S'], { git });
  assert.equal(calls.find((c) => c[0] === 'diff').at(-1), `${MB}...S`);
});

test('a manifest that says absent ignores a copy an earlier snapshot left behind', (t) => {
  const ws = workspace(t);
  writeSnapshot(ws, { files: { verifyReport: 'absent', qaReport: 'absent', qaStamp: 'absent' } });
  const { facts } = gather(ws, ['--run', ws.runDir]);
  assert.deepEqual(idsOf(facts, 'check'), []);
  assert.deepEqual(idsOf(facts, 'story'), []);
  assert.ok(facts.partial.includes('verify report not found'));
});

test('a manifest saying the QA report was unreadable is a stated partial', (t) => {
  const ws = workspace(t);
  writeSnapshot(ws, { files: { verifyReport: 'copied', qaReport: 'unreadable', qaStamp: 'absent' } });
  const { facts } = gather(ws, ['--run', ws.runDir]);
  assert.ok(facts.partial.includes('QA report not read — selected stories not listed'));
});

test('a snapshotted stamp that fails validation reads as no stamp, not a crash', (t) => {
  const ws = workspace(t);
  writeSnapshot(ws, { files: { verifyReport: 'copied', qaReport: 'absent', qaStamp: 'copied' }, stamp: false });
  writeJson(inputs(ws, 'qa-stamp.json'), { sha: H, stories: 'nope' });
  const { facts } = gather(ws, ['--run', ws.runDir]);
  assert.deepEqual(idsOf(facts, 'story'), []);
});

test('a live stamp at the head beats the snapshot', (t) => {
  const ws = workspace(t);
  writeSnapshot(ws, { files: { verifyReport: 'copied', qaReport: 'absent', qaStamp: 'copied' } });
  writeStamp(ws.gitDir, { sha: OTHER, stories: [{ id: 'live', file: 's.yaml', sha256: HASH }] });
  const { git } = fakeGit({ revParse: { S: OTHER } });
  const { facts } = gather(ws, ['--run', ws.runDir, '--head', 'S'], { git });
  assert.deepEqual(idsOf(facts, 'story'), ['story:live']);
});

// ---- render ----

const FACTS = {
  schemaVersion: 1, record: 7, partial: [], refused: [], facts: [{ id: 'check:tests', kind: 'check', status: 'passed', source: 'verify-report' }],
};

function renderArgs(ws, { facts = FACTS, narrative = { schemaVersion: 1, claims: [] } } = {}) {
  const factsFile = writeJson(ws.file('facts.json'), facts);
  const narrativeFile = writeJson(ws.file('narrative.json'), narrative);
  return ['render', '--facts', factsFile, '--narrative', narrativeFile, '--out', ws.file('out.md')];
}

test('render round-trip: markdown starts with the marker, --dropped-out carries screened without the claim text', (t) => {
  const ws = workspace(t);
  const secret = 'abc123secretvalue';
  const argv = renderArgs(ws, {
    narrative: {
      schemaVersion: 1,
      claims: [
        { section: 'test-guide', text: `log in with token=${secret}`, refs: ['check:tests'] },
        { section: 'what-changed', text: 'a claim with no evidence', refs: ['change:missing'] },
      ],
    },
  });
  const h = harness(ws);
  const droppedOut = ws.file('dropped.json');
  assert.equal(run([...argv, '--dropped-out', droppedOut, '--poster', 'the wrap-up run'], h.deps), 0, h.stderr());
  const markdown = fs.readFileSync(ws.file('out.md'), 'utf8');
  assert.ok(markdown.startsWith(`${PACKET_MARKER}\n`));
  assert.match(markdown, /the wrap-up run/);
  assert.ok(!markdown.includes(secret));
  const raw = fs.readFileSync(droppedOut, 'utf8');
  assert.ok(!raw.includes(secret), 'a screened claim\'s text never reaches --dropped-out');
  const dropped = JSON.parse(raw);
  assert.deepEqual(dropped.screened, [{ section: 'test-guide', key: 'token' }]);
  assert.deepEqual(dropped.dropped, [{ section: 'what-changed', reason: 'absent fact' }]);
  assert.equal(dropped.truncated, 0);
  assert.equal(dropped.chars, markdown.length);
  assert.deepEqual(JSON.parse(h.stdout()), { out: ws.file('out.md'), dropped: 1, screened: 1, truncated: 0, chars: markdown.length });
});

test('--dropped-out holds a section and a fixed reason for every drop, never a claim-supplied value', (t) => {
  const ws = workspace(t);
  const secret = 'S3CRET-VALUE';
  const facts = { ...FACTS, facts: [...FACTS.facts, { id: 'flag:f1', kind: 'flag', status: 'passed', source: 'flags' }] };
  const claim = (section, refs) => ({ section, text: `claim holding ${secret}`, refs });
  const argv = renderArgs(ws, {
    facts,
    narrative: {
      schemaVersion: 1,
      claims: [
        claim(`section-${secret}`, ['check:tests']),
        claim(`line one\nsection-${secret}`, ['check:tests']),
        claim('what-changed', []),
        claim('what-changed', [`change:${secret}`]),
        claim('what-changed', [`${secret} as a ref`]),
        claim('what-changed', [`line one\n${secret} as a ref`]),
        claim('what-changed', ['check:tests']),
        claim('tried-to-break', ['check:tests']),
        claim('risk-proofs', ['check:tests']),
        claim('risk-proofs', ['flag:f1']),
      ],
    },
  });
  const droppedOut = ws.file('dropped.json');
  const h = harness(ws);
  assert.equal(run([...argv, '--dropped-out', droppedOut], h.deps), 0, h.stderr());
  const raw = fs.readFileSync(droppedOut, 'utf8');
  assert.ok(!raw.includes(secret));
  assert.deepEqual(JSON.parse(raw).dropped, [
    { section: 'unknown', reason: 'unknown section' },
    { section: 'unknown', reason: 'unknown section' },
    { section: 'what-changed', reason: 'no refs' },
    { section: 'what-changed', reason: 'absent fact' },
    { section: 'what-changed', reason: 'absent fact' },
    { section: 'what-changed', reason: 'absent fact' },
    { section: 'what-changed', reason: 'incompatible fact' },
    { section: 'tried-to-break', reason: 'tried-to-break claim cites no negative or failed fact' },
    { section: 'risk-proofs', reason: 'risk proof cites no flag' },
    { section: 'risk-proofs', reason: 'risk proof cites no proof fact' },
  ]);
});

test('a validator entry without a known reasonKind is withheld, whatever its free-form reason says', () => {
  const secret = 'S3CRET-VALUE';
  const claim = { section: 'what-changed', text: 'x', refs: [] };
  const withheld = { section: 'what-changed', reason: 'dropped (reason withheld)' };
  assert.deepEqual(droppedEntry({ claim, reason: `a future reason holding ${secret}` }), withheld);
  assert.deepEqual(droppedEntry({ claim, reason: `absent fact ${secret}`, reasonKind: `absent fact ${secret}` }), withheld);
  assert.deepEqual(droppedEntry({ claim, reason: 'no refs', reasonKind: 'no refs' }), { section: 'what-changed', reason: 'no refs' });
});

const STALE = 'an earlier render';

for (const [name, breakIt] of [
  ['an unreadable --facts', (ws) => fs.rmSync(ws.file('facts.json'))],
  ['an unparseable --narrative', (ws) => writeText(ws.file('narrative.json'), '{not json')],
  ['a schema failure', (ws) => writeJson(ws.file('narrative.json'), { schemaVersion: 2, claims: [] })],
]) {
  test(`render failing on ${name} removes an earlier --out and --dropped-out`, (t) => {
    const ws = workspace(t);
    const argv = renderArgs(ws);
    breakIt(ws);
    const droppedOut = writeText(ws.file('dropped.json'), STALE);
    writeText(ws.file('out.md'), STALE);
    const h = harness(ws);
    assert.equal(run([...argv, '--dropped-out', droppedOut], h.deps), 1);
    assert.throws(() => fs.statSync(ws.file('out.md')));
    assert.throws(() => fs.statSync(droppedOut));
  });
}

test('render over the cap removes an earlier --out', (t) => {
  const ws = workspace(t);
  const plan = writeText(ws.file('plan.txt'), 'x'.repeat(MAX_PACKET_CHARS + 10));
  writeText(ws.file('out.md'), STALE);
  const h = harness(ws);
  assert.equal(run([...renderArgs(ws), '--observation-plan', plan], h.deps), 1);
  assert.throws(() => fs.statSync(ws.file('out.md')));
});

test('render whose --dropped-out will not write removes the --out it just wrote', (t) => {
  const ws = workspace(t);
  const blocker = writeText(ws.file('blocker'), 'x');
  const h = harness(ws);
  assert.equal(run([...renderArgs(ws), '--dropped-out', path.join(blocker, 'dropped.json')], h.deps), 1);
  assert.throws(() => fs.statSync(ws.file('out.md')));
});

test('a failed removal of a stale --out is stated, and the exit stays 1', (t) => {
  const ws = workspace(t);
  const argv = renderArgs(ws, { narrative: { schemaVersion: 2, claims: [] } });
  const h = harness(ws, { removeFile: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } });
  assert.equal(run(argv, h.deps), 1);
  assert.ok(h.stderr().includes(`could not remove ${ws.file('out.md')}`));
});

test('a plan line carrying a credential is dropped by the CLI, stated in --dropped-out and never on stdout or the packet', (t) => {
  const ws = workspace(t);
  const plan = writeText(ws.file('plan.md'), [
    '### Observation plan',
    '- Entry point: http://localhost:3000/settings?token=abc123',
    '- Prepare:',
    '  - `npm run seed -- --api-key=sk-live-xyz`',
  ].join('\n'));
  const droppedOut = ws.file('dropped.json');
  const h = harness(ws);
  assert.equal(run([...renderArgs(ws), '--observation-plan', plan, '--dropped-out', droppedOut], h.deps), 0, h.stderr());
  const markdown = fs.readFileSync(ws.file('out.md'), 'utf8');
  const raw = fs.readFileSync(droppedOut, 'utf8');
  for (const secret of ['abc123', 'sk-live-xyz']) {
    assert.ok(!markdown.includes(secret), secret);
    assert.ok(!raw.includes(secret), secret);
    assert.ok(!h.stdout().includes(secret), secret);
  }
  assert.deepEqual(JSON.parse(raw).screened, [{ section: 'observation-plan', key: 'token' }, { section: 'observation-plan', key: 'api_key' }]);
  assert.match(markdown, /^2 entries omitted for credential-shaped content: Observation plan \(token\); Observation plan \(api_key\)$/m);
  assert.equal(JSON.parse(h.stdout()).screened, 2);
});

test('a dropped plan key line takes its value line with it', (t) => {
  const ws = workspace(t);
  const plan = writeText(ws.file('plan.md'), [
    '- Prepare:',
    '  - curl -H "Authorization: \\',
    '    Bearer SECRET-ONE" http://localhost',
    '  - npm run seed --api-key \\',
    'SECRET-TWO',
    '  - npm run ok',
  ].join('\n'));
  const droppedOut = ws.file('dropped.json');
  const h = harness(ws);
  assert.equal(run([...renderArgs(ws), '--observation-plan', plan, '--dropped-out', droppedOut], h.deps), 0, h.stderr());
  const markdown = fs.readFileSync(ws.file('out.md'), 'utf8');
  for (const secret of ['SECRET-ONE', 'SECRET-TWO']) assert.ok(!markdown.includes(secret), secret);
  assert.ok(markdown.endsWith('### Observation plan\n- Prepare:\n  - npm run ok'), markdown);
  assert.deepEqual(readJson(droppedOut).screened, [{ section: 'observation-plan', key: 'authorization' }, { section: 'observation-plan', key: 'api_key' }]);
});

test('render forwards --observation-plan', (t) => {
  const ws = workspace(t);
  const plan = writeText(ws.file('plan.txt'), 'watch the error rate\n');
  const h = harness(ws);
  assert.equal(run([...renderArgs(ws), '--observation-plan', plan], h.deps), 0, h.stderr());
  assert.match(fs.readFileSync(ws.file('out.md'), 'utf8'), /### Observation plan\nwatch the error rate/);
});

test('render over the cap exits 1, names it, and writes nothing', (t) => {
  const ws = workspace(t);
  const plan = writeText(ws.file('plan.txt'), 'x'.repeat(MAX_PACKET_CHARS + 10));
  const h = harness(ws);
  const droppedOut = ws.file('dropped.json');
  assert.equal(run([...renderArgs(ws), '--observation-plan', plan, '--dropped-out', droppedOut], h.deps), 1);
  assert.match(h.stderr(), new RegExp(`${MAX_PACKET_CHARS}`));
  assert.throws(() => fs.statSync(ws.file('out.md')));
  assert.throws(() => fs.statSync(droppedOut));
  assert.equal(h.stdout(), '');
});

test('render with a schemaVersion 2 narrative exits 1', (t) => {
  const ws = workspace(t);
  const h = harness(ws);
  assert.equal(run(renderArgs(ws, { narrative: { schemaVersion: 2, claims: [] } }), h.deps), 1);
  assert.match(h.stderr(), /schemaVersion/);
  assert.ok(!h.stderr().includes('could not remove'), 'no earlier --out to remove is not a failure');
  assert.throws(() => fs.statSync(ws.file('out.md')));
});

for (const flag of ['--facts', '--narrative', '--observation-plan']) {
  test(`render with an unreadable ${flag} exits 1, naming it`, (t) => {
    const ws = workspace(t);
    const argv = renderArgs(ws);
    const bad = flag === '--observation-plan' ? [...argv, flag, ws.file('absent')] : argv.map((a, i) => (argv[i - 1] === flag ? ws.file('absent') : a));
    const h = harness(ws);
    assert.equal(run(bad, h.deps), 1);
    assert.ok(h.stderr().includes(flag));
  });
}

test('render with an unparseable --facts exits 1', (t) => {
  const ws = workspace(t);
  const argv = renderArgs(ws);
  writeText(ws.file('facts.json'), '{not json');
  const h = harness(ws);
  assert.equal(run(argv, h.deps), 1);
  assert.match(h.stderr(), /--facts/);
});

test('render with an unwritable --out exits 1', (t) => {
  const ws = workspace(t);
  const argv = renderArgs(ws);
  const blocker = writeText(ws.file('blocker'), 'x');
  const h = harness(ws);
  assert.equal(run(argv.map((a, i) => (argv[i - 1] === '--out' ? path.join(blocker, 'out.md') : a)), h.deps), 1);
  assert.match(h.stderr(), /--out/);
});

// ---- post ----

const BODY = `${PACKET_MARKER}\n\npacket`;

function fakeGh({ comments = [], labels = [], commentThrows = false, prBody = 'pr body', prEditThrows = false } = {}) {
  const calls = [];
  const prBodies = [];
  const gh = (args) => {
    calls.push(args);
    if (args[0] === 'pr' && args[1] === 'edit') {
      prBodies.push(fs.readFileSync(args[args.indexOf('--body-file') + 1], 'utf8'));
      if (prEditThrows) throw new Error('pr edit failed');
      return '';
    }
    if (args[0] === 'issue' && args[1] === 'view' && args.includes('comments')) return JSON.stringify({ comments });
    if (args[0] === 'issue' && args[1] === 'view' && args.includes('labels')) return JSON.stringify({ labels: labels.map((name) => ({ name })) });
    if (args[0] === 'issue' && args[1] === 'comment') {
      if (commentThrows) throw new Error('post failed');
      return 'https://github.com/o/r/issues/7#issuecomment-1\n';
    }
    if (args[0] === 'issue' && args[1] === 'edit') return '';
    if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ body: prBody });
    throw new Error(`unexpected gh ${args.join(' ')}`);
  };
  return { gh, calls, prBodies };
}

for (const [name, text] of [
  ['no marker', 'packet'],
  ['the marker on a later line', `intro\n${PACKET_MARKER}\n`],
  ['text after the marker', `${PACKET_MARKER} trailing\n`],
]) {
  test(`post with a body with ${name} exits 2, before any gh probe or call`, (t) => {
    const ws = workspace(t);
    const body = writeText(ws.file('body.md'), text);
    const { gh, calls } = fakeGh({ labels: ['demo:pending'] });
    let probed = false;
    const h = harness(ws, { gh, ghAvailable: () => { probed = true; return true; } });
    assert.equal(run(['post', '--record', '7', '--body-file', body, '--label', 'demo:pending'], h.deps), 2);
    assert.match(h.stderr(), /--body-file/);
    assert.deepEqual(calls, []);
    assert.equal(probed, false);
  });
}

test('post accepts a CRLF marker line', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), `${PACKET_MARKER}\r\n\r\npacket`);
  const { gh } = fakeGh();
  const h = harness(ws, { gh });
  assert.equal(run(['post', '--record', '7', '--body-file', body], h.deps), 0, h.stderr());
});

test('post deletes the --pr temp file when the pull request edit fails too', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const tmp = ws.file('pr-body.md');
  const { gh, prBodies } = fakeGh({ prEditThrows: true });
  const h = harness(ws, { gh, tmpPath: () => tmp });
  assert.equal(run(['post', '--record', '7', '--body-file', body, '--pr', '9'], h.deps), 0, h.stderr());
  assert.equal(JSON.parse(h.stdout()).prLink.ok, false);
  assert.equal(prBodies.length, 1);
  assert.throws(() => fs.statSync(tmp));
});

test('post deletes the --pr temp file when the comment post fails, and states a failed delete', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const removed = [];
  const { gh } = fakeGh({ commentThrows: true });
  const h = harness(ws, {
    gh,
    tmpPath: () => ws.file('pr-body.md'),
    removeFile: (p) => { removed.push(p); throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
  });
  assert.equal(run(['post', '--record', '7', '--body-file', body, '--pr', '9'], h.deps), 1);
  assert.deepEqual(removed, [ws.file('pr-body.md')]);
  assert.ok(h.stderr().includes(`could not remove ${ws.file('pr-body.md')}`));
});

test('post with gh absent exits 4 and names the MCP path', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const h = harness(ws, { ghAvailable: () => false });
  assert.equal(run(['post', '--record', '7', '--body-file', body], h.deps), 4);
  assert.match(h.stderr(), /gh absent — follow _shared\/acceptance-packet\.md's MCP path/);
});

for (const [name, argv] of [
  ['a malformed record', ['post', '--record', 'x', '--body-file', 'b']],
  ['a malformed --repo', ['post', '--record', '7', '--body-file', 'b', '--repo', 'nope']],
]) {
  test(`post with ${name} exits 2 even with gh absent, never reaching the MCP signal`, (t) => {
    const ws = workspace(t);
    let probed = false;
    const h = harness(ws, { ghAvailable: () => { probed = true; return false; } });
    assert.equal(run(argv, h.deps), 2);
    assert.equal(probed, false);
  });
}

test('post with an unreadable body file exits 1 with no gh call, gh present or absent', (t) => {
  const ws = workspace(t);
  const { gh, calls } = fakeGh({ labels: ['demo:pending'] });
  const present = harness(ws, { gh });
  assert.equal(run(['post', '--record', '7', '--body-file', ws.file('absent.md')], present.deps), 1);
  assert.deepEqual(calls, []);
  const absent = harness(ws, { ghAvailable: () => false });
  assert.equal(run(['post', '--record', '7', '--body-file', ws.file('absent.md')], absent.deps), 1);
});

test('post whose comment post throws exits 1, adds no label, and reports the stale state', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const { gh, calls } = fakeGh({ commentThrows: true, labels: ['demo:pending'] });
  const h = harness(ws, { gh });
  assert.equal(run(['post', '--record', '7', '--body-file', body, '--label', 'demo:pending'], h.deps), 1);
  assert.ok(!calls.some((c) => c.includes('--add-label')));
  assert.ok(calls.some((c) => c.includes('--remove-label')));
  const result = JSON.parse(h.stdout());
  assert.equal(result.ok, false);
  assert.ok(Object.hasOwn(result, 'stalePacket'));
  assert.equal(result.labelRemoval, 'removed');
});

test('post that lands exits 0, labels, and links the pull request through the tmp file', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const tmp = ws.file('pr-body.md');
  const { gh, calls, prBodies } = fakeGh();
  const names = [];
  const h = harness(ws, { gh, tmpPath: (name) => { names.push(name); return tmp; } });
  assert.equal(run(['post', '--record', '7', '--body-file', body, '--label', 'demo:pending', '--pr', '9'], h.deps), 0, h.stderr());
  const result = JSON.parse(h.stdout());
  assert.equal(result.ok, true);
  assert.equal(result.action, 'created');
  assert.deepEqual(result.prLink, { ok: true, action: 'appended' });
  assert.ok(calls.some((c) => c.includes('--add-label') && c.includes('demo:pending')));
  assert.ok(calls.some((c) => c[0] === 'issue' && c[1] === 'comment' && c.includes(body)));
  assert.match(prBodies[0], /Acceptance packet: https:\/\/github\.com\/o\/r\/issues\/7#issuecomment-1/);
  assert.equal(names.length, 1);
  assert.throws(() => fs.statSync(tmp), 'the temp file is gone after the call');
});

test('post with no --pr asks for no tmp path', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const { gh } = fakeGh();
  const h = harness(ws, { gh, tmpPath: () => { throw new Error('asked'); } });
  assert.equal(run(['post', '--record', '7', '--body-file', body], h.deps), 0, h.stderr());
  assert.equal(h.stderr(), '', 'with no temp file there is nothing to remove');
});

for (const [repo, host] of [['o/r', 'github.com'], ['ghe.example/o/r', 'ghe.example']]) {
  test(`post pins and forwards --repo ${repo}`, (t) => {
    const ws = workspace(t);
    const body = writeText(ws.file('body.md'), BODY);
    const { gh, calls } = fakeGh();
    const pinned = [];
    const h = harness(ws, { gh, pinGhHost: (spec) => pinned.push(spec) });
    assert.equal(run(['post', '--record', '7', '--body-file', body, '--repo', repo], h.deps), 0, h.stderr());
    assert.equal(pinned.length, 1);
    assert.equal(pinned[0].host, host);
    assert.equal(pinned[0].owner, 'o');
    assert.equal(pinned[0].repo, 'r');
    assert.ok(calls.every((c) => c.at(-2) === '--repo' && c.at(-1) === repo));
  });
}

test('post with no --repo pins nothing', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const { gh } = fakeGh();
  let pinned = false;
  const h = harness(ws, { gh, pinGhHost: () => { pinned = true; } });
  assert.equal(run(['post', '--record', '7', '--body-file', body], h.deps), 0, h.stderr());
  assert.equal(pinned, false);
});

// ---- local ----

function localRecord(ws, facets = defaultFacets()) {
  const file = ws.file('7-a-record.md');
  writeRecord(file, { title: 'A record', body: 'Some body.\n', facets });
  return file;
}

const marked = (text) => `${PACKET_MARKER}\n${text}`;

for (const [name, text] of [
  ['no marker', 'PACKET'],
  ['the marker on a later line', `intro\n${PACKET_MARKER}\n`],
  ['text after the marker', `${PACKET_MARKER} trailing\n`],
]) {
  test(`local with a body with ${name} exits 2 and leaves the record byte-unchanged`, (t) => {
    const ws = workspace(t);
    const file = localRecord(ws);
    const before = fs.readFileSync(file, 'utf8');
    const body = writeText(ws.file('body.md'), text);
    const h = harness(ws);
    assert.equal(run(['local', '--record-file', file, '--body-file', body, '--pending'], h.deps), 2);
    assert.match(h.stderr(), /--body-file/);
    assert.equal(fs.readFileSync(file, 'utf8'), before);
  });
}

test('local accepts a CRLF marker line', (t) => {
  const ws = workspace(t);
  const file = localRecord(ws);
  const body = writeText(ws.file('body.md'), `${PACKET_MARKER}\r\nPACKET`);
  const h = harness(ws);
  assert.equal(run(['local', '--record-file', file, '--body-file', body], h.deps), 0, h.stderr());
});

test('local without --pending leaves facets.acceptance unset, and upserts in place', (t) => {
  const ws = workspace(t);
  const file = localRecord(ws);
  const first = writeText(ws.file('first.md'), marked('FIRST'));
  const second = writeText(ws.file('second.md'), marked('SECOND'));
  const h = harness(ws);
  assert.equal(run(['local', '--record-file', file, '--body-file', first], h.deps), 0, h.stderr());
  assert.deepEqual(JSON.parse(h.stdout()), { recordFile: file, pending: false });
  assert.equal(readRecord(file).facets.acceptance, defaultFacets().acceptance);
  assert.ok(!fs.readFileSync(file, 'utf8').includes('acceptance:'));
  assert.equal(run(['local', '--record-file', file, '--body-file', second], harness(ws).deps), 0);
  const { body, title } = readRecord(file);
  assert.equal(title, 'A record');
  assert.ok(body.includes('Some body.'));
  assert.ok(body.includes(`${LOCAL_START}\n${marked('SECOND')}\n${LOCAL_END}`));
  assert.ok(!body.includes('FIRST'));
});

test('local with --pending sets facets.acceptance to pending', (t) => {
  const ws = workspace(t);
  const file = localRecord(ws);
  const body = writeText(ws.file('body.md'), marked('PACKET'));
  const h = harness(ws);
  assert.equal(run(['local', '--record-file', file, '--body-file', body, '--pending'], h.deps), 0, h.stderr());
  assert.deepEqual(JSON.parse(h.stdout()), { recordFile: file, pending: true });
  assert.equal(readRecord(file).facets.acceptance, 'pending');
});

test('local with an unreadable record or body exits 1', (t) => {
  const ws = workspace(t);
  const file = localRecord(ws);
  const before = fs.readFileSync(file, 'utf8');
  const body = writeText(ws.file('body.md'), marked('PACKET'));
  assert.equal(run(['local', '--record-file', ws.file('8-absent.md'), '--body-file', body], harness(ws).deps), 1);
  assert.equal(run(['local', '--record-file', file, '--body-file', ws.file('absent.md')], harness(ws).deps), 1);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
});

test('local with a failed write exits 1', (t) => {
  const ws = workspace(t);
  const file = localRecord(ws);
  const body = writeText(ws.file('body.md'), marked('PACKET'));
  const h = harness(ws, { writeRecord: () => { throw new Error('disk full'); } });
  assert.equal(run(['local', '--record-file', file, '--body-file', body], h.deps), 1);
  assert.match(h.stderr(), /disk full/);
});

// ---- real git, through the real deps ----

function realGitEnv() {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return {
    ...env,
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.test', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.test',
  };
}

test('in-process over a real repo: snapshot then gather, real git and git dir', (t) => {
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  const env = realGitEnv();
  const inRepo = (args) => fixtureGit(['-C', repo, ...args], { env, encoding: 'utf8' });
  const base = inRepo(['rev-parse', 'HEAD']).trim();
  writeText(path.join(repo, 'old.js'), 'module.exports = 1;\n'.repeat(20));
  inRepo(['add', '.']);
  inRepo(['commit', '-q', '-m', 'add old']);
  const mergeBase = inRepo(['rev-parse', 'HEAD']).trim();
  inRepo(['mv', 'old.js', 'new +name.js']);
  writeText(path.join(repo, 'café.md'), 'x\n');
  inRepo(['add', '.']);
  inRepo(['commit', '-q', '-m', 'rename and add']);
  const head = inRepo(['rev-parse', 'HEAD']).trim();
  const gitDir = inRepo(['rev-parse', '--absolute-git-dir']).trim();
  writeJson(path.join(gitDir, 'claude-tweaks-verify', 'report.json'), REPORT);
  const runDir = path.join(repo, '.claude-tweaks', 'pipelines', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });

  const cli = (...args) => {
    const r = runCliSync(BIN, args, { cwd: repo, env, fresh: true, deps: { gh: unexpectedGh } });
    return { ...r, status: r.code };
  };
  const snap = cli('snapshot', '--run', runDir, '--base', mergeBase);
  assert.equal(snap.status, 0, snap.stderr);
  const manifest = JSON.parse(snap.stdout);
  assert.equal(manifest.head, head);
  assert.equal(manifest.mergeBase, mergeBase);
  assert.equal(manifest.files.verifyReport, 'copied');

  const out = path.join(repo, '.claude-tweaks', 'facts.json');
  const gathered = cli('gather', '--record', '7', '--out', out, '--run', runDir, '--base', base);
  assert.equal(gathered.status, 0, gathered.stderr);
  const facts = readJson(out);
  assert.equal(factOf(facts, 'check:tests').status, 'passed');
  const changes = idsOf(facts, 'change');
  assert.ok(changes.includes('change:new%20%2Bname.js'), changes.join(' '));
  assert.ok(changes.includes('change:caf%C3%A9.md'), changes.join(' '));
  assert.ok(!changes.includes('change:old.js'), 'the manifest\'s mergeBase, not --base, and the rename\'s new path only');
  assert.ok(facts.facts.some((f) => f.text === 'rename and add'));
  assert.ok(!facts.facts.some((f) => f.text === 'add old'));

  const skipped = cli('snapshot', '--run', runDir, '--base', head);
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.deepEqual(JSON.parse(skipped.stdout), { skipped: 'no commits ahead of base' });
  const rerun = cli('snapshot', '--run', runDir, '--base', mergeBase);
  assert.equal(rerun.status, 0, rerun.stderr);
  assert.deepEqual(JSON.parse(rerun.stdout), MAIN_RERUN);
  assert.equal(readJson(path.join(runDir, 'packet-inputs', 'manifest.json')).head, head);
});

test('AC6.1: snapshot reads the git dir from the injected env', (t) => {
  const repo = gitRepo();
  const other = gitRepo();
  t.after(() => { fs.rmSync(repo, { recursive: true, force: true }); fs.rmSync(other, { recursive: true, force: true }); });
  const env = realGitEnv();
  const base = fixtureGit(['-C', repo, 'rev-parse', 'HEAD'], { env, encoding: 'utf8' }).trim();
  writeText(path.join(repo, 'a.txt'), 'a\n');
  fixtureGit(['-C', repo, 'add', '.'], { env });
  fixtureGit(['-C', repo, 'commit', '-q', '-m', 'a'], { env });
  const head = fixtureGit(['-C', repo, 'rev-parse', 'HEAD'], { env, encoding: 'utf8' }).trim();
  const repoGitDir = fixtureGit(['-C', repo, 'rev-parse', '--absolute-git-dir'], { env, encoding: 'utf8' }).trim();
  writeJson(path.join(repoGitDir, 'claude-tweaks-verify', 'report.json'), REPORT);
  const runDir = path.join(other, '.claude-tweaks', 'pipelines', 'run-1');
  fs.mkdirSync(runDir, { recursive: true });
  // cwd is a different repo; only the injected env points git at `repo`.
  assert.notEqual(other, repo);
  const result = runCliSync(BIN, ['snapshot', '--run', runDir, '--base', base], {
    cwd: other, env: { ...env, GIT_DIR: repoGitDir }, fresh: true, deps: { gh: unexpectedGh },
  });
  assert.equal(result.code, 0, result.stderr);
  const manifest = JSON.parse(result.stdout);
  assert.equal(manifest.head, head);
  assert.equal(manifest.files.verifyReport, 'copied');
});

test('AC3.1: tmpPath follows the injected CLAUDE_CODE_SESSION_ID and cwd, not process.env', (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const bodyFiles = [];
  const { gh } = fakeGh();
  const spyGh = (args) => {
    if (args[0] === 'pr' && args[1] === 'edit') bodyFiles.push(args[args.indexOf('--body-file') + 1]);
    return gh(args);
  };
  const injected = 'injected-session-5383';
  t.after(() => fs.rmSync(path.join(os.tmpdir(), `ct-session-${injected}`), { recursive: true, force: true }));
  const saved = process.env.CLAUDE_CODE_SESSION_ID;
  process.env.CLAUDE_CODE_SESSION_ID = 'ambient-session-5383';
  let result;
  try {
    result = runCliSync(BIN, ['post', '--record', '7', '--body-file', body, '--pr', '9'], {
      cwd: ws.root,
      env: { PATH: process.env.PATH, TMPDIR: os.tmpdir(), CLAUDE_CODE_SESSION_ID: injected },
      fresh: true,
      deps: { gh: spyGh, ghAvailable: () => true, pinGhHost: () => {} },
    });
  } finally {
    if (saved === undefined) delete process.env.CLAUDE_CODE_SESSION_ID;
    else process.env.CLAUDE_CODE_SESSION_ID = saved;
  }
  assert.equal(result.code, 0, result.stderr);
  assert.equal(bodyFiles.length, 1);
  assert.equal(path.basename(path.dirname(bodyFiles[0])), `ct-session-${injected}`);
});

test('AC6.1: the gh probe runs on the injected env PATH, not the real one', { skip: STUB_SKIP }, (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const withGh = path.join(ws.root, 'with-gh');
  const noGh = path.join(ws.root, 'no-gh');
  fs.mkdirSync(withGh);
  fs.mkdirSync(noGh);
  fs.writeFileSync(path.join(withGh, 'gh'), `#!${process.execPath}\nconsole.log('gh version 2.0.0');\n`);
  fs.chmodSync(path.join(withGh, 'gh'), 0o755); // root-safe: makes the stub runnable
  fs.symlinkSync(process.execPath, path.join(noGh, 'node'));
  const { gh } = fakeGh();
  const post = (bin) => runCliSync(BIN, ['post', '--record', '7', '--body-file', body, '--pr', '9'], {
    cwd: ws.root,
    env: { PATH: bin, HOME: process.env.HOME, TMPDIR: os.tmpdir() },
    fresh: true,
    allowRealRunner: true,
    deps: { gh, pinGhHost: () => {} },
  });
  const absent = post(noGh);
  assert.equal(absent.code, 4, absent.stderr);
  const present = post(withGh);
  assert.equal(present.code, 0, present.stderr);
});

// A `gh` that logs the cwd and the env it was started with, then answers a visibility probe.
function recordingGhShim(ws) {
  const dir = path.join(ws.root, 'gh-shim');
  const log = path.join(ws.root, 'gh-calls.jsonl');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'gh'), `#!${process.execPath}\n`
    + `require('node:fs').appendFileSync(${JSON.stringify(log)}, JSON.stringify({ cwd: process.cwd(), marker: process.env.CT_MARKER_5383, ghHost: process.env.GH_HOST, args: process.argv.slice(2) }) + '\\n');\n`
    + 'console.log(JSON.stringify({ isPrivate: true }));\n');
  fs.chmodSync(path.join(dir, 'gh'), 0o755); // root-safe: makes the stub runnable
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);
  return { dir, calls };
}

// The environment an in-process call sees with the recording gh first on PATH.
function shimEnv(shim) {
  return { PATH: shim.dir + path.delimiter + process.env.PATH, HOME: process.env.HOME, TMPDIR: os.tmpdir() };
}

function unexpectedGh() {
  throw new Error('unexpected gh');
}

function withAmbient(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) { saved[k] = process.env[k]; process.env[k] = v; }
  try {
    return fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}

test('AC6.2: the real gh member starts gh in the injected cwd with the injected env', { skip: STUB_SKIP }, (t) => {
  const ws = workspace(t);
  qaRun(ws);
  const shim = recordingGhShim(ws);
  assert.notEqual(ws.root, process.cwd());
  const result = withAmbient({ CT_MARKER_5383: 'ambient' }, () => runCliSync(BIN, ['snapshot', '--run', ws.runDir, '--base', 'B'], {
    cwd: ws.root,
    env: { ...shimEnv(shim), CT_MARKER_5383: 'injected', GH_HOST: 'github.com' },
    fresh: true,
    allowRealRunner: true,
    deps: { git: AHEAD(), gitDir: () => ws.gitDir, mainRoot: ws.root, encodeWalkthrough: encoderStub().encodeWalkthrough },
  }));
  assert.equal(result.code, 0, result.stderr);
  const [call] = shim.calls();
  assert.ok(call, 'the injected PATH reached the gh spawn');
  assert.deepEqual(call.args, ['repo', 'view', '--json', 'isPrivate']);
  assert.equal(call.cwd, ws.root, 'gh starts in the injected cwd');
  assert.equal(call.marker, 'injected', 'gh gets the injected env, not process.env');
});

test('AC6.2: the real pinGhHost reads GH_HOST from the injected env, not process.env', { skip: STUB_SKIP }, (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const shim = recordingGhShim(ws);
  withAmbient({ GH_HOST: 'ambient.example' }, () => runCliSync(BIN, ['post', '--record', '7', '--body-file', body, '--repo', 'ghe.example/o/r'], {
    cwd: ws.root,
    env: shimEnv(shim),
    fresh: true,
    allowRealRunner: true,
    deps: { ghAvailable: () => true },
  }));
  const calls = shim.calls();
  assert.ok(calls.length > 0, 'the post reached gh');
  // The injected env holds no GH_HOST, so the typed --repo host is pinned; an ambient one read in its place would pin nothing.
  assert.ok(calls.every((c) => c.ghHost === 'ghe.example'), JSON.stringify(calls.map((c) => c.ghHost)));
});

test('AC6.3: the real pinGhHost compares the --repo host with the injected cwd\'s origin, not process.cwd()\'s', { skip: STUB_SKIP }, (t) => {
  const ws = workspace(t);
  const body = writeText(ws.file('body.md'), BODY);
  const shim = recordingGhShim(ws);
  const repo = gitRepo();
  t.after(() => fs.rmSync(repo, { recursive: true, force: true }));
  // A *.ghe.com origin is a known GitHub host, so resolveGhSpec admits it; this checkout's own origin is github.com.
  fixtureGit(['-C', repo, 'remote', 'add', 'origin', 'https://corp.ghe.com/o/r.git'], { env: realGitEnv() });
  runCliSync(BIN, ['post', '--record', '7', '--body-file', body, '--repo', 'github.com/o/r'], {
    cwd: repo,
    env: shimEnv(shim),
    fresh: true,
    allowRealRunner: true,
    deps: { ghAvailable: () => true },
  });
  const calls = shim.calls();
  assert.ok(calls.length > 0, 'the post reached gh');
  // github.com differs from the injected cwd's origin host, so it is pinned; read against process.cwd() it matches and pins nothing.
  assert.ok(calls.every((c) => c.ghHost === 'github.com'), JSON.stringify(calls.map((c) => c.ghHost)));
});

test('AC3.1: a relative --scope resolves against the injected working directory, not process.cwd()', (t) => {
  const ws = workspace(t);
  assert.notEqual(ws.root, process.cwd());
  writeJson(path.join(ws.root, 'scope.json'), { checks: { lint: 'y' }, rules: [] });
  const out = ws.file('facts.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const result = runCliSync(BIN, ['gather', '--record', '7', '--out', out, '--scope', 'scope.json'], {
    cwd: ws.root,
    env: { PATH: process.env.PATH },
    fresh: true,
    deps: { git: fakeGit().git, gitDir: () => ws.gitDir, mainRoot: ws.root, gh: unexpectedGh },
  });
  assert.equal(result.code, 0, result.stderr);
  const facts = readJson(out);
  assert.equal(factOf(facts, 'check:lint').status, 'not-run');
  assert.ok(!facts.partial.includes(SCOPE_NOTE));
});

// ---- risk facts: unconfirmed flags, planned proofs, the plan copy ----

test('--flags keeps unconfirmed: true on the flag fact and no other flag gains the field', (t) => {
  const ws = workspace(t);
  const flags = writeJson(ws.file('flags.json'), [{ id: 'f1', unconfirmed: true }, { id: 'f2', unconfirmed: false }, { id: 'f3' }]);
  const { facts } = gather(ws, ['--flags', flags]);
  assert.equal(factOf(facts, 'flag:f1').unconfirmed, true);
  assert.equal(Object.hasOwn(factOf(facts, 'flag:f2'), 'unconfirmed'), false);
  assert.equal(Object.hasOwn(factOf(facts, 'flag:f3'), 'unconfirmed'), false);
});

for (const bad of ['yes', 1]) {
  test(`--flags with a non-boolean unconfirmed (${JSON.stringify(bad)}) is a stated partial and no flag fact`, (t) => {
    const ws = workspace(t);
    const flags = writeJson(ws.file('flags.json'), [{ id: 'f1', unconfirmed: bad }]);
    const { facts } = gather(ws, ['--flags', flags]);
    assert.ok(facts.partial.includes('--flags input not read — treated as absent'));
    assert.deepEqual(idsOf(facts, 'flag'), []);
  });
}

test('--proofs reaches the facts as a not-run proof fact', (t) => {
  const ws = workspace(t);
  const proofs = writeJson(ws.file('proofs.json'), [{ id: 'auth', text: 't' }]);
  const { facts } = gather(ws, ['--proofs', proofs]);
  assert.deepEqual(factOf(facts, 'proof:auth'), {
    id: 'proof:auth', kind: 'proof', status: 'not-run', reason: 'planned in the plan, not yet run', source: 'proofs', text: 't',
  });
});

test('--help names --proofs and --plan', () => {
  const out = [];
  assert.equal(run(['--help'], { stdout: (s) => out.push(s), stderr: () => {} }), 0);
  const usage = out.join('');
  assert.match(usage, /--proofs <file>/);
  assert.match(usage, /snapshot --run <dir> --base <ref> \[--plan <file>\]/);
});

function snapshotWithPlan(ws, planFile, overrides) {
  const h = harness(ws, { git: fakeGit({ revParse: { HEAD: H }, mergeBase: MB }).git, ...overrides });
  const code = run(['snapshot', '--run', ws.runDir, '--base', 'B', ...(planFile === undefined ? ['--plan'] : ['--plan', planFile])], h.deps);
  return { code, stdout: h.stdout(), stderr: h.stderr() };
}

test('snapshot --plan copies the plan byte-for-byte and the manifest says copied', (t) => {
  const ws = workspace(t);
  const text = '# Plan\r\n\r\nProof(auth): refuses an unauthenticated request\né\n';
  const plan = writeText(ws.file('plan.md'), text);
  const { code, stdout, stderr } = snapshotWithPlan(ws, plan);
  assert.equal(code, 0, stderr);
  assert.equal(fs.readFileSync(inputs(ws, 'plan.md'), 'utf8'), text);
  assert.equal(JSON.parse(stdout).files.plan, 'copied');
  assert.equal(readJson(inputs(ws, 'manifest.json')).files.plan, 'copied');
  assert.deepEqual(fs.readdirSync(path.join(ws.runDir, 'packet-inputs')).filter((n) => n.includes('.tmp-')), []);
});

test('snapshot --plan with a missing plan says absent and writes no plan.md', (t) => {
  const ws = workspace(t);
  const { code, stdout, stderr } = snapshotWithPlan(ws, ws.file('nope.md'));
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).files.plan, 'absent');
  assert.equal(readJson(inputs(ws, 'manifest.json')).files.plan, 'absent');
  assert.throws(() => fs.statSync(inputs(ws, 'plan.md')));
});

test('snapshot --plan with a directory says unreadable and writes no plan.md', (t) => {
  const ws = workspace(t);
  const dir = ws.file('a-dir');
  fs.mkdirSync(dir, { recursive: true });
  const { code, stdout, stderr } = snapshotWithPlan(ws, dir);
  assert.equal(code, 0, stderr);
  assert.equal(JSON.parse(stdout).files.plan, 'unreadable');
  assert.throws(() => fs.statSync(inputs(ws, 'plan.md')));
});

test('snapshot --plan with no value exits 2 and runs nothing', (t) => {
  const ws = workspace(t);
  const { code, stderr } = snapshotWithPlan(ws, undefined);
  assert.equal(code, 2);
  assert.match(stderr, /--plan requires a value/);
  assert.throws(() => fs.statSync(inputs(ws, 'manifest.json')));
});

test('snapshot without --plan leaves files.plan out of the manifest', (t) => {
  const ws = workspace(t);
  const { stdout } = snapshot(ws, { git: fakeGit({ revParse: { HEAD: H }, mergeBase: MB }).git });
  assert.equal(Object.hasOwn(JSON.parse(stdout).files, 'plan'), false);
  assert.throws(() => fs.statSync(inputs(ws, 'plan.md')));
});

test('a re-run from the main checkout keeps the earlier plan.md', (t) => {
  const ws = workspace(t);
  const earlier = writeText(inputs(ws, 'plan.md'), 'EARLIER PLAN\n');
  writeJson(inputs(ws, 'manifest.json'), { schemaVersion: 1, head: OTHER, mergeBase: MB, files: { plan: 'copied' } });
  const plan = writeText(ws.file('plan.md'), 'LATER PLAN\n');
  const { code, stdout, stderr } = snapshotWithPlan(ws, plan);
  assert.equal(code, 0, stderr);
  assert.deepEqual(JSON.parse(stdout), MAIN_RERUN);
  assert.equal(fs.readFileSync(earlier, 'utf8'), 'EARLIER PLAN\n');
});

test('snapshot --plan with nothing ahead of the base keeps the earlier plan.md', (t) => {
  const ws = workspace(t);
  const earlier = writeText(inputs(ws, 'plan.md'), 'EARLIER PLAN\n');
  const plan = writeText(ws.file('plan.md'), 'LATER PLAN\n');
  const { code, stdout } = snapshotWithPlan(ws, plan, { git: fakeGit({ revParse: { HEAD: H }, mergeBase: H }).git });
  assert.equal(code, 0);
  assert.deepEqual(JSON.parse(stdout), { skipped: 'no commits ahead of base' });
  assert.equal(fs.readFileSync(earlier, 'utf8'), 'EARLIER PLAN\n');
});
