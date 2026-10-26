'use strict';

// Pins plugin/skills/_shared/git-path-read.md: every plugin/bin argv that asks
// git for a path list (--name-only / --name-status) also passes -z on the same
// line, so core.quotepath cannot C-quote a non-ASCII path into a string no file
// matches. The one non-git exemption is `gh pr diff ... --name-only`, which has
// no -z flag (compose-subject.js). The same lines also carry --end-of-options
// before a ref (second pin below). ls-files, ls-tree, --numstat, and
// status --porcelain readers are held to -z too, unless the line carries a
// `// git-path-read: not a path list (<reason>)` marker (findUnzippedReads).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

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
const TEMPLATE_Z_FLAG = /\s-z(?:\s|['"`])/;

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
// ls-tree always takes a tree-ish; --numstat takes a ref only under diff/log/show
// (`apply --numstat -z <patch>` reads a patch file, not a ref).
const LS_TREE_TOKEN = /(['"])ls-tree\1/;
const NUMSTAT_TOKEN = /(['"])--numstat\1/;
const REF_COMMAND_TOKEN = /(['"])(?:diff|log|show)\1/;

function findMissingEndOfOptions(files) {
  const violations = [];
  for (const { path: filePath, text } of files) {
    if (NO_REF_READERS.has(path.basename(filePath))) continue;
    text.split('\n').forEach((line, index) => {
      if (EXEMPT_MARKER.test(line)) return;
      const nameRead = NAME_FLAG.test(line) && Z_FLAG.test(line) && !GH_PR_DIFF.test(line);
      const treeRead = LS_TREE_TOKEN.test(line);
      const numstatRead = NUMSTAT_TOKEN.test(line) && REF_COMMAND_TOKEN.test(line);
      if (!nameRead && !treeRead && !numstatRead) return;
      if (END_OF_OPTIONS.test(line)) return;
      violations.push({ path: filePath, line: index + 1, text: line.trim() });
    });
  }
  return violations;
}

// Beyond --name-only/--name-status: ls-files, ls-tree, --numstat, and status --porcelain
// print paths too, so they carry -z on the same line. A read that never turns the output
// into a path (emptiness, exit code, display, counts for a caller-named path) says so with
// EXEMPT_MARKER at the end of its line. A line-based pin cannot see an argv array split
// across lines, so a covered reader keeps its argv on one line.
const PATH_LIST_TOKEN = /(['"])(?:ls-files|ls-tree|--numstat)\1/;
const STATUS_TOKEN = /(['"])status\1/;
const PORCELAIN_TOKEN = /(['"])--porcelain(?:=v[12])?\1/;
const SHORT_TOKEN = /(['"])(?:-s|--short)\1/;
const EXEC_TEMPLATE_READ = /\w*[eE]xec\w*\(\s*(['"`])git [^'"`\n]*(?:ls-files|ls-tree|--numstat|status[^'"`\n]*(?:--porcelain|--short|\s-s\b))[^'"`\n]*\1/;
const EXEMPT_MARKER = /\/\/ git-path-read: not a path list \([^)]+\)/;

function findUnzippedReads(files) {
  const violations = [];
  for (const { path: filePath, text } of files) {
    text.split('\n').forEach((line, index) => {
      if (EXEMPT_MARKER.test(line)) return;
      const isArgvRead = PATH_LIST_TOKEN.test(line) || (STATUS_TOKEN.test(line) && (PORCELAIN_TOKEN.test(line) || SHORT_TOKEN.test(line)));
      const argvViolation = isArgvRead && !Z_FLAG.test(line);
      const templateMatch = EXEC_TEMPLATE_READ.exec(line);
      const templateViolation = templateMatch !== null && !TEMPLATE_Z_FLAG.test(templateMatch[0]);
      if (argvViolation || templateViolation) {
        violations.push({ path: filePath, line: index + 1, text: line.trim() });
      }
    });
  }
  return violations;
}

// Reads the live file at relFile (under plugin/bin), asserts the needle is there and that
// the live text is clean, then asserts the text with needle -> replacement reports exactly
// one violation. Throws when the mutation does not turn the line red.
function assertGoesRed(relFile, needle, replacement) {
  const file = path.join(BIN_DIR, relFile);
  const live = readText(file);
  assert.ok(live.includes(needle), `${relFile} contains ${needle}`);
  assert.equal(findUnzippedReads([{ path: file, text: live }]).length, 0, `${relFile} is clean as shipped`);
  const broken = live.replace(needle, replacement);
  assert.equal(findUnzippedReads([{ path: file, text: broken }]).length, 1, `${relFile} reports one violation without ${needle}`);
}

// raw: true pin: a runGit/runGitAsync call that passes '-z' is reading NUL-delimited
// output, which runGit's default trim would corrupt (a first path beginning with a
// space loses it), so the same line also carries `raw: true`. A line the marker waives
// is not a path list.
const RUN_GIT_CALL = /\brunGit(?:Async)?\(/;

function findUnrawRunGitZ(files) {
  const violations = [];
  for (const { path: filePath, text } of files) {
    text.split('\n').forEach((line, index) => {
      if (EXEMPT_MARKER.test(line)) return;
      if (RUN_GIT_CALL.test(line) && Z_FLAG.test(line) && !/\braw:\s*true\b/.test(line)) {
        violations.push({ path: filePath, line: index + 1, text: line.trim() });
      }
    });
  }
  return violations;
}

// Same shape as assertGoesRed, for the raw: true finder.
function assertRawGoesRed(relFile, needle, replacement) {
  const file = path.join(BIN_DIR, relFile);
  const live = readText(file);
  assert.ok(live.includes(needle), `${relFile} contains ${needle}`);
  assert.equal(findUnrawRunGitZ([{ path: file, text: live }]).length, 0, `${relFile} is clean as shipped`);
  const broken = live.replace(needle, replacement);
  assert.equal(findUnrawRunGitZ([{ path: file, text: broken }]).length, 1, `${relFile} reports one violation without ${needle}`);
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
  const live = readText(file);
  const needle = "'--name-status', '-z'";
  assert.ok(live.includes(needle), 'the live reader line is present');
  const broken = live.replace(needle, "'--name-status'");
  assert.equal(findViolations([{ path: file, text: live }]).length, 0);
  assert.equal(findViolations([{ path: file, text: broken }]).length, 1);
});

test('findUnzippedReads: an ls-files/ls-tree/numstat/status argv without -z is flagged, with -z or the marker it passes', () => {
  const cases = [
    ["git(['ls-files', '--', dir])", "git(['ls-files', '-z', '--', dir])"],
    ["git(['ls-tree', '-r', ref])", "git(['ls-tree', '-r', '-z', ref])"],
    ["git(['diff', '--numstat', ref])", "git(['diff', '--numstat', '-z', ref])"],
    ["git(['status', '--porcelain'])", "git(['status', '--porcelain', '-z'])"],
    ["git(['status', '--porcelain=v1', '-uall'])", "git(['status', '--porcelain=v1', '-z', '-uall'])"],
    ["git(['status', '--porcelain=v2', '--branch'])", "git(['status', '--porcelain=v2', '-z', '--branch'])"],
    ["git(['status', '-s', '--', dir])", "git(['status', '-s', '-z', '--', dir])"],
    ["git(['status', '--short', '--', dir])", "git(['status', '--short', '-z', '--', dir])"],
  ];
  for (const [bad, good] of cases) {
    assert.equal(findUnzippedReads([{ path: 'x.js', text: bad }]).length, 1, bad);
    assert.equal(findUnzippedReads([{ path: 'x.js', text: good }]).length, 0, good);
    const marked = `${bad} // git-path-read: not a path list (emptiness only)`;
    assert.equal(findUnzippedReads([{ path: 'x.js', text: marked }]).length, 0, marked);
  }
  assert.equal(findUnzippedReads([{ path: 'x.js', text: "git(['status', '-b'])" }]).length, 0, 'status without --porcelain is not a path read');
});

test('findUnzippedReads: an exec template string is held to -z, and the marker exempts it', () => {
  const bad = "const out = execSync('git -C x status --porcelain -b', { cwd });";
  const badShort = "const out = execSync('git -C x status --short', { cwd });";
  const goodShort = "const out = execSync('git -C x status --short -z', { cwd });";
  const marked = `${bad} // git-path-read: not a path list (branch and dirty flag only)`;
  const good = "const out = execSync('git ls-files -z', { cwd });";
  const goodTick = 'const out = execFn(`git ls-files -z`, opts);';
  const label = "const command = opts.range ? `git ls-files ${opts.range}` : 'x';";
  assert.equal(findUnzippedReads([{ path: 'x.js', text: bad }]).length, 1);
  assert.equal(findUnzippedReads([{ path: 'x.js', text: marked }]).length, 0);
  assert.equal(findUnzippedReads([{ path: 'x.js', text: badShort }]).length, 1);
  assert.equal(findUnzippedReads([{ path: 'x.js', text: goodShort }]).length, 0);
  assert.equal(findUnzippedReads([{ path: 'x.js', text: good }]).length, 0);
  assert.equal(findUnzippedReads([{ path: 'x.js', text: goodTick }]).length, 0);
  assert.equal(findUnzippedReads([{ path: 'x.js', text: label }]).length, 0);
});

test('AC2.1: no plugin/bin ls-files/ls-tree/numstat/status --porcelain read lacks -z or an exemption marker', () => {
  const files = collectJsFiles(BIN_DIR).map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
  assert.ok(files.length > 0, 'walked at least one plugin/bin file');
  assert.deepEqual(findUnzippedReads(files), []);
});

test('AC2.1 go-red: removing -z from any one covered reader is a violation', () => {
  assertGoesRed(path.join('lib', 'blast-radius-cli.js'), "'--numstat', '-z'", "'--numstat'");
  assertGoesRed(path.join('lib', 'wrap-up', 'engine-verify.js'), "'--porcelain=v1', '-z'", "'--porcelain=v1'");
  assertGoesRed(path.join('lib', 'reconcile', 'archive-merged.js'), "'ls-files', '-z', '--', runDir", "'ls-files', '--', runDir");
  assertGoesRed(path.join('lib', 'issues', 'claims-git-cas.js'), "'ls-tree', '-r', '-z'", "'ls-tree', '-r'");
});

test('AC2.1 go-red control: a mutation that leaves -z in place does not go red, so the helper can fail', () => {
  // '--no-renames' first occurs on the numstat reader line; dropping it leaves -z
  // there, so the only assertion that can fail is the "exactly one violation" one.
  assert.throws(
    () => assertGoesRed(path.join('lib', 'blast-radius-cli.js'), "'--no-renames', ", ''),
    { name: 'AssertionError', message: /reports one violation without/ },
  );
});

test('findMissingEndOfOptions: flags a ref-taking line without the separator, passes one with it', () => {
  const without = "git(['diff', '--name-only', '-z', ref])";
  const withSep = "git(['diff', '--name-only', '-z', '--end-of-options', ref])";
  assert.equal(findMissingEndOfOptions([{ path: 'x.js', text: without }]).length, 1);
  assert.equal(findMissingEndOfOptions([{ path: 'x.js', text: withSep }]).length, 0);
  assert.equal(findMissingEndOfOptions([{ path: 'lib/hooks/pre-tool-use.js', text: without }]).length, 0);
});

test('findMissingEndOfOptions: ls-tree and diff/log/show --numstat take a ref; apply --numstat and marked lines do not', () => {
  const missing = (text) => findMissingEndOfOptions([{ path: 'x.js', text }]).length;
  assert.equal(missing("git(['ls-tree', '-z', treeSha])"), 1);
  assert.equal(missing("git(['ls-tree', '-z', '--end-of-options', treeSha])"), 0);
  assert.equal(missing("git(['diff', '--numstat', '-z', range])"), 1);
  assert.equal(missing("git(['log', '--numstat', '-z', range])"), 1);
  assert.equal(missing("git(['show', '--numstat', '-z', sha])"), 1);
  assert.equal(missing("git(['diff', '--numstat', '-z', '--end-of-options', range])"), 0);
  assert.equal(missing("git(['apply', '--numstat', '-z', patch])"), 0);
  assert.equal(missing("git(['ls-tree', '-z', treeSha]) // git-path-read: not a path list (emptiness only)"), 0);
});

test('every plugin/bin path-list argv that takes a ref also passes --end-of-options on the same line', () => {
  const files = collectJsFiles(BIN_DIR).map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
  assert.deepEqual(findMissingEndOfOptions(files), []);
});

test('--end-of-options go-red: removing it from a real reader line is a violation', () => {
  const file = path.join(BIN_DIR, 'lib', 'wrap-up', 'facts.js');
  const live = readText(file);
  const needle = "'-z', '--end-of-options', `${base}...HEAD`], { trim: false }));";
  assert.ok(live.includes(needle), 'the live reader line is present');
  const broken = live.replace(needle, "'-z', `${base}...HEAD`], { trim: false }));");
  assert.equal(findMissingEndOfOptions([{ path: file, text: live }]).length, 0);
  assert.equal(findMissingEndOfOptions([{ path: file, text: broken }]).length, 1);
});

test('findUnrawRunGitZ: a runGit -z call without raw: true is flagged; raw: true, no -z, and the marker pass', () => {
  const flagged = (text) => findUnrawRunGitZ([{ path: 'x.js', text }]).length;
  assert.equal(flagged("const r = runGit(['ls-files', '-z'], root);"), 1);
  assert.equal(flagged("const r = await runGitAsync(['ls-files', '-z'], root);"), 1);
  assert.equal(flagged("const r = runGit(['ls-files', '-z'], root, { raw: true });"), 0);
  assert.equal(flagged("const r = runGit(['ls-files', '-z', '--', rel], root, { env: repoPinnedEnv(), raw: true });"), 0);
  assert.equal(flagged("const r = runGit(['status'], dir);"), 0);
  assert.equal(flagged("const r = runGit(['ls-files', '-z'], root); // git-path-read: not a path list (emptiness only)"), 0);
});

test('every plugin/bin runGit/runGitAsync call that passes -z also passes raw: true on the same line', () => {
  const files = collectJsFiles(BIN_DIR).map((p) => ({ path: p, text: fs.readFileSync(p, 'utf8') }));
  assert.ok(files.length > 0, 'walked at least one plugin/bin file');
  assert.deepEqual(findUnrawRunGitZ(files), []);
});

test('raw: true go-red: removing it from a real -z runGit caller is a violation', () => {
  assertRawGoesRed(path.join('lib', 'hooks', 'worktree-reap.js'), 'branch], repoRoot, { raw: true }', 'branch], repoRoot');
  assertRawGoesRed(path.join('lib', 'reconcile', 'archive-merged.js'), "'ls-files', '-z', '--', runDir], root, { raw: true }", "'ls-files', '-z', '--', runDir], root");
});

test('AC3.1: the _shared contract states the rule and names the reference implementations', () => {
  const contract = readText(path.join(SHARED_DIR, 'git-path-read.md'));
  const tokens = [
    '-z', '--end-of-options', 'changed-files.js', 'compose-subject.js', 'git-z.js',
    'parseNumstatZ', 'parseStatusPorcelainZ', 'parseLsTreeZ', 'unquoteCPath', 'git-path-read: not a path list',
  ];
  for (const token of tokens) {
    assert.ok(contract.includes(token), `git-path-read.md mentions ${token}`);
  }
  const discipline = readText(path.join(SHARED_DIR, 'git-discipline.md'));
  assert.ok(discipline.includes('git-path-read.md'), 'git-discipline.md points at git-path-read.md');
});
