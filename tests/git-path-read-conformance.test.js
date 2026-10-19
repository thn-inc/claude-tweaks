'use strict';

// Pins plugin/skills/_shared/git-path-read.md: every plugin/bin argv that asks
// git for a path list (--name-only / --name-status) also passes -z on the same
// line, so core.quotepath cannot C-quote a non-ASCII path into a string no file
// matches. The one non-git exemption is `gh pr diff ... --name-only`, which has
// no -z flag (compose-subject.js).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BIN_DIR = path.join(__dirname, '..', 'plugin', 'bin');
const SHARED_DIR = path.join(__dirname, '..', 'plugin', 'skills', '_shared');

const NAME_FLAG = /(['"])--name-(?:only|status)\1/;
const Z_FLAG = /(['"])-z\1/;
const GH_PR_DIFF = /(['"])pr\1,\s*(['"])diff\2/;

function findViolations(files) {
  const violations = [];
  for (const { path: filePath, text } of files) {
    text.split('\n').forEach((line, index) => {
      if (!NAME_FLAG.test(line)) return;
      if (Z_FLAG.test(line) || GH_PR_DIFF.test(line)) return;
      violations.push({ path: filePath, line: index + 1, text: line.trim() });
    });
  }
  return violations;
}

function collectJsFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...collectJsFiles(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

test('findViolations: the gh pr diff exemption does not swallow a git line', () => {
  assert.equal(findViolations([{ path: 'x.js', text: "git(['diff', '--name-only', ref])" }]).length, 1);
  assert.equal(findViolations([{ path: 'x.js', text: "runner(['pr', 'diff', '7', '--name-only'])" }]).length, 0);
  assert.equal(findViolations([{ path: 'x.js', text: "git(['diff', '--name-only', '-z', ref])" }]).length, 0);
});

test('AC2.1: no plugin/bin git argv carries --name-only/--name-status without -z on the same line', () => {
  const files = collectJsFiles(BIN_DIR).map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
  assert.ok(files.length > 0, 'walked at least one plugin/bin file');
  assert.deepEqual(findViolations(files), []);
});

test('AC2.1 go-red: removing -z from a real reader line is a violation', () => {
  const file = path.join(BIN_DIR, 'lib', 'hooks', 'pre-tool-use.js');
  const live = fs.readFileSync(file, 'utf8');
  const needle = "'--name-status', '-z'";
  assert.ok(live.includes(needle), 'the live reader line is present');
  const broken = live.replace(needle, "'--name-status'");
  assert.equal(findViolations([{ path: file, text: live }]).length, 0);
  assert.equal(findViolations([{ path: file, text: broken }]).length, 1);
});

test('AC3.1: the _shared contract states the rule and names the reference implementations', () => {
  const contract = fs.readFileSync(path.join(SHARED_DIR, 'git-path-read.md'), 'utf8');
  for (const token of ['-z', '--end-of-options', 'changed-files.js', 'compose-subject.js', 'git-z.js']) {
    assert.ok(contract.includes(token), `git-path-read.md mentions ${token}`);
  }
  const discipline = fs.readFileSync(path.join(SHARED_DIR, 'git-discipline.md'), 'utf8');
  assert.ok(discipline.includes('git-path-read.md'), 'git-discipline.md points at git-path-read.md');
});
