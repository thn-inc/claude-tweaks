'use strict';
// #5377: the hook-event test files run hooks.js in-process (tests/helpers/hook-event.js). A real
// `node hooks.js` child stays only where the process is the test's subject, through `spawnCli`, and
// the converted files together hold at most CEILING of them. This scan keeps a later edit from
// starting hooks.js through a raw spawn again, or growing the count past the ceiling.
//
// What the scan cannot see:
// - It counts call sites, not calls. A local wrapper that holds one `spawnCli(HOOKS` and is called
//   from many tests counts once, so the ceiling bounds the places a real process is started, not
//   how many real processes a run starts. (tools/count-node-procs.js measures the latter.)
// - The spawnCli count takes only a first argument that is the bare `HOOKS` or `hooks` identifier. A
//   script path held under another name, a member access (`paths.hooks`) or a computed path is not
//   counted. The raw-spawn pattern is wider: `\b(HOOKS|hooks)\b` matches anywhere in the argv array,
//   so `execFileSync('node', [paths.hooks, 'x'])` and `spawnSync(process.execPath, [script, '--dir',
//   'hooks'])` are both flagged, and the raw-spawn scan can over-match.
// - The loop check sees a `for`/`while` body and a `.forEach(`/`.map(` call. It does not see a
//   `do { … } while (…)` body, a `for await (`, another iterating method (`.reduce`, `.filter`,
//   `.some`, `.flatMap`), a braceless body past its first `;`, or a helper that a loop calls.
// - A mis-parse by the comment stripper, or a file that does not compile as CommonJS, is reported as
//   an offender (a `stripperVerdict` other than `ok`) rather than scanned over blanked text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

const REPO = path.join(__dirname, '..');
const CONVERTED = [
  'tests/hooks-dispatcher.test.js',
  'tests/hooks-run-attribution.test.js',
  'tests/run-integrity.test.js',
  'tests/skill-invocation.test.js',
  'tests/teardown-gate.test.js',
  'tests/user-prompt-submit.test.js',
];
const CEILING = 20;

// Any argv array that names the script, so a `['--require', preload, HOOKS, ...]` site is flagged too.
const RAW_SPAWN = /(execFileSync|spawnSync|execSync|spawn)\(\s*('node'|"node"|process\.execPath)\s*,\s*\[[^\]]*\b(HOOKS|hooks)\b/g;
const SPAWN_CLI = /spawnCli\(\s*(HOOKS|hooks)\b/g;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

// The comment-stripped text, or the stripper's own mis-parse / unparseable message when the stripped
// text cannot be trusted. A scan over blanked code would read as a clean file.
function stripperOffender(src) {
  const verdict = stripperVerdict(src, stripComments(src));
  return verdict === 'ok' ? null : STRIPPER_VERDICT_MESSAGES[verdict];
}

function rawSpawnLines(src) {
  const text = stripComments(src);
  return [...text.matchAll(RAW_SPAWN)].map((m) => lineOf(text, m.index));
}

function spawnCliSites(src) {
  const text = stripComments(src);
  return [...text.matchAll(SPAWN_CLI)].map((m) => lineOf(text, m.index));
}

// Index of the bracket that closes the one at `open` (`(`, `{` or `[`), or text.length when unbalanced.
function closeOf(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if ('({['.includes(text[i])) depth += 1;
    else if (')}]'.includes(text[i]) && --depth === 0) return i;
  }
  return text.length;
}

// [from, to) of the code a for/while/forEach/map runs per iteration, on blank-mode text (string,
// template and regex bodies blanked, so a brace inside one is not a brace). A for/while body opens after
// the balanced `)` of its header: a `{` block to its balanced `}`, or a braceless statement to the next
// top-level `;`. A forEach/map callback is the whole call, from its `(` to its balanced `)`, so an arrow
// with a destructured parameter, a `function (...)` callback and a body without braces all count.
function loopRegions(text) {
  const regions = [];
  for (const m of text.matchAll(/\b(for|while)\s*\(/g)) {
    let i = closeOf(text, m.index + m[0].length - 1) + 1;
    while (i < text.length && /\s/.test(text[i])) i += 1;
    if (text[i] === '{') {
      regions.push([i, closeOf(text, i) + 1]);
      continue;
    }
    let end = i;
    let depth = 0;
    for (; end < text.length; end++) {
      const ch = text[end];
      if ('({['.includes(ch)) depth += 1;
      else if (')}]'.includes(ch)) { if (depth === 0) break; depth -= 1; } else if (ch === ';' && depth === 0) break;
    }
    regions.push([i, end]);
  }
  for (const m of text.matchAll(/\.(forEach|map)\(/g)) {
    const open = m.index + m[0].length - 1;
    regions.push([open, closeOf(text, open) + 1]);
  }
  return regions;
}

// Lines of a `spawnCli(` call that sits inside the body of a for/while/forEach/map.
function spawnCliInLoopLines(src) {
  const text = stripComments(src, { literals: 'blank' });
  const regions = loopRegions(text);
  const flagged = new Set();
  for (const m of text.matchAll(/spawnCli\(/g)) {
    if (regions.some(([from, to]) => m.index >= from && m.index < to)) flagged.add(lineOf(text, m.index));
  }
  return [...flagged].sort((a, b) => a - b);
}

function read(rel) {
  return readText(path.join(REPO, rel));
}

function ceilingFailure(sites, ceiling) {
  return sites > ceiling
    ? `${sites} spawnCli call sites for hooks.js across the converted files, over the ceiling of ${ceiling}`
    : null;
}

// Everything the first AC flags in one file: a stripper offender, then the raw-spawn lines.
function rawSpawnFlags(src) {
  const offender = stripperOffender(src);
  if (offender) return [offender];
  return rawSpawnLines(src).map((n) => `line ${n}: a raw spawn names hooks.js`);
}

test('AC1.1: no converted file starts hooks.js outside spawnCli', () => {
  for (const rel of CONVERTED) {
    assert.deepEqual(rawSpawnFlags(read(rel)), [], `${rel}: a raw spawn names hooks.js — use runHookCli, or spawnCli with a "real process:" reason`);
  }
});

test('AC1.1: the converted files hold at most 20 spawnCli call sites for hooks.js', () => {
  let total = 0;
  for (const rel of CONVERTED) {
    const src = read(rel);
    assert.equal(stripperOffender(src), null, `${rel}: the comment stripper cannot be trusted over this file`);
    total += spawnCliSites(src).length;
    assert.deepEqual(spawnCliInLoopLines(src), [], `${rel}: a spawnCli call sits inside a loop body`);
  }
  assert.equal(ceilingFailure(total, CEILING), null, ceilingFailure(total, CEILING) || '');
});

test('self-test: a planted execFileSync of hooks.js is flagged with its line', () => {
  const src = ["'use strict';", "execFileSync('node', [HOOKS, 'pre-tool-use']);"].join('\n');
  assert.deepEqual(rawSpawnLines(src), [2]);
});

test('self-test: a planted --require preload spawn of hooks.js is flagged with its line', () => {
  const src = ["'use strict';", '', "execFileSync('node', ['--require', preload, HOOKS, 'pre-tool-use']);"].join('\n');
  assert.deepEqual(rawSpawnLines(src), [3]);
});

test('self-test: a spawn that does not name the script is not flagged', () => {
  assert.deepEqual(rawSpawnLines("spawnSync(process.execPath, ['-e', '']);"), []);
});

test('self-test: a spawn named only in a comment is not flagged', () => {
  assert.deepEqual(rawSpawnLines("// execFileSync('node', [HOOKS, 'x']);"), []);
});

test('self-test: a planted twenty-first spawnCli fails with the ceiling message', () => {
  const src = Array.from({ length: CEILING + 1 }, () => "spawnCli(HOOKS, ['pre-tool-use']);").join('\n');
  const sites = spawnCliSites(src).length;
  assert.equal(sites, CEILING + 1);
  assert.match(ceilingFailure(sites, CEILING), /21 spawnCli call sites for hooks\.js .* over the ceiling of 20/);
  assert.equal(ceilingFailure(CEILING, CEILING), null);
});

test('self-test: a spawnCli inside a loop body is flagged by line', () => {
  const src = [
    'for (const a of list) {',
    "  spawnCli(HOOKS, ['pre-tool-use']);",
    '}',
    "spawnCli(HOOKS, ['session-end']);",
    'list.forEach((a) => {',
    "  spawnCli(HOOKS, [a]);",
    '});',
  ].join('\n');
  assert.deepEqual(spawnCliInLoopLines(src), [2, 6]);
});

test('self-test: a spawnCli in a loop body that opens and closes on one line is flagged, and the call after it is not', () => {
  const src = [
    'list.forEach((a) => { spawnCli(HOOKS, [a]); });',
    "spawnCli(HOOKS, ['session-end']);",
    'for (const a of list) { spawnCli(HOOKS, [a]); }',
    "spawnCli(HOOKS, ['pre-compact']);",
    'list.map((a) => { return a; });',
    "spawnCli(HOOKS, ['stop']);",
  ].join('\n');
  assert.deepEqual(spawnCliInLoopLines(src), [1, 3]);
});

test('self-test: a loop body with no braces that calls spawnCli is flagged', () => {
  const src = [
    'for (const a of list) spawnCli(HOOKS, [a]);',
    "spawnCli(HOOKS, ['session-end']);",
  ].join('\n');
  assert.deepEqual(spawnCliInLoopLines(src), [1]);
});

test('self-test: a destructured loop header or callback parameter does not open the body early', () => {
  const src = [
    'for (const { a } of list) {',
    '  const x = 1;',
    "  spawnCli(HOOKS, [a]);",
    '}',
    "spawnCli(HOOKS, ['session-end']);",
    'list.forEach(({ a }) => {',
    '  const y = 2;',
    "  spawnCli(HOOKS, [a]);",
    '});',
    "spawnCli(HOOKS, ['pre-compact']);",
  ].join('\n');
  assert.deepEqual(spawnCliInLoopLines(src), [3, 8]);
});

test('self-test: a brace inside a string literal is not a loop body or a loop end', () => {
  const src = [
    "const open = '{';",
    "const close = '}';",
    "for (const a of ['{']) {",
    "  spawnCli(HOOKS, [a]);",
    '}',
    "spawnCli(HOOKS, ['session-end']);",
  ].join('\n');
  assert.deepEqual(spawnCliInLoopLines(src), [4]);
});

test('self-test: a function callback of forEach is a loop body', () => {
  const src = [
    'list.forEach(function (a) {',
    "  spawnCli(HOOKS, [a]);",
    '});',
    "spawnCli(HOOKS, ['stop']);",
  ].join('\n');
  assert.deepEqual(spawnCliInLoopLines(src), [2]);
});

test('self-test: a file the comment stripper mis-parses is reported as an offender, not scanned', () => {
  const src = "if (x) /[/*]/.test(x);\nexecFileSync('node', [HOOKS, 'pre-tool-use']);\n/* c */\n";
  assert.equal(stripperOffender(src), STRIPPER_VERDICT_MESSAGES.misparsed);
  assert.deepEqual(rawSpawnFlags(src), [STRIPPER_VERDICT_MESSAGES.misparsed]);
});

test('self-test: a file that does not compile as CommonJS is reported as an offender', () => {
  const src = "import { spawnCli } from './helpers/run-cli';\nspawnCli(HOOKS, ['pre-tool-use']);\n";
  assert.equal(stripperOffender(src), STRIPPER_VERDICT_MESSAGES.unparseable);
  assert.deepEqual(rawSpawnFlags(src), [STRIPPER_VERDICT_MESSAGES.unparseable]);
});

test('self-test: a clean file has no stripper offender', () => {
  assert.equal(stripperOffender("execFileSync('git', ['status']);\n"), null);
});
