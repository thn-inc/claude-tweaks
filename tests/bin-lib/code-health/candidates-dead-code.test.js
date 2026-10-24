'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { detectEntrypoints } = require('../../../plugin/bin/lib/code-health/candidates-dead-code');
const { readText } = require('../../helpers/read-skill');

function tmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'codehealth-deadcode-'));
}

// ── detectEntrypoints ────────────────────────────────────────────────────────

test('detectEntrypoints: direct children of bin/ are entrypoints, nested bin/lib files are not', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'cli.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, 'bin', 'lib', 'helper.js'), 'module.exports = {};\n');
  const files = ['bin/cli.js', 'bin/lib/helper.js'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('bin/cli.js'));
  assert.ok(!eps.has('bin/lib/helper.js'));
});

test('detectEntrypoints: files referenced inside hooks/hooks.json are entrypoints', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/bin/hooks.js" session-start' }] }],
      },
    }),
  );
  fs.writeFileSync(path.join(root, 'bin', 'hooks.js'), 'module.exports = {};\n');
  const files = ['bin/hooks.js', 'hooks/hooks.json'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('bin/hooks.js'));
});

// The test above cannot fail if Rule 2 is deleted — bin/hooks.js is already an
// entrypoint via Rule 1 (direct child of bin/). This one puts the hooks.json
// reference outside bin/ so Rule 2 is the only thing that can find it, and
// keeps the "${VAR}/" prefix so the expansion strip is exercised too.
test('detectEntrypoints: a hooks.json reference outside bin/ is an entrypoint, "${VAR}/" prefix stripped', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PostToolUse: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/notify.js" post-tool-use' }] }],
      },
    }),
  );
  fs.writeFileSync(path.join(root, 'scripts', 'notify.js'), 'module.exports = {};\n');
  const files = ['scripts/notify.js', 'hooks/hooks.json'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('scripts/notify.js'));
});

test('detectEntrypoints: files referenced inside .claude-plugin/plugin.json are entrypoints', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'x', agents: ['./agents/qa-agent.js'] }),
  );
  fs.writeFileSync(path.join(root, 'agents', 'qa-agent.js'), 'module.exports = {};\n');
  const files = ['agents/qa-agent.js', '.claude-plugin/plugin.json'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('agents/qa-agent.js'));
});

test('detectEntrypoints: package.json bin/main/exports fields name entrypoints', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'index.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, 'src', 'cli.js'), 'module.exports = {};\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ main: './src/index.js', bin: { mytool: './src/cli.js' } }),
  );
  const files = ['src/index.js', 'src/cli.js', 'package.json'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('src/index.js'));
  assert.ok(eps.has('src/cli.js'));
});

// The test above covers `main` and `bin` but not `exports`, which is the only
// field routed through collectStrings' recursive walk.
test('detectEntrypoints: a nested conditional-exports object names entrypoints', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'esm.mjs'), 'export default {};\n');
  fs.writeFileSync(path.join(root, 'src', 'cjs.cjs'), 'module.exports = {};\n');
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ exports: { '.': { import: './src/esm.mjs', require: './src/cjs.cjs' } } }),
  );
  const files = ['src/esm.mjs', 'src/cjs.cjs', 'package.json'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('src/esm.mjs'));
  assert.ok(eps.has('src/cjs.cjs'));
});

test('detectEntrypoints: bin/lib/hooks/*.js is an implicit entrypoint set when bin/hooks.js dynamically requires from it', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin', 'lib', 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'bin', 'hooks.js'),
    "function loadModule(event) { try { return require('./lib/hooks/' + event); } catch { return null; } }\nmodule.exports = { loadModule };\n",
  );
  fs.writeFileSync(path.join(root, 'bin', 'lib', 'hooks', 'session-start.js'), 'function run() { return 1; }\nmodule.exports = { run };\n');
  const files = ['bin/hooks.js', 'bin/lib/hooks/session-start.js'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('bin/lib/hooks/session-start.js'), 'dynamically-loaded hook module must be treated as an entrypoint');
});

test('detectEntrypoints: bin/lib/hooks/*.js is NOT an implicit entrypoint when bin/hooks.js does not use the dynamic-require pattern', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'bin', 'lib', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'bin', 'hooks.js'), "const x = require('./lib/hooks/session-start');\nmodule.exports = { x };\n");
  fs.writeFileSync(path.join(root, 'bin', 'lib', 'hooks', 'session-start.js'), 'module.exports = {};\n');
  const files = ['bin/hooks.js', 'bin/lib/hooks/session-start.js'];
  const eps = detectEntrypoints(root, files);
  assert.ok(!eps.has('bin/lib/hooks/session-start.js'), 'a literal (non-computed) require must not trigger the implicit-entrypoint carve-out');
});

// ── detectEntrypoints, nested `plugin/` payload layout (#418) ────────────────
//
// This repo moved its whole plugin payload one level down, so a self-sweep now
// lists `plugin/bin/cli.js`, `plugin/hooks/hooks.json`, `plugin/.claude-plugin/
// plugin.json` and `plugin/bin/lib/hooks/*.js`. Every rule above is anchored at
// the repo root, so without the nested spelling each of those reads as dead code.
// The root-layout tests above stay: a consumer repo (and this repo's own history)
// still keeps the payload at the root, so both spellings have to work.

test('detectEntrypoints: direct children of plugin/bin/ are entrypoints, nested plugin/bin/lib files are not', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'plugin', 'bin', 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', 'bin', 'cli.js'), 'module.exports = {};\n');
  fs.writeFileSync(path.join(root, 'plugin', 'bin', 'lib', 'helper.js'), 'module.exports = {};\n');
  const files = ['plugin/bin/cli.js', 'plugin/bin/lib/helper.js'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('plugin/bin/cli.js'));
  assert.ok(!eps.has('plugin/bin/lib/helper.js'), 'the direct-child restriction must survive the nested spelling');
});

// The manifests under plugin/ still spell their own references plugin-root-relative
// ("${CLAUDE_PLUGIN_ROOT}/bin/hooks.js"), so the extracted "bin/hooks.js" has to be
// resolved against the manifest's own payload root, not the repo root.
test('detectEntrypoints: a plugin/hooks/hooks.json reference resolves against the nested payload root', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'plugin', 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugin', 'scripts'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'plugin', 'hooks', 'hooks.json'),
    JSON.stringify({
      hooks: {
        PostToolUse: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/scripts/notify.js" post-tool-use' }] }],
      },
    }),
  );
  fs.writeFileSync(path.join(root, 'plugin', 'scripts', 'notify.js'), 'module.exports = {};\n');
  const files = ['plugin/scripts/notify.js', 'plugin/hooks/hooks.json'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('plugin/scripts/notify.js'));
});

test('detectEntrypoints: files referenced inside plugin/.claude-plugin/plugin.json are entrypoints', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'plugin', '.claude-plugin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'plugin', 'agents'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'plugin', '.claude-plugin', 'plugin.json'),
    JSON.stringify({ name: 'x', agents: ['./agents/qa-agent.js'] }),
  );
  fs.writeFileSync(path.join(root, 'plugin', 'agents', 'qa-agent.js'), 'module.exports = {};\n');
  const files = ['plugin/agents/qa-agent.js', 'plugin/.claude-plugin/plugin.json'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('plugin/agents/qa-agent.js'));
});

test('detectEntrypoints: plugin/bin/lib/hooks/*.js is an implicit entrypoint set when plugin/bin/hooks.js dynamically requires from it', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'plugin', 'bin', 'lib', 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'plugin', 'bin', 'hooks.js'),
    "function loadModule(event) { try { return require('./lib/hooks/' + event); } catch { return null; } }\nmodule.exports = { loadModule };\n",
  );
  fs.writeFileSync(path.join(root, 'plugin', 'bin', 'lib', 'hooks', 'session-start.js'), 'function run() { return 1; }\nmodule.exports = { run };\n');
  const files = ['plugin/bin/hooks.js', 'plugin/bin/lib/hooks/session-start.js'];
  const eps = detectEntrypoints(root, files);
  assert.ok(eps.has('plugin/bin/lib/hooks/session-start.js'), 'dynamically-loaded hook module must be treated as an entrypoint under the nested payload root too');
});

test('detectEntrypoints: plugin/bin/lib/hooks/*.js is NOT an implicit entrypoint when plugin/bin/hooks.js does not use the dynamic-require pattern', () => {
  const root = tmp();
  fs.mkdirSync(path.join(root, 'plugin', 'bin', 'lib', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(root, 'plugin', 'bin', 'hooks.js'), "const x = require('./lib/hooks/session-start');\nmodule.exports = { x };\n");
  fs.writeFileSync(path.join(root, 'plugin', 'bin', 'lib', 'hooks', 'session-start.js'), 'module.exports = {};\n');
  const files = ['plugin/bin/hooks.js', 'plugin/bin/lib/hooks/session-start.js'];
  const eps = detectEntrypoints(root, files);
  assert.ok(!eps.has('plugin/bin/lib/hooks/session-start.js'), 'a literal (non-computed) require must not trigger the implicit-entrypoint carve-out under the nested payload root either');
});

const { extractModuleExports } = require('../../../plugin/bin/lib/code-health/source-scan');

// ── extractModuleExports ─────────────────────────────────────────────────────

test('extractModuleExports: single-line brace form', () => {
  const text = "function a() {}\nfunction b() {}\nmodule.exports = { a, b };\n";
  const found = extractModuleExports(text);
  assert.deepStrictEqual(found.map((f) => f.symbol).sort(), ['a', 'b']);
});

test('extractModuleExports: this repo\'s dominant multi-line brace shape', () => {
  const text = [
    'function usedFn() {}',
    'function deadFn() {}',
    'module.exports = {',
    '  usedFn,',
    '  deadFn,',
    '};',
    '',
  ].join('\n');
  const found = extractModuleExports(text);
  assert.deepStrictEqual(found.map((f) => f.symbol).sort(), ['deadFn', 'usedFn']);
  // The block spans the "module.exports = {" line through the closing "};" line.
  const usedFn = found.find((f) => f.symbol === 'usedFn');
  assert.strictEqual(usedFn.startLine, 3);
  assert.strictEqual(usedFn.endLine, 6);
});

test('extractModuleExports: no module.exports block yields an empty array, no crash', () => {
  assert.deepStrictEqual(extractModuleExports('const x = 1;\nexport default x;\n'), []);
});

test('extractModuleExports: aliased/computed keys are skipped, not crashed on (conservative)', () => {
  const text = 'function a() {}\nmodule.exports = { a, renamed: a, [computed()]: a };\n';
  const found = extractModuleExports(text);
  assert.deepStrictEqual(found.map((f) => f.symbol), ['a']);
});

test('extractModuleExports: a spread-based barrel re-export extracts no symbols and does not crash (AC2)', () => {
  const text = "module.exports = { ...require('./a'), ...require('./b') };\n";
  assert.deepStrictEqual(extractModuleExports(text), []);
});

test('extractModuleExports: an unterminated module.exports block is skipped, not crashed on', () => {
  const text = 'module.exports = { a, b\n// no closing brace in this file\n';
  assert.deepStrictEqual(extractModuleExports(text), []);
});

// None of the tests above contains a nested object value, so all of them still
// pass if the brace-depth scan is replaced by "stop at the first '}'". This one
// fails under that mutation: the naive scan would close the block on line 2 and
// extract nothing.
test('extractModuleExports: a nested object value does not prematurely end the block', () => {
  const text = [
    'module.exports = {',
    '  config: { a: 1 },',
    '  deadFn,',
    '};',
    '',
  ].join('\n');
  const found = extractModuleExports(text);
  assert.deepStrictEqual(found.map((f) => f.symbol), ['deadFn']);
  assert.strictEqual(found[0].startLine, 1);
  assert.strictEqual(found[0].endLine, 4);
});

// Likewise, every test above has exactly one export block, so they all pass if
// the scan stops after the first one. This one pins the loop *and* the per-block
// line range Task 3's `declRange` depends on.
test('extractModuleExports: a second module.exports block is scanned too, with its own line range', () => {
  const text = [
    'if (x) {',
    '  module.exports = { first };',
    '} else {',
    '  module.exports = { second };',
    '}',
    '',
  ].join('\n');
  const found = extractModuleExports(text);
  assert.deepStrictEqual(found.map((f) => f.symbol), ['first', 'second']);
  assert.deepStrictEqual(found.map((f) => f.startLine), [2, 4]);
  assert.deepStrictEqual(found.map((f) => f.endLine), [2, 4]);
});

// Pins `startRe.lastIndex = closeIdx`: without it the scan resumes one char
// past the opening brace and re-matches a "module.exports = {" that occurs
// *inside* the block it already consumed, emitting `fake` as an export that
// exists nowhere — i.e. a false dead-code report. No other test here fails if
// that line is deleted.
test('extractModuleExports: a "module.exports = {" inside a string value is not rescanned as a second block', () => {
  const text = "module.exports = { note: 'module.exports = { fake }', real };\n";
  const found = extractModuleExports(text);
  assert.deepStrictEqual(found.map((f) => f.symbol), ['real']);
});

const { isReferenced } = require('../../../plugin/bin/lib/code-health/candidates-dead-code');

// ── isReferenced ──────────────────────────────────────────────────────────────

// isReferenced takes linesByFile (file -> array of lines), not raw text —
// see the function's own header comment (Item 7: the caller precomputes the
// split once and reuses it across every symbol's call, instead of
// isReferenced re-splitting each file's text on every invocation). This
// helper builds that shape from a plain {path: text} literal, which is a
// friendlier shape for a fixture to author than an array-of-lines literal.
function linesMap(entries) {
  return new Map(Object.entries(entries).map(([file, text]) => [file, text.split('\n')]));
}

test('isReferenced: a symbol used elsewhere in another file is referenced', () => {
  const linesByFile = linesMap({
    'lib/used.js': 'function usedFn() {}\nfunction deadFn() {}\nmodule.exports = { usedFn, deadFn };\n',
    'lib/caller.js': "const { usedFn } = require('./used');\nusedFn();\n",
  });
  const allFiles = ['lib/used.js', 'lib/caller.js'];
  assert.strictEqual(isReferenced('usedFn', 'lib/used.js', { startLine: 3, endLine: 3 }, allFiles, linesByFile), true);
});

test('isReferenced: a symbol with no use anywhere but its own export-block mention and definition line is NOT referenced', () => {
  const linesByFile = linesMap({
    'lib/used.js': 'function usedFn() {}\nfunction deadFn() {}\nmodule.exports = { usedFn, deadFn };\n',
    'lib/caller.js': "const { usedFn } = require('./used');\nusedFn();\n",
  });
  const allFiles = ['lib/used.js', 'lib/caller.js'];
  assert.strictEqual(isReferenced('deadFn', 'lib/used.js', { startLine: 3, endLine: 3 }, allFiles, linesByFile), false);
});

test('isReferenced: a same-named identifier elsewhere in the tree is treated as a reference (accepted false-negative)', () => {
  const linesByFile = linesMap({
    'lib/a.js': 'function helper() {}\nmodule.exports = { helper };\n',
    'lib/unrelated.js': 'const helper = 42; // totally unrelated variable, same bare name\nconsole.log(helper);\n',
  });
  const allFiles = ['lib/a.js', 'lib/unrelated.js'];
  // 'helper' is genuinely dead in lib/a.js's own sense, but the word-bounded
  // bare-symbol search cannot distinguish it from the unrelated identifier —
  // this is the spec's explicitly accepted false-negative policy.
  assert.strictEqual(isReferenced('helper', 'lib/a.js', { startLine: 2, endLine: 2 }, allFiles, linesByFile), true);
});

test('isReferenced: the symbol\'s own function/const/class definition line is not itself counted as a use', () => {
  const linesByFile = linesMap({
    'lib/a.js': 'const deadConst = 1;\nfunction deadFn() {}\nclass DeadClass {}\nmodule.exports = { deadConst, deadFn, DeadClass };\n',
  });
  const allFiles = ['lib/a.js'];
  assert.strictEqual(isReferenced('deadConst', 'lib/a.js', { startLine: 4, endLine: 4 }, allFiles, linesByFile), false);
  assert.strictEqual(isReferenced('deadFn', 'lib/a.js', { startLine: 4, endLine: 4 }, allFiles, linesByFile), false);
  assert.strictEqual(isReferenced('DeadClass', 'lib/a.js', { startLine: 4, endLine: 4 }, allFiles, linesByFile), false);
});

// Every isReferenced test above still passes with the boundary assertions
// stripped from the search regex — none of them contains the symbol as a
// substring of a longer identifier. This one fails under that mutation:
// an unanchored search reads 'undead' and 'deadline' as uses of `dead`.
test('isReferenced: a bare substring inside a longer identifier is not a reference', () => {
  const linesByFile = linesMap({
    'lib/a.js': 'function dead() {}\nmodule.exports = { dead };\n',
    'lib/b.js': 'console.log(undead, deadline);\n',
  });
  const allFiles = ['lib/a.js', 'lib/b.js'];
  assert.strictEqual(isReferenced('dead', 'lib/a.js', { startLine: 2, endLine: 2 }, allFiles, linesByFile), false);
});

// `$` is legal in a JS identifier (IDENTIFIER_RE accepts it) and is also a
// regex metacharacter. Without escapeRegExp the pattern for `a$b` reads as
// "a, end-of-line, b" and matches nothing, so the live symbol reports dead.
test('isReferenced: a `$` inside the symbol name is matched literally, not as a regex anchor', () => {
  const linesByFile = linesMap({
    'lib/a.js': 'function a$b() {}\nmodule.exports = { a$b };\n',
    'lib/caller.js': "const { a$b } = require('./a');\na$b();\n",
  });
  const allFiles = ['lib/a.js', 'lib/caller.js'];
  assert.strictEqual(isReferenced('a$b', 'lib/a.js', { startLine: 2, endLine: 2 }, allFiles, linesByFile), true);
});

// The two tests below pin why the boundaries are identifier-class lookarounds
// rather than `\b`: to the regex engine `$` is a NON-word character, so `\b`
// is wrong in both directions around it.

// Direction 1 (the forbidden one — a live symbol reported dead): `\b\$fn\b`
// matches nothing anywhere, because no word boundary exists before a `$`.
test('isReferenced: a symbol whose name starts with `$` is still found where it is used', () => {
  const linesByFile = linesMap({
    'lib/a.js': 'function $fn() {}\nmodule.exports = { $fn };\n',
    'lib/caller.js': "const { $fn } = require('./a');\n$fn();\n",
  });
  const allFiles = ['lib/a.js', 'lib/caller.js'];
  assert.strictEqual(isReferenced('$fn', 'lib/a.js', { startLine: 2, endLine: 2 }, allFiles, linesByFile), true);
});

// Direction 2 (the accepted one, fixed for free): `\bdead\b` DOES match inside
// `$dead`, since the `$`-to-`d` transition is a word boundary — so a distinct
// `$dead` identifier would mask a genuinely dead `dead`.
test('isReferenced: an unrelated `$`-prefixed identifier is not a use of the bare symbol', () => {
  const linesByFile = linesMap({
    'lib/a.js': 'function dead() {}\nmodule.exports = { dead };\n',
    'lib/b.js': 'console.log($dead);\n',
  });
  const allFiles = ['lib/a.js', 'lib/b.js'];
  assert.strictEqual(isReferenced('dead', 'lib/a.js', { startLine: 2, endLine: 2 }, allFiles, linesByFile), false);
});

// Item 7 regression: linesByFile is precomputed once per scanDeadCode call
// and reused across every symbol's isReferenced call — pin that reuse is
// safe by calling isReferenced twice against the SAME linesByFile map for
// two different symbols in the same file, and confirm neither call's result
// depends on call order (a mutated/consumed-once cache would make the
// second call see stale or missing data).
test('isReferenced: the same linesByFile map is safely reused across multiple calls for different symbols', () => {
  const linesByFile = linesMap({
    'lib/a.js': 'function usedFn() {}\nfunction deadFn() {}\nmodule.exports = { usedFn, deadFn };\n',
    'lib/caller.js': "const { usedFn } = require('./a');\nusedFn();\n",
  });
  const allFiles = ['lib/a.js', 'lib/caller.js'];
  const declRange = { startLine: 3, endLine: 3 };
  assert.strictEqual(isReferenced('usedFn', 'lib/a.js', declRange, allFiles, linesByFile), true);
  assert.strictEqual(isReferenced('deadFn', 'lib/a.js', declRange, allFiles, linesByFile), false);
  // Re-run in reverse order against the identical map instance — same
  // results either way confirms the map is read-only from isReferenced's
  // perspective, safe for scanDeadCode's real multi-symbol reuse.
  assert.strictEqual(isReferenced('deadFn', 'lib/a.js', declRange, allFiles, linesByFile), false);
  assert.strictEqual(isReferenced('usedFn', 'lib/a.js', declRange, allFiles, linesByFile), true);
});

const { isFileOrphan, referencedFileSpecifiers } = require('../../../plugin/bin/lib/code-health/candidates-dead-code');

// ── isFileOrphan ──────────────────────────────────────────────────────────────

test('isFileOrphan: a file required by another file (relative path, any depth) is not orphan', () => {
  const contentsByFile = new Map([
    ['lib/used.js', 'module.exports = {};\n'],
    ['bin/main.js', "const used = require('../lib/used');\n"],
  ]);
  const allFiles = ['lib/used.js', 'bin/main.js'];
  assert.strictEqual(isFileOrphan('lib/used.js', allFiles, contentsByFile), false);
});

test('isFileOrphan: a file nothing requires is orphan', () => {
  const contentsByFile = new Map([
    ['orphan.js', 'module.exports = { orphanFn: () => 1 };\n'],
    ['other.js', 'module.exports = {};\n'],
  ]);
  const allFiles = ['orphan.js', 'other.js'];
  assert.strictEqual(isFileOrphan('orphan.js', allFiles, contentsByFile), true);
});

test('isFileOrphan: a short basename is not falsely matched inside an unrelated longer name (no substring false-positive)', () => {
  const contentsByFile = new Map([
    ['a.js', "function fromA() {}\nmodule.exports = { fromA };\n"],
    ['barrel.js', "module.exports = { ...require('./a') };\n"],
    ['main.js', "const x = require('./barrel');\n"],
  ]);
  const allFiles = ['a.js', 'barrel.js', 'main.js'];
  // 'a' is a substring of 'barrel', 'main' etc. — must not count as a match
  // unless it is genuinely the last path segment of a require/import specifier.
  assert.strictEqual(isFileOrphan('a.js', allFiles, contentsByFile), false, 'a.js IS required (by barrel.js) — must not be orphan');
});

test('isFileOrphan: an ES-module `from` specifier also counts as a reference', () => {
  const contentsByFile = new Map([
    ['lib/util.js', 'export function helper() {}\n'],
    ['src/app.js', "import { helper } from '../lib/util.js';\n"],
  ]);
  const allFiles = ['lib/util.js', 'src/app.js'];
  assert.strictEqual(isFileOrphan('lib/util.js', allFiles, contentsByFile), false);
});

// The substring test above asserts `false` for a file that IS required, so it
// passes under a substring/`includes` comparison too — the very mutation its
// name describes. This is the discriminating half: 'a' is a substring of the
// only specifier in the tree ('./barrel'), and nothing requires a.js.
test('isFileOrphan: a file whose basename is merely a substring of another specifier is still orphan', () => {
  const contentsByFile = new Map([
    ['a.js', 'module.exports = { fromA: () => 1 };\n'],
    ['barrel.js', 'module.exports = {};\n'],
    ['main.js', "const x = require('./barrel');\n"],
  ]);
  const allFiles = ['a.js', 'barrel.js', 'main.js'];
  assert.strictEqual(isFileOrphan('a.js', allFiles, contentsByFile), true);
});

// Pins `if (other === relFile) continue;` — a file that names itself (a
// self-require, a commented-out import, a doc string) must not thereby prove
// its own liveness.
test('isFileOrphan: a file naming itself is not thereby referenced', () => {
  const contentsByFile = new Map([
    ['lib/self.js', "// historical: require('./self') was the old entry\nmodule.exports = {};\n"],
    ['lib/other.js', 'module.exports = {};\n'],
  ]);
  const allFiles = ['lib/self.js', 'lib/other.js'];
  assert.strictEqual(isFileOrphan('lib/self.js', allFiles, contentsByFile), true);
});

// A directory index is reached as `require('./lib')` — its own basename
// ('index') appears in no specifier anywhere. Matching on basename alone
// reports every such live file orphan, which is the forbidden direction.
test('isFileOrphan: a directory index reached as `require(\'./lib\')` is not orphan', () => {
  const contentsByFile = new Map([
    ['lib/index.js', 'module.exports = {};\n'],
    ['main.js', "const lib = require('./lib');\n"],
  ]);
  const allFiles = ['lib/index.js', 'main.js'];
  assert.strictEqual(isFileOrphan('lib/index.js', allFiles, contentsByFile), false);
});

// ...but the directory-name allowance is scoped to index files only: a
// non-index file must not be rescued by a specifier naming its directory.
test('isFileOrphan: a non-index file is not rescued by a specifier naming its directory', () => {
  const contentsByFile = new Map([
    ['lib/thing.js', 'module.exports = {};\n'],
    ['main.js', "const lib = require('./lib');\n"],
  ]);
  const allFiles = ['lib/thing.js', 'main.js'];
  assert.strictEqual(isFileOrphan('lib/thing.js', allFiles, contentsByFile), true);
});

// A side-effect-only static import has no `from` and no parenthesis, so the
// require/from/import( alternation alone misses it — again the forbidden
// direction (a live, imported file reported orphan).
test('isFileOrphan: a side-effect-only `import \'./x.js\'` counts as a reference', () => {
  const contentsByFile = new Map([
    ['polyfill.js', 'globalThis.x = 1;\n'],
    ['app.js', "import './polyfill.js';\n"],
  ]);
  const allFiles = ['polyfill.js', 'app.js'];
  assert.strictEqual(isFileOrphan('polyfill.js', allFiles, contentsByFile), false);
});

test('isFileOrphan: a file listed in allFiles but absent from contentsByFile is skipped, not crashed on', () => {
  const contentsByFile = new Map([['b.js', "const a = require('./a');\n"]]);
  const allFiles = ['a.js', 'b.js', 'unread.js'];
  assert.strictEqual(isFileOrphan('a.js', allFiles, contentsByFile), false);
});

// ── referencedFileSpecifiers ──────────────────────────────────────────────────

test('referencedFileSpecifiers: finds require, static import, side-effect import, dynamic import, and from specifiers', () => {
  const text = [
    "const a = require('./a');",
    "import { b } from '../b.js';",
    "import './side-effect.js';",
    "const c = await import(`./c.js`);",
    "export * from './d';",
    'const dynamic = require(dirName + suffix);',
  ].join('\n');
  assert.deepStrictEqual(referencedFileSpecifiers(text), ['./a', '../b.js', './side-effect.js', './c.js', './d']);
});

const { execFileSync } = require('node:child_process');
const { candidatesDeadCode, scanDeadCode } = require('../../../plugin/bin/lib/code-health/candidates-dead-code');
const { listTrackedSourceFiles, isGlobDiscoveredTestFile } = require('../../../plugin/bin/lib/code-health/source-scan');

function gitInit(root) {
  execFileSync('git', ['-C', root, 'init', '-q']);
}

// Shared by every fixture below that needs a real git repo (as opposed to the
// "no git init" test, which calls tmp() directly).
function tmpGitRepo() {
  const root = tmp();
  gitInit(root);
  return root;
}

// ── listTrackedSourceFiles: the {files, discoveryFailed, reason?} shape ─────

test('listTrackedSourceFiles: a real git repo returns {files, discoveryFailed: false}, no reason key', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'a.js'), 'module.exports = {};\n');
  const result = listTrackedSourceFiles(root);
  assert.deepStrictEqual(result.files, ['lib/a.js']);
  assert.strictEqual(result.discoveryFailed, false);
  assert.ok(!('reason' in result));
});

test('listTrackedSourceFiles: a non-git root returns {files: [], discoveryFailed: true, reason: <non-empty>}', () => {
  const root = tmp(); // no git init
  const result = listTrackedSourceFiles(root);
  assert.deepStrictEqual(result.files, []);
  assert.strictEqual(result.discoveryFailed, true);
  assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
});

// ── AC1: a fixture tree with a known dead export, a live export, an orphan
// file, an entrypoint, and a gitignored file yields EXACTLY the dead export +
// orphan as candidates. Deliberately unambiguous per AC6 — no re-export or
// dynamic-require proximity anywhere in this tree.

function buildAc1Fixture() {
  const root = tmpGitRepo();
  fs.writeFileSync(path.join(root, '.gitignore'), 'ignored.js\n');

  // Live export ('usedFn') + dead export ('deadFn') in the same file.
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'lib', 'used.js'),
    'function usedFn() { return 1; }\nfunction deadFn() { return 2; }\nmodule.exports = { usedFn, deadFn };\n',
  );
  // Calls usedFn — the only reference to it anywhere in the tree.
  fs.writeFileSync(path.join(root, 'lib', 'caller.js'), "const { usedFn } = require('./used');\nusedFn();\n");

  // A file nothing requires — orphan-file candidate.
  fs.writeFileSync(path.join(root, 'orphan.js'), 'function orphanFn() { return 3; }\nmodule.exports = { orphanFn };\n');

  // An entrypoint (direct child of bin/) whose own export would otherwise
  // read as dead — must never be flagged, either as an orphan file or for
  // its export. It also requires lib/caller.js, which is what keeps caller.js
  // itself off the orphan list: nothing else in the tree names it, so without
  // this line the fixture would carry a third, unintended orphan candidate.
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'bin', 'entry.js'),
    "require('../lib/caller');\nfunction entryOnlyFn() { return 4; }\nmodule.exports = { entryOnlyFn };\n",
  );

  // A gitignored file containing an otherwise-dead-looking export — must
  // never appear as a candidate.
  fs.writeFileSync(path.join(root, 'ignored.js'), 'function neverSeen() {}\nmodule.exports = { neverSeen };\n');

  // A NUL-byte / binary-ish file — must be skipped silently (no crash, no
  // candidate), and must show up in scanDeadCode's skippedFiles with a reason.
  fs.writeFileSync(path.join(root, 'blob.js'), Buffer.from([0x6d, 0x00, 0x6f, 0x64]));

  return root;
}

test('AC1: fixture tree yields exactly the dead export + orphan as candidates', () => {
  const root = buildAc1Fixture();
  const candidates = candidatesDeadCode(root);
  const simplified = candidates.map((c) => ({ file: c.file, symbol: c.symbol, kind: c.kind })).sort((a, b) => a.file.localeCompare(b.file));
  assert.deepStrictEqual(simplified, [
    { file: 'lib/used.js', symbol: 'deadFn', kind: 'unreferenced-export' },
    { file: 'orphan.js', symbol: undefined, kind: 'orphan-file' },
  ]);
});

test('AC1: entrypoint files are never flagged (export-level or file-level)', () => {
  const root = buildAc1Fixture();
  const candidates = candidatesDeadCode(root);
  assert.ok(!candidates.some((c) => c.file === 'bin/entry.js'));
});

test('AC1: gitignored files are never flagged', () => {
  const root = buildAc1Fixture();
  const candidates = candidatesDeadCode(root);
  assert.ok(!candidates.some((c) => c.file === 'ignored.js'));
});

test('AC1/Gotchas: a NUL-byte file is skipped, never a candidate, and reported in skippedFiles with a reason', () => {
  const root = buildAc1Fixture();
  const { candidates, scannedFiles, skippedFiles } = scanDeadCode(root);
  assert.ok(!candidates.some((c) => c.file === 'blob.js'));
  assert.ok(scannedFiles > 0, 'scannedFiles must be nonzero — a zero count on a real tree signals a broken scan, not a clean one (IL-115)');
  const blobSkip = skippedFiles.find((s) => s.file === 'blob.js');
  assert.ok(blobSkip, 'blob.js must appear in skippedFiles');
  assert.strictEqual(blobSkip.reason, 'binary-or-nul');
});

// ── AC2: dynamic patterns produce no candidate and no crash — asserted on
// fixtures containing them, kept structurally separate from the AC1 tree above.

test('AC2: a bin/hooks.js-style computed require makes its dynamically-loaded target an entrypoint (no candidate, no crash)', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'bin', 'lib', 'hooks'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'bin', 'hooks.js'),
    "function loadModule(event) { try { return require('./lib/hooks/' + event); } catch { return null; } }\nmodule.exports = { loadModule };\n",
  );
  fs.writeFileSync(
    path.join(root, 'bin', 'lib', 'hooks', 'session-start.js'),
    'function run() { return 1; }\nmodule.exports = { run };\n',
  );
  const candidates = candidatesDeadCode(root);
  assert.deepStrictEqual(candidates, []);
});

test('AC2: a spread-based barrel re-export beyond one hop produces no candidate and no crash', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'a.js'), 'function fromA() { return 1; }\nmodule.exports = { fromA };\n');
  fs.writeFileSync(path.join(root, 'lib', 'b.js'), 'function fromB() { return 2; }\nmodule.exports = { fromB };\n');
  fs.writeFileSync(
    path.join(root, 'lib', 'barrel.js'),
    "module.exports = { ...require('./a'), ...require('./b') };\n",
  );
  fs.writeFileSync(
    path.join(root, 'bin', 'main.js'),
    "const { fromA, fromB } = require('../lib/barrel');\nfromA();\nfromB();\n",
  );
  const candidates = candidatesDeadCode(root);
  assert.deepStrictEqual(candidates, []);
});

// ── Item 1: glob-discovered test files are excluded from orphan-file
// candidacy (docs/plans/2026-08-09-code-health-focus-mode-dead-code-ledger.md
// item #1) ───────────────────────────────────────────────────────────────────

test('isGlobDiscoveredTestFile: matches this repo\'s own *.test.js/*.spec.js naming convention, at any depth', () => {
  assert.strictEqual(isGlobDiscoveredTestFile('bin/lib/code-health/tests/candidates-dead-code.test.js'), true);
  assert.strictEqual(isGlobDiscoveredTestFile('tests/hooks-dispatcher.test.js'), true);
  assert.strictEqual(isGlobDiscoveredTestFile('lib/foo.spec.ts'), true);
});

test('isGlobDiscoveredTestFile: a non-test file, including one that merely lives in a tests/ directory, does not match', () => {
  assert.strictEqual(isGlobDiscoveredTestFile('bin/lib/code-health/tests/helpers.js'), false);
  assert.strictEqual(isGlobDiscoveredTestFile('bin/lib/color.js'), false);
  assert.strictEqual(isGlobDiscoveredTestFile('lib/testing-utils.js'), false);
});

// (a) A glob-discovered test file that nothing require/imports by name would
// read as an orphan under the old rule (nothing names it) — it must now be
// excluded from orphan-file candidacy specifically, while a genuinely dead
// export inside that same file is still caught (the exclusion is scoped to
// file-orphan candidacy only, per the item's own instruction).
test('Item 1: a glob-discovered test file is never an orphan-file candidate, but its own dead exports are still found', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
  // Nothing anywhere requires this file by name — under the pre-fix rule it
  // would read as orphan-file. It also carries its own genuinely dead
  // export, which must still surface.
  fs.writeFileSync(
    path.join(root, 'tests', 'sample.test.js'),
    "const assert = require('node:assert');\nfunction helperDead() { return 1; }\nassert.ok(true);\nmodule.exports = { helperDead };\n",
  );
  const candidates = candidatesDeadCode(root);
  assert.ok(!candidates.some((c) => c.kind === 'orphan-file' && c.file === 'tests/sample.test.js'), 'a glob-discovered test file must never be an orphan-file candidate');
  assert.ok(
    candidates.some((c) => c.kind === 'unreferenced-export' && c.file === 'tests/sample.test.js' && c.symbol === 'helperDead'),
    'a genuinely dead export inside a glob-discovered test file must still be reported — the exclusion is file-orphan-only',
  );
});

// (b) A genuinely orphaned NON-test file (does not match the test-glob
// naming convention) must still be reported — the fix must not become a
// blanket "skip anything under tests/" rule.
test('Item 1: a genuinely orphaned file that is not a glob-discovered test file is still reported as an orphan-file candidate', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(root, 'lib', 'unused-helper.js'), 'function neverCalled() { return 1; }\nmodule.exports = { neverCalled };\n');
  const candidates = candidatesDeadCode(root);
  assert.deepStrictEqual(
    candidates.map((c) => `${c.file}:${c.kind}`),
    ['lib/unused-helper.js:orphan-file'],
  );
});

// ── Zero-candidates is a clean no-op, not a crash ───────────────────────────

test('an empty tree (git repo, no source files) returns zero candidates with scannedFiles: 0 and discoveryFailed: false', () => {
  const root = tmpGitRepo();
  const { candidates, scannedFiles, skippedFiles, discoveryFailed, discoveryReason } = scanDeadCode(root);
  assert.deepStrictEqual(candidates, []);
  assert.strictEqual(scannedFiles, 0);
  assert.deepStrictEqual(skippedFiles, []);
  // The IL-115 distinguishing signal: a legitimately empty tracked tree is
  // discoveryFailed: false, NOT the same scannedFiles: 0 sentinel a broken
  // discovery call also produces (see the next test).
  assert.strictEqual(discoveryFailed, false);
  assert.strictEqual(discoveryReason, undefined);
});

test('a non-git root reports discoveryFailed: true with a captured reason, not the same scannedFiles: 0 a clean tree produces', () => {
  const root = tmp(); // no git init
  const { candidates, scannedFiles, discoveryFailed, discoveryReason } = scanDeadCode(root);
  assert.deepStrictEqual(candidates, []);
  assert.strictEqual(scannedFiles, 0);
  // This is the case Finding 2 fixes: previously indistinguishable from a
  // real empty repo's scannedFiles: 0. discoveryFailed: true plus a
  // non-empty reason (git's own "not a git repository" stderr) is what
  // makes the two tell-apart-able now.
  assert.strictEqual(discoveryFailed, true);
  assert.ok(typeof discoveryReason === 'string' && discoveryReason.length > 0, 'discoveryReason must capture the underlying git failure, not be silently dropped');
});

// ── Output contract: coverage counts, ordering, evidence ────────────────────

// The AC1 NUL-byte test asserts only `scannedFiles > 0`, so the count's
// actual semantics — and the 'entrypoint' skip reason — are otherwise
// unpinned. Both are read by focus-mode.md's zero-candidates report, where a
// wrong coverage number is worse than no number (IL-77).
test('scannedFiles counts every tracked source file considered, skipped ones included, and gitignored files are never considered at all', () => {
  const root = buildAc1Fixture();
  const { scannedFiles, skippedFiles, discoveryFailed } = scanDeadCode(root);
  // bin/entry.js, blob.js, lib/caller.js, lib/used.js, orphan.js —
  // NOT ignored.js (gitignored) and NOT .gitignore (not a source extension).
  assert.strictEqual(scannedFiles, 5);
  assert.strictEqual(discoveryFailed, false);
  assert.deepStrictEqual(
    skippedFiles.map((s) => `${s.file}:${s.reason}`).sort(),
    ['bin/entry.js:entrypoint', 'blob.js:binary-or-nul'],
  );
});

// The other half of the skip contract. A dangling symlink is listed by
// `git ls-files --others` but throws on read — the one shape that reaches the
// read-failure branch, which no fixture above exercises at all.
test('an unreadable file is skipped with reason "unreadable", never a candidate, and never crashes the scan', () => {
  const root = tmpGitRepo();
  fs.writeFileSync(path.join(root, 'orphan.js'), 'function f() {}\nmodule.exports = { f };\n');
  fs.symlinkSync(path.join(root, 'nonexistent-target.js'), path.join(root, 'dangling.js'));
  const { candidates, skippedFiles } = scanDeadCode(root);
  assert.deepStrictEqual(skippedFiles, [{ file: 'dangling.js', reason: 'unreadable' }]);
  assert.ok(!candidates.some((c) => c.file === 'dangling.js'));
  assert.deepStrictEqual(candidates.map((c) => c.file), ['orphan.js']);
});

// ── Output contract: ordering and evidence ──────────────────────────────────

// Every test above either re-sorts the result itself or asserts an empty
// array, so all of them still pass with `candidates.sort(...)` deleted. This
// one pins it: two dead exports in one file are DEFINED in the order
// beta-then-alpha and therefore extracted (and pushed) in that order, so an
// unsorted result emits them backwards.
test('candidates are emitted in a deterministic file-then-symbol order', () => {
  const root = tmpGitRepo();
  fs.mkdirSync(path.join(root, 'bin'), { recursive: true });
  fs.mkdirSync(path.join(root, 'lib'), { recursive: true });
  // Entrypoint — keeps lib/multi.js off the orphan list so its exports get checked.
  fs.writeFileSync(path.join(root, 'bin', 'main.js'), "require('../lib/multi');\n");
  fs.writeFileSync(
    path.join(root, 'lib', 'multi.js'),
    'function beta() { return 1; }\nfunction alpha() { return 2; }\nmodule.exports = { beta, alpha };\n',
  );
  fs.writeFileSync(path.join(root, 'a-orphan.js'), 'const x = 1;\nconsole.log(x);\n');
  const candidates = candidatesDeadCode(root);
  assert.deepStrictEqual(
    candidates.map((c) => `${c.file}:${c.symbol || ''}`),
    ['a-orphan.js:', 'lib/multi.js:alpha', 'lib/multi.js:beta'],
  );
});

// Nothing above reads `evidence`, so it could be dropped or blank with the
// whole suite still green — and it is the only part of a candidate the judge
// (SKILL.md Step 5) actually reasons over.
test('each candidate carries evidence naming its own file and symbol', () => {
  const root = buildAc1Fixture();
  const byKind = Object.fromEntries(candidatesDeadCode(root).map((c) => [c.kind, c.evidence]));
  assert.strictEqual(
    byKind['unreferenced-export'],
    '"deadFn" is exported from lib/used.js (module.exports) but no other line in any tracked file references it by name',
  );
  assert.strictEqual(
    byKind['orphan-file'],
    "no other tracked file's require/import specifier resolves to orphan.js",
  );
});

// The spec's cursor-neutrality constraint: a focus firing must not touch the
// generalist rotation's cursor or content-hash state, both of which live in
// bin/lib/code-health/scope.js. There is no on-disk rotation state reachable
// from a fixture tree, so the enforceable form of that constraint is that
// this module never imports scope.js (or next-slice) at all — bound to a
// check here rather than left to prose (IL-102). Comment lines are stripped
// first so the header's illustrative `require('./a')`-style examples don't
// count as imports.
test('cursor-neutrality: the module imports nothing beyond fs/path/./source-scan/./focus-generators/../shared-primitives — never scope.js or next-slice', () => {
  const src = readText(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'code-health', 'candidates-dead-code.js'));
  const codeOnly = src.split('\n').filter((line) => !/^\s*\/\//.test(line)).join('\n');
  const imports = (codeOnly.match(/require\(\s*['"][^'"]+['"]\s*\)/g) || []).sort();
  // './focus-generators' is the shared framework registry this module
  // registers into (Item 6); '../shared-primitives' (#977) is a pure,
  // zero-dependency utility module (GH_TIMEOUT_MS, escapeRegExp) with no
  // requires of its own; './source-scan' (#3478) is the leaf holding the
  // shared git-ls-files/export-extraction helpers (child_process lives there
  // now) — none touches scope.js or next-slice, the two this guarantee
  // actually cares about.
  assert.deepStrictEqual(imports, ["require('../shared-primitives')", "require('./focus-generators')", "require('./source-scan')", "require('fs')", "require('path')"]);
});

// Behavioral counterpart to the source-grep test above (review finding: the
// grep proves the import list is clean but not that runtime behavior
// matches — a refactor-safe rename or a dynamic `require` built from string
// concatenation would evade it without violating the real guarantee). This
// asserts the actual guarantee directly: a real scanDeadCode call must leave
// every on-disk/ref surface the generalist rotation's state lives on
// byte-identical. Two such surfaces exist:
//   - the local dedup cache, .claude-tweaks/<skill>/cache.json
//     (bin/lib/health-core/cache.js) — must never be created here;
//   - the durable rotation-cursor/content-hash state, which is NOT a local
//     file at all — it lives on a dedicated `health-state` git branch
//     (bin/lib/health-core/durable-state.js), fetched/pushed via
//     `git ... origin/health-state`. A fetch/push against it would create or
//     move a `health-state` ref in this fixture repo, which `for-each-ref`
//     catches; `git status --porcelain` additionally catches any other
//     unexpected write anywhere in the tree (new/modified/untracked files).
test('cursor-neutrality (behavioral): a real scanDeadCode call leaves durable rotation-cursor/content-hash state and the local dedup cache byte-identical', () => {
  const root = buildAc1Fixture();
  const cacheDir = path.join(root, '.claude-tweaks');

  function snapshot() {
    return {
      cacheDirExists: fs.existsSync(cacheDir),
      refs: execFileSync('git', ['-C', root, 'for-each-ref'], { encoding: 'utf8' }),
      status: execFileSync('git', ['-C', root, 'status', '--porcelain'], { encoding: 'utf8' }),
    };
  }

  const before = snapshot();
  assert.strictEqual(before.cacheDirExists, false, 'sanity check: the fixture must not already have a cache dir, or this test would prove nothing');

  scanDeadCode(root);

  const after = snapshot();
  assert.deepStrictEqual(after, before);
});
