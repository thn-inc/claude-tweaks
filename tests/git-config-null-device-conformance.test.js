'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

// #5666 (follows #3696): a test or tool that hands git `os.devNull` as the value
// of GIT_CONFIG_GLOBAL or GIT_CONFIG_SYSTEM passes on POSIX, where os.devNull is
// '/dev/null', and fails only on Windows, where it is '\\.\nul' and git reads it
// as a config file path it cannot open. CI runs on ubuntu only, so each such line
// surfaced through the post-merge Windows run. The literal string '/dev/null' is
// the value git accepts on every platform. This scan fails on Linux instead: no
// .js file under tests/ or tools/ may give either variable the value os.devNull,
// as an object-literal property (`GIT_CONFIG_GLOBAL: os.devNull`, quoted key too)
// or as an assignment (`env.GIT_CONFIG_SYSTEM = os.devNull`, `env['…'] = …`).
// A comparison (`=== os.devNull`) and a stdio use (`fs.openSync(os.devNull)`) are
// not reported.
//
// Recall limits (by design, stated so a green scan is not read as more):
//   (a) a destructured `devNull` (`const { devNull } = require('os')`) is not
//       matched, since the value is no longer spelled `os.devNull`;
//   (b) a value held in a variable (`const NUL = os.devNull; … GIT_CONFIG_GLOBAL: NUL`)
//       is not followed;
//   (c) a key and its value split across lines are not matched, the scan being
//       one regex per line;
//   (d) a wrapped or conditional value, where `os.devNull` does not directly
//       follow the separator (`GIT_CONFIG_GLOBAL: cond ? os.devNull : x`,
//       `GIT_CONFIG_GLOBAL: (os.devNull)`), is not matched.
// It matches raw lines, not comment-stripped code, so a comment that holds the
// pattern is flagged too. The suite skips its own file by name: its planted
// offenders are text, so scanning it would report them.
const ROOT = path.join(__dirname, '..');
const SELF = path.basename(__filename);

// .js files under tests/ and tools/ (this suite excluded) when this landed:
// `git ls-files tests tools | grep -c '\.js$'` printed 1382 before this file
// existed. When .js files under tests/ or tools/ were really deleted, lower the
// floor to the new tracked count (`git ls-files tests tools | grep -c '\.js$'`
// minus this suite) in the same change and say why; never lower it to hide a
// walk that lost part of the tree.
const FILE_FLOOR = 1382;

const NULL_DEVICE_CONFIG = /(?<![\w$])GIT_CONFIG_(?:GLOBAL|SYSTEM)['"]?\]?\s*(?::|=)\s*os\s*\.\s*devNull(?![\w$])/;

// 1-based line numbers of every line giving GIT_CONFIG_GLOBAL/SYSTEM os.devNull.
function findNullDeviceConfig(text) {
  const lines = [];
  text.split('\n').forEach((line, i) => {
    if (NULL_DEVICE_CONFIG.test(line)) lines.push(i + 1);
  });
  return lines;
}

function listJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listJs(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function assertFloor(count) {
  assert.ok(count >= FILE_FLOOR, `walked only ${count} .js files, floor ${FILE_FLOOR}: the walk lost part of tests/ or tools/, or files were deleted (then lower the floor to the tracked count)`);
}

let corpusCache = null;
function corpus() {
  if (corpusCache === null) {
    const testsRoot = path.join(ROOT, 'tests');
    const files = [...listJs(testsRoot), ...listJs(path.join(ROOT, 'tools'))].filter((f) => !(path.dirname(f) === testsRoot && path.basename(f) === SELF));
    corpusCache = files.map((file) => ({
      rel: path.relative(ROOT, file).split(path.sep).join('/'),
      text: readText(file),
    }));
  }
  return corpusCache;
}

test('AC3.1 AC3.2 a planted object-literal and assignment offender are each reported with its line', () => {
  const planted = [
    "const env = { GIT_CONFIG_GLOBAL: os.devNull };",
    "const x = 1;",
    "process.env.GIT_CONFIG_SYSTEM = os.devNull;",
    "const y = { 'GIT_CONFIG_GLOBAL': os.devNull, a: 1 };",
    "env['GIT_CONFIG_SYSTEM'] = os.devNull;",
  ].join('\n');
  assert.deepEqual(findNullDeviceConfig(planted), [1, 3, 4, 5]);
  assert.deepEqual(findNullDeviceConfig(planted.replace(/\n/g, '\r\n')), [1, 3, 4, 5]);
});

test("AC3.3 AC3.4 the literal '/dev/null', a stdio os.devNull and a comparison are not reported", () => {
  const clean = [
    "const env = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };",
    "spawnSync('git', ['status'], { stdio: ['ignore', fs.openSync(os.devNull, 'w'), 'pipe'] });",
    "const fd = fs.openSync(os.devNull, 'r');",
    "if (env.GIT_CONFIG_GLOBAL === os.devNull) {}",
  ].join('\n');
  assert.deepEqual(findNullDeviceConfig(clean), []);
});

test('AC4.1 the suite fails when it reads fewer files than its floor', () => {
  assert.throws(() => assertFloor(FILE_FLOOR - 1), /floor/);
  assert.doesNotThrow(() => assertFloor(FILE_FLOOR));
});

test('AC4.2 the walk reads at least the files it read when it landed (floor on files walked)', () => {
  assertFloor(corpus().length);
});

test('AC2.1 no test or tool source gives GIT_CONFIG_GLOBAL or GIT_CONFIG_SYSTEM the value os.devNull (use the literal /dev/null)', () => {
  const offenders = corpus().flatMap(({ rel, text }) => findNullDeviceConfig(text).map((line) => `${rel}:${line}`));
  assert.deepEqual(offenders, []);
});
