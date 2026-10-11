// tests/resolve-ambiguity-cli.test.js — in-process tests for
// bin/resolve-ambiguity.js's run(argv, deps), mirroring
// tests/resolve-linked-prs-cli.test.js's deps-injection style: real fs calls
// are replaced by fakeDeps so no temp file ever touches disk in this suite.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { run } = require('../plugin/bin/resolve-ambiguity');

function fakeDeps(overrides = {}) {
  const calls = { readFile: [], writeFile: [], stdout: [], stderr: [] };
  const files = { '/body.txt': 'Before. <!-- ambiguity: which store? --> After.' };
  return {
    calls,
    files,
    readFile: (p) => {
      calls.readFile.push(p);
      if (!(p in files)) throw new Error(`ENOENT: ${p}`);
      return files[p];
    },
    writeFile: (p, s) => {
      calls.writeFile.push([p, s]);
      files[p] = s;
    },
    stdout: (s) => calls.stdout.push(s),
    stderr: (s) => calls.stderr.push(s),
    ...overrides,
  };
}

// --- argument parsing ---------------------------------------------------

test('missing <body-file> is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['--marker', 'x', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /<body-file> is required/);
});

test('missing --marker is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--marker <text> or --marker-file <file> is required/);
});

test('missing --resolution is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', 'x', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--resolution <text> or --resolution-file <file> is required/);
});

test('missing --out is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', 'x', '--resolution', 'y'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--out <body-file> is required/);
});

test('unknown flag is malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--bogus'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /unknown argument: --bogus/);
});

test('--help prints usage and exits 0 without touching the filesystem', () => {
  const deps = fakeDeps({
    readFile: () => { throw new Error('should not be called'); },
    writeFile: () => { throw new Error('should not be called'); },
  });
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(deps.calls.stdout.join(''), /usage: resolve-ambiguity\.js/);
});

// --- read failure ---------------------------------------------------------

test('unreadable <body-file> — exit 2, no write attempted', () => {
  const deps = fakeDeps();
  const code = run(['/missing.txt', '--marker', 'x', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not read <body-file>/);
  assert.deepEqual(deps.calls.writeFile, []);
});

// --- marker not found ------------------------------------------------------

test('marker not found verbatim — exit 3, nothing written', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', 'not present', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 3);
  assert.match(deps.calls.stderr.join(''), /markerText not found verbatim/);
  assert.deepEqual(deps.calls.writeFile, []);
});

// --- success ----------------------------------------------------------------

test('success: replaces the marker and writes --out; a body that is not spec-shaped is not ready-restorable', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', '<!-- ambiguity: which store? -->', '--resolution', 'Uses Redis.', '--out', '/out.txt'], deps);
  assert.equal(code, 0);
  assert.equal(deps.files['/out.txt'], 'Before. Uses Redis. After.');
  const printed = JSON.parse(deps.calls.stdout[0]);
  assert.deepEqual(printed, {
    out: '/out.txt', markersRemaining: 0, openQuestionsRemaining: false, openQuestionsRemoved: false, readyRestorable: false,
  });
});

test('success: a second remaining marker reports readyRestorable false', () => {
  const deps = fakeDeps();
  deps.files['/body.txt'] = '<!-- ambiguity: a --> and <!-- ambiguity: b -->';
  const code = run(['/body.txt', '--marker', '<!-- ambiguity: a -->', '--resolution', 'resolved a', '--out', '/out.txt'], deps);
  assert.equal(code, 0);
  const printed = JSON.parse(deps.calls.stdout[0]);
  assert.equal(printed.markersRemaining, 1);
  assert.equal(printed.readyRestorable, false);
});

// --- write failure ------------------------------------------------------

test('--out cannot be written — exit 2', () => {
  const deps = fakeDeps({
    writeFile: () => { throw new Error('EACCES'); },
  });
  const code = run(['/body.txt', '--marker', '<!-- ambiguity: which store? -->', '--resolution', 'x', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /could not write --out file/);
});

// --- #2699 review fixes ------------------------------------------------------

const SHAPED = [
  '## Current State', 'x', '',
  '## Deliverables', '- [ ] y <!-- ambiguity: `which` store? -->', '',
  '## Acceptance Criteria', '- [ ] z', '',
  '## Release Note', 'n', '',
].join('\n');

test('an empty --marker "" is malformed — exit 2, not a lib-level exit 3', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', '', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.deepEqual(deps.calls.writeFile, []);
});

test('--marker and --marker-file together are malformed — exit 2', () => {
  const deps = fakeDeps();
  const code = run(['/body.txt', '--marker', 'x', '--marker-file', '/m.txt', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /not both/);
});

test('--marker-file/--resolution-file carry shell-hostile text verbatim, minus one trailing newline', () => {
  const deps = fakeDeps();
  deps.files['/body.txt'] = SHAPED;
  deps.files['/m.txt'] = '<!-- ambiguity: `which` store? -->\n';
  deps.files['/r.txt'] = 'Uses `$(redis)` "as is".\n';
  const code = run(['/body.txt', '--marker-file', '/m.txt', '--resolution-file', '/r.txt', '--out', '/out.txt'], deps);
  assert.equal(code, 0);
  assert.ok(deps.files['/out.txt'].includes('- [ ] y Uses `$(redis)` "as is".\n'), deps.files['/out.txt']);
  assert.equal(JSON.parse(deps.calls.stdout[0]).readyRestorable, true);
});

test('an empty --marker-file is malformed — exit 2', () => {
  const deps = fakeDeps();
  deps.files['/m.txt'] = '\n';
  const code = run(['/body.txt', '--marker-file', '/m.txt', '--resolution', 'y', '--out', '/out.txt'], deps);
  assert.equal(code, 2);
  assert.match(deps.calls.stderr.join(''), /--marker-file is empty/);
});

test('marker text that occurs more than once — exit 3, nothing written', () => {
  const deps = fakeDeps();
  deps.files['/body.txt'] = 'See X. Later: X. <!-- ambiguity: p -->';
  const code = run(['/body.txt', '--marker', 'X.', '--resolution', 'Y.', '--out', '/out.txt'], deps);
  assert.equal(code, 3);
  assert.deepEqual(deps.calls.writeFile, []);
});

test('a surviving Open Questions section keeps readyRestorable false at the CLI', () => {
  const deps = fakeDeps();
  deps.files['/body.txt'] = `${SHAPED}\n## Open Questions\n\n| Persona | Finding |\n|---|---|\n| Maintainer | q |\n`;
  const code = run(['/body.txt', '--marker', '<!-- ambiguity: `which` store? -->', '--resolution', 'Redis.', '--out', '/out.txt'], deps);
  assert.equal(code, 0);
  const printed = JSON.parse(deps.calls.stdout[0]);
  assert.equal(printed.markersRemaining, 0);
  assert.equal(printed.openQuestionsRemaining, true);
  assert.equal(printed.readyRestorable, false);
});
