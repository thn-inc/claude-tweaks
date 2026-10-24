'use strict';
// tests/diff-facts-parse-numstat-conformance.test.js — pins #2869: the two skill docs that tell
// the agent to derive diff facts name `parseNumstatZ` (git-z.js) before
// `computeDiffFacts`, because `computeDiffFacts` takes the parsed `{path, additions, deletions}[]`
// array, never raw `git diff --numstat -z` output. Reads live skill prose deliberately — the prose IS
// the contract an agent follows — and runs the documented one-line composition for real.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { toPosix } = require('../plugin/bin/lib/shared-primitives');

const ROOT = path.join(__dirname, '..');
// pluginRootFor(root, pathImpl): the plugin root as it is spliced into script text. Native `join`
// on a Windows host yields backslashes that a JS single-quoted literal in the composition eats,
// so the spliced form is forward-slashed; `ROOT` itself stays native for the readText calls.
const pluginRootFor = (root, pathImpl = path) => toPosix(pathImpl.join(root, 'plugin'), pathImpl.sep);
const PLUGIN = pluginRootFor(ROOT);
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

// compositionFor(pluginRoot): the documented `node -e` command from ceremony-derivation.md with
// `${CLAUDE_PLUGIN_ROOT}` replaced by `pluginRoot`.
function compositionFor(pluginRoot) {
  const line = CEREMONY.split('\n').find((l) => l.includes('parseNumstatZ') && l.includes('node -e'));
  assert.ok(line, 'ceremony-derivation.md has no line with both parseNumstatZ and node -e');
  const nodeStart = line.indexOf('| node -e');
  assert.ok(nodeStart >= 0, 'the composition line must pipe the numstat output into `node -e`');
  return line.slice(nodeStart + 2).split('${CLAUDE_PLUGIN_ROOT}').join(pluginRoot);
}

test('the documented node -e composition runs and yields a diff-facts object', () => {
  const cmd = compositionFor(PLUGIN);
  const res = spawnSync('sh', ['-c', cmd], { input: '3\t1\tsrc/a.js\u0000', encoding: 'utf8' });
  assert.equal(res.status, 0, `snippet exited ${res.status}: ${res.stderr}`);
  const facts = JSON.parse(res.stdout);
  assert.equal(facts.fileCount, 1);
  assert.equal(facts.implFiles, 1);
});

test('a win32-shaped plugin root splices into the composition with no backslash', () => {
  const cmd = compositionFor(pluginRootFor('D:\\a\\repo', path.win32));
  assert.ok(!cmd.includes('\\'), `spliced command contains a backslash: ${cmd}`);
  assert.ok(cmd.includes("require('D:/a/repo/plugin/bin/lib/git-z.js')"), cmd);
});

// preSplitFactsMissing(text): the #3829 facts ceremony-derivation.md must state, returning the ones
// it no longer does. A worktree-isolated session refuses a `$(git ...)` substitution, so the
// merge-base is its own command and the composition line takes the pasted-in `{merge-base}`.
const NO_SUBSTITUTION = 'no $(...) substitution on the composition line';
const PLACEHOLDER = '{merge-base} placeholder on the composition line';
const OWN_COMMAND = 'git merge-base HEAD origin/main as its own command';
function preSplitFactsMissing(text) {
  const lines = text.split('\n');
  const line = lines.find((l) => l.includes('parseNumstatZ') && l.includes('node -e'));
  if (!line) return ['composition line (parseNumstatZ and node -e)'];
  const missing = [];
  if (line.includes('$(')) missing.push(NO_SUBSTITUTION);
  if (!line.includes('{merge-base}')) missing.push(PLACEHOLDER);
  if (!lines.some((l) => l.trim() === 'git merge-base HEAD origin/main')) missing.push(OWN_COMMAND);
  return missing;
}

test('#3829: ceremony-derivation.md pre-splits the merge-base out of the composition line', () => {
  assert.deepStrictEqual(preSplitFactsMissing(CEREMONY), []);
});

test('#3829 go-red: each pre-split fact fails alone, on a doctored copy of the live text', () => {
  const doctor = (from, to) => {
    const doctored = CEREMONY.replace(from, to);
    assert.notEqual(doctored, CEREMONY, `doctoring matched nothing: ${from}`);
    return doctored;
  };
  assert.deepStrictEqual(
    preSplitFactsMissing(doctor('{merge-base} | node -e', '{merge-base} "$(echo x)" | node -e')),
    [NO_SUBSTITUTION],
  );
  assert.deepStrictEqual(
    preSplitFactsMissing(doctor('{merge-base} | node -e', 'abc1234 | node -e')),
    [PLACEHOLDER],
  );
  assert.deepStrictEqual(
    preSplitFactsMissing(doctor('git merge-base HEAD origin/main\n', 'git merge-base HEAD origin/master\n')),
    [OWN_COMMAND],
  );
});
