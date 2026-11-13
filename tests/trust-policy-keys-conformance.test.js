'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// Every caller of trustRows builds the policy it passes from TRUST_POLICY_KEYS
// (plugin/bin/lib/issues/trust.js), so a trust policy key added to that list
// reaches every caller at once. A caller that spells out the keys by hand
// silently ignores the next one: until #5291 every caller passed only
// trust-revert-window-days, so project policy for the evaluation window and the
// follow-up rate was dropped on the floor.
//
// A "site" is a call to trustRows whose first argument starts with an identifier
// (`trustRows(records, …)`). A prose mention (`trustRows()`, `` `trustRows` ``)
// and trust.js's own definition are not sites.
//   - plugin/bin/**/*.js: a file with a site must build a policy from the list,
//     `TRUST_POLICY_KEYS.map` or `Object.fromEntries(TRUST_POLICY_KEYS`, in its
//     comment-stripped text. File granularity, because a bin module builds its
//     policy once; a second site in the same file would share it.
//   - plugin/skills/**/*.md: a fenced block with a site must build a policy the
//     same way in the same fence. Block granularity, because each snippet is run
//     on its own by a reader who never sees the others.
// A bare mention (a require that names TRUST_POLICY_KEYS beside a hand-written
// `{ 'trust-revert-window-days': … }`) is flagged.
// Recall limits: a call whose first argument is not an identifier (an inline
// array literal, a call expression), or one reached through an alias
// (`const t = trustRows; t(…)`), is not seen; a `TRUST_POLICY_KEYS.map` anywhere
// in the file or fence satisfies the check without proving its result is the
// policy handed to the call (a second site in one file or fence that hand-builds
// its own policy beside a compliant one passes; the CLI behavior tests catch the
// bin case). The floor below and the exact site-file roster are what show the
// matcher still matches.
const ROOT = path.join(__dirname, '..');
const BIN_ROOT = path.join(ROOT, 'plugin', 'bin');
const SKILLS_ROOT = path.join(ROOT, 'plugin', 'skills');
const DEFINITION = path.join('plugin', 'bin', 'lib', 'issues', 'trust.js');
const SITE_RE = /\btrustRows\(\s*[A-Za-z_$]/g;
const KEYS_RE = /\bTRUST_POLICY_KEYS\s*\.\s*map\b|\bObject\.fromEntries\(\s*TRUST_POLICY_KEYS\b/;
const FENCE_RE = /```[^\n]*\r?\n([\s\S]*?)```/g;

// Manual withFileTypes walk: readdirSync's `recursive` option is ignored before
// Node 18.17, which would silently cover only the top level.
function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

function siteCount(text) {
  return (text.match(SITE_RE) || []).length;
}

// raw JS -> { sites, offenders: string[] }
function jsScan(raw, label) {
  const stripped = stripComments(raw);
  const verdict = stripperVerdict(raw, stripped);
  if (verdict !== 'ok') return { sites: 0, offenders: [`${label}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`] };
  const sites = siteCount(stripped);
  if (sites > 0 && !KEYS_RE.test(stripped)) {
    return { sites, offenders: [`${label}: ${sites} trustRows call site(s) but no policy built from TRUST_POLICY_KEYS in the file`] };
  }
  return { sites, offenders: [] };
}

// raw markdown -> { sites, offenders: string[] }
function mdScan(raw, label) {
  let sites = 0;
  const offenders = [];
  let n = 0;
  for (const m of raw.matchAll(FENCE_RE)) {
    n += 1;
    const here = siteCount(m[1]);
    sites += here;
    if (here > 0 && !KEYS_RE.test(m[1])) {
      offenders.push(`${label}: fenced block ${n} has ${here} trustRows call site(s) but no policy built from TRUST_POLICY_KEYS`);
    }
  }
  return { sites, offenders };
}

function scanTree() {
  const siteFiles = [];
  let sites = 0;
  const offenders = [];
  for (const file of walk(BIN_ROOT, '.js')) {
    const rel = path.relative(ROOT, file);
    if (rel === DEFINITION) continue;
    const r = jsScan(readText(file), rel);
    if (r.sites > 0) siteFiles.push(rel.split(path.sep).join('/'));
    sites += r.sites;
    offenders.push(...r.offenders);
  }
  for (const file of walk(SKILLS_ROOT, '.md')) {
    const rel = path.relative(ROOT, file);
    const r = mdScan(readText(file), rel);
    if (r.sites > 0) siteFiles.push(rel.split(path.sep).join('/'));
    sites += r.sites;
    offenders.push(...r.offenders);
  }
  return { siteFiles: siteFiles.sort(), sites, offenders };
}

test('AC8.1: every trustRows call site builds its policy from TRUST_POLICY_KEYS', () => {
  const { offenders } = scanTree();
  assert.deepEqual(offenders, []);
});

test('AC8.1 floor: the four known call sites are still matched, and no other file calls trustRows', () => {
  const { siteFiles, sites } = scanTree();
  // A lower count means the matcher stopped matching, not that the calls went away.
  assert.ok(sites >= 4, `expected at least 4 trustRows call sites, matched ${sites}`);
  assert.deepEqual(siteFiles, [
    'plugin/bin/lib/backlog-grant-gate/backlog-grant-gate.js',
    'plugin/skills/_shared/trust-table.md',
    'plugin/skills/backlog/trust-signal.md',
    'plugin/skills/capture/SKILL.md',
  ]);
});

test('AC8.2 go-red: the block checker flags a fence that hand-builds the policy', () => {
  const md = [
    'Prose that says trustRows() and TRUST_POLICY_KEYS outside any fence.',
    '',
    '```bash',
    'node -e "trustRows(r, g, n, { \'trust-revert-window-days\': process.argv[1] })"',
    '```',
    '',
  ].join('\n');
  const r = mdScan(md, 'planted.md');
  assert.equal(r.sites, 1);
  assert.equal(r.offenders.length, 1);
  assert.match(r.offenders[0], /fenced block 1 .*no policy built from TRUST_POLICY_KEYS/);
});

test('AC8.2 go-red: a fence that imports TRUST_POLICY_KEYS but hand-builds the policy is flagged', () => {
  const md = [
    '```bash',
    'node -e "',
    '  const { trustRows, TRUST_POLICY_KEYS } = require(root + \'/bin/lib/issues/trust.js\');',
    '  const policy = { \'trust-revert-window-days\': process.argv[1] };',
    '  trustRows(records, gitLog, Date.now(), policy);',
    '" -- "{resolved-window}"',
    '```',
    '',
  ].join('\n');
  const r = mdScan(md, 'bare-mention.md');
  assert.equal(r.sites, 1);
  assert.equal(r.offenders.length, 1);
});

test('AC8.2 control: the block checker passes a fence that names TRUST_POLICY_KEYS, and a prose-only mention', () => {
  const ok = [
    '```bash',
    'node -e "const policy = Object.fromEntries(TRUST_POLICY_KEYS.map((k, i) => [k, process.argv[1 + i]])); trustRows(r, g, n, policy)"',
    '```',
    '',
  ].join('\n');
  assert.deepEqual(mdScan(ok, 'ok.md'), { sites: 1, offenders: [] });
  assert.deepEqual(mdScan('Only prose: `trustRows()` and `trustRows` are named here.\n', 'prose.md'), { sites: 0, offenders: [] });
});

test('AC8.2 go-red: the block checker reads each fence on its own, and a CRLF file the same way', () => {
  const md = [
    '```bash',
    'const p = Object.fromEntries(TRUST_POLICY_KEYS.map((k) => [k, 1]));',
    '```',
    '',
    '```bash',
    'trustRows(records, log, now, p)',
    '```',
    '',
  ].join('\n');
  const split = mdScan(md, 'split.md');
  assert.equal(split.sites, 1);
  assert.equal(split.offenders.length, 1, 'the keys in another fence must not satisfy this one');
  assert.equal(mdScan(md.replace(/\n/g, '\r\n'), 'crlf.md').offenders.length, 1);
});

test('AC8.2 go-red: the js checker flags a call with a hand-built policy', () => {
  const r = jsScan('const rows = trustRows(records, log, now, {});\n', 'planted.js');
  assert.equal(r.sites, 1);
  assert.equal(r.offenders.length, 1);
  assert.match(r.offenders[0], /no policy built from TRUST_POLICY_KEYS in the file/);
});

test('AC8.2 go-red: a js file that imports TRUST_POLICY_KEYS but hand-builds the policy is flagged', () => {
  const src = [
    "const { trustRows, TRUST_POLICY_KEYS } = require('./trust');",
    "const rows = trustRows(records, log, now, { 'trust-revert-window-days': pol.windowDays });",
    '',
  ].join('\n');
  const r = jsScan(src, 'bare-mention.js');
  assert.equal(r.sites, 1);
  assert.equal(r.offenders.length, 1);
});

test('AC8.2 control: the js checker passes a file that names TRUST_POLICY_KEYS, ignores a comment-only mention, and skips a definition-free file', () => {
  assert.deepEqual(
    jsScan('const { trustRows, TRUST_POLICY_KEYS } = require("./trust");\nconst p = Object.fromEntries(TRUST_POLICY_KEYS.map((k) => [k, 1]));\ntrustRows(records, log, now, p);\n', 'ok.js'),
    { sites: 1, offenders: [] },
  );
  const commentOnly = jsScan('// TRUST_POLICY_KEYS\nconst rows = trustRows(records, log, now, {});\n', 'comment.js');
  assert.equal(commentOnly.offenders.length, 1, 'a comment naming the list must not satisfy the check');
  assert.deepEqual(jsScan('// trustRows(records) is called elsewhere\nmodule.exports = {};\n', 'none.js'), { sites: 0, offenders: [] });
});

test('AC8.2 go-red: the js checker reports a stripper mis-parse as an offender', () => {
  // A regex right after `)` is read as division, so its quote pairs with the next
  // string and the `//` inside it opens a comment that blanks the live call.
  const planted = 'if (b) /"/.test(b); const c = "//"; trustRows(x);\n';
  assert.equal(stripperVerdict(planted, stripComments(planted)), 'misparsed');
  const r = jsScan(planted, 'misparsed.js');
  assert.equal(r.offenders.length, 1);
  assert.ok(r.offenders[0].includes(STRIPPER_VERDICT_MESSAGES.misparsed));
});
