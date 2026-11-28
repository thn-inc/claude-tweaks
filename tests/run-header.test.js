'use strict';
// Unit tests for plugin/bin/lib/run-header.js (#3974): the one resolver for where a
// run's materialized spec header lives — live, or archived after wrap-up's move.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  PIPELINES_REL, runRelDirs, headerRelPaths, headerPathspecs,
  archivedRunDir, headerFileCandidates, listHeaderDirs,
} = require('../plugin/bin/lib/run-header');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

const P = '.claude-tweaks/pipelines';

test('PIPELINES_REL is the POSIX literal', () => {
  assert.equal(PIPELINES_REL, P);
});

test('runRelDirs returns [live, archived], optionally suffixed with specDir', () => {
  assert.deepEqual(runRelDirs('R'), [`${P}/R`, `${P}/archive/R`]);
  assert.deepEqual(runRelDirs('R', { specDir: 'spec-9' }), [`${P}/R/spec-9`, `${P}/archive/R/spec-9`]);
});

test('headerRelPaths: live flat, live nested, archived flat, archived nested', () => {
  assert.deepEqual(headerRelPaths('R', 7), [
    `${P}/R/work/7-spec.md`,
    `${P}/R/spec-7/work/7-spec.md`,
    `${P}/archive/R/work/7-spec.md`,
    `${P}/archive/R/spec-7/work/7-spec.md`,
  ]);
});

test('headerRelPaths: layout filters flat or nested', () => {
  const all = headerRelPaths('R', 7);
  assert.deepEqual(headerRelPaths('R', 7, { layout: 'nested' }), [all[1], all[3]]);
  assert.deepEqual(headerRelPaths('R', 7, { layout: 'flat' }), [all[0], all[2]]);
});

test('headerRelPaths: specDir pins the per-spec child run dir', () => {
  assert.deepEqual(headerRelPaths('R', 7, { specDir: 'spec-9' }), [
    `${P}/R/spec-9/work/7-spec.md`,
    `${P}/archive/R/spec-9/work/7-spec.md`,
  ]);
});

test('headerPathspecs: trailing wildcard on the spec-* pathspecs', () => {
  assert.deepEqual(headerPathspecs('R'), [
    `${P}/R/work`,
    `${P}/R/spec-*/work/*`,
    `${P}/archive/R/work`,
    `${P}/archive/R/spec-*/work/*`,
  ]);
  assert.deepEqual(headerPathspecs('R', { specDir: 'spec-9' }), [
    `${P}/R/spec-9/work/*`,
    `${P}/archive/R/spec-9/work/*`,
  ]);
});

test('archivedRunDir: run dir and per-spec child dir under pipelines', () => {
  assert.equal(
    archivedRunDir('/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1', path.posix),
    '/m/.claude-tweaks/pipelines/archive/2026-11-16T020801-record-1',
  );
  assert.equal(
    archivedRunDir('/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1/spec-4', path.posix),
    '/m/.claude-tweaks/pipelines/archive/2026-11-16T020801-record-1/spec-4',
  );
});

test('archivedRunDir: no archived dir is invented for other shapes', () => {
  assert.equal(archivedRunDir('/tmp/x/run'), null);
  assert.equal(archivedRunDir('/m/.claude-tweaks/pipelines/archive/R'), null);
  assert.equal(archivedRunDir('/m/.claude-tweaks/pipelines/archive'), null);
  assert.equal(archivedRunDir('/m/.claude-tweaks/pipelines/not-a-run-id/spec-4'), null);
  assert.equal(archivedRunDir('/tmp/x/2026-11-16T020801-record-1/spec-4'), null);
});

test('archivedRunDir: win32 path module keeps backslashes', () => {
  assert.equal(
    archivedRunDir('C:\\m\\.claude-tweaks\\pipelines\\R', path.win32),
    'C:\\m\\.claude-tweaks\\pipelines\\archive\\R',
  );
});

test('AC7.1: precedence — live before archived, root by root', () => {
  const runDir = '/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1';
  const mirror = '/w/.claude-tweaks/pipelines/2026-11-16T020801-record-1';
  const four = (d) => {
    const a = d.replace('/pipelines/', '/pipelines/archive/');
    return [
      `${d}/work/7-spec.md`, `${d}/spec-7/work/7-spec.md`,
      `${a}/work/7-spec.md`, `${a}/spec-7/work/7-spec.md`,
    ].map((p) => path.join(p));
  };
  assert.deepEqual(headerFileCandidates([runDir, mirror], 7), [...four(runDir), ...four(mirror)]);
});

test('headerFileCandidates: skips falsy entries and invents no archived path off pipelines', () => {
  assert.deepEqual(headerFileCandidates([null, '', '/tmp/x/run'], 3), [
    path.join('/tmp/x/run', 'work', '3-spec.md'),
    path.join('/tmp/x/run', 'spec-3', 'work', '3-spec.md'),
  ]);
});

test('listHeaderDirs: flat work then sorted spec-* dirs, live then archived', () => {
  const runDir = '/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1';
  const readdir = () => ['spec-2', 'work', 'spec-10', 'spec-x'];
  const out = listHeaderDirs([runDir, null], { readdir });
  const arch = '/m/.claude-tweaks/pipelines/archive/2026-11-16T020801-record-1';
  const expected = [];
  for (const [base, location] of [[runDir, 'live'], [arch, 'archived']]) {
    expected.push({ dir: path.join(base, 'work'), location, specDir: null, specN: null });
    expected.push({ dir: path.join(base, 'spec-10', 'work'), location, specDir: 'spec-10', specN: 10 });
    expected.push({ dir: path.join(base, 'spec-2', 'work'), location, specDir: 'spec-2', specN: 2 });
    expected.push({ dir: path.join(base, 'spec-x', 'work'), location, specDir: 'spec-x', specN: null });
  }
  assert.deepEqual(out, expected);
});

test('listHeaderDirs: nested false lists the flat work dirs only and never reads the run dir', () => {
  const runDir = '/m/.claude-tweaks/pipelines/2026-11-16T020801-record-1';
  const readdir = () => { throw new Error('readdir must not run'); };
  const out = listHeaderDirs([runDir], { readdir, nested: false });
  assert.deepEqual(out.map((e) => [e.location, e.specDir]), [['live', null], ['archived', null]]);
});

test('listHeaderDirs: default readdir over an archived-only layout lists the archived work dir', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-header-'));
  try {
    const id = '2026-11-16T020801-record-1';
    const live = path.join(root, '.claude-tweaks', 'pipelines', id);
    const archived = path.join(root, '.claude-tweaks', 'pipelines', 'archive', id);
    fs.mkdirSync(path.join(archived, 'work'), { recursive: true });
    const out = listHeaderDirs([live]);
    assert.ok(out.some((e) => e.location === 'archived' && e.dir === path.join(archived, 'work') && e.specDir === null));
    assert.ok(out.some((e) => e.location === 'live' && e.dir === path.join(live, 'work')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('listHeaderDirs: absent directories (default readdir) yield only the flat work dirs', () => {
  const runDir = path.join(os.tmpdir(), 'run-header-absent', '.claude-tweaks', 'pipelines', '2026-11-16T020801-record-1');
  const out = listHeaderDirs([runDir]);
  assert.deepEqual(out.map((e) => [e.location, e.specDir]), [['live', null], ['archived', null]]);
});

test('listHeaderDirs: a default readdir that errors (ENOTDIR) returns [] instead of throwing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'run-header-file-'));
  try {
    const pipelines = path.join(root, '.claude-tweaks', 'pipelines');
    fs.mkdirSync(pipelines, { recursive: true });
    const runDir = path.join(pipelines, '2026-11-16T020801-record-1');
    fs.writeFileSync(runDir, 'not a directory');
    assert.throws(() => fs.readdirSync(runDir), { code: 'ENOTDIR' });
    const out = listHeaderDirs([runDir]);
    assert.deepEqual(out, [
      { dir: path.join(runDir, 'work'), location: 'live', specDir: null, specN: null },
      { dir: path.join(pipelines, 'archive', '2026-11-16T020801-record-1', 'work'), location: 'archived', specDir: null, specN: null },
    ]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

const WIN_RUN = 'C:\\m\\.claude-tweaks\\pipelines\\2026-11-16T020801-record-1';
const WIN_ARCH = 'C:\\m\\.claude-tweaks\\pipelines\\archive\\2026-11-16T020801-record-1';

test('headerFileCandidates: win32 path module yields exact backslash strings', () => {
  assert.deepEqual(headerFileCandidates([WIN_RUN], 7, path.win32), [
    `${WIN_RUN}\\work\\7-spec.md`,
    `${WIN_RUN}\\spec-7\\work\\7-spec.md`,
    `${WIN_ARCH}\\work\\7-spec.md`,
    `${WIN_ARCH}\\spec-7\\work\\7-spec.md`,
  ]);
});

test('listHeaderDirs: win32 path module yields exact backslash strings', () => {
  const readdir = () => ['spec-2'];
  assert.deepEqual(listHeaderDirs([WIN_RUN], { readdir, pathImpl: path.win32 }), [
    { dir: `${WIN_RUN}\\work`, location: 'live', specDir: null, specN: null },
    { dir: `${WIN_RUN}\\spec-2\\work`, location: 'live', specDir: 'spec-2', specN: 2 },
    { dir: `${WIN_ARCH}\\work`, location: 'archived', specDir: null, specN: null },
    { dir: `${WIN_ARCH}\\spec-2\\work`, location: 'archived', specDir: 'spec-2', specN: 2 },
  ]);
});

// ---------------------------------------------------------------------------
// AC8 conformance: one place builds a spec-header path.
//
// Reader scan. The eight readers (READER_FILES) must not spell the archive location
// themselves: no string or template literal holds an `archive` path segment — the
// whole literal ('archive', "archive", `archive`) or a segment inside longer literal
// text ('archive/', '/archive/', `${p}/archive/${id}`, `pipelines/archive`). The
// match runs over the same literal mask the builder scan builds, so identifiers
// (`archiveDir`), `${…}` code and comments never count. The six that resolve
// headers directly must also require run-header. precondition.js reads through
// hasMaterializeCommit and plugin/bin/context-gauge.js (the CLI) through the gauge
// lib, so those two are scanned for the literals only.
//
// Builder scan. Over every plugin/bin/**/*.js file, a site is flagged when the
// literal text of a path-module `.join(`/`.resolve(` argument list (receiver named
// like path, pathImpl, win32 or posix), or of a template literal, holds a `work` path
// segment ('work', "work", or work/ and /work inside literal text) and `-spec.md`.
// Literal text is where the literal-keeping and literal-blanking stripper outputs
// differ, so identifiers, `${…}` code and comments never count. Allowed sites sit in
// BUILDER_ALLOWED with an exact per-file count and nothing else is allowed; there is
// no message-text exemption (Tasks 2 and 7 reworded the two messages that held one).
//
// Recall limits — the scan cannot see:
// - a path built from an identifier that names the directory: materialize.js (the
//   writer) builds `path.join(workDir, `${opts.n}-spec.md`)`, and `workDir` is code;
// - a split across statements: `path.join(dir, name, 'work')` and then a separate
//   filename regex or join (the shape that hid the preflight and context-gauge
//   readers until plan review);
// - string concatenation (`'work/' + n + '-spec.md'`), a plain string literal (the
//   USAGE text in verify-run-bookends.js, ruled not a path), a segment held in a
//   constant, and a destructured `join(`/`resolve(` or a receiver not named like a
//   path module — `require('path').join(…)` (the receiver is a call, not a name) and
//   an aliased receiver (`const j = path.join; j(…)`, `const { join: pj } = path`)
//   among them.
// A stripperVerdict mis-parse is an offender in both scans, keep and blank mode,
// since both build the literal mask from the two outputs.

const REPO = path.join(__dirname, '..');
const BIN_ROOT = path.join(REPO, 'plugin', 'bin');

const REQUIRING_READERS = [
  'plugin/bin/verify-run-bookends.js',
  'plugin/bin/lib/flow/preflight.js',
  'plugin/bin/lib/hooks/pre-tool-use.js',
  'plugin/bin/lib/wrap-up/pack.js',
  'plugin/bin/lib/dispatch/first-call-artifact-check.js',
  'plugin/bin/lib/timing/context-gauge.js',
];
const LITERAL_ONLY_READERS = [
  'plugin/bin/lib/pr-bookkeeping/precondition.js',
  'plugin/bin/context-gauge.js',
];

const BUILDER_ALLOWED = new Map([
  ['plugin/bin/lib/run-header.js', { count: 5, reason: 'the resolver: the one place a header path is built' }],
  ['plugin/bin/lib/reconcile/archive-merged.js', { count: 0, reason: 'archive writer: moves whole work/ trees, builds no header file path today' }],
  ['plugin/bin/sweep-stray-run-dirs.js', { count: 0, reason: 'archive writer: moves whole work/ trees, builds no header file path today' }],
]);

// Counts at landing (#3974). A lower count means the walk or the matcher stopped
// matching, not that files or sites went away; never lower them to go green.
const FILES_WALKED_FLOOR = 603;
const BUILDER_SITES_FLOOR = 5;

function listBinJs(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listBinJs(full));
    else if (entry.isFile() && entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

let binCache = null;
function binSources() {
  if (binCache === null) {
    binCache = listBinJs(BIN_ROOT).map((abs) => ({
      rel: path.relative(REPO, abs).split(path.sep).join('/'),
      raw: readText(abs),
    }));
  }
  return binCache;
}

function lineAt(text, offset) {
  let n = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

const verdictOffenders = (pairs) => pairs
  .filter(([, v]) => v !== 'ok')
  .map(([mode, v]) => `${mode}: ${STRIPPER_VERDICT_MESSAGES[v]}`);

// An `archive` path segment over the literal mask: bounded by NUL (a delimiter or
// code), `/` or `\` on both sides — or `pipelines/archive` whatever follows it
// (prose after it, a trailing `.`), AC8's second clause.
const ARCHIVE_SEGMENT_RE = /(?:^|[\0/\\])archive(?=[\0/\\]|$)|pipelines[/\\]archive/gm;
const RUN_HEADER_REQUIRE_RE = /\brequire\(\s*(['"])[^'"\n]*\/run-header(?:\.js)?\1\s*\)/;

// Literal text only: a keep-mode character where blank mode differs from it, NUL
// everywhere else (delimiters, `${…}` code, identifiers), newlines kept.
function literalMask(keep, blank) {
  let out = '';
  for (let i = 0; i < keep.length; i++) {
    if (keep[i] === '\n') out += '\n';
    else out += keep[i] !== blank[i] ? keep[i] : '\0';
  }
  return out;
}

// { verdicts, lines, requiresRunHeader } for one reader's raw source.
function scanReader(raw) {
  const keep = stripComments(raw);
  const blank = stripComments(raw, { literals: 'blank' });
  // Blank mode keeps a literal's whitespace, so the mask holds NUL there; a space is
  // a word boundary in prose, not a path-segment boundary, so it goes back to a space.
  const mask = literalMask(keep, blank).replace(/\0/g, (nul, i) => (/\s/.test(keep[i]) ? ' ' : nul));
  const lines = [...mask.matchAll(ARCHIVE_SEGMENT_RE)].map((m) => lineAt(mask, m.index));
  return {
    verdicts: verdictOffenders([['keep', stripperVerdict(raw, keep)], ['blank', stripperVerdict(raw, blank)]]),
    lines: [...new Set(lines)],
    requiresRunHeader: RUN_HEADER_REQUIRE_RE.test(keep),
  };
}

const WORK_SEGMENT_RE = /(?:^|[\0/\\])work(?=[\0/\\]|$)/m;
const SPEC_FILE_RE = /-spec\.md/;
const PATH_CALL_RE = /(?<![\w$])([\w$]+)\s*\.\s*(?:join|resolve)\s*\(/g;
const PATH_RECEIVER_RE = /path|^win32$|^posix$/i;
const holdsHeaderPath = (masked) => WORK_SEGMENT_RE.test(masked) && SPEC_FILE_RE.test(masked);

// Template-literal spans [open, close] over blank-mode text, where string, regex
// and template-text bodies are already blank, so every backtick, `${` and brace
// left is a delimiter or code.
function templateSpans(blank) {
  const spans = [];
  const stack = [];
  for (let i = 0; i < blank.length; i++) {
    const ch = blank[i];
    const top = stack[stack.length - 1];
    if (top && top.type === 'tpl') {
      if (ch === '`') { spans.push([top.start, i]); stack.pop(); }
      else if (ch === '$' && blank[i + 1] === '{') { stack.push({ type: 'code', depth: 0 }); i++; }
      continue;
    }
    if (ch === '`') stack.push({ type: 'tpl', start: i });
    else if (top && ch === '{') top.depth++;
    else if (top && ch === '}') { if (top.depth === 0) stack.pop(); else top.depth--; }
  }
  return spans;
}

// The offset of the `)` closing the `(` at `open`, over blank-mode text.
function closingParen(blank, open) {
  let depth = 0;
  for (let i = open; i < blank.length; i++) {
    if (blank[i] === '(') depth++;
    else if (blank[i] === ')' && --depth === 0) return i;
  }
  return blank.length - 1;
}

// { verdicts, lines } for one file's raw source: the lines of flagged builder sites.
function scanBuilder(raw) {
  const keep = stripComments(raw);
  const blank = stripComments(raw, { literals: 'blank' });
  const mask = literalMask(keep, blank);
  const starts = [];
  for (const m of blank.matchAll(PATH_CALL_RE)) {
    if (!PATH_RECEIVER_RE.test(m[1])) continue;
    const open = m.index + m[0].length - 1;
    if (holdsHeaderPath(mask.slice(open, closingParen(blank, open) + 1))) starts.push(m.index);
  }
  for (const [open, close] of templateSpans(blank)) {
    if (holdsHeaderPath(mask.slice(open, close + 1))) starts.push(open);
  }
  const lines = [...new Set(starts.map((o) => lineAt(raw, o)))].sort((a, b) => a - b);
  return {
    verdicts: verdictOffenders([['keep', stripperVerdict(raw, keep)], ['blank', stripperVerdict(raw, blank)]]),
    lines,
  };
}

test('AC8.1 reader scan self-test: archive literals flag by exact line, comments and lookalikes do not', () => {
  const src = [
    "const { listHeaderDirs } = require('../run-header');",
    "const a = path.join(root, 'archive', id);",
    "// path.join(root, 'archive', id) — comment only",
    'const b = `.claude-tweaks/pipelines/archive/${id}`;',
    'const c = "archive";',
    'const d = `archive`;',
    "const e = entry.location === 'archived';",
    'const f = archiveDir;',
    "const g = path.join(root, 'archive/', id);",
    "const h = root + '/archive/' + id;",
    'const i = `${p}/archive/${id}`;',
    "const j = 'run the archive step';",
    "const k = 'archived/x';",
    "const l = 'no header under pipelines/archive or live';",
    'const m = `see .claude-tweaks/pipelines/archive.`;',
  ].join('\n');
  const out = scanReader(src);
  // Not: 3 comment, 7 'archived', 8 identifier, 12 word in prose, 13 longer segment.
  // 14 and 15: `pipelines/archive` followed by prose or a `.` still flags.
  assert.deepEqual(out.lines, [2, 4, 5, 6, 9, 10, 11, 14, 15]);
  assert.deepEqual(out.verdicts, []);
  assert.equal(out.requiresRunHeader, true);
  assert.equal(scanReader("const x = require('./lib/run-header.js');").requiresRunHeader, true);
  assert.equal(scanReader("// const x = require('./run-header');\nconst y = 1;").requiresRunHeader, false);
  assert.equal(scanReader("const x = require('./run-header-extra');").requiresRunHeader, false);
});

test('AC8.1 reader scan self-test: a mis-parse is an offender in keep and blank mode', () => {
  const out = scanReader('if (b) /"/.test(b); const c = "//"; const d = \'archive\';');
  assert.deepEqual(out.verdicts, [
    `keep: ${STRIPPER_VERDICT_MESSAGES.misparsed}`,
    `blank: ${STRIPPER_VERDICT_MESSAGES.misparsed}`,
  ]);
});

test('AC8.2 builder scan self-test: flagged sites by exact line', () => {
  const src = [
    "const a = path.join('work', `${n}-spec.md`);",
    'const b = `${r}/work/${n}-spec.md`;',
    '// const c = `${r}/work/${n}-spec.md`;',
    "const d = 'then commit work/7-spec.md';",
    'const e = `… then commit work/${n}-spec.md`;',
    'const f = path.join(workDir, `${n}-spec.md`);',
    "const g = path.join(dir, name, 'work');",
    "const h = pathImpl.join(b, `spec-${n}`, 'work', `${n}-spec.md`);",
    "const i = parts.join('/work/', `${n}-spec.md`);",
    'const j = path.resolve(',
    "  root, 'work',",
    '  `${n}-spec.md`);',
    "const k = path.join('pre-work', `${n}-spec.md`);",
    "const l = path.join(a, 'b'); const m = `${n}-spec.md`; const o = 'work';",
    'const q = `${x ? `${r}/work` : y}/${n}-spec.md`;',
    "const s = path.win32.join(r, 'work', '1-spec.md');",
  ].join('\n');
  const out = scanBuilder(src);
  // 1 join, 2 template, 5 the pre-change remedy message (the reword was needed),
  // 8 pathImpl, 10 multi-line call (its first line), 15 nested template, 16 win32.
  // Not: 3 comment, 4 plain string, 6 identifier dir, 7 split shape, 9 non-path
  // receiver, 11-12 continuation lines, 13 pre-work segment, 14 separate sites.
  assert.deepEqual(out.lines, [1, 2, 5, 8, 10, 15, 16]);
  assert.deepEqual(out.verdicts, []);
});

test('AC8.2 builder scan self-test: a blank-mode mis-parse is an offender', () => {
  const out = scanBuilder("if (b) /'/.test(b); const c = 'x';");
  assert.deepEqual(out.verdicts, [`blank: ${STRIPPER_VERDICT_MESSAGES.misparsed}`]);
});

test('AC8.2 builder scan go-red: the pre-migration root template re-added to a reader copy is flagged', () => {
  const rel = 'plugin/bin/lib/timing/context-gauge.js';
  const raw = readText(path.join(REPO, rel));
  assert.deepEqual(scanBuilder(raw).lines, [], `${rel} should build no header path`);
  const base = raw.split('\n').length;
  const planted = `${raw}\nconst root = '.claude-tweaks/pipelines';\nconst p = \`\${root}/\${base}/work/\${issue}-spec.md\`;\n`;
  assert.deepEqual(scanBuilder(planted).lines, [base + 2]);
});

test('AC8.1 reader scan over the eight readers: no archive literal, run-header required by six', () => {
  const offenders = [];
  for (const rel of [...REQUIRING_READERS, ...LITERAL_ONLY_READERS]) {
    const out = scanReader(readText(path.join(REPO, rel)));
    for (const v of out.verdicts) offenders.push(`${rel}: ${v}`);
    for (const line of out.lines) offenders.push(`${rel}:${line}: archive literal — resolve through plugin/bin/lib/run-header.js`);
    if (REQUIRING_READERS.includes(rel) && !out.requiresRunHeader) offenders.push(`${rel}: does not require run-header`);
  }
  assert.deepEqual(offenders, []);
});

test('AC8.2 builder scan over plugin/bin: header paths are built only where allowed', () => {
  const files = binSources();
  assert.ok(
    files.length >= FILES_WALKED_FLOOR,
    `walked ${files.length} plugin/bin files, floor ${FILES_WALKED_FLOOR}: a low count means the walk stopped descending, not that files went away`,
  );
  const offenders = [];
  let sites = 0;
  for (const { rel, raw } of files) {
    const out = scanBuilder(raw);
    for (const v of out.verdicts) offenders.push(`${rel}: ${v}`);
    sites += out.lines.length;
    const allowed = BUILDER_ALLOWED.get(rel);
    if (allowed) {
      if (out.lines.length !== allowed.count) {
        offenders.push(`${rel}: ${out.lines.length} header-path builds at lines [${out.lines}], allowed exactly ${allowed.count} (${allowed.reason})`);
      }
    } else {
      for (const line of out.lines) offenders.push(`${rel}:${line}: builds a spec-header path — use plugin/bin/lib/run-header.js`);
    }
  }
  assert.deepEqual(offenders, []);
  assert.ok(
    sites >= BUILDER_SITES_FLOOR,
    `matched ${sites} header-path builds, floor ${BUILDER_SITES_FLOOR}: a low count means the matcher stopped matching, not that the builds went away`,
  );
});
