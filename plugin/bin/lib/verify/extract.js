// plugin/bin/lib/verify/extract.js — content-sniffed output-family detection,
// bounded failing-region extraction, and suite-count parsing (#892, AC5).
// Family is sniffed from output CONTENT, never from the check's name. Counts
// fail toward absence: anything ambiguous returns null — a wrong count would
// poison #881's future drop-detection.
// `extractFailingFiles` (#1925) names the failing TEST files the same way,
// ANSI-stripped, for the runner's flaky retry; `[]` when nothing parses.
'use strict';

const MAX_REGION_LINES = 100;
const GENERIC_TAIL_LINES = 30;
const MAX_SUMMARY_CHARS = 200;
const MAX_LINE_CHARS = 500;

const TAP_MARKERS = [/^not ok\b/m, /^ok \d/m, /^# tests\b/m];
const SUMMARY_MARKERS = [/^FAIL /m, /^PASS /m, /^Tests:.*failed/m, /^=+ .*(passed|failed).*=+$/m];
const KNOWN_SUMMARY_CATEGORIES = ['failed', 'passed', 'skipped', 'pending', 'todo'];

function sniffFamily(text) {
  if (TAP_MARKERS.some((re) => re.test(text))) return 'tap';
  if (SUMMARY_MARKERS.some((re) => re.test(text))) return 'summary';
  return 'generic';
}

function cap(lines) {
  return lines.slice(0, MAX_REGION_LINES)
    .map((line) => (line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line))
    .join('\n');
}

function extractFailingRegion(text, family) {
  const lines = text.split('\n');
  if (family === 'tap') {
    // Each `not ok` line plus its trailing diagnostic block (node --test emits
    // the diagnostics AFTER the failure line — same reason verification.md's
    // old recipe used grep -A).
    const out = [];
    let inFailure = false;
    for (const line of lines) {
      if (/^not ok\b/.test(line)) { inFailure = true; out.push(line); continue; }
      if (/^(ok \d|# )/.test(line)) { inFailure = false; continue; }
      if (inFailure) out.push(line);
    }
    return cap(out);
  }
  if (family === 'summary') {
    // FAIL/Error regions (2 before, 20 after each anchor) plus the trailing
    // summary block, deduplicated by line index and kept in file order.
    const keep = new Set();
    lines.forEach((line, i) => {
      if (/^FAIL |^Error:/.test(line)) {
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 20); j++) keep.add(j);
      }
      if (/^Tests:|^=+ .*(passed|failed).*=+$/.test(line)) keep.add(i);
    });
    return cap([...keep].sort((a, b) => a - b).map((i) => lines[i]));
  }
  return cap(lines.slice(-GENERIC_TAIL_LINES));
}

function num(match) {
  return match === null ? null : Number(match[1]);
}

function parseCounts(text, family) {
  if (family === 'tap') {
    const tests = num(text.match(/^# tests (\d+)/m));
    const pass = num(text.match(/^# pass (\d+)/m));
    const fail = num(text.match(/^# fail (\d+)/m));
    if (tests === null || pass === null || fail === null) return null;
    return { tests, pass, fail };
  }
  if (family === 'summary') {
    const lineMatch = text.match(/^Tests:.*$/m) || text.match(/^=+ .*(?:passed|failed).*=+$/m);
    if (lineMatch === null) return null;
    const line = lineMatch[0];
    let failed = num(line.match(/(\d+) failed/));
    let passed = num(line.match(/(\d+) passed/));
    const total = num(line.match(/(\d+) total/));
    if (failed === null && passed === null) return null;
    if (total !== null) {
      const pairs = [...line.matchAll(/(\d+) ([a-z]+)/gi)]
        .filter((m) => m[2].toLowerCase() !== 'total');
      const hasUnknownCategory = pairs.some((m) => !KNOWN_SUMMARY_CATEGORIES.includes(m[2].toLowerCase()));
      if (!hasUnknownCategory) {
        const accounted = pairs.reduce((s, m) => s + Number(m[1]), 0);
        const missing = total - accounted;
        if (missing >= 0) {
          if (failed === null) failed = missing;
          else if (passed === null) passed = missing;
        }
      }
    }
    if (failed === null || passed === null) return null;
    return { tests: total === null ? passed + failed : total, pass: passed, fail: failed };
  }
  return null;
}

// One bounded line for the report table: the counts line when one parses,
// else the last non-empty line, truncated.
function summaryLine(text, family) {
  const counts = parseCounts(text, family);
  if (counts !== null) return `tests ${counts.tests}, pass ${counts.pass}, fail ${counts.fail}`;
  const lastLine = text.split('\n').filter((l) => l.trim() !== '').pop() || '';
  return lastLine.slice(0, MAX_SUMMARY_CHARS);
}

// ANSI colour sequences, ESC-anchored (#1837: vitest's coloured summary
// defeated parseCounts). Stripped before every regex below — never
// applied to the region/summary paths, whose fixtures are colour-free.
const ANSI_RE = /\x1b\[[0-9;]*m/g;
function stripAnsi(text) { return text.replace(ANSI_RE, ''); }

// Only test files are retried — a stack frame also names the source files
// under test, and the retry template runs a test file, never a module.
const TEST_FILE_RE = /(?:\.(?:test|spec)\.[cm]?[jt]sx?|(?:^|\/)test_[^/]+\.py|_test\.[a-z]+)$/;
const PATH = '[A-Za-z0-9_./@~-]+';
// Windows-native node --test frames add a drive-letter colon and backslash
// separators (`C:\repo\tests\x.test.js:42:10`) — this wider class is for
// TAP_FRAME_RE only. SUMMARY_FAIL_RE keeps the colon-free PATH: its pytest
// case (`FAILED path::name`) relies on `:` not being a PATH character so the
// `(?=\s|::|$)` lookahead stops at `::` instead of the capture swallowing it
// (review finding, refs #1925).
const WIN_PATH = '[A-Za-z0-9_./@~:\\\\-]+';
// node --test: `at fn (path:line:col)` / `at path:line:col`, and the
// `location: 'path:line:col'` diagnostic newer runners print.
const TAP_FRAME_RE = new RegExp(`(?:\\(|\\s|')(${WIN_PATH}):\\d+:\\d+\\)?`, 'g');
// vitest (` FAIL  path > name`, `❯ path (n tests | m failed)`), jest
// (`FAIL path`), pytest (`FAILED path::name`).
const SUMMARY_FAIL_RE = new RegExp(`^\\s*(?:FAIL|❯|FAILED)\\s+(${PATH})(?=\\s|::|$)`);

function relativize(file, cwd) {
  const normalizedFile = file.replace(/\\/g, '/');
  const prefix = `${cwd.replace(/\\/g, '/').replace(/\/+$/, '')}/`;
  return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : normalizedFile;
}

// Deduped, log-order, repo-relative test files named by the failing part of
// the log. `[]` whenever nothing parses — no parse ⇒ no retry (the caller
// never guesses). TAP: frames inside `not ok` blocks only, so a passing
// test that printed a stack never reads as failing.
function extractFailingFiles(text, family, { cwd = process.cwd() } = {}) {
  const lines = stripAnsi(text).split('\n');
  const found = [];
  const push = (file) => {
    const rel = relativize(file, cwd);
    if (TEST_FILE_RE.test(rel) && !rel.startsWith('node:') && !found.includes(rel)) found.push(rel);
  };
  if (family === 'tap') {
    let inFailure = false;
    for (const line of lines) {
      if (/^not ok\b/.test(line)) { inFailure = true; continue; }
      if (/^(ok \d|# )/.test(line)) { inFailure = false; continue; }
      if (!inFailure) continue;
      for (const m of line.matchAll(TAP_FRAME_RE)) push(m[1]);
    }
    return found;
  }
  if (family === 'summary') {
    for (const line of lines) {
      const m = line.match(SUMMARY_FAIL_RE);
      if (m) push(m[1]);
    }
    return found;
  }
  return found;
}

module.exports = {
  sniffFamily, extractFailingRegion, parseCounts, summaryLine,
  stripAnsi, extractFailingFiles, TEST_FILE_RE,
  MAX_REGION_LINES, GENERIC_TAIL_LINES, MAX_LINE_CHARS,
};
