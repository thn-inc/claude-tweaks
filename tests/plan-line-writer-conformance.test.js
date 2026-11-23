'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// One composer of the `Plan:` body line (#6052). The line is
// `Plan: refs/claude-tweaks/plans/{n} {commit} spec-sha256:{hash}`; composePlanLine in
// plugin/bin/lib/issues/plan-line.js is its only producer, and every other module reaches
// it by calling that export (plan-store.js does). work-record.md's `## Plan line` section
// says never hand-edit the line, so this scan walks plugin/bin and flags a string,
// template or regex literal holding `Plan:` followed by the ref prefix
// (`refs/claude-tweaks/plans/`) or by a template substitution (`Plan: ${ref} ...`)
// anywhere except plan-line.js. Reading the line (`startsWith('Plan: ')`), naming it in
// a usage string (`<Plan: line>`), and owning the ref prefix (plan-store/ref.js) write
// nothing and do not match. A literal is told from code by comparing keep-mode text with
// `literals: 'blank'` text at the match offset.
// Recall limits, by design: a line assembled from two literals (`'Plan:' + ' ' + ref`)
// is not seen. `stripperVerdict` runs on the blank-mode text only, so a mis-parse is an
// offender rather than a clean file (blank mode subsumes keep mode; see
// risk-flags-writer-conformance.test.js for the probe).
const ROOT = path.join(__dirname, '..');
const BIN_ROOT = path.join(ROOT, 'plugin', 'bin');

const WRITER_MODULE = 'plugin/bin/lib/issues/plan-line.js';
const PLAN_LINE = /(?<![A-Za-z0-9_$])Plan:[ \t]*(?:refs\/claude-tweaks\/plans\/|\$\{)/g;

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// -> { offenders: [{line, reason, text}], lineSites }. A site is a match whether or not
// its file may hold it, so the floor proves the matcher matches.
function scanSource(rel, raw) {
  const keep = stripComments(raw);
  const blank = stripComments(raw, { literals: 'blank' });
  const offenders = [];
  const verdict = stripperVerdict(raw, blank);
  if (verdict !== 'ok') {
    offenders.push({ line: 1, reason: `stripper-${verdict}`, text: STRIPPER_VERDICT_MESSAGES[verdict] });
  }
  if (keep.length !== blank.length) {
    offenders.push({ line: 1, reason: 'stripper-offsets', text: 'keep-mode and blank-mode text differ in length, so offsets cannot be compared' });
  }
  if (offenders.length > 0) return { offenders, lineSites: 0 };
  let lineSites = 0;
  for (const m of keep.matchAll(PLAN_LINE)) {
    if (blank[m.index] === keep[m.index]) continue; // code, not literal text
    lineSites++;
    if (rel !== WRITER_MODULE) offenders.push({ line: lineAt(keep, m.index), reason: 'line-literal', text: m[0] });
  }
  return { offenders, lineSites };
}

function findWriterOffenders(rel, raw) {
  return scanSource(rel, raw).offenders;
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

function scanTree() {
  const offenders = [];
  let files = 0;
  let lineSites = 0;
  for (const file of listJs(BIN_ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const scanned = scanSource(rel, readText(file));
    files++;
    lineSites += scanned.lineSites;
    for (const o of scanned.offenders) offenders.push(`${rel}:${o.line} ${o.reason} ${o.text}`);
  }
  return { offenders, files, lineSites };
}

const shape = (rel, src) => findWriterOffenders(rel, src).map((o) => [o.line, o.reason]);

test('#6052: the tree has one composer of the Plan line', () => {
  const { offenders, files, lineSites } = scanTree();
  assert.deepStrictEqual(offenders, []);
  assert.ok(files > 500, `walked only ${files} files: the walk broke`);
  // Floor set to the count at landing (1 site: composePlanLine's template, inside the file
  // that may hold it). Fewer matches mean the matcher died, not that the code went away.
  assert.ok(lineSites >= 1, `matched only ${lineSites} line-literal sites: the line matcher stopped matching`);
});

test('a planted second composer is flagged at its exact line, in a template and a plain string', () => {
  const src = "const a = 1;\nconst l = `Plan: ${ref} ${sha} spec-sha256:${h}`;\nconst m = 'Plan: refs/claude-tweaks/plans/7 x';\n";
  assert.deepStrictEqual(shape('plugin/bin/lib/x.js', src), [[2, 'line-literal'], [3, 'line-literal']]);
});

test('the sanctioned composer file stays green on its own template', () => {
  const src = "const a = 1;\nreturn `Plan: ${ref} ${commit} ${HASH_TOKEN_PREFIX}${hash}`;\n";
  assert.deepStrictEqual(findWriterOffenders(WRITER_MODULE, src), []);
  assert.deepStrictEqual(shape('plugin/bin/lib/issues/other.js', src), [[2, 'line-literal']]);
});

test('a CLI that calls composePlanLine and re-exports the ref prefix is clean', () => {
  const cli = [
    "const { composePlanLine } = require('./lib/issues/plan-line');",
    "const { PLAN_REF_PREFIX } = require('./lib/plan-store/ref');",
    "const USAGE = 'check --line <Plan: line> --spec-file <f>';",
    'const line = composePlanLine({ record, commit, specHash });',
    "const ref = `${PLAN_REF_PREFIX}${record}`;",
    "if (!l.startsWith('Plan: ')) return null;",
    '',
  ].join('\n');
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/plan-store.js', cli), []);
  assert.deepStrictEqual(shape('plugin/bin/plan-store.js', cli + "const own = `Plan: ${x}`;\n"), [[7, 'line-literal']]);
});

test('a comment naming the line is not a composer', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', '// Plan: refs/claude-tweaks/plans/1 abc\nconst a = 1;\n'), []);
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', '/* Plan: ${ref}\n */\nconst a = 1;\n'), []);
});

test('a code identifier or object key spelled Plan is not a literal, nor is an identifier-glued prefix', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', "const o = { Plan: refs };\nconst e = 'ReplayPlan: ${x}';\n"), []);
});

test('a planted mis-parse is an offender', () => {
  assert.ok(findWriterOffenders('plugin/bin/lib/x.js', "if (b) /'/.test(b);\nconst c = 'x';\nnot valid(((").length > 0);
});

test('a planted mis-parse that only blank mode shows is an offender', () => {
  const src = "if (b) /'/.test(b);\nconst c = 'x';\nconst l = 'Plan: refs/claude-tweaks/plans/1';\n";
  assert.equal(stripperVerdict(src, stripComments(src)), 'ok', 'the control must be clean in keep mode');
  assert.equal(stripperVerdict(src, stripComments(src, { literals: 'blank' })), 'misparsed', 'the control must be a mis-parse in blank mode');
  assert.deepStrictEqual(shape('plugin/bin/lib/x.js', src), [[1, 'stripper-misparsed']]);
});
