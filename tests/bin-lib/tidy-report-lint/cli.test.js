'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { scratchDir } = require('../../helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { run } = require('../../../plugin/bin/tidy-report-lint');
const { conformantReport, condensedReport, longFullReport } = require('./fixtures');

function fakeDeps({ readFileMap = {}, stdinText = null, stdinIsTTY = false } = {}) {
  const out = [];
  const err = [];
  return {
    deps: {
      readFileSync: (target) => {
        if (target === 0) {
          if (stdinText === null) throw new Error('no stdin fixture provided');
          return stdinText;
        }
        if (Object.prototype.hasOwnProperty.call(readFileMap, target)) return readFileMap[target];
        throw new Error(`ENOENT: no such file, open '${target}'`);
      },
      stdinIsTTY: () => stdinIsTTY,
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
    },
    out,
    err,
  };
}

test('cli: a known-conformant report via --path arg exits 0 with no output', () => {
  const { deps, out } = fakeDeps({ readFileMap: { '/report.md': conformantReport() } });
  const code = run(['/report.md'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
});

test('cli: a known-conformant report via stdin exits 0 with no output', () => {
  const { deps, out } = fakeDeps({ stdinText: conformantReport() });
  const code = run([], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
});

test('cli: a known-nonconformant report (over-width line, missing footer, omitted fence) flags one line per failing row', () => {
  const lines = conformantReport().split('\n');
  // Over-width line.
  const widthIdx = lines.findIndex((l) => l.startsWith('deleted'));
  lines[widthIdx] = `${lines[widthIdx]}${'x'.repeat(30)}`;
  // Omit the Clean fence's opening marker.
  const cleanIdx = lines.findIndex((l) => l.trim() === '**Clean:**');
  let fenceIdx = cleanIdx + 1;
  while (lines[fenceIdx].trim() === '') fenceIdx += 1;
  assert.match(lines[fenceIdx], /^```/);
  lines.splice(fenceIdx, 1);
  // Drop the footer entirely (missing footer).
  const footerIdx = lines.findIndex((l) => l.includes('decisions.md'));
  lines.splice(footerIdx, 1);

  const { deps, out } = fakeDeps({ readFileMap: { '/report.md': lines.join('\n') } });
  const code = run(['/report.md'], deps);
  assert.equal(code, 1);
  const text = out.join('');
  assert.match(text, /^Width: line \d+ is \d+ chars \(max 100\)$/m);
  assert.match(text, /^Fenced, no box art: section "Clean:" is not followed by a fence$/m);
  assert.match(text, /^Clean shape: line \d+ "\*\*Clean:\*\*" is not followed by a fence$/m);
  assert.match(text, /^Footer once: "decisions\.md" appears 0 times \(expected exactly 1\)$/m);
  // One line per failing row — the omitted fence trips both "Fenced, no box
  // art" and "Clean shape" (two distinct table rows), so four rows fail here.
  assert.equal(text.trim().split('\n').length, 4);
});

test('cli: reads a real file path with fs, end to end', () => {
  const tmp = scratchDir('trl-cli-');
  const file = path.join(tmp, 'report.md');
  fs.writeFileSync(file, conformantReport());
  const out = [];
  const code = run([file], {
    readFileSync: fs.readFileSync,
    stdinIsTTY: () => false,
    stdout: (s) => out.push(s),
    stderr: () => {},
  });
  assert.equal(code, 0);
  assert.deepEqual(out, []);
});

test('cli: an unreadable path is a malformed invocation (exit 2)', () => {
  const { deps, err } = fakeDeps({ readFileMap: {} });
  const code = run(['/no/such/file.md'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /ENOENT/);
});

test('cli: too many positional args is a malformed invocation (exit 2)', () => {
  const { deps } = fakeDeps();
  const code = run(['/a.md', '/b.md'], deps);
  assert.equal(code, 2);
});

test('cli: no path and stdin is a TTY is a malformed invocation (exit 2)', () => {
  const { deps } = fakeDeps({ stdinIsTTY: true });
  const code = run([], deps);
  assert.equal(code, 2);
});

test('cli: --help prints usage and exits 0 without reading anything', () => {
  const { deps, out } = fakeDeps();
  const code = run(['--help'], deps);
  assert.equal(code, 0);
  assert.match(out.join(''), /usage: tidy-report-lint\.js/);
});

// #1625: --surface=condensed|full

test('cli: an unknown --surface value is a malformed invocation (exit 2)', () => {
  const { deps, err } = fakeDeps({ readFileMap: { '/report.md': conformantReport() } });
  const code = run(['--surface=bogus', '/report.md'], deps);
  assert.equal(code, 2);
  assert.match(err.join(''), /--surface must be "condensed" or "full"/);
});

test('cli: --surface=condensed against a genuinely condensed report exits 0 (no Footer once/Clean shape/Fenced-no-box-art false positives)', () => {
  const { deps, out } = fakeDeps({ readFileMap: { '/report.md': condensedReport() } });
  const code = run(['--surface=condensed', '/report.md'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
});

test('cli: the same condensed report WITHOUT --surface reproduces the pre-#1625 false positives (exit 1)', () => {
  const { deps, out } = fakeDeps({ readFileMap: { '/report.md': condensedReport() } });
  const code = run(['/report.md'], deps);
  assert.equal(code, 1);
  const text = out.join('');
  assert.match(text, /^Footer once:/m);
  assert.match(text, /^Clean shape:/m);
  assert.match(text, /^Fenced, no box art:/m);
});

test('cli: --surface=full against a long report.md exits 0 (no Condense false positive)', () => {
  const { deps, out } = fakeDeps({ readFileMap: { '/report.md': longFullReport() } });
  const code = run(['--surface=full', '/report.md'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
});

test('cli: the same long report.md WITHOUT --surface reproduces the pre-#1625 Condense false positive (exit 1)', () => {
  const { deps, out } = fakeDeps({ readFileMap: { '/report.md': longFullReport() } });
  const code = run(['/report.md'], deps);
  assert.equal(code, 1);
  assert.match(out.join(''), /^Condense: report is \d+ lines \(over 40\)/m);
});

test('cli: --surface works via stdin too', () => {
  const { deps, out } = fakeDeps({ stdinText: condensedReport() });
  const code = run(['--surface=condensed'], deps);
  assert.equal(code, 0);
  assert.deepEqual(out, []);
});
