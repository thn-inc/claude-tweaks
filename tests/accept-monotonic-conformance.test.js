'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// The diff tripwire is monotonic (#4619, spec Global Constraint): it may add a risk flag, never
// remove one. This scan walks plugin/bin/lib/accept/ and plugin/bin/accept-park.js (the tripwire
// evaluator, the target resolver and the park executor, with the CLI that drives them) and flags:
//   remover-ref   any reference to removeRiskFlag, removeRiskFlags or confirmRiskFlags, the human-
//                 confirmed narrowing writers, call, import or bracket-string form. Read over
//                 keep-mode text, so a quoted name in a literal counts; a comment does not.
//   narrowing-fn  a function, method, property-bound function, const/let/var-bound function or a
//                 function assigned to `exports.NAME` / `module.exports.NAME`,
//                 whose name matches /^(?:remove|narrow|drop|strip)\w*flags?$/i. Read over
//                 blank-mode text, so a name inside a literal is not a declaration.
// A reader of removal history (`removalLogSlugs`, `readRemovedFlags`) is neither: it reads what a
// human removed and writes nothing.
// Recall limits, by design: a narrowing function bound through any other member assignment
// (`obj.dropFlags = ...`) or a computed key, a remover reached through a computed property name,
// and a narrowing function whose name falls outside the pattern are not seen; an identifier
// containing `$` is not matched as a whole name. `stripperVerdict` runs on the blank-mode text,
// which subsumes the keep-mode verdict (see tests/risk-flags-writer-conformance.test.js), so a
// mis-parse is an offender rather than a clean file.
const ROOT = path.join(__dirname, '..');
const ACCEPT_LIB = path.join(ROOT, 'plugin', 'bin', 'lib', 'accept');
const ACCEPT_CLI = path.join(ROOT, 'plugin', 'bin', 'accept-park.js');

const NAME = String.raw`(?<![\w$])(?:remove|narrow|drop|strip)\w*flags?(?![\w$])`;
const FN_VALUE = String.raw`(?:async\s*)?(?:function\b|\((?:[^()]|\([^()]*\))*\)\s*=>|[\w$]+\s*=>)`;
const REMOVER_REF = /\b(?:removeRiskFlags?|confirmRiskFlags?)\b/g;
const FUNCTION_DECL = new RegExp(String.raw`\bfunction\s*\*?\s*(${NAME})\s*\(`, 'gi');
const BOUND_DECL = new RegExp(String.raw`\b(?:const|let|var)\s+(${NAME})\s*=\s*${FN_VALUE}`, 'gi');
const PROPERTY_DECL = new RegExp(String.raw`(?<![\w$.])(${NAME})\s*:\s*${FN_VALUE}`, 'gi');
const MEMBER_DECL = new RegExp(String.raw`(?<![\w$.])(?:module\s*\.\s*)?exports\s*\.\s*(${NAME})\s*=\s*${FN_VALUE}`, 'gi');
const METHOD_DECL = new RegExp(String.raw`^[ \t]*(?:(?:async|static|get|set)\s+)*\*?\s*(${NAME})\s*\((?:[^()]|\([^()]*\))*\)\s*\{`, 'gim');

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// -> { offenders: [{line, reason, text}], refSites, declSites }. A site counts whether or not it is
// an offender; here every site is, so the counts are the offender counts of a planted file.
function scanSource(raw) {
  const keep = stripComments(raw);
  const blank = stripComments(raw, { literals: 'blank' });
  const verdict = stripperVerdict(raw, blank);
  if (verdict !== 'ok') {
    return { offenders: [{ line: 1, reason: `stripper-${verdict}`, text: STRIPPER_VERDICT_MESSAGES[verdict] }], refSites: 0, declSites: 0 };
  }
  if (keep.length !== blank.length) {
    return { offenders: [{ line: 1, reason: 'stripper-offsets', text: 'keep-mode and blank-mode text differ in length, so offsets cannot be compared' }], refSites: 0, declSites: 0 };
  }
  const offenders = [];
  let refSites = 0;
  let declSites = 0;
  for (const m of keep.matchAll(REMOVER_REF)) {
    refSites++;
    offenders.push({ line: lineAt(keep, m.index), reason: 'remover-ref', text: m[0] });
  }
  const seen = new Set();
  for (const re of [FUNCTION_DECL, BOUND_DECL, PROPERTY_DECL, MEMBER_DECL, METHOD_DECL]) {
    for (const m of blank.matchAll(re)) {
      const at = m.index + m[0].indexOf(m[1]);
      if (seen.has(at)) continue;
      seen.add(at);
      declSites++;
      offenders.push({ line: lineAt(blank, at), reason: 'narrowing-fn', text: m[1] });
    }
  }
  offenders.sort((a, b) => a.line - b.line);
  return { offenders, refSites, declSites };
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
  const files = [...listJs(ACCEPT_LIB), ACCEPT_CLI];
  const offenders = [];
  const rels = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    rels.push(rel);
    for (const o of scanSource(readText(file)).offenders) offenders.push(`${rel}:${o.line} ${o.reason} ${o.text}`);
  }
  return { offenders, rels };
}

const shape = (src) => scanSource(src).offenders.map((o) => [o.line, o.reason]);

test('the tripwire stays monotonic: no accept module removes or narrows a risk flag', () => {
  const { offenders, rels } = scanTree();
  assert.deepStrictEqual(offenders, []);
  // Floor: the accept lib is five modules and the CLI is the sixth at landing. Fewer files means
  // the walk broke (a moved directory reads as a clean scan), not that the code went away.
  assert.ok(rels.length >= 6, `scanned only ${rels.length} files: the walk broke`);
  assert.ok(rels.includes('plugin/bin/lib/accept/tripwire.js'), 'tripwire.js must be among the scanned files');
  assert.ok(rels.includes('plugin/bin/accept-park.js'), 'accept-park.js must be among the scanned files');
});

test('a planted remover import is flagged at its exact line', () => {
  assert.deepStrictEqual(shape("const a = 1;\nconst { removeRiskFlag } = require('../issues/record');\n"), [[2, 'remover-ref']]);
});

test('a planted confirm call, a plural spelling and a bracket-string reference are flagged', () => {
  const src = "const a = 1;\nconfirmRiskFlags(body, o);\nconst b = rec['removeRiskFlag'];\nconst c = removeRiskFlags;\n";
  assert.deepStrictEqual(shape(src), [[2, 'remover-ref'], [3, 'remover-ref'], [4, 'remover-ref']]);
});

test('a planted function, const-bound function, method and property function are each flagged', () => {
  assert.deepStrictEqual(shape('const a = 1;\nfunction removeTripwireFlag() {}\n'), [[2, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('const a = 1;\nconst dropFlags = () => {};\n'), [[2, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('const a = 1;\nconst narrowFlag = async (x, y = f(1)) => x;\n'), [[2, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('const a = 1;\nconst stripFlags = function () {};\n'), [[2, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('const a = 1;\nconst x = x => 1;\nlet dropFlag = e => e;\n'), [[3, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('class A {\n  dropFlags(list) {\n    return 1;\n  }\n}\n'), [[2, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('const o = {\n  removeFlag: (x) => x,\n  stripFlags: function () {},\n};\n'), [[2, 'narrowing-fn'], [3, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('class A {\n  static async *narrowFlags() {}\n}\n'), [[2, 'narrowing-fn']]);
});

test('a planted function assigned to exports.NAME or module.exports.NAME is flagged', () => {
  assert.deepStrictEqual(shape('const a = 1;\nexports.dropFlags = function () {};\n'), [[2, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('const a = 1;\nmodule.exports.narrowFlag = (x) => x;\nmodule.exports.stripFlags = async e => e;\n'), [[2, 'narrowing-fn'], [3, 'narrowing-fn']]);
  assert.deepStrictEqual(shape('const a = 1;\nexports.readRemovedFlags = () => [];\nexports.dropFlagsNow = () => 1;\n'), [], 'a reader and a longer name are not narrowing');
});

test('a reader of removal history and unrelated names are not narrowing', () => {
  const src = [
    'function removalLogSlugs(comments) { return []; }',
    'const readRemovedFlags = () => [];',
    'const o = { readRemovedFlags() { return 1; }, flags: [] };',
    'function addFlags() {}',
    'const dropFlagsNow = () => 1;',
    'const flagsToDrop = () => 1;',
    'const removeAll = () => 1;',
    'dropFlags(list);',
    'const r = dropFlags;',
    '',
  ].join('\n');
  assert.deepStrictEqual(shape(src), []);
});

test('a name in a comment or a string is not a declaration or a reference to a remover in a comment', () => {
  assert.deepStrictEqual(shape('// function dropFlags() {}\n/* removeRiskFlag(body) */\nconst a = 1;\n'), []);
  assert.deepStrictEqual(shape("const m = 'function dropFlags() {}';\nconst n = `const stripFlags = () => 1`;\n"), []);
});

test('a remover name inside a string literal is still a reference', () => {
  assert.deepStrictEqual(shape("const a = 1;\nconst n = 'removeRiskFlag';\n"), [[2, 'remover-ref']]);
});

test('the matcher still sees code after a fake comment opener in a string and a regex', () => {
  const src = "const g = '/*';\nconst r = /^origin\\//;\nfunction dropFlags() {}\n";
  assert.deepStrictEqual(shape(src), [[3, 'narrowing-fn']]);
});

test('a CRLF copy gets the same verdict', () => {
  const src = "const a = 1;\nconst { removeRiskFlag } = require('../issues/record');\nconst dropFlags = () => {};\n";
  assert.deepStrictEqual(shape(src.replace(/\n/g, '\r\n')), shape(src));
});

test('a planted mis-parse is an offender', () => {
  assert.ok(scanSource("if (b) /'/.test(b);\nconst c = 'x';\nnot valid(((").offenders.length > 0);
});

test('a planted mis-parse that only blank mode shows is an offender', () => {
  const src = "if (b) /'/.test(b);\nconst c = 'x';\nfunction dropFlags() {}\n";
  assert.equal(stripperVerdict(src, stripComments(src)), 'ok', 'the control must be clean in keep mode');
  assert.equal(stripperVerdict(src, stripComments(src, { literals: 'blank' })), 'misparsed', 'the control must be a mis-parse in blank mode');
  assert.deepStrictEqual(shape(src), [[1, 'stripper-misparsed']]);
});

// plugin/bin/lib/accept/ imports no flag writer at all (build deviation 1): the one write goes
// through accept-park.js, the CLI, which reads and writes the record. A module in that directory
// that requires the record-flag writer or names one of its adders is an offender, comments aside.
const WRITER_REQUIRE = /\brequire\s*\(\s*['"`][^'"`]*(?:record-risk-flags|issues\/record)['"`]\s*\)/g;
const WRITER_REF = /\b(?:addRiskFlags|addTripwireRiskFlags|carryTripwireFlags|appendRiskProofGotcha)\b/g;

function writerImports(raw) {
  const keep = stripComments(raw);
  // A mis-parse is an offender, never a clean file (the same verdict scanSource applies).
  const verdict = stripperVerdict(raw, stripComments(raw, { literals: 'blank' }));
  if (verdict !== 'ok') return [[1, `stripper-${verdict}`]];
  const offenders = [];
  for (const [re, reason] of [[WRITER_REQUIRE, 'writer-require'], [WRITER_REF, 'writer-ref']]) {
    for (const m of keep.matchAll(re)) offenders.push([lineAt(keep, m.index), reason]);
  }
  return offenders.sort((a, b) => a[0] - b[0]);
}

test('no accept lib module imports or names a risk-flag writer', () => {
  const files = listJs(ACCEPT_LIB);
  assert.ok(files.length >= 5, `scanned only ${files.length} files: the walk broke`);
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const [line, reason] of writerImports(readText(file))) offenders.push(`${rel}:${line} ${reason}`);
  }
  assert.deepStrictEqual(offenders, []);
});

test('a planted mis-parse is an offender for the writer-import scan too', () => {
  assert.deepStrictEqual(writerImports("if (b) /'/.test(b);\nconst c = 'x';\nfunction dropFlags() {}\n"), [[1, 'stripper-misparsed']]);
  assert.deepStrictEqual(writerImports("if (b) /'/.test(b);\nconst c = 'x';\nnot valid((("), [[1, 'stripper-unparseable']]);
});

test('a planted writer require or adder reference is flagged, a comment is not', () => {
  assert.deepStrictEqual(writerImports("const a = 1;\nconst { addRiskFlags } = require('../issues/record-risk-flags');\n"), [[2, 'writer-require'], [2, 'writer-ref']]);
  assert.deepStrictEqual(writerImports("const a = 1;\nconst r = require('../issues/record');\n"), [[2, 'writer-require']]);
  assert.deepStrictEqual(writerImports('const a = 1;\naddTripwireRiskFlags(body, flags);\n'), [[2, 'writer-ref']]);
  assert.deepStrictEqual(writerImports('// addRiskFlags is the CLI\'s\n/* require(\'../issues/record\') */\nconst a = 1;\n'), []);
  assert.deepStrictEqual(writerImports("const { parseRiskFlags } = require('../issues/record-vocabulary');\n"), []);
});
