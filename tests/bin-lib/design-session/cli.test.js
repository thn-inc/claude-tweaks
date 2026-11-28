'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readText } = require('../../helpers/read-skill');
const { runCliSync, spawnCli } = require('../../helpers/run-cli');
const { readStatus } = require('../../../plugin/bin/lib/design-session/status');
const { PERSPECTIVES } = require('../../../plugin/bin/lib/design-session/notes');

const CLI = path.resolve(__dirname, '..', '..', '..', 'plugin', 'bin', 'design-session.js');
const NOW = new Date(2026, 10, 27, 12);
// Strings absent from the reader-brief prose, so the printed prompt carries them only when the session's frame and storyboard do.
const FRAME_SENTINEL = 'FRAME-SENTINEL-7f3a';
const BOARD_SENTINEL = 'BOARD-SENTINEL-9c1d';

function scratch(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'design-cli-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const call = (argv, cwd, extra = {}) => runCliSync(CLI, argv, { cwd, deps: { now: () => NOW, ...extra } });

function notes(n, { pending = false } = {}) {
  const lines = [`# Perspective notes — round ${n}`, '', 'Status: done', ''];
  PERSPECTIVES.forEach((p, i) => {
    lines.push(`## ${n}.${i + 1} — ${p} — ${i === 0 ? 'serious' : 'none'}`);
    if (i === 0) lines.push('> a note', pending ? 'Outcome: pending' : 'Outcome: changed — fixed');
    lines.push('');
  });
  return lines.join('\n');
}

function session(t, files = {}) {
  const dir = scratch(t);
  const design = `# T — design\n\n## Frame\n\nStatus: done\n\n${FRAME_SENTINEL}\n\n## Storyboard\n\nStatus: done\n\nRound: 1\nFile: storyboard.md\n`;
  const all = { 'design.md': design, 'storyboard.md': BOARD_SENTINEL, 'evidence.md': '# Evidence\n\nStatus: done\n\n- a claim — source: #6352\n', ...files };
  for (const [n, text] of Object.entries(all)) fs.writeFileSync(path.join(dir, n), text);
  return dir;
}

test('--help lists every flag and exits 0', (t) => {
  const r = call(['--help'], scratch(t));
  assert.strictEqual(r.code, 0);
  for (const flag of ['--topic', '--root', '--create', '--folder', '--round', '--reader']) {
    assert.ok(r.stdout.includes(flag), flag);
  }
});

test('folder prints the dated path, creates only with --create, and reuses an existing one', (t) => {
  const root = scratch(t);
  const want = path.join(root, 'docs', 'superpowers', 'specs', '2026-11-27-ordering-flow');
  const dry = call(['folder', '--topic', 'Ordering flow', '--root', root], root);
  assert.strictEqual(dry.code, 0);
  assert.strictEqual(dry.stdout.trim(), want);
  assert.ok(!fs.existsSync(want));
  const made = call(['folder', '--topic', 'Ordering flow', '--root', root, '--create'], root);
  assert.strictEqual(made.stdout.trim(), want);
  assert.ok(fs.statSync(want).isDirectory());
  const later = runCliSync(CLI, ['folder', '--topic', 'Ordering flow', '--root', root], { cwd: root, deps: { now: () => new Date(2026, 11, 5) } });
  assert.strictEqual(later.stdout.trim(), want);
});

test('folder resolves a relative --root against the injected cwd', (t) => {
  const cwd = scratch(t);
  fs.mkdirSync(path.join(cwd, 'repo'));
  const r = call(['folder', '--topic', '#6352', '--root', 'repo'], cwd);
  assert.strictEqual(r.stdout.trim(), path.join(cwd, 'repo', 'docs', 'superpowers', 'specs', '2026-11-27-issue-6352'));
});

test('status prints readStatus\'s object', (t) => {
  const dir = session(t);
  const r = call(['status', '--folder', dir], '/');
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(JSON.parse(r.stdout), JSON.parse(JSON.stringify(readStatus(dir))));
});

test('a relative --folder resolves against the injected cwd', (t) => {
  const dir = session(t);
  const r = call(['status', '--folder', path.basename(dir)], path.dirname(dir));
  assert.strictEqual(r.code, 0);
  assert.strictEqual(JSON.parse(r.stdout).steps[1], 'done');
});

test('check-evidence exits 0 when done and sourced, 1 naming unsourced claims and fences', (t) => {
  const ok = call(['check-evidence', '--folder', session(t)], '/');
  assert.strictEqual(ok.code, 0);
  assert.deepStrictEqual(JSON.parse(ok.stdout), { done: true, unsourced: [], unclosedFence: false });

  const bad = call(['check-evidence', '--folder', session(t, { 'evidence.md': '# E\n\nStatus: done\n\n- no source here\n' })], '/');
  assert.strictEqual(bad.code, 1);
  assert.strictEqual(JSON.parse(bad.stdout).unsourced.length, 1);

  const open = call(['check-evidence', '--folder', session(t, { 'evidence.md': '# E\n\nStatus: done\n\n```\n- a claim — source: #1\n' })], '/');
  assert.strictEqual(open.code, 1);
  assert.strictEqual(JSON.parse(open.stdout).unclosedFence, true);

  const wip = call(['check-evidence', '--folder', session(t, { 'evidence.md': '# E\n\nStatus: in-progress\n\n- a claim — source: #1\n' })], '/');
  assert.strictEqual(wip.code, 1);
});

test('check-notes passes round N as the expected round and names pending ids', (t) => {
  const ok = call(['check-notes', '--folder', session(t, { 'notes-round-1.md': notes(1) }), '--round', '1'], '/');
  assert.strictEqual(ok.code, 0);
  assert.strictEqual(JSON.parse(ok.stdout).ok, true);
  assert.deepStrictEqual(JSON.parse(ok.stdout).serious, ['1.1']);

  const pending = call(['check-notes', '--folder', session(t, { 'notes-round-1.md': notes(1, { pending: true }) }), '--round', '1'], '/');
  assert.strictEqual(pending.code, 1);
  const p = JSON.parse(pending.stdout);
  assert.deepStrictEqual(p.pending, ['1.1']);
  for (const k of ['serious', 'missingPerspectives', 'malformed']) assert.ok(Array.isArray(p[k]), k);

  const wrong = call(['check-notes', '--folder', session(t, { 'notes-round-2.md': notes(1) }), '--round', '2'], '/');
  assert.strictEqual(wrong.code, 1);
  assert.ok(JSON.parse(wrong.stdout).malformed[0].startsWith('line 1:'));
});

test('brief prints the prompt, and a refusal exits 1 with its reason on stdout', (t) => {
  const dir = session(t);
  const ok = call(['brief', '--folder', dir, '--reader', 'user', '--round', '1'], '/');
  assert.strictEqual(ok.code, 0);
  assert.ok(ok.stdout.includes(FRAME_SENTINEL), 'the session frame is in the printed prompt');
  assert.ok(ok.stdout.includes(BOARD_SENTINEL), 'the session storyboard is in the printed prompt');

  const builder = call(['brief', '--folder', dir, '--reader', 'builder'], '/');
  assert.strictEqual(builder.code, 0);

  const cap = call(['brief', '--folder', dir, '--reader', 'user', '--round', '5'], '/');
  assert.strictEqual(cap.code, 1);
  assert.strictEqual(JSON.parse(cap.stdout).reason, 'round-cap');

  const stale = call(['brief', '--folder', session(t, { 'notes-round-1.md': notes(1) }), '--reader', 'user', '--round', '2'], '/');
  assert.strictEqual(stale.code, 1);
  assert.strictEqual(JSON.parse(stale.stdout).reason, 'stale-storyboard');

  const pending = call(['brief', '--folder', session(t, { 'notes-round-1.md': notes(1, { pending: true }) }), '--reader', 'user', '--round', '2'], '/');
  assert.strictEqual(JSON.parse(pending.stdout).reason, 'pending-outcomes');

  const noFrame = call(['brief', '--folder', session(t, { 'design.md': '# T\n' }), '--reader', 'user', '--round', '1'], '/');
  assert.strictEqual(JSON.parse(noFrame.stdout).reason, 'no-frame');

  const noBoard = call(['brief', '--folder', session(t, { 'design.md': '# T\n\n## Frame\n\nStatus: done\n\nf\n' }), '--reader', 'user', '--round', '1'], '/');
  assert.strictEqual(JSON.parse(noBoard.stdout).reason, 'no-storyboard');
});

test('malformed invocations exit 2 with a stderr message', (t) => {
  const dir = session(t);
  const cases = [
    [],
    ['nonsense'],
    ['folder'],
    ['folder', '--topic', '!!!', '--root', dir],
    ['status'],
    ['status', '--folder', path.join(dir, 'absent')],
    ['status', '--folder'],
    ['status', '--folder', dir, '--bogus'],
    ['check-evidence', '--folder', scratch(t)],
    ['check-notes', '--folder', dir],
    ['check-notes', '--folder', dir, '--round', '0'],
    ['check-notes', '--folder', dir, '--round', '1'],
    ['brief', '--folder', dir],
    ['brief', '--folder', dir, '--reader', 'user'],
    ['brief', '--folder', dir, '--reader', 'user', '--round', 'x'],
    ['constructor', 'x'],
  ];
  for (const argv of cases) {
    const r = call(argv, '/');
    assert.strictEqual(r.code, 2, JSON.stringify(argv));
    assert.ok(r.stderr.includes('design-session.js:'), JSON.stringify(argv));
  }
});

test('an unknown reader is refused as data', (t) => {
  const r = call(['brief', '--folder', session(t), '--reader', 'nobody', '--round', '1'], '/');
  assert.strictEqual(r.code, 1);
  assert.strictEqual(JSON.parse(r.stdout).reason, 'unknown-reader');
});

test('script entry: shebang, exit code and the real reader-briefs file', (t) => {
  const dir = session(t);
  const r = spawnCli(CLI, ['brief', '--folder', dir, '--reader', 'smallest', '--round', '1'], { env: {} });
  assert.strictEqual(r.code, 0, r.stderr);
  assert.ok(r.stdout.includes('the smallest version that would do'));
  const bad = spawnCli(CLI, ['status'], { env: {} });
  assert.strictEqual(bad.code, 2);
  assert.ok(readText(CLI).startsWith('#!/usr/bin/env node'));
});

test('fix6: --create on any verb but folder is a usage error', (t) => {
  const dir = session(t);
  for (const argv of [['status', '--folder', dir, '--create'], ['check-evidence', '--folder', dir, '--create'],
    ['check-notes', '--folder', dir, '--round', '1', '--create'], ['brief', '--folder', dir, '--reader', 'builder', '--create']]) {
    const r = call(argv, '/');
    assert.strictEqual(r.code, 2, JSON.stringify(argv));
    assert.ok(r.stderr.includes('--create'), JSON.stringify(argv));
  }
});

test('fix1: a symlinked storyboard refuses through the CLI with exit 1', (t) => {
  const dir = session(t);
  const outside = path.join(scratch(t), 'o.md');
  fs.writeFileSync(outside, 'OUTSIDE');
  fs.rmSync(path.join(dir, 'storyboard.md'));
  fs.symlinkSync(outside, path.join(dir, 'storyboard.md'));
  const r = call(['brief', '--folder', dir, '--reader', 'user', '--round', '1'], '/');
  assert.strictEqual(r.code, 1);
  assert.strictEqual(JSON.parse(r.stdout).reason, 'symlink');
  assert.ok(!r.stdout.includes('OUTSIDE'));
});

// --- parts, digest, check-approval, mark-filed (#6353) ---
const { TABLE_HEADER, approvalLine, partsDigest, estimate, parseParts } = require('../../../plugin/bin/lib/design-session/parts');

const REPO = 'thn-inc/claude-tweaks';
const REMOTE = 'git@github.com:thn-inc/claude-tweaks.git';
const partRow = (n, name, size, waits, issue = '') => `| ${n} | ${name} | ${size} | ${REPO} | ${waits} | ${issue} |`;
const FOUR_ROWS = [
  partRow(1, 'Parser', 'size:low', '—'),
  partRow(2, 'Decomposition branch', 'size:medium', 'Parser'),
  partRow(3, 'Skill steps', 'size:medium', 'Parser'),
  partRow(4, 'Docs and help', 'size:low', 'Decomposition branch, Skill steps'),
];

function orderDesign(approval) {
  return [
    '# Design', '',
    '## Frame', '', 'Status: done', '', 'Measure: weekly orders filed — for 4 weeks', '',
    '## Approaches', '', 'Status: done', '', 'Chosen: A', '',
    '## Parts', '', 'Status: done', '', `| ${TABLE_HEADER.join(' | ')} |`, `|${TABLE_HEADER.map(() => '---').join('|')}|`,
    ...FOUR_ROWS, '',
    ...(approval === undefined ? [] : ['## Approval', '', 'Status: done', '', ...(approval ? [approval] : []), '']),
  ].join('\n');
}
const UNAPPROVED = orderDesign(null);
const APPROVED_LINE = approvalLine('2026-11-28', partsDigest(UNAPPROVED));
const APPROVED = orderDesign(APPROVED_LINE);

function orderFolder(t, text = APPROVED, name = '2026-11-27-factory-v7-slice1') {
  const dir = path.join(scratch(t), name);
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'design.md'), text);
  return dir;
}
// The gate reads GH_HOST and ~/.config/gh/hosts.yml unless told otherwise: pin both so the verdict is the fixture's, whatever the shell exports.
const GATE = { env: {}, readFile: () => { throw new Error('no hosts.yml'); } };
const withRemote = (url, gateDeps = GATE) => ({
  remoteUrl: () => { if (url instanceof Error) throw url; return url; },
  gateDeps,
});
const writeMarks = (t, value) => {
  const file = path.join(scratch(t), 'marks.json');
  fs.writeFileSync(file, typeof value === 'string' ? value : JSON.stringify(value));
  return file;
};

test('parts prints the table, its errors and the estimate; exit 0 only when present and clean', (t) => {
  const r = call(['parts', '--folder', orderFolder(t)], '/');
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.present, true);
  assert.deepStrictEqual(out.errors, []);
  assert.strictEqual(out.parts.length, 4);
  assert.strictEqual(out.estimate.line, estimate(out.parts).line);
  assert.match(out.estimate.line, /^Estimate: 4 parts/);

  const bad = call(['parts', '--folder', orderFolder(t, APPROVED.replace('size:low', 'size:huge'))], '/');
  assert.strictEqual(bad.code, 1);
  assert.ok(JSON.parse(bad.stdout).errors.length > 0);

  const none = call(['parts', '--folder', orderFolder(t, '# Design\n')], '/');
  assert.strictEqual(none.code, 1);
  assert.strictEqual(JSON.parse(none.stdout).present, false);
});

test('digest prints the 64-hex digest, or exit 1 missing-sections', (t) => {
  const r = call(['digest', '--folder', orderFolder(t)], '/');
  assert.strictEqual(r.code, 0);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.ok, true);
  assert.match(out.digest, /^[0-9a-f]{64}$/);
  assert.strictEqual(out.digest, partsDigest(APPROVED));

  const missing = call(['digest', '--folder', orderFolder(t, '# Design\n\n## Frame\n\nx\n')], '/');
  assert.strictEqual(missing.code, 1);
  assert.deepStrictEqual(JSON.parse(missing.stdout), { ok: false, reason: 'missing-sections' });
});

test('check-approval: approved fixture passes with the filing plan, slug and repository', (t) => {
  const r = call(['check-approval', '--folder', orderFolder(t)], '/', withRemote(REMOTE));
  assert.strictEqual(r.code, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.approved, true);
  assert.strictEqual(out.designSlug, 'factory-v7-slice1');
  assert.strictEqual(out.thisRepository, 'thn-inc/claude-tweaks');
  assert.deepStrictEqual(out.filing.file.map((p) => p.name), ['Parser', 'Decomposition branch', 'Skill steps', 'Docs and help']);
});

test('AC3.1: check-approval refuses with not-approved once the Approved: line is removed', (t) => {
  const r = call(['check-approval', '--folder', orderFolder(t, UNAPPROVED)], '/', withRemote(REMOTE));
  assert.strictEqual(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.reason, 'not-approved');
  assert.strictEqual(out.filing, undefined);
});

test('check-approval: an unresolved remote is no-repository, exit 1, however it fails', (t) => {
  for (const remote of [new Error('fatal: not a git repository'), 'not a url', '']) {
    const r = call(['check-approval', '--folder', orderFolder(t)], '/', withRemote(remote));
    assert.strictEqual(r.code, 1, String(remote));
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.reason, 'no-repository');
    assert.strictEqual(out.thisRepository, null);
    assert.strictEqual(out.filing, undefined);
  }
});

test('check-approval: an origin on an unknown host is refused as no-repository, with the gate\'s reason', (t) => {
  const r = call(['check-approval', '--folder', orderFolder(t)], '/', withRemote('git@git.corp.invalid:thn-inc/claude-tweaks.git'));
  assert.strictEqual(r.code, 1);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.reason, 'no-repository');
  assert.strictEqual(out.thisRepository, null);
  assert.match(out.repositoryRefusal, /git\.corp\.invalid/);
});

test('check-approval hands the folder to the remote seam', (t) => {
  const dir = orderFolder(t);
  const seen = [];
  const r = call(['check-approval', '--folder', dir], '/', { remoteUrl: (d) => { seen.push(d); return REMOTE; }, gateDeps: GATE });
  assert.strictEqual(r.code, 0);
  assert.deepStrictEqual(seen, [dir]);
});

test('mark-filed writes the mark in place, keeps the approval, and reports marked names (AC7.3)', (t) => {
  const dir = orderFolder(t);
  const r = call(['mark-filed', '--folder', dir, '--marks', writeMarks(t, { Parser: `${REPO}#7001` })], '/');
  assert.strictEqual(r.code, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), { marked: ['Parser'], unknown: [], conflicts: [] });
  const text = fs.readFileSync(path.join(dir, 'design.md'), 'utf8');
  assert.ok(text.includes(`| 1 | Parser | size:low | ${REPO} | — | ${REPO}#7001 |`));
  assert.strictEqual(parseParts(text).parts[0].issue, `${REPO}#7001`);
  const again = call(['check-approval', '--folder', dir], '/', withRemote(REMOTE));
  assert.strictEqual(again.code, 0);
});

test('mark-filed resolves a relative --marks against the injected cwd', (t) => {
  const dir = orderFolder(t);
  const marks = writeMarks(t, { Parser: `${REPO}#7001` });
  const r = call(['mark-filed', '--folder', dir, '--marks', path.basename(marks)], path.dirname(marks));
  assert.strictEqual(r.code, 0, r.stderr);
});

test('mark-filed refuses unknown names and conflicts, writing nothing', (t) => {
  const dir = orderFolder(t);
  const unknown = call(['mark-filed', '--folder', dir, '--marks', writeMarks(t, { Nope: `${REPO}#7001`, Parser: `${REPO}#7002` })], '/');
  assert.strictEqual(unknown.code, 1);
  assert.deepStrictEqual(JSON.parse(unknown.stdout).unknown, ['Nope']);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'design.md'), 'utf8'), APPROVED);

  const marked = call(['mark-filed', '--folder', dir, '--marks', writeMarks(t, { Parser: `${REPO}#7001` })], '/');
  assert.strictEqual(marked.code, 0);
  const after = fs.readFileSync(path.join(dir, 'design.md'), 'utf8');
  const conflict = call(['mark-filed', '--folder', dir, '--marks', writeMarks(t, { Parser: `${REPO}#7002`, 'Skill steps': `${REPO}#7003` })], '/');
  assert.strictEqual(conflict.code, 1);
  assert.deepStrictEqual(JSON.parse(conflict.stdout).conflicts, ['Parser']);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'design.md'), 'utf8'), after);
});

test('mark-filed exits 1 on a value that is not a repository-qualified mark, writing nothing', (t) => {
  const dir = orderFolder(t);
  for (const value of ['#7001', 'TBD', 'left for nowhere', 7001, null]) {
    const r = call(['mark-filed', '--folder', dir, '--marks', writeMarks(t, { Parser: value })], '/');
    assert.strictEqual(r.code, 1, String(value));
  }
  assert.strictEqual(fs.readFileSync(path.join(dir, 'design.md'), 'utf8'), APPROVED);
});

test('mark-filed: an unreadable or malformed --marks file is exit 2', (t) => {
  const dir = orderFolder(t);
  for (const marks of [writeMarks(t, 'not json'), writeMarks(t, '[1]'), writeMarks(t, 'null'), path.join(scratch(t), 'absent.json')]) {
    const r = call(['mark-filed', '--folder', dir, '--marks', marks], '/');
    assert.strictEqual(r.code, 2, marks);
    assert.ok(r.stderr.includes('design-session.js:'));
  }
  const missingFlag = call(['mark-filed', '--folder', dir], '/');
  assert.strictEqual(missingFlag.code, 2);
});

test('a missing design.md is exit 2 for parts, digest, check-approval and mark-filed', (t) => {
  const dir = scratch(t);
  const marks = writeMarks(t, { Parser: `${REPO}#7001` });
  for (const argv of [['parts'], ['digest'], ['check-approval'], ['mark-filed', '--marks', marks]]) {
    const r = call([argv[0], '--folder', dir, ...argv.slice(1)], '/', withRemote(REMOTE));
    assert.strictEqual(r.code, 2, argv[0]);
    assert.ok(r.stderr.includes('design.md'), argv[0]);
  }
});

test('--help names the four new verbs and --marks', (t) => {
  const r = call(['--help'], scratch(t));
  for (const word of ['parts', 'digest', 'check-approval', 'mark-filed', '--marks']) assert.ok(r.stdout.includes(word), word);
});

test('check-approval: an exported GH_HOST decides the host, on purpose', (t) => {
  const r = call(['check-approval', '--folder', orderFolder(t)], '/', withRemote('git@git.corp.invalid:thn-inc/claude-tweaks.git', { ...GATE, env: { GH_HOST: 'github.com' } }));
  assert.strictEqual(r.code, 0, r.stdout);
  assert.strictEqual(JSON.parse(r.stdout).thisRepository, 'thn-inc/claude-tweaks');
});

test('check-approval --repository is thisRepository and skips the origin read', (t) => {
  const boom = { remoteUrl: () => { throw new Error('origin must not be read'); }, gateDeps: GATE };
  const r = call(['check-approval', '--folder', orderFolder(t), '--repository', REPO], '/', boom);
  assert.strictEqual(r.code, 0, r.stderr + r.stdout);
  const out = JSON.parse(r.stdout);
  assert.strictEqual(out.thisRepository, REPO);
  assert.strictEqual(out.filing.file.length, 4);
  const other = call(['check-approval', '--folder', orderFolder(t), '--repository', 'thn-inc/other'], '/', boom);
  assert.strictEqual(other.code, 0);
  assert.strictEqual(JSON.parse(other.stdout).filing.file.length, 0);
});

test('--repository: a malformed value or another verb is exit 2', (t) => {
  const dir = orderFolder(t);
  for (const argv of [['check-approval', '--folder', dir, '--repository', 'nope'], ['check-approval', '--folder', dir, '--repository', 'a/b/c'],
    ['parts', '--folder', dir, '--repository', REPO], ['status', '--folder', dir, '--repository', 'nope']]) {
    const r = call(argv, '/', withRemote(REMOTE));
    assert.strictEqual(r.code, 2, JSON.stringify(argv));
    assert.ok(r.stderr.includes('--repository'), JSON.stringify(argv));
  }
});

test('mark-filed reports only the cells it changed; re-marking and an empty file leave design.md untouched', (t) => {
  const dir = orderFolder(t);
  const file = path.join(dir, 'design.md');
  const first = call(['mark-filed', '--folder', dir, '--marks', writeMarks(t, { Parser: `${REPO}#7001` })], '/');
  assert.deepStrictEqual(JSON.parse(first.stdout).marked, ['Parser']);
  const before = fs.statSync(file).mtimeMs;
  const again = call(['mark-filed', '--folder', dir, '--marks', writeMarks(t, { Parser: `${REPO}#7001` })], '/');
  assert.strictEqual(again.code, 0);
  assert.deepStrictEqual(JSON.parse(again.stdout).marked, []);
  const empty = call(['mark-filed', '--folder', dir, '--marks', writeMarks(t, {})], '/');
  assert.strictEqual(empty.code, 0);
  assert.deepStrictEqual(JSON.parse(empty.stdout), { marked: [], unknown: [], conflicts: [] });
  assert.strictEqual(fs.statSync(file).mtimeMs, before);
});

test('a symlinked design.md is exit 2 for every parts verb, and nothing is written through it', (t) => {
  const dir = orderFolder(t);
  const outside = path.join(scratch(t), 'o.md');
  fs.writeFileSync(outside, APPROVED);
  fs.rmSync(path.join(dir, 'design.md'));
  fs.symlinkSync(outside, path.join(dir, 'design.md'));
  const marks = writeMarks(t, { Parser: `${REPO}#7001` });
  for (const argv of [['parts'], ['digest'], ['check-approval'], ['mark-filed', '--marks', marks]]) {
    const r = call([argv[0], '--folder', dir, ...argv.slice(1)], '/', withRemote(REMOTE));
    assert.strictEqual(r.code, 2, argv[0]);
    assert.ok(r.stderr.includes('design.md') && r.stderr.includes('symlink'), argv[0]);
  }
  assert.strictEqual(fs.readFileSync(outside, 'utf8'), APPROVED);
});

// --- status in the repository a part was left for (#6353 final review) ---
const OTHER = 'thn-inc/other';
const OTHER_REMOTE = 'git@github.com:thn-inc/other.git';

// A whole session through step 10 in REPO: Parser filed there, Skill steps left for OTHER.
function filedSession(t) {
  const done = (h, extra = []) => [`## ${h}`, '', 'Status: done', '', ...extra, 'body', ''].join('\n');
  const head = [`| ${TABLE_HEADER.join(' | ')} |`, `|${TABLE_HEADER.map(() => '---').join('|')}|`];
  const parts = (issues) => ['## Parts', '', 'Status: done', '', ...head,
    `| 1 | Parser | size:low | ${REPO} | — | ${issues[0]} |`,
    `| 2 | Skill steps | size:medium | ${OTHER} | Parser | ${issues[1]} |`, '', 'Estimate: 2 parts', ''].join('\n');
  const before = ['# T — design', '', done('Frame', ['Measure: fewer stops']), done('Storyboard', ['Round: 1', 'File: storyboard.md']),
    done('Perspectives'), done('Approaches'), done('Pre-mortem'), done('Builder check')];
  const digest = partsDigest([...before, parts(['', ''])].join('\n'));
  const design = [...before, parts([`${REPO}#7001`, `left for ${OTHER}`]),
    ['## Approval', '', 'Status: done', '', approvalLine('2026-11-28', digest), ''].join('\n'), done('Filing', ['Parent: #7000'])].join('\n');
  return session(t, { 'design.md': design, 'notes-round-1.md': notes(1).replace(/ — serious$/m, ' — minor') });
}
const statusOf = (r) => { assert.strictEqual(r.code, 0, r.stderr); const s = JSON.parse(r.stdout); return [s.resumeAt, s.action]; };

test('status --repository: the folder copied into the left-for repository resumes at step 10, skipping the origin read', (t) => {
  const dir = filedSession(t);
  const boom = { remoteUrl: () => { throw new Error('origin must not be read'); }, gateDeps: GATE };
  assert.deepStrictEqual(statusOf(call(['status', '--folder', dir, '--repository', OTHER], '/', boom)), [10, 'continue']);
  assert.deepStrictEqual(statusOf(call(['status', '--folder', dir, '--repository', REPO], '/', boom)), ['complete', null]);
});

test('status reads the origin through the gate: the left-for repository resumes at 10; a gated or absent origin keeps today\'s reading', (t) => {
  const dir = filedSession(t);
  const seen = [];
  const r = call(['status', '--folder', dir], '/', { remoteUrl: (d) => { seen.push(d); return OTHER_REMOTE; }, gateDeps: GATE });
  assert.deepStrictEqual(statusOf(r), [10, 'continue']);
  assert.deepStrictEqual(seen, [dir]);
  assert.deepStrictEqual(statusOf(call(['status', '--folder', dir], '/', withRemote(REMOTE))), ['complete', null]);
  for (const remote of ['git@git.corp.invalid:thn-inc/other.git', new Error('fatal: not a git repository'), '']) {
    assert.deepStrictEqual(statusOf(call(['status', '--folder', dir], '/', withRemote(remote))), ['complete', null], String(remote));
  }
});
