'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// One writer of the `Risk-flags:` body line (#4618, spec AC5a). The line, its
// `Risk-flags-unconfirmed:` marker, and the removal/confirm verbs are owned by
// plugin/bin/lib/issues/record-risk-flags.js; every other module reaches them by
// calling its exports (re-exported by record.js, called by the bin/risk-flags.js CLI).
// This scan walks plugin/bin and flags two shapes:
//   line-literal  a string, template or regex literal holding the line key followed
//                 by its colon (RISK_LINE) anywhere except record-risk-flags.js. The
//                 colon is what makes it the line: `require('./record-risk-flags')` and
//                 `usage: risk-flags.js ...` hold the bare name and write nothing. A
//                 literal is told from code by comparing keep-mode text with
//                 `literals: 'blank'` text at the match offset, so an object key such as
//                 `riskFlags: x` is code, not a literal.
//   remover       any reference to `removeRiskFlag` or `confirmRiskFlags` (singular or
//                 plural, call or bracket-string form) outside record-risk-flags.js,
//                 record.js (re-export) and the CLI. The two verbs widen nothing and
//                 need a human decision, so a caller beyond the CLI is a second path
//                 to a removal. `addRiskFlags` and `appendRiskProofGotcha` are open to
//                 any caller: they only widen.
// Recall limits, by design: a line key assembled from two literals (`'Risk-' + 'flags: '`)
// and a remover reached through a computed property name are not seen. The matchers
// read keep-mode text (the literal-vs-code test also reads blank-mode text at the same
// offsets), but `stripperVerdict` runs on the blank-mode text only, so a mis-parse is an
// offender rather than a clean file. Blank mode subsumes keep mode: both modes make the
// same comment decisions and blank only spaces out literal bodies, so no input has a
// non-`ok` keep verdict with an `ok` blank verdict (probed over 780k compilable
// `if (b) /<regex body>/.test(b);` fixtures: 30,144 keep-mode mis-parses, every one
// also a blank-mode mis-parse, 531,315 blank-mode mis-parses in all). A keep-mode
// verdict run would therefore never fire alone, and no fixture can pin it.
const ROOT = path.join(__dirname, '..');
const BIN_ROOT = path.join(ROOT, 'plugin', 'bin');

const WRITER_MODULE = 'plugin/bin/lib/issues/record-risk-flags.js';
const REMOVER_ALLOWED = new Set([WRITER_MODULE, 'plugin/bin/lib/issues/record.js', 'plugin/bin/risk-flags.js']);
const RISK_LINE = /risk[-_ ]?flags(?:[-_ ]unconfirmed)?\s*:/gi;
const REMOVER = /\b(?:removeRiskFlags?|confirmRiskFlags?)\b/g;

function lineAt(text, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

// -> { offenders: [{line, reason, text}], lineSites, removerSites }. A site is a
// match whether or not its file may hold it, so the floor proves the matcher matches.
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
  if (offenders.length > 0) return { offenders, lineSites: 0, removerSites: 0 };
  let lineSites = 0;
  for (const m of keep.matchAll(RISK_LINE)) {
    if (blank[m.index] === keep[m.index]) continue; // code, not literal text
    lineSites++;
    if (rel !== WRITER_MODULE) offenders.push({ line: lineAt(keep, m.index), reason: 'line-literal', text: m[0] });
  }
  let removerSites = 0;
  for (const m of keep.matchAll(REMOVER)) {
    removerSites++;
    if (!REMOVER_ALLOWED.has(rel)) offenders.push({ line: lineAt(keep, m.index), reason: 'remover', text: m[0] });
  }
  offenders.sort((a, b) => a.line - b.line);
  return { offenders, lineSites, removerSites };
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
  let removerSites = 0;
  for (const file of listJs(BIN_ROOT)) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    const scanned = scanSource(rel, readText(file));
    files++;
    lineSites += scanned.lineSites;
    removerSites += scanned.removerSites;
    for (const o of scanned.offenders) offenders.push(`${rel}:${o.line} ${o.reason} ${o.text}`);
  }
  return { offenders, files, lineSites, removerSites };
}

const shape = (rel, src) => findWriterOffenders(rel, src).map((o) => [o.line, o.reason]);

test('AC5.6: the tree has one writer of the Risk-flags line', () => {
  const { offenders, files, lineSites, removerSites } = scanTree();
  assert.deepStrictEqual(offenders, []);
  assert.ok(files > 500, `walked only ${files} files: the walk broke`);
  // Floors set to the counts at landing (546 files; 4 line-literal and 13 remover sites,
  // all inside the files that may hold them). Fewer matches mean a matcher died, not
  // that the code went away; raise them when sites are added, never lower them.
  assert.ok(lineSites >= 4, `matched only ${lineSites} line-literal sites: the line matcher stopped matching`);
  assert.ok(removerSites >= 13, `matched only ${removerSites} remover sites: the remover matcher stopped matching`);
});

test('AC5.6: a planted second writer is flagged at its exact line', () => {
  const planted = "const a = 1;\nconst body2 = `Risk-flags: ${x}`;\n";
  assert.deepStrictEqual(shape('plugin/bin/lib/x.js', planted), [[2, 'line-literal']]);
});

test('AC5.6: a planted remover call is flagged', () => {
  assert.deepStrictEqual(
    shape('plugin/bin/lib/accept/x.js', "const b = 1;\nremoveRiskFlag(body, 's', { humanConfirmed: true });\n"),
    [[2, 'remover']],
  );
});

test('a planted confirm call, a plural spelling and a bracket-string reference are flagged', () => {
  const src = "const a = 1;\nconfirmRiskFlags(body, o);\nconst b = rec['removeRiskFlag'];\nconst c = removeRiskFlags;\n";
  assert.deepStrictEqual(shape('plugin/bin/lib/x.js', src), [[2, 'remover'], [3, 'remover'], [4, 'remover']]);
});

test('the sanctioned files may name the removers; no other file may', () => {
  const src = "const b = 1;\nremoveRiskFlag(body, 's', {});\n";
  for (const rel of ['plugin/bin/lib/issues/record-risk-flags.js', 'plugin/bin/lib/issues/record.js', 'plugin/bin/risk-flags.js']) {
    assert.deepStrictEqual(findWriterOffenders(rel, src), [], rel);
  }
  assert.deepStrictEqual(shape('plugin/bin/lib/issues/record-other.js', src), [[2, 'remover']]);
});

test('a CLI that imports and calls the writers without composing the line is clean', () => {
  const cli = [
    "const { addRiskFlags, removeRiskFlag, confirmRiskFlags } = require('./lib/issues/record');",
    "const USAGE = 'usage: risk-flags.js classify|settle|confirm';",
    'const next = addRiskFlags(body, slugs, { extraCategories });',
    'const dropped = removeRiskFlag(next, slug, { humanConfirmed: true });',
    '',
  ].join('\n');
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/risk-flags.js', cli), []);
  assert.deepStrictEqual(shape('plugin/bin/risk-flags.js', cli + "const own = `Risk-flags: ${x}`;\n"), [[5, 'line-literal']]);
});

test('a comment naming the line is not a writer', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', '// writes Risk-flags: a\nconst a = 1;\n'), []);
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', '/* Risk-flags-unconfirmed: true\n   removeRiskFlag */\nconst a = 1;\n'), []);
});

test('a module path or CLI name holding risk-flags with no colon is not a writer', () => {
  assert.deepStrictEqual(
    findWriterOffenders('plugin/bin/lib/x.js', "const m = require('./record-risk-flags');\nconst u = 'usage: risk-flags.js classify';\n"),
    [],
  );
});

test('a code identifier or object key spelled riskFlags is not a literal', () => {
  assert.deepStrictEqual(findWriterOffenders('plugin/bin/lib/x.js', 'const o = { riskFlags: [], status: 1 };\nconst riskFlags = o.riskFlags;\n'), []);
});

test('AC5.6: a planted marker literal is flagged at its exact line', () => {
  assert.deepStrictEqual(
    shape('plugin/bin/lib/x.js', "const a = 1;\nconst m = 'Risk-flags-unconfirmed: true';\n"),
    [[2, 'line-literal']],
  );
});

test('a spelling variant of the line key in a literal is flagged', () => {
  const src = "const a = 1;\nconst k = \"risk_flags : x\";\nconst r = /^Risk flags:/;\n";
  assert.deepStrictEqual(shape('plugin/bin/lib/x.js', src), [[2, 'line-literal'], [3, 'line-literal']]);
});

test('the line literal is still seen after a fake comment opener in a string and a regex', () => {
  const src = "const g = '/*';\nconst r = /^origin\\//;\nconst l = 'Risk-flags: x';\n";
  assert.deepStrictEqual(shape('plugin/bin/lib/x.js', src), [[3, 'line-literal']]);
});

test('a planted mis-parse is an offender', () => {
  assert.ok(findWriterOffenders('plugin/bin/lib/x.js', "if (b) /'/.test(b);\nconst c = 'x';\nnot valid(((").length > 0);
});

test('a planted mis-parse that only blank mode shows is an offender', () => {
  const src = "if (b) /'/.test(b);\nconst c = 'x';\nconst l = 'Risk-flags: x';\n";
  assert.equal(stripperVerdict(src, stripComments(src)), 'ok', 'the control must be clean in keep mode');
  assert.equal(stripperVerdict(src, stripComments(src, { literals: 'blank' })), 'misparsed', 'the control must be a mis-parse in blank mode');
  assert.deepStrictEqual(shape('plugin/bin/lib/x.js', src), [[1, 'stripper-misparsed']]);
});
