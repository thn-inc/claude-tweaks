'use strict';
// tests/diff-facts-parse-numstat-conformance.test.js — pins two contracts on the skill prose.
// #2869: the two skill docs that tell the agent to derive diff facts name `parseNumstatZ`
// (git-z.js) before `computeDiffFacts`, because `computeDiffFacts` takes the parsed
// `{path, additions, deletions}[]` array, never raw `git diff --numstat -z` output. #3955:
// ceremony-derivation.md step 1 names exactly one `diff-facts.js` command, carries no hand-composed
// `git merge-base`, and that command runs for real. Reads live skill prose deliberately — the prose
// IS the contract an agent follows.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

const ROOT = path.join(__dirname, '..');
// PLUGIN: the plugin root as it is spliced into the command text, forward-slashed so no backslash
// reaches the shell. `ROOT` itself stays native for readText.
const PLUGIN = toPosix(path.join(ROOT, 'plugin'), path.sep);
const read = (...p) => readText(path.join(ROOT, ...p));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');
const CEREMONY = read('plugin', 'skills', 'wrap-up', 'ceremony-derivation.md');

// assertNamesParser(text, label): the paragraph (blank-line-delimited block) containing
// `computeDiffFacts` also contains `parseNumstatZ` and `git-z.js`, with
// `parseNumstatZ` followed by `computeDiffFacts` within 400 characters (adjacency, not just
// first-occurrence order, because the dispatch.md block is one very long paragraph).
function assertNamesParser(text, label) {
  const block = text.split(/\n\s*\n/).find((b) => b.includes('computeDiffFacts'));
  assert.ok(block, `${label}: no paragraph contains computeDiffFacts`);
  assert.ok(block.includes('parseNumstatZ'), `${label}: paragraph does not name parseNumstatZ`);
  assert.ok(block.includes('git-z.js'), `${label}: paragraph does not name git-z.js`);
  assert.match(
    block,
    /parseNumstatZ[\s\S]{0,400}?computeDiffFacts/,
    `${label}: parseNumstatZ must be followed by computeDiffFacts within 400 characters`,
  );
}

test('AC1.1: build/dispatch.md names parseNumstatZ before computeDiffFacts', () => {
  assertNamesParser(DISPATCH, 'build/dispatch.md');
});

test('AC1.1: wrap-up/ceremony-derivation.md names parseNumstatZ before computeDiffFacts', () => {
  assertNamesParser(CEREMONY, 'wrap-up/ceremony-derivation.md');
});

test('negative control: the assertion throws on each way a paragraph can fail to name the parser', () => {
  // No parseNumstatZ at all.
  assert.throws(() => assertNamesParser('… `computeDiffFacts` over `git diff --numstat -z` output …', 'control'));
  // parseNumstatZ named only after computeDiffFacts.
  assert.throws(() =>
    assertNamesParser('… `computeDiffFacts` over the output, then `parseNumstatZ` (`bin/lib/git-z.js`) …', 'control'));
  // parseNumstatZ named but the module that exports it is not.
  assert.throws(() => assertNamesParser('… `parseNumstatZ` first, then `computeDiffFacts` …', 'control'));
});

// commandFactsMissing(text): the #3955 facts ceremony-derivation.md must state, returning the ones
// it does not. The one command is a single process, so the merge-base is never a separate or
// substituted call in the skill prose.
const ONE_COMMAND = 'exactly one diff-facts.js line, the documented command';
const NO_MERGE_BASE = 'no git merge-base anywhere in the file';
const COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/diff-facts.js" --integration-branch {integration-branch}';
function commandFactsMissing(text) {
  const missing = [];
  const named = text.split('\n').filter((l) => l.includes('diff-facts.js'));
  if (named.length !== 1 || named[0].trim() !== COMMAND) missing.push(ONE_COMMAND);
  if (text.includes('git merge-base')) missing.push(NO_MERGE_BASE);
  return missing;
}

test('AC2.1: ceremony-derivation.md names the diff-facts command once and carries no git merge-base', () => {
  assert.deepStrictEqual(commandFactsMissing(CEREMONY), []);
});

test('AC2.1 go-red: each fact fails alone on a doctored copy of the live text', () => {
  const replaced = (from, to) => {
    const doctored = CEREMONY.replace(from, to);
    assert.notEqual(doctored, CEREMONY, `doctoring matched nothing: ${from}`);
    return doctored;
  };
  assert.deepStrictEqual(
    commandFactsMissing(`${CEREMONY}\ngit merge-base HEAD origin/main\n`),
    [NO_MERGE_BASE],
  );
  assert.deepStrictEqual(
    commandFactsMissing(replaced(COMMAND, COMMAND.replace('{integration-branch}', '"$(git branch --show-current)"'))),
    [ONE_COMMAND],
  );
  assert.deepStrictEqual(
    commandFactsMissing(`${CEREMONY}\n\`bin/diff-facts.js\`\n`),
    [ONE_COMMAND],
  );
});

test('AC3.1: the documented command runs and yields a diff-facts object', () => {
  const line = CEREMONY.split('\n').find((l) => l.includes('diff-facts.js'));
  assert.ok(line, 'ceremony-derivation.md has no diff-facts.js line');
  const cmd = line.trim()
    .split('${CLAUDE_PLUGIN_ROOT}').join(PLUGIN)
    .split('{integration-branch}').join('main');
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'diff-facts-ac31-'));
  try {
    const git = (...args) => {
      const res = spawnSync('git', [
        '-c', 'init.defaultBranch=main', '-c', 'user.name=t', '-c', 'user.email=t@example.com',
        '-c', 'commit.gpgsign=false', ...args,
      ], { cwd: repo, encoding: 'utf8' });
      assert.equal(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
    };
    git('init', '-q');
    fs.writeFileSync(path.join(repo, 'README.md'), 'base\n');
    git('add', 'README.md');
    git('commit', '-q', '-m', 'base');
    git('checkout', '-q', '-b', 'feature');
    fs.mkdirSync(path.join(repo, 'src'));
    fs.writeFileSync(path.join(repo, 'src', 'a.js'), 'const a = 1;\nconst b = 2;\nconst c = 3;\n');
    git('add', 'src/a.js');
    git('commit', '-q', '-m', 'feature');
    const res = spawnSync('sh', ['-c', cmd], { cwd: repo, encoding: 'utf8' });
    assert.equal(res.status, 0, `command exited ${res.status}: ${res.stderr}`);
    const facts = JSON.parse(res.stdout);
    assert.equal(facts.fileCount, 1);
    assert.equal(facts.implFiles, 1);
    assert.equal(facts.lowSurface, false);
  } finally {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});
