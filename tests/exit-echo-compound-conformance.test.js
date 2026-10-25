'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// #4190: a skill-prose instruction that chains an exit-status echo onto a command in one Bash
// call (`cmd > out 2>&1; echo "exit=$?"`) is not safe in a worktree-isolated session, which
// refuses some chained shapes outright (`_shared/scratch-worktree.md` §7, e.g. a `gh` call with a
// piped `--jq`). The bounded-execution `cmd` is whatever the checked doc or claim names, so its
// shape is not known in advance. That is why skill prose must use plain separate calls, and why
// this sweep flags every `;`/`&&`-chained exit-status echo, not only the refused shapes. This
// live-corpus scan (not a frozen fixture) fails the moment a skill reintroduces the compound, so
// the regression is caught at the commit that adds it.

const SKILLS_DIR = path.join(__dirname, '..', 'plugin', 'skills');

// `_shared/scratch-worktree.md`'s §7 table catalogues refused and passing shapes verbatim, so
// its rows carry the compound on purpose. Nothing else is exempt.
const EXEMPT = new Set(['_shared/scratch-worktree.md']);

// Matches a command, then `;` or `&&`, then an exit-status echo, all on one line. Accepted limits
// (each pinned as a not-flagged fixture below, not bugs):
//   - a compound split across a line break is two lines, and neither line carries both halves;
//   - a backtick before the separator (`npm test` ; echo exit=$?) breaks the `[^`\n]*` run, so the
//     span is not read as one command;
//   - a span whose text opens with the separator itself (the description forms
//     `(`; echo exit=$?`)` and `(`&& echo exit=$?`)`) has no command before `;` or `&&`, so it is
//     not flagged, by design.
const COMPOUND_PATTERN = /[^\s`;&][^`\n]*(?:;|&&)\s*echo\s+["']?exit=\$\?/;

function findAllMdFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findAllMdFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

function relSkillPath(file) {
  return path.relative(SKILLS_DIR, file).split(path.sep).join('/');
}

// Returns [{ lineNumber, line }] for every line carrying a command, `;` or `&&`, then an exit-status
// echo. A span that opens with `;` or `&&` (a description such as (`; echo exit=$?`)) does not match.
function findCompoundSites(text) {
  const lines = text.split('\n');
  const sites = [];
  for (let i = 0; i < lines.length; i++) {
    if (COMPOUND_PATTERN.test(lines[i])) {
      sites.push({ lineNumber: i + 1, line: lines[i] });
    }
  }
  return sites;
}

// --- Proof the check can go red, and stays green on prose (synthetic fixtures) ---

test('findCompoundSites: flags a fenced cmd > out 2>&1; echo "exit=$?" line', () => {
  const text = 'cmd > /tmp/x.out 2>&1; echo "exit=$?"';
  assert.strictEqual(findCompoundSites(text).length, 1, 'must go red on the fenced compound');
});

test('findCompoundSites: flags an inline code span carrying the compound', () => {
  const text = '`cmd > out 2>&1; echo "exit=$?"`';
  assert.strictEqual(findCompoundSites(text).length, 1, 'must go red on the inline-span compound');
});

test('findCompoundSites: flags the unquoted foo; echo exit=$? form', () => {
  const text = 'foo; echo exit=$?';
  assert.strictEqual(findCompoundSites(text).length, 1, 'must go red on the unquoted form');
});

test('findCompoundSites: flags the && chaining form foo && echo "exit=$?"', () => {
  const text = 'foo && echo "exit=$?"';
  assert.strictEqual(findCompoundSites(text).length, 1, 'must go red on the && form');
});

test('findCompoundSites: does not flag a span that opens with ; (a description, not an instruction)', () => {
  const text = '(`; echo exit=$?`)';
  assert.deepStrictEqual(findCompoundSites(text), []);
});

test('findCompoundSites: does not flag a span that opens with && (a description, not an instruction)', () => {
  const text = '(`&& echo exit=$?`)';
  assert.deepStrictEqual(findCompoundSites(text), []);
});

test('findCompoundSites: accepted limit, a compound split across a line break is not flagged per line', () => {
  const text = 'cmd > out 2>&1;\necho "exit=$?"';
  assert.deepStrictEqual(findCompoundSites(text), []);
});

test('findCompoundSites: accepted limit, a backtick before the separator is not flagged', () => {
  const text = 'run `npm test` ; echo "exit=$?"';
  assert.deepStrictEqual(findCompoundSites(text), []);
});

test('findCompoundSites: does not flag prose that names the shape', () => {
  const text = 'never chain an exit-status echo onto it';
  assert.deepStrictEqual(findCompoundSites(text), []);
});

// --- Live-corpus sweep ---

test('sweep floor: at least 200 plugin/skills .md files are scanned, so a broken walker cannot pass vacuously', () => {
  const count = findAllMdFiles(SKILLS_DIR).length;
  assert.ok(count >= 200, `expected at least 200 skill .md files, scanned ${count}`);
});

test('no plugin/skills/**/*.md line chains an exit-status echo onto a command outside the exempt set', () => {
  const failures = [];
  for (const file of findAllMdFiles(SKILLS_DIR)) {
    const rel = relSkillPath(file);
    if (EXEMPT.has(rel)) continue;
    for (const site of findCompoundSites(readText(file))) {
      failures.push(`${rel}:${site.lineNumber}`);
    }
  }
  assert.deepStrictEqual(
    failures,
    [],
    'a `cmd; echo "exit=$?"` compound in skill prose can be refused in a worktree-isolated session ' +
      'depending on the command shape. Write it as three plain Bash calls ' +
      '(mktemp, cmd > "{tmp}" 2>&1, tail -20 "{tmp}") — see ' +
      '_shared/scratch-worktree.md §7. Offenders: ' +
      failures.join(', '),
  );
});

test('exempt files still exist and still carry a site, so a stale exemption is caught', () => {
  for (const rel of EXEMPT) {
    const abs = path.join(SKILLS_DIR, ...rel.split('/'));
    assert.ok(fs.existsSync(abs), `exempt ${rel} does not exist; drop it from EXEMPT`);
    assert.ok(
      findCompoundSites(readText(abs)).length > 0,
      `exempt ${rel} no longer carries a compound site; drop it from EXEMPT`,
    );
  }
});
