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
// node --test: `at fn (path:line:col)` / bare `at path:line:col`, and the
// `location: 'path:line:col'` diagnostic newer runners print. Each
// alternative is delimiter-anchored (a quote, a paren, or line-start/end) —
// never bare whitespace — so the captured path can safely contain spaces or
// a Windows drive-letter colon+backslash (`C:\repo\tests\x.test.js:42:10`);
// a whitespace anchor truncated a space-containing checkout path (#3155).
// Exactly one capture group is set per match; consumers read whichever one
// matched.
const TAP_FRAME_RE = /(?:location:\s*'(.+?):\d+:\d+'|\((.+?):\d+:\d+\)|\bat\s+(.+):\d+:\d+\s*$)/g;
// vitest (` FAIL  path > name`, `❯ path (n tests | m failed)`), jest
// (`FAIL path`), pytest (`FAILED path::name`). The path capture is
// unrestricted (`.+?`) so it can contain spaces (#3155); it stops at
// whichever terminator the runner's own output shape uses — ` > ` / ` (`
// for vitest/jest, `::` for pytest's `path::name` (review finding, refs
// #1925 — `:` must not be swallowed into the capture), or end of line for a
// bare `FAIL path` — never at a bare space, which would truncate a
// space-containing path.
const SUMMARY_FAIL_RE = /^\s*(?:FAIL|❯|FAILED)\s+(.+?)(?=\s>\s|\s\(|::|$)/;

// A run of backslashes is ONE separator: node's TAP `location: '...'` line is
// YAML-quoted, so on Windows it carries `\\` per separator — read as two, the
// path never matched the cwd prefix and the same file listed twice. The fold
// also turns a UNC path outside cwd (`\\srv\share\x.test.js`) into
// `/srv/share/x.test.js` — never under cwd, so it never matches a file at
// base and fails closed (attributable).
function relativize(file, cwd) {
  const normalizedFile = file.replace(/\\+/g, '/');
  const prefix = `${cwd.replace(/\\+/g, '/').replace(/\/+$/, '')}/`;
  return normalizedFile.startsWith(prefix) ? normalizedFile.slice(prefix.length) : normalizedFile;
}

// A path extractFailingFiles would keep: a test file, never a node: internal
// — and, when the caller passes an `exists` predicate, one present in the
// checkout under test (#3153: a path absent there was never a real failing
// file of this run).
function isRetryableFile(rel, exists) {
  return TEST_FILE_RE.test(rel) && !rel.startsWith('node:') && (!exists || exists(rel));
}

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

const INCONCLUSIVE_RE = /test timed out after|testTimeoutFailure|cancelledBy|was cancelled|did not finish before/i;
const TAP_LOCATION_RE = /location:\s*'.*:(\d+:\d+)'/;

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
// `conclusiveOnly`: an entry whose diagnostics say it timed out or was
// cancelled is dropped — it did not finish, which proves nothing about
// whether it fails. A TAP block's diagnostics are its own top-level YAML keys
// only — an `error:` value can quote a child's timeout (#3153).
function failingTestsByFile(text, family, { cwd = process.cwd(), located = false, conclusiveOnly = false, exists } = {}) {
  const byFile = new Map();
  const add = (rel, name, loc, diagnostics) => {
    if (conclusiveOnly && diagnostics.some((l) => INCONCLUSIVE_RE.test(l))) return;
    let named = name !== null && relativize(name, cwd) === rel ? rel : name;
    if (located && named !== null) named = loc ? `${named}@${loc}` : null;
    if (!byFile.has(rel)) byFile.set(rel, []);
    byFile.get(rel).push(named);
  };
  const lines = stripAnsi(text).split('\n');
  if (family === 'spec') {
    for (const { file, loc, next, body } of specEntries(lines)) {
      const rel = relativize(file, cwd);
      if (!isRetryableFile(rel, exists)) continue;
      const m = next.match(SPEC_FAIL_NAME_RE);
      add(rel, m ? m[1] : null, loc, body);
    }
  }
  if (family === 'tap') {
    for (const block of tapBlocks(lines)) {
      const [, name, directive] = block.line.replace(/\r$/, '').match(TAP_NAME_RE);
      if (directive) continue;
      const locLine = block.frames.map((l) => l.match(TAP_LOCATION_RE)).find(Boolean);
      tapBlockFiles(block, cwd, exists).forEach((rel) => add(rel, name, locLine ? locLine[1] : null, block.keys));
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
function testTree(text, family) {
  const all = new Map();
  const passed = new Map();
  const paths = new Map();
  const failures = [];
  let wellFormed = true;
  const bump = (map, name) => map.set(name, (map.get(name) || 0) + 1);
  const open = [];
  let lastPoint = null;
  let yaml = null;
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
    lastPoint = { indent, failure: fail ? { qualified, name, parent, inherited: false } : null };
    if (fail) failures.push(lastPoint.failure);
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
      // A point's YAML diagnostics block (`---` … `...`, two spaces deeper
      // than the point) is data, never test points — an assertion's
      // expected/actual text can hold `not ok …` or `failureType:` lines.
      // Only the block's own top-level `failureType` key is read: a parent
      // whose failure is only its subtests' says 'subtestsFailed'.
      if (yaml) {
        if (line === `${yaml.pad}...`) yaml = null;
        else if (yaml.failure && yaml.failure.parent && line === `${yaml.pad}failureType: 'subtestsFailed'`) yaml.failure.inherited = true;
        continue;
      }
      if (lastPoint && line === `${' '.repeat(lastPoint.indent + 2)}---`) {
        yaml = { pad: ' '.repeat(lastPoint.indent + 2), failure: lastPoint.failure };
        continue;
      }
      const o = line.match(TAP_OPEN_RE);
      if (o) { open.push({ indent: o[1].length, name: o[2] }); continue; }
      const m = line.match(TAP_POINT_RE);
      if (m) point(m[1].length, m[3], m[2].toLowerCase() === 'ok' && !m[4], m[2].toLowerCase() === 'not ok' && !m[4]);
    }
  }
  if (open.length > 0) wellFormed = false;
  if (family === 'spec') {
    // A spec parent failed in its own right only when the failing section
    // lists it. Failing leaves take their own listings first; what is left
    // under a name vouches for that name's parents — none left: all
    // inherited; one per parent: all their own; anything else is ambiguous,
    // and the tree is no evidence.
    const take = (name) => { if (listed.get(name)) listed.set(name, listed.get(name) - 1); };
    failures.filter((f) => !f.parent).forEach((f) => take(f.name));
    const parentsByName = new Map();
    failures.filter((f) => f.parent).forEach((f) => parentsByName.set(f.name, [...(parentsByName.get(f.name) || []), f]));
    parentsByName.forEach((parents, name) => {
      const left = listed.get(name) || 0;
      if (left === 0) parents.forEach((f) => { f.inherited = true; });
      else if (left !== parents.length) wellFormed = false;
    });
  }
  const failed = failures.filter((f) => !f.inherited).map((f) => f.qualified);
  return { all, passed, paths, failed, wellFormed };
}

// Relativized forward-slash test paths whose failing entries are ALL
// file-level (the name is the path itself). A file with any per-test entry
// is absent. Families other than spec and tap return an empty Set.
function fileLevelFailures(text, family, { cwd = process.cwd(), exists } = {}) {
  const fileLevel = new Set();
  failingTestsByFile(text, family, { cwd, exists }).forEach((names, rel) => {
    if (names.every((n) => n === rel)) fileLevel.add(rel);
  });
  return fileLevel;
}

// Every `test at` entry in a spec log's failing section, matched or not — the
// adjudicator's check that the list accounts for `ℹ fail N`.
function specEntryCount(text) { return specEntries(stripAnsi(text).split('\n')).length; }

// The YAML keys whose values are the failing point's own site: its
// `location:` and its `stack:`. Every other key (`error:`, `expected:`,
// `actual:`) is message text, which can quote a whole TAP document a test
// spawned (#3153) — its paths are that child's, never this point's.
const TAP_FRAME_KEYS = new Set(['location', 'stack']);

// The shared TAP line classifier (#3404): one entry per input line, in order,
// {kind: 'notOk' | 'ok' | 'subtest' | 'comment' | 'yamlOpen' | 'yaml' |
// 'yamlClose' | 'other', indent: the CR-stripped line's leading-whitespace
// length, owner: the index of the `not ok` line whose block holds this line
// (itself, its body, its YAML block included) or -1 — ownership continues past
// the block's yamlClose until the next test point or `# ` line, because
// tapBlocks' body and frames include those lines, key: on a 'yaml' line the
// top-level YAML key in force, else null, keyStart: true on a 'yaml' line that
// starts a `name:` key}. A block ends at the next test point or `# ` line at
// any indentation.
function tapLines(lines) {
  const entries = [];
  let owner = -1;
  let pointPad = null;
  let yamlPad = null;
  let keyPad = null;
  let yamlKey = null;
  lines.forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    const entry = { kind: 'other', indent: line.match(/^\s*/)[0].length, owner, key: null, keyStart: false };
    entries.push(entry);
    // A point's YAML block (`---` … `...`, two spaces deeper) is its body,
    // never a new point — an assertion's expected/actual text can hold
    // `not ok …` lines. The `...` terminator is always matched at `yamlPad`
    // (the `---` line's own indent) — node never varies it. Keys are a
    // different matter: node puts them at `yamlPad` too, but a non-node TAP
    // producer (tape-style) can indent them deeper, so the key indent is
    // whatever the FIRST non-blank line after `---` uses (falling back to
    // `yamlPad` when the block closes before any non-blank line) — a line at
    // exactly that indent starts a key; deeper lines continue it.
    if (yamlPad !== null) {
      if (line === `${yamlPad}...`) { entry.kind = 'yamlClose'; yamlPad = null; keyPad = null; return; }
      entry.kind = 'yaml';
      if (keyPad === null) {
        const firstNonBlank = line.match(/^(\s*)\S/);
        if (firstNonBlank) keyPad = firstNonBlank[1];
      }
      if (keyPad !== null && line.startsWith(keyPad) && line.length > keyPad.length && line[keyPad.length] !== ' ') {
        const key = line.slice(keyPad.length).match(/^([A-Za-z_]+):/);
        yamlKey = key ? key[1] : null;
        entry.keyStart = key !== null;
      }
      entry.key = yamlKey;
      return;
    }
    if (pointPad !== null && line === `${pointPad}  ---`) {
      entry.kind = 'yamlOpen';
      yamlPad = `${pointPad}  `;
      keyPad = null;
      yamlKey = null;
      return;
    }
    const notOk = line.match(/^(\s*)not ok\b/);
    if (notOk) { entry.kind = 'notOk'; owner = index; entry.owner = index; pointPad = notOk[1]; return; }
    const ok = line.match(/^(\s*)ok \d/);
    if (ok) { entry.kind = 'ok'; owner = -1; entry.owner = -1; pointPad = ok[1]; return; }
    if (/^\s*# /.test(line)) {
      entry.kind = /^\s*# Subtest:/.test(line) ? 'subtest' : 'comment';
      owner = -1;
      entry.owner = -1;
      pointPad = null;
    }
  });
  return entries;
}

// Every TAP `not ok` block, at any indentation (a failing subtest nests under
// its suite), in log order: {line: the `not ok` line, body: the lines after
// it up to the next test point or `# ` line at any indentation, frames: the
// body lines that can name this point's own file — every line outside its
// YAML block, and inside it only the `location:`/`stack:` keys; keys: its own
// top-level YAML key lines, never their continuation lines}.
function tapBlocks(lines) {
  const blocks = [];
  const byLine = new Map();
  tapLines(lines).forEach((entry, i) => {
    if (entry.kind === 'notOk') {
      const block = { line: lines[i], body: [], frames: [], keys: [] };
      blocks.push(block);
      byLine.set(i, block);
      return;
    }
    const block = byLine.get(entry.owner);
    if (!block) return;
    block.body.push(lines[i]);
    if (entry.kind === 'other' || (entry.kind === 'yaml' && TAP_FRAME_KEYS.has(entry.key))) block.frames.push(lines[i]);
    if (entry.keyStart) block.keys.push(lines[i]);
  });
  return blocks;
}

// Every TAP `not ok` block, counted the same way `specEntryCount` counts
// spec entries — the accounting `unattributedFailureCount` compares against
// `# fail` + `# cancelled`.
function tapBlockCount(text) { return tapBlocks(stripAnsi(text).split('\n')).length; }

// The relativized test files one TAP block's own frames name, deduped.
function tapBlockFiles(block, cwd, exists) {
  const files = [];
  for (const line of block.frames) {
    for (const m of line.matchAll(TAP_FRAME_RE)) {
      const rel = relativize(m[1] ?? m[2] ?? m[3], cwd);
      if (isRetryableFile(rel, exists) && !files.includes(rel)) files.push(rel);
    }
  }
  return files;
}

// How many failing entries extractFailingFiles silently drops: a spec entry
// whose path is no test file (or a node: internal), or a TAP `not ok` block
// whose frames name no test file. The baseline adjudicator refuses to
// classify when this is non-zero — an undercounted file list must never read
// as a clean pass. Every other family returns 0.
function countUnmatchedFailures(text, family, { cwd = process.cwd(), exists } = {}) {
  const lines = stripAnsi(text).split('\n');
  if (family === 'tap') return tapBlocks(lines).filter((b) => tapBlockFiles(b, cwd, exists).length === 0).length;
  if (family !== 'spec') return 0;
  return specEntries(lines)
    .filter(({ file }) => !isRetryableFile(relativize(file, cwd), exists)).length;
}

// Whether a spec/tap log's failing-file list accounts for the whole
// failure — the same accounting `baseline.js`'s `adjudicate` already
// applies before trusting a classification, reused here so the flaky-retry
// hook (#3066) fails closed on the identical gap: a failure
// `countUnmatchedFailures` could not attribute to any test file, a log
// whose summary counts don't parse (truncated or unrecognized — spec and
// tap alike, since TAP's `# fail N` line is exactly as parseable a summary
// as spec's `ℹ fail`), or a failing-entry count that does not add up to
// `ℹ fail`/`# fail` + `ℹ cancelled`/`# cancelled` — any of these means the
// failing-file list used to plan a retry is an undercount, so retrying and
// passing those named files would wrongly clear the whole check. Returns 0
// (accounted) or a positive count (unattributed); every family other than
// spec/tap returns 0 — retry eligibility for those is governed elsewhere
// and this guard never widens it.
function unattributedFailureCount(text, family, { cwd = process.cwd() } = {}) {
  if (family !== 'spec' && family !== 'tap') return 0;
  const unmatched = countUnmatchedFailures(text, family, { cwd });
  if (unmatched > 0) return unmatched;
  const counts = parseCounts(text, family);
  if (counts === null) return 1;
  const cancelled = cancelledCount(text, family) || 0;
  const entries = family === 'spec' ? specEntryCount(text) : tapBlockCount(text);
  const expected = counts.fail + cancelled;
  return entries === expected ? 0 : Math.abs(entries - expected);
}

// Deduped, log-order, repo-relative test files named by the failing part of
// the log. `[]` whenever nothing parses — no parse ⇒ no retry (the caller
// never guesses). TAP: frames inside `not ok` blocks only, so a passing
// test that printed a stack never reads as failing.
function extractFailingFiles(text, family, { cwd = process.cwd(), exists } = {}) {
  const lines = stripAnsi(text).split('\n');
  const found = [];
  const push = (file) => {
    const rel = relativize(file, cwd);
    if (isRetryableFile(rel, exists) && !found.includes(rel)) found.push(rel);
  };
  if (family === 'tap') {
    tapBlocks(lines).forEach((b) => tapBlockFiles(b, cwd, exists).forEach(push));
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
  stripAnsi, extractFailingFiles, countUnmatchedFailures, unattributedFailureCount, fileLevelFailures, failingTestsByFile, specEntryCount,
  cancelledCount, testTree, tapLines, TEST_FILE_RE,
  MAX_REGION_LINES, GENERIC_TAIL_LINES, MAX_LINE_CHARS,
};
