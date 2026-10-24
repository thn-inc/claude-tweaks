'use strict';
// #3792: skill call sites that put git- or user-supplied text into a log-decision.js
// entry pass it through `--text-file`, never a double-quoted `--text` (a file name,
// path list, stderr reason or branch name may carry `"`, `$`, a backtick or `\`).
// Canonical rule: _shared/auto-decision-log.md's "Text from git or a user" paragraph.
// One row per migrated site; later migrations append rows to SITES.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const TEXT_FILE = '--text-file "{text-file}"';
const CANONICAL = 'Text from git or a user';
const WINDOW = 400;

// `content` is the exact text-file line (= the former `--text` argument).
const SITES = [
  { id: 'W1', file: 'plugin/skills/flow/multispec-parallel-waves.md', content: 'condition: preflight-records.js --waves exited non-zero ({stderr reason}) → fallback: sequential run.' },
  { id: 'W2', file: 'plugin/skills/flow/multispec-parallel-waves.md', content: '#{N} merged; git worktree remove refused ({reason}); {worktreePath} and {worktreeBranch} left for manual cleanup.' },
  { id: 'W3', file: 'plugin/skills/flow/multispec-parallel-waves.md', content: '#{N} conflicted at merge-back ({paths}); re-run sequentially.' },
  { id: 'W4', file: 'plugin/skills/flow/multispec-parallel-waves.md', content: 'condition: per-spec worktree unavailable ({reason}) → fallback: sequential' },
  { id: 'G1', file: 'plugin/skills/flow/steps-and-gates.md', content: 'the filled note line' },
  { id: 'D1', file: 'plugin/skills/dispatch/two-call-gate.md', content: 'Artifact check failed: {message}' },
  { id: 'T1', file: 'plugin/skills/tidy/release-note-repair.md', content: '{ref}: {stderr reason} → not written' },
];

const collapse = (text) => text.replace(/\s+/g, ' ');

// Throws an Error naming `--text-file` when the site still passes its text as a quoted `--text`
// or lacks the file-based form / the canonical citation / carries an escape instruction.
function checkSite(text, site) {
  const flat = collapse(text);
  if (flat.includes('--text "' + site.content) || flat.includes("--text '" + site.content)) {
    throw new Error(`${site.id}: text passed as a quoted --text, not --text-file`);
  }
  const idx = flat.indexOf(site.content);
  if (idx < 0 || flat.lastIndexOf(site.content) !== idx) {
    throw new Error(`${site.id}: content must appear exactly once (as the --text-file line)`);
  }
  const before = flat.slice(Math.max(0, idx - WINDOW), idx);
  if (!before.includes(TEXT_FILE)) {
    throw new Error(`${site.id}: no --text-file "{text-file}" before its text`);
  }
  const win = flat.slice(Math.max(0, idx - WINDOW), idx + site.content.length + WINDOW);
  if (!win.includes(CANONICAL)) {
    throw new Error(`${site.id}: --text-file site does not cite _shared/auto-decision-log.md's "${CANONICAL}" paragraph`);
  }
  if (/escape any|'\\''|single-quoted/i.test(win)) {
    throw new Error(`${site.id}: --text-file site carries an escape instruction; the file form needs none`);
  }
}

// Puts the site back to a quoted `--text`: the last `--text-file "{text-file}"` within the
// WINDOW chars before the content becomes `--text "<content>"`.
function revertSite(text, site) {
  const flat = collapse(text);
  const idx = flat.indexOf(site.content);
  assert.ok(idx >= 0, `${site.id}: content not found, nothing to revert`);
  const start = Math.max(0, idx - WINDOW);
  const at = flat.slice(start, idx).lastIndexOf(TEXT_FILE);
  assert.ok(at >= 0, `${site.id}: no ${TEXT_FILE} within ${WINDOW} chars before the content`);
  const pos = start + at;
  const reverted = flat.slice(0, pos) + `--text "${site.content}"` + flat.slice(pos + TEXT_FILE.length);
  assert.notStrictEqual(reverted, flat, `${site.id}: revert must change the text`);
  return reverted;
}

for (const site of SITES) {
  test(`AC1.2/AC2.1/AC2.2/AC3.1 pin: ${site.id} ${site.file} reads its text from --text-file`, () => {
    assert.doesNotThrow(() => checkSite(read(site.file), site));
  });

  // Go-red control: the SAME checkSite the pin uses must throw once the site reverts.
  test(`AC3.1 go-red: ${site.id} reverted to --text throws`, () => {
    assert.throws(() => checkSite(revertSite(read(site.file), site), site), /quoted --text, not --text-file/);
  });
}
