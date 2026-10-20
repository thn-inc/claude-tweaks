// tests/specify-ceremony-tally-prose.test.js
// Pins that record-creation-subissues.md's manifest-accumulation snippet carries
// each sub-issue's ceremony tier, and that a "Ceremony tally" step exists between
// "Snapshot invalidation" and "### Rules" — the durable-record mechanism for #3128.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { readText } = require('./helpers/read-skill');

const REPO_ROOT = path.join(__dirname, '..');
const RECORD_CREATION = readText(
  path.join(REPO_ROOT, 'plugin/skills/specify/record-creation-subissues.md'),
);

test('manifest-accumulation entry object carries a ceremony field', () => {
  assert.ok(
    /entry\s*=\s*\{[^}]*ceremony\s*:\s*process\.argv\[\d+\][^}]*\}/.test(RECORD_CREATION),
    'the manifest entry object literal must include a ceremony: process.argv[n] field'
  );
});

test('the manifest-accumulation node -e call passes $SUB_ISSUE_CEREMONY as an argv', () => {
  const accumIdx = RECORD_CREATION.indexOf('Accumulate this unit for the cross-reference pass below');
  assert.ok(accumIdx >= 0, 'the Accumulate section must still exist');
  const section = RECORD_CREATION.slice(accumIdx, accumIdx + 2000);
  assert.ok(
    section.includes('$SUB_ISSUE_CEREMONY'),
    'the accumulation bash fence must pass $SUB_ISSUE_CEREMONY to the node -e call'
  );
});

test('a "Ceremony tally" step exists between Snapshot invalidation and ### Rules', () => {
  const snapshotIdx = RECORD_CREATION.indexOf('**Snapshot invalidation.**');
  const tallyIdx = RECORD_CREATION.indexOf('**Ceremony tally.**');
  const rulesIdx = RECORD_CREATION.indexOf('### Rules');
  assert.ok(snapshotIdx >= 0, 'Snapshot invalidation section must still exist');
  assert.ok(tallyIdx >= 0, 'a Ceremony tally section must exist');
  assert.ok(rulesIdx >= 0, '### Rules must still exist');
  assert.ok(snapshotIdx < tallyIdx, 'Ceremony tally must come after Snapshot invalidation');
  assert.ok(tallyIdx < rulesIdx, 'Ceremony tally must come before ### Rules');
});

test('the Ceremony tally step writes to docs/specify-decomposition-log.md on a 2+ threshold', () => {
  const tallyIdx = RECORD_CREATION.indexOf('**Ceremony tally.**');
  const section = RECORD_CREATION.slice(tallyIdx, tallyIdx + 2500);
  assert.ok(
    section.includes('docs/specify-decomposition-log.md'),
    'the Ceremony tally step must name the durable log file docs/specify-decomposition-log.md'
  );
  assert.ok(
    /ceremony\s*===\s*'standard'/.test(section) || /ceremony === "standard"/.test(section),
    'the tally must count entries whose ceremony field is exactly "standard"'
  );
  assert.ok(
    /standard\.length\s*<\s*2/.test(section),
    'the tally must gate the write on a 2-or-more threshold'
  );
  assert.ok(
    section.includes('CLAUDE_CODE_SESSION_ID'),
    'the written entry must include the session id as the transcript pointer'
  );
});

// --- Extract-and-run (#3128 fix wave 1) ---
// The fences below are pulled out of the live record-creation-subissues.md and executed
// as-is (docs/skill-authoring.md's "Executable snippets in skill prose" — the doc is the
// only source of the executed text). Extraction anchors on each step's bold label plus the
// next ```bash fence; a moved label fails loudly as "extraction pattern is out of sync".

const PLUGIN_ROOT = path.join(REPO_ROOT, 'plugin');
const SESSION_ID = 'ceremony-tally-test-session';

function fenceAfter(label) {
  const idx = RECORD_CREATION.indexOf(label);
  assert.ok(idx >= 0, `extraction pattern is out of sync: label ${label} not found`);
  const m = /```bash\n([\s\S]*?)\n```/.exec(RECORD_CREATION.slice(idx));
  assert.ok(m && m[1].trim(), `extraction pattern is out of sync: no bash fence after ${label}`);
  return m[1];
}

const INIT_FENCE = fenceAfter('**Fresh manifest for this invocation.**');
const ACCUM_FENCE = fenceAfter('**Accumulate this unit for the cross-reference pass below.**');
const TALLY_FENCE = fenceAfter('**Ceremony tally.**');

// A scratch project (cwd) plus a private TMPDIR so sessionTmpPath's root lands inside
// the scratch dir, never the machine's shared temp root.
function makeProject({ policy, workBackend = 'github-issues' } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-ceremony-tally-'));
  const cwd = path.join(root, 'proj');
  const tmp = path.join(root, 'tmp');
  fs.mkdirSync(cwd);
  fs.mkdirSync(tmp);
  if (policy !== undefined) {
    fs.mkdirSync(path.join(cwd, '.claude-tweaks'));
    fs.writeFileSync(path.join(cwd, '.claude-tweaks', 'policy.yml'), `specify-decomposition-log: ${policy}\n`);
  }
  fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), `# Fixture\n\n## Work records\n\nwork-backend: ${workBackend}\n`);
  const bodyFile = path.join(root, 'body.md');
  fs.writeFileSync(bodyFile, '## Current State\n\nfixture body\n');
  // Forward slashes: the fences interpolate this into a JS string literal
  // inside `node -e "..."`, where a win32 backslash path would be read as escapes.
  const env = {
    ...process.env,
    CLAUDE_PLUGIN_ROOT: PLUGIN_ROOT.split(path.sep).join('/'),
    CLAUDE_CODE_SESSION_ID: SESSION_ID,
    TMPDIR: tmp,
  };
  const run = (script, extra = {}) => {
    const r = spawnSync('bash', ['-c', script], { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `fence exited ${r.status}: ${r.stderr}`);
    return r;
  };
  const init = () => run(INIT_FENCE);
  const accumulate = (num, ceremony) => run(ACCUM_FENCE, {
    SUB_ISSUE_TITLE: `Unit ${num}`, SUB_ISSUE_NUM: String(num), SPECIFY_SUB_ISSUE_BODY: bodyFile, SUB_ISSUE_CEREMONY: ceremony,
  });
  const tally = () => run(TALLY_FENCE);
  const logPath = path.join(cwd, 'docs', 'specify-decomposition-log.md');
  const readLog = () => fs.readFileSync(logPath, 'utf8');
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { cwd, init, accumulate, tally, readLog, cleanup };
}

const HEADER_LINE = '# Specify Decomposition Event Log';
const entryCount = (log) => (log.match(/^### \d{4}-\d{2}-\d{2}T/gm) || []).length;

test('tally: exactly 2 ceremony:standard entries triggers the first-ever write, header included, no docs/ needed beforehand', (t) => {
  const p = makeProject({ policy: 'true' });
  t.after(p.cleanup);
  assert.ok(!fs.existsSync(path.join(p.cwd, 'docs')), 'precondition: the scratch project has no docs/ directory');
  p.init();
  p.accumulate(11, 'standard');
  p.accumulate(12, 'fast-lane');
  p.accumulate(13, 'standard');
  p.tally();
  const log = p.readLog();
  assert.ok(log.startsWith(HEADER_LINE + '\n'), 'a first-ever write must start with the log header');
  assert.strictEqual(entryCount(log), 1);
  assert.match(log, /- Sub-issues in this batch: 3\n/);
  assert.match(log, /sub-issues \(2\): #11, #13\n/);
  assert.match(log, new RegExp(`sessionId ${SESSION_ID}, host ${os.hostname().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, cwd `));
});

test('tally: below threshold (1 ceremony:standard) is a silent no-op — no file, no docs/ directory', (t) => {
  const p = makeProject({ policy: 'true' });
  t.after(p.cleanup);
  p.init();
  p.accumulate(21, 'standard');
  p.accumulate(22, 'fast-lane');
  const r = p.tally();
  assert.strictEqual(r.stderr, '', 'below threshold must print nothing');
  assert.ok(!fs.existsSync(path.join(p.cwd, 'docs')), 'below threshold must not create docs/');
});

test('tally: a second qualifying batch appends an entry without repeating the header', (t) => {
  const p = makeProject({ policy: 'true' });
  t.after(p.cleanup);
  p.init(); p.accumulate(31, 'standard'); p.accumulate(32, 'standard'); p.tally();
  p.init(); p.accumulate(41, 'standard'); p.accumulate(42, 'standard'); p.tally();
  const log = p.readLog();
  assert.strictEqual(log.split(HEADER_LINE).length - 1, 1, 'header must appear exactly once');
  assert.strictEqual(entryCount(log), 2);
  assert.match(log, /\(2\): #41, #42\n/);
});

test('fresh-manifest init: a second invocation in the same session tallies only its own batch', (t) => {
  const p = makeProject({ policy: 'true' });
  t.after(p.cleanup);
  p.init(); p.accumulate(51, 'standard'); p.accumulate(52, 'standard'); p.tally();
  assert.strictEqual(entryCount(p.readLog()), 1);
  // Second decomposition, same session id: the init fence resets the shared manifest,
  // so one standard sub-issue stays below threshold instead of counting as 3.
  p.init(); p.accumulate(61, 'standard'); p.tally();
  assert.strictEqual(entryCount(p.readLog()), 1, 'the second batch (1 standard) must not trigger');
});

test('fresh-manifest init is what prevents the cross-invocation count (go-red control)', (t) => {
  const p = makeProject({ policy: 'true' });
  t.after(p.cleanup);
  p.init(); p.accumulate(71, 'standard'); p.accumulate(72, 'standard');
  // Skip the init fence for the "second invocation" — the pre-fix behavior.
  p.accumulate(81, 'standard'); p.tally();
  assert.match(p.readLog(), /\(3\): #71, #72, #81\n/, 'without the reset the stale entries are counted');
});

test('tally: work-backend local-files renders bare record ids, no # prefix', (t) => {
  const p = makeProject({ policy: 'true', workBackend: 'local-files' });
  t.after(p.cleanup);
  p.init(); p.accumulate(7, 'standard'); p.accumulate(8, 'standard'); p.tally();
  assert.match(p.readLog(), /sub-issues \(2\): 7, 8\n/);
});

test('policy gate: specify-decomposition-log unset or false makes the whole step a no-op', (t) => {
  for (const policy of [undefined, 'false']) {
    const p = makeProject({ policy });
    t.after(p.cleanup);
    p.init(); p.accumulate(91, 'standard'); p.accumulate(92, 'standard'); p.accumulate(93, 'standard');
    const r = p.tally();
    assert.strictEqual(r.stderr, '', `policy ${policy}: no output expected`);
    assert.ok(!fs.existsSync(path.join(p.cwd, 'docs')), `policy ${policy}: no docs/ write expected`);
  }
});
