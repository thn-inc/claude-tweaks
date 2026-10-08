// plugin/bin/lib/verify/extract.js — content-sniffed output-family detection,
// bounded failing-region extraction, and suite-count parsing (#892, AC5).
// Family is sniffed from output CONTENT, never from the check's name. Counts
// fail toward absence: anything ambiguous returns null — a wrong count would
// poison #881's future drop-detection.
// Families: tap, summary (jest/pytest/vitest), spec (node --test's default
// reporter, #3043), generic.
// `extractFailingFiles` (#1925) names the failing TEST files the same way,
// ANSI-stripped, for the runner's flaky retry; `[]` when nothing parses.
'use strict';

const MAX_REGION_LINES = 100;
const GENERIC_TAIL_LINES = 30;
const MAX_SUMMARY_CHARS = 200;
const MAX_LINE_CHARS = 500;

const TAP_MARKERS = [/^not ok\b/m, /^ok \d/m, /^# tests\b/m];
// Vitest's own summary block (`Test Files  64 passed (64)` / `Tests  727 passed
// (727)`) carries no colon and no `=`-banner — #1837 adds this as its own
// dialect rather than loosening the jest/pytest regexes.
const SUMMARY_MARKERS = [
  /^FAIL /m, /^PASS /m, /^Tests:.*failed/m, /^=+ .*(passed|failed).*=+$/m,
  /^\s*Test Files\s+\d+ (?:passed|failed)/m,
];
const KNOWN_SUMMARY_CATEGORIES = ['failed', 'passed', 'skipped', 'pending', 'todo'];
// node --test's `spec` reporter — the default since Node 20 (#3043). Its
// summary is `ℹ tests N` / `ℹ pass N` / `ℹ fail N`, and every failure is
// listed after `✖ failing tests:` as `test at <path>:<line>:<col>` followed by
// the failing test's name and diagnostics. Without this family the runner
// sniffed this repo's own `npm test` output as `generic` and named no file.
const SPEC_MARKERS = [/^ℹ tests \d+/m, /^✖ failing tests:/m];
const SPEC_TEST_AT_RE = /^test at (.+):(\d+:\d+)\s*$/;

// Spec first: its markers are unambiguous, while a stray `not ok` line a test
// printed to stdout would otherwise sniff a spec log as tap.
function sniffFamily(text) {
  if (SPEC_MARKERS.some((re) => re.test(text))) return 'spec';
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
    // #1837 review finding: sniffFamily now routes vitest output to
    // 'summary' too, but the anchors below only matched jest's/pytest's own
    // shapes — a vitest FAIL/❯/FAILED line has no leading-whitespace
    // tolerance here, and vitest's colon-free `Tests`/`Test Files` summary
    // lines never matched the trailing-summary anchor either, so a failed
    // vitest run's failingRegion could come back empty. Mirror this file's
    // own SUMMARY_FAIL_RE (below) and SUMMARY_MARKERS' vitest dialect
    // rather than diverging from patterns this file already has.
    const keep = new Set();
    lines.forEach((line, i) => {
      if (/^\s*(?:FAIL|❯|FAILED)\s|^Error:/.test(line)) {
        for (let j = Math.max(0, i - 2); j <= Math.min(lines.length - 1, i + 20); j++) keep.add(j);
      }
      if (/^Tests:|^=+ .*(passed|failed).*=+$|^\s*Test Files\s+\d+ (?:passed|failed)|^\s*Tests\s+\d+ (?:passed|failed)/.test(line)) keep.add(i);
    });
    return cap([...keep].sort((a, b) => a - b).map((i) => lines[i]));
  }
  if (family === 'spec') {
    const start = lines.findIndex((line) => /^✖ failing tests:/.test(line));
    if (start !== -1) return cap(lines.slice(start).map((line) => line.replace(/\r$/, '')));
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
    if (lineMatch === null) return parseVitestCounts(text);
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
  if (family === 'spec') {
    const tests = num(text.match(/^ℹ tests (\d+)/m));
    const pass = num(text.match(/^ℹ pass (\d+)/m));
    const fail = num(text.match(/^ℹ fail (\d+)/m));
    if (tests === null || pass === null || fail === null) return null;
    return { tests, pass, fail };
  }
  return null;
}

// Vitest's `Tests` line only — `Test Files` counts suites, not tests, and
// must never feed `counts.tests` (a 64-file suite is not 64 tests).
function parseVitestCounts(text) {
  const lineMatch = text.match(/^\s*Tests\s+\d+.*$/m);
  if (lineMatch === null) return null;
  const line = lineMatch[0];
  let failed = num(line.match(/(\d+) failed/));
  let passed = num(line.match(/(\d+) passed/));
  const skipped = num(line.match(/(\d+) skipped/));
  const total = num(line.match(/\((\d+)\)/));
  if (failed === null && passed === null) return null;
  if (total !== null) {
    const pairs = [...line.matchAll(/(\d+) ([a-z]+)/gi)];
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
  return { tests: total === null ? passed + failed + (skipped || 0) : total, pass: passed, fail: failed };
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

// A run of backslashes is ONE separator: node's TAP `location: '...'` line is
// YAML-quoted, so on Windows it carries `\\` per separator — read as two, the
// path never matched the cwd prefix and the same file listed twice.
function relativize(file, cwd) {
  const normalizedFile = file.replace(/\\+/g, '/');
  const prefix = `${cwd.replace(/\\+/g, '/').replace(/\/+$/, '')}/`;
  return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : normalizedFile;
}

// A path extractFailingFiles would keep: a test file, never a node: internal.
function isRetryableFile(rel) { return TEST_FILE_RE.test(rel) && !rel.startsWith('node:'); }

// Every `test at <path>:L:C` entry ({file: raw path, loc: 'L:C', next: the
// line right after it, body: the diagnostic lines after that}, in log order)
// inside the spec reporter's `✖ failing tests:` section.
function specEntries(lines) {
  const entries = [];
  let inSection = false;
  let current = null;
  let wantNext = false;
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const m = inSection ? line.match(SPEC_TEST_AT_RE) : null;
    if (wantNext) {
      current.next = line;
      wantNext = false;
      if (!m) continue;
    }
    if (/^✖ failing tests:/.test(line)) { inSection = true; continue; }
    if (!inSection) continue;
    if (m) { current = { file: m[1], loc: m[2], next: '', body: [] }; entries.push(current); wantNext = true; continue; }
    if (current) current.body.push(line);
  }
  return entries;
}

// A spec entry is file-level when node reports the FILE itself as the failing
// test (`✖ <path> (Nms)` right under `test at <path>:1:1`) — the shape a test
// file that fails to load takes, as opposed to a failing test inside it.
const SPEC_FAIL_NAME_RE = /^✖ (.+) \(\d[\d.]*ms\)\s*$/;

// A TAP name carries an optional `# SKIP` / `# TODO` directive after it. A
// block with a directive is not a failure (TAP's `# fail` excludes it), so it
// contributes no name — a todo name at base must never cover a real failure
// at HEAD.
const TAP_NAME_RE = /^\s*not ok\b(?:\s+\d+)?(?:\s+-)?\s*(.*?)(\s+#\s*(?:SKIP|TODO)\b.*)?\s*$/i;

// The failing test names per relativized test file, in log order, as a
// multiset (a name may repeat): Map<file, (string|null)[]>. spec: the
// `✖ <name> (…)` line after each `test at` entry, minus its duration (null
// when that line does not parse). tap: each `not ok N - <name>` block's name,
// under every test file its frames name — a `# SKIP`/`# TODO` block is
// skipped. A file-level entry's name is the path itself, so it is normalized
// the same way the file is. Entries naming no test file are skipped
// (countUnmatchedFailures counts them); every other family returns an empty
// Map. `located`: each name — file-level ones included — becomes
// `<name>@<line>:<col>` (the failing site; null when the entry carries none),
// so a load failure (`1:1`) and a file-scoped hook failure stay distinct.
// `conclusiveOnly`: an entry whose
// diagnostics say it timed out or was cancelled is dropped — it did not
// finish, which proves nothing about whether it fails.
const INCONCLUSIVE_RE = /test timed out after|testTimeoutFailure|cancelledBy|was cancelled|did not finish before/i;
const TAP_LOCATION_RE = /location:\s*'.*:(\d+:\d+)'/;
function failingTestsByFile(text, family, { cwd = process.cwd(), located = false, conclusiveOnly = false } = {}) {
  const byFile = new Map();
  const add = (rel, name, loc, body) => {
    if (conclusiveOnly && body.some((l) => INCONCLUSIVE_RE.test(l))) return;
    let named = name !== null && relativize(name, cwd) === rel ? rel : name;
    if (located && named !== null) named = loc ? `${named}@${loc}` : null;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(named);
  };
  const lines = stripAnsi(text).split('\n');
  if (family === 'spec') {
    for (const { file, loc, next, body } of specEntries(lines)) {
      const rel = relativize(file, cwd);
      if (!isRetryableFile(rel)) continue;
      const m = next.match(SPEC_FAIL_NAME_RE);
      add(rel, m ? m[1] : null, loc, body);
    }
  }
  if (family === 'tap') {
    for (const block of tapBlocks(lines)) {
      const [, name, directive] = block.line.replace(/\r$/, '').match(TAP_NAME_RE);
      if (directive) continue;
      const locLine = block.body.map((l) => l.match(TAP_LOCATION_RE)).find(Boolean);
      tapBlockFiles(block, cwd).forEach((rel) => add(rel, name, locLine ? locLine[1] : null, block.body));
    }
  }
  return byFile;
}

// The `ℹ cancelled N` (spec) / `# cancelled N` (tap) count, or null when the
// log carries none — a cancelled test did not finish, so a log with any is no
// evidence of what fails.
function cancelledCount(text, family) {
  const re = { spec: /^ℹ cancelled (\d+)/m, tap: /^# cancelled (\d+)/m }[family];
  const m = re && stripAnsi(text).match(re);
  return m ? Number(m[1]) : null;
}

// Every test point a single-file log reports. `all`/`passed` count leaf names
// (pass, fail or skip — suites included / only the ones that ran and passed,
// no SKIP/TODO directive), `paths` counts suite paths; `failed` lists each
// failing point by its suite path (a JSON array of names, so no name can
// fake a nesting boundary; a multiset in log order — suites and parent tests
// included), so two tests sharing a leaf name in different suites stay
// distinct. spec reads the tree above `✖ failing tests:` (that section
// repeats failures), nesting from `▶ name` openers and their same-indent
// closers; tap reads every `ok`/`not ok` line at any indentation, nesting
// from `# Subtest: name` lines. Names are read byte-for-byte on both sides,
// never trimmed. `wellFormed` is false when the nesting does not close
// cleanly — a point at a suite's indent that is not its closer, a point
// shallower than an open suite, or a suite still open at the end (a name
// containing a newline prints across lines) — and such a tree is no
// evidence of anything. A parent (a suite, or a test with subtests) appears in
// `failed` only when it failed in its own right — spec: it has its own
// `✖ failing tests:` entry (a hook failure); tap: its block's failureType is
// not 'subtestsFailed' — never for a failure it only inherits from a child,
// which the child's own entry already carries. Any ` # …` suffix (SKIP, TODO,
// a `t.skip('reason')` message) marks a point that neither passed nor
// failed. Other families: empty and well-formed.
const SPEC_TREE_RE = /^( *)([✔✖﹣]) (.+) \(\d[\d.]*ms\)( # .*)?$/;
const SPEC_OPEN_RE = /^( *)▶ (.*)$/;
const TAP_POINT_RE = /^( *)(not ok|ok)(?= |$)(?: \d+)?(?: - )?(.*?)( # (?:SKIP|TODO)\b.*)?$/i;
const TAP_OPEN_RE = /^( *)# Subtest: (.*)$/;
const TAP_INHERITED_RE = /^\s*failureType:\s*'subtestsFailed'/;
function testTree(text, family) {
  const all = new Map();
  const passed = new Map();
  const paths = new Map();
  const failures = [];
  let wellFormed = true;
  const bump = (map, name) => map.set(name, (map.get(name) || 0) + 1);
  const open = [];
  let lastFailure = null;
  const point = (indent, name, ok, fail) => {
    const top = open[open.length - 1];
    let parent = false;
    if (top && indent < top.indent) wellFormed = false;
    if (top && indent === top.indent) {
      if (top.name === name) { open.pop(); parent = top.hasChildren; } else wellFormed = false;
    }
    if (open.length) open[open.length - 1].hasChildren = true;
    const qualified = JSON.stringify([...open.map((o) => o.name), name]);
    bump(all, name);
    bump(paths, qualified);
    if (ok) bump(passed, name);
    lastFailure = fail ? { qualified, name, parent, inherited: false } : null;
    if (fail) failures.push(lastFailure);
  };
  if (family !== 'spec' && family !== 'tap') return { all, passed, paths, failed: [], wellFormed };
  const listed = new Map();
  let inFailingSection = false;
  let afterTestAt = false;
  for (const raw of stripAnsi(text).split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (family === 'spec') {
      if (inFailingSection) {
        if (afterTestAt) { const n = line.match(SPEC_FAIL_NAME_RE); if (n) bump(listed, n[1]); }
        afterTestAt = SPEC_TEST_AT_RE.test(line);
        continue;
      }
      if (/^✖ failing tests:/.test(line)) { inFailingSection = true; continue; }
      const o = line.match(SPEC_OPEN_RE);
      if (o) { open.push({ indent: o[1].length, name: o[2] }); continue; }
      const m = line.match(SPEC_TREE_RE);
      if (m) point(m[1].length, m[3], m[2] === '✔' && !m[4], m[2] === '✖' && !m[4]);
    } else {
      if (lastFailure && TAP_INHERITED_RE.test(line)) { lastFailure.inherited = true; continue; }
      const o = line.match(TAP_OPEN_RE);
      if (o) { open.push({ indent: o[1].length, name: o[2] }); continue; }
      const m = line.match(TAP_POINT_RE);
      if (m) point(m[1].length, m[3], m[2].toLowerCase() === 'ok' && !m[4], m[2].toLowerCase() === 'not ok' && !m[4]);
    }
  }
  if (open.length > 0) wellFormed = false;
  if (family === 'spec') {
    // A spec parent failed in its own right only when the failing section
    // lists it; each listing vouches for one parent.
    for (const f of failures) {
      if (!f.parent) continue;
      if (listed.get(f.name)) listed.set(f.name, listed.get(f.name) - 1); else f.inherited = true;
    }
  }
  const failed = failures.filter((f) => !f.inherited).map((f) => f.qualified);
  return { all, passed, paths, failed, wellFormed };
}

// Relativized forward-slash test paths whose failing entries are ALL
// file-level (the name is the path itself). A file with any per-test entry
// is absent. Families other than spec and tap return an empty Set.
function fileLevelFailures(text, family, { cwd = process.cwd() } = {}) {
  const fileLevel = new Set();
  failingTestsByFile(text, family, { cwd }).forEach((names, rel) => {
    if (names.every((n) => n === rel)) fileLevel.add(rel);
  });
  return fileLevel;
}

// Every `test at` entry in a spec log's failing section, matched or not — the
// adjudicator's check that the list accounts for `ℹ fail N`.
function specEntryCount(text) { return specEntries(stripAnsi(text).split('\n')).length; }

// Every TAP `not ok` block, at any indentation (a failing subtest nests under
// its suite), in log order: {line: the `not ok` line, body: the lines after
// it up to the next test point or `# ` line at any indentation}.
function tapBlocks(lines) {
  const blocks = [];
  let current = null;
  for (const line of lines) {
    if (/^\s*not ok\b/.test(line)) { current = { line, body: [] }; blocks.push(current); continue; }
    if (/^\s*(ok \d|# )/.test(line)) { current = null; continue; }
    if (current) current.body.push(line);
  }
  return blocks;
}

// The relativized test files one TAP block's frames name, deduped.
function tapBlockFiles(block, cwd) {
  const files = [];
  for (const line of block.body) {
    for (const m of line.matchAll(TAP_FRAME_RE)) {
      const rel = relativize(m[1], cwd);
      if (isRetryableFile(rel) && !files.includes(rel)) files.push(rel);
    }
  }
  return files;
}

// How many failing entries extractFailingFiles silently drops: a spec entry
// whose path is no test file (or a node: internal), or a TAP `not ok` block
// whose frames name no test file. The baseline adjudicator refuses to
// classify when this is non-zero — an undercounted file list must never read
// as a clean pass. Every other family returns 0.
function countUnmatchedFailures(text, family, { cwd = process.cwd() } = {}) {
  const lines = stripAnsi(text).split('\n');
  if (family === 'tap') return tapBlocks(lines).filter((b) => tapBlockFiles(b, cwd).length === 0).length;
  if (family !== 'spec') return 0;
  return specEntries(lines)
    .filter(({ file }) => !isRetryableFile(relativize(file, cwd))).length;
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
    if (isRetryableFile(rel) && !found.includes(rel)) found.push(rel);
  };
  if (family === 'tap') {
    tapBlocks(lines).forEach((b) => tapBlockFiles(b, cwd).forEach(push));
    return found;
  }
  if (family === 'summary') {
    for (const line of lines) {
      const m = line.match(SUMMARY_FAIL_RE);
      if (m) push(m[1]);
    }
    return found;
  }
  if (family === 'spec') specEntries(lines).forEach(({ file }) => push(file));
  return found;
}

module.exports = {
  sniffFamily, extractFailingRegion, parseCounts, summaryLine,
  stripAnsi, extractFailingFiles, countUnmatchedFailures, fileLevelFailures, failingTestsByFile, specEntryCount,
  cancelledCount, testTree, TEST_FILE_RE,
  MAX_REGION_LINES, GENERIC_TAIL_LINES, MAX_LINE_CHARS,
};
