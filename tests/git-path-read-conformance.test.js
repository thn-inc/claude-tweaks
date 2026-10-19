'use strict';

// Pins plugin/skills/_shared/git-path-read.md: every plugin/bin argv that asks
// git for a path list (--name-only / --name-status) also passes -z on the same
// line, so core.quotepath cannot C-quote a non-ASCII path into a string no file
// matches. The one non-git exemption is `gh pr diff ... --name-only`, which has
// no -z flag (compose-subject.js). The same lines also carry --end-of-options
// before a ref (second pin below).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BIN_DIR = path.join(__dirname, '..', 'plugin', 'bin');
const SHARED_DIR = path.join(__dirname, '..', 'plugin', 'skills', '_shared');

const NAME_FLAG = /(['"])--name-(?:only|status)\1/;
const Z_FLAG = /(['"])-z\1/;
const GH_PR_DIFF = /(['"])pr\1,\s*(['"])diff\2/;

// A git command built as one template string and handed to an exec helper
// (backlog.js's execFn(`git log -z --name-only ...`)) has no quoted argv token for
// NAME_FLAG to see. Only a string passed straight to an exec-named call counts, so
// a message label that merely quotes a command is not mistaken for a read.
const EXEC_TEMPLATE_CMD = /\w*[eE]xec\w*\(\s*`git [^`\n]*--name-(?:only|status)[^`\n]*`/;
const TEMPLATE_Z_FLAG = /\s-z(?:\s|`)/;

function findViolations(files) {
  const violations = [];
  for (const { path: filePath, text } of files) {
    text.split('\n').forEach((line, index) => {
      const argvViolation = NAME_FLAG.test(line) && !Z_FLAG.test(line) && !GH_PR_DIFF.test(line);
      const templateMatch = EXEC_TEMPLATE_CMD.exec(line);
      const templateViolation = templateMatch !== null && !TEMPLATE_Z_FLAG.test(templateMatch[0]);
      if (argvViolation || templateViolation) {
        violations.push({ path: filePath, line: index + 1, text: line.trim() });
      }
    });
  }
  return violations;
}

// --end-of-options pin: a path-list argv that takes a ref, range, or sha carries
// '--end-of-options' on the same line. Two readers take none - pre-tool-use.js reads
// the staged index (--cached) and freshness.js's log is pathspec-only - so they are
// the named exemptions; a new no-ref reader joins this set deliberately.
const NO_REF_READERS = new Set(['pre-tool-use.js', 'freshness.js']);
const END_OF_OPTIONS = /(['"])--end-of-options\1/;

function findMissingEndOfOptions(files) {
  const violations = [];
  for (const { path: filePath, text } of files) {
    if (NO_REF_READERS.has(path.basename(filePath))) continue;
    text.split('\n').forEach((line, index) => {
      if (!NAME_FLAG.test(line) || !Z_FLAG.test(line) || GH_PR_DIFF.test(line)) return;
      if (END_OF_OPTIONS.test(line)) return;
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

test('findViolations: a git command built as a template string is held to -z too', () => {
  const bad = "const out = execFn(`git log --name-only --format=%x01%cI`, opts);";
  const good = "const out = execFn(`git log -z --name-only --format=%x01%cI`, opts);";
  const label = "const command = opts.range ? `git diff --name-only ${opts.range}` : 'x';";
  assert.equal(findViolations([{ path: 'x.js', text: bad }]).length, 1);
  assert.equal(findViolations([{ path: 'x.js', text: good }]).length, 0);
  assert.equal(findViolations([{ path: 'x.js', text: label }]).length, 0);
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

test('findMissingEndOfOptions: flags a ref-taking line without the separator, passes one with it', () => {
  const without = "git(['diff', '--name-only', '-z', ref])";
  const withSep = "git(['diff', '--name-only', '-z', '--end-of-options', ref])";
  assert.equal(findMissingEndOfOptions([{ path: 'x.js', text: without }]).length, 1);
  assert.equal(findMissingEndOfOptions([{ path: 'x.js', text: withSep }]).length, 0);
  assert.equal(findMissingEndOfOptions([{ path: 'lib/hooks/pre-tool-use.js', text: without }]).length, 0);
});

test('every plugin/bin path-list argv that takes a ref also passes --end-of-options on the same line', () => {
  const files = collectJsFiles(BIN_DIR).map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
  assert.deepEqual(findMissingEndOfOptions(files), []);
});

test('--end-of-options go-red: removing it from a real reader line is a violation', () => {
  const file = path.join(BIN_DIR, 'lib', 'wrap-up', 'facts.js');
  const live = fs.readFileSync(file, 'utf8');
  const needle = "'-z', '--end-of-options', `${base}...HEAD`], { trim: false }));";
  assert.ok(live.includes(needle), 'the live reader line is present');
  const broken = live.replace(needle, "'-z', `${base}...HEAD`], { trim: false }));");
  assert.equal(findMissingEndOfOptions([{ path: file, text: live }]).length, 0);
  assert.equal(findMissingEndOfOptions([{ path: file, text: broken }]).length, 1);
});

test('AC3.1: the _shared contract states the rule and names the reference implementations', () => {
  const contract = fs.readFileSync(path.join(SHARED_DIR, 'git-path-read.md'), 'utf8');
  for (const token of ['-z', '--end-of-options', 'changed-files.js', 'compose-subject.js', 'git-z.js']) {
    assert.ok(contract.includes(token), `git-path-read.md mentions ${token}`);
  }
  const discipline = fs.readFileSync(path.join(SHARED_DIR, 'git-discipline.md'), 'utf8');
  assert.ok(discipline.includes('git-path-read.md'), 'git-discipline.md points at git-path-read.md');
});
