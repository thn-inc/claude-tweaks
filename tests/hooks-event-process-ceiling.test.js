'use strict';
// #5377: the hook-event test files run hooks.js in-process (tests/helpers/hook-event.js). A real
// `node hooks.js` child stays only where the process is the test's subject, through `spawnCli`, and
// the converted files together hold at most CEILING of them. This scan keeps a later edit from
// starting hooks.js through a raw spawn again, or growing the count past the ceiling.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { stripComments } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

const REPO = path.join(__dirname, '..');
const CONVERTED = ['tests/hooks-dispatcher.test.js'];
const CEILING = 20;

// Any argv array that names the script, so a `['--require', preload, HOOKS, ...]` site is flagged too.
const RAW_SPAWN = /(execFileSync|spawnSync|execSync|spawn)\(\s*('node'|"node"|process\.execPath)\s*,\s*\[[^\]]*\b(HOOKS|hooks)\b/g;
const SPAWN_CLI = /spawnCli\(\s*(HOOKS|hooks)\b/g;
const LOOP_OPENERS = /\b(for|while)\s*\(|\.(forEach|map)\(/;

function lineOf(text, index) {
  return text.slice(0, index).split('\n').length;
}

function rawSpawnLines(src) {
  const text = stripComments(src);
  return [...text.matchAll(RAW_SPAWN)].map((m) => lineOf(text, m.index));
}

function spawnCliSites(src) {
  const text = stripComments(src);
  return [...text.matchAll(SPAWN_CLI)].map((m) => lineOf(text, m.index));
}

// Lines of a `spawnCli(` call that sits inside the body of a for/while/forEach/map. Brace depth is
// tracked on the stripped text; a loop body opens at the first `{` after its opener.
function spawnCliInLoopLines(src) {
  const text = stripComments(src);
  const lines = text.split('\n');
  const loopDepths = [];
  const flagged = [];
  let depth = 0;
  let pendingLoop = false;
  lines.forEach((line, i) => {
    if (LOOP_OPENERS.test(line)) pendingLoop = true;
    if (loopDepths.length && /spawnCli\(/.test(line)) flagged.push(i + 1);
    for (const ch of line) {
      if (ch === '{') {
        depth += 1;
        if (pendingLoop) { loopDepths.push(depth); pendingLoop = false; }
      } else if (ch === '}') {
        if (loopDepths.length && loopDepths[loopDepths.length - 1] === depth) loopDepths.pop();
        depth -= 1;
      }
    }
    if (pendingLoop && /;\s*$/.test(line) && !/\{/.test(line)) {
      if (/spawnCli\(/.test(line)) flagged.push(i + 1);
      pendingLoop = false;
    }
  });
  return flagged;
}

function read(rel) {
  return readText(path.join(REPO, rel));
}

function ceilingFailure(sites, ceiling) {
  return sites > ceiling
    ? `${sites} spawnCli call sites for hooks.js across the converted files, over the ceiling of ${ceiling}`
    : null;
}

test('AC1.1: no converted file starts hooks.js outside spawnCli', () => {
  for (const rel of CONVERTED) {
    assert.deepEqual(rawSpawnLines(read(rel)), [], `${rel}: a raw spawn names hooks.js — use runHookCli, or spawnCli with a "real process:" reason`);
  }
});

test('AC1.1: the converted files hold at most 20 spawnCli call sites for hooks.js', () => {
  let total = 0;
  for (const rel of CONVERTED) {
    const src = read(rel);
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
