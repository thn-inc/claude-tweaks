'use strict';
// tests/diff-facts-parse-numstat-conformance.test.js — pins #2869: the two skill docs that tell
// the agent to derive diff facts name `parseNumstat` (blast-radius-cli.js) before
// `computeDiffFacts`, because `computeDiffFacts` takes the parsed `{path, additions, deletions}[]`
// array, never raw `git diff --numstat` output. Reads live skill prose deliberately — the prose IS
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
// `computeDiffFacts` also contains `parseNumstat` and `blast-radius-cli.js`, with
// `parseNumstat` followed by `computeDiffFacts` within 400 characters (adjacency, not just
// first-occurrence order, because the dispatch.md block is one very long paragraph).
function assertNamesParser(text, label) {
  const block = text.split(/\n\s*\n/).find((b) => b.includes('computeDiffFacts'));
  assert.ok(block, `${label}: no paragraph contains computeDiffFacts`);
  assert.ok(block.includes('parseNumstat'), `${label}: paragraph does not name parseNumstat`);
  assert.ok(block.includes('blast-radius-cli.js'), `${label}: paragraph does not name blast-radius-cli.js`);
  assert.match(
    block,
    /parseNumstat[\s\S]{0,400}?computeDiffFacts/,
    `${label}: parseNumstat must be followed by computeDiffFacts within 400 characters`,
  );
}

test('AC1.1: build/dispatch.md names parseNumstat before computeDiffFacts', () => {
  assertNamesParser(DISPATCH, 'build/dispatch.md');
});

test('AC1.1: wrap-up/ceremony-derivation.md names parseNumstat before computeDiffFacts', () => {
  assertNamesParser(CEREMONY, 'wrap-up/ceremony-derivation.md');
});

test('negative control: the assertion throws on each way a paragraph can fail to name the parser', () => {
  // No parseNumstat at all.
  assert.throws(() => assertNamesParser('… `computeDiffFacts` over `git diff --numstat` output …', 'control'));
  // parseNumstat named only after computeDiffFacts.
  assert.throws(() =>
    assertNamesParser('… `computeDiffFacts` over the output, then `parseNumstat` (`bin/lib/blast-radius-cli.js`) …', 'control'));
  // parseNumstat named but the module that exports it is not.
  assert.throws(() => assertNamesParser('… `parseNumstat` first, then `computeDiffFacts` …', 'control'));
});

// compositionFor(pluginRoot): the documented `node -e` command from ceremony-derivation.md with
// `${CLAUDE_PLUGIN_ROOT}` replaced by `pluginRoot`.
function compositionFor(pluginRoot) {
  const line = CEREMONY.split('\n').find((l) => l.includes('parseNumstat') && l.includes('node -e'));
  assert.ok(line, 'ceremony-derivation.md has no line with both parseNumstat and node -e');
  const nodeStart = line.indexOf('| node -e');
  assert.ok(nodeStart >= 0, 'the composition line must pipe the numstat output into `node -e`');
  return line.slice(nodeStart + 2).split('${CLAUDE_PLUGIN_ROOT}').join(pluginRoot);
}

test('the documented node -e composition runs and yields a diff-facts object', () => {
  const cmd = compositionFor(PLUGIN);
  const res = spawnSync('sh', ['-c', cmd], { input: '3\t1\tsrc/a.js\n', encoding: 'utf8' });
  assert.equal(res.status, 0, `snippet exited ${res.status}: ${res.stderr}`);
  const facts = JSON.parse(res.stdout);
  assert.equal(facts.fileCount, 1);
  assert.equal(facts.implFiles, 1);
});

test('a win32-shaped plugin root splices into the composition with no backslash', () => {
  const cmd = compositionFor(pluginRootFor('D:\\a\\repo', path.win32));
  assert.ok(!cmd.includes('\\'), `spliced command contains a backslash: ${cmd}`);
  assert.ok(cmd.includes("require('D:/a/repo/plugin/bin/lib/blast-radius-cli.js')"), cmd);
});
