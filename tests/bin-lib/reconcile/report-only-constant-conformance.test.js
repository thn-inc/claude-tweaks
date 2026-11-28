'use strict';
// tests/bin-lib/reconcile/report-only-constant-conformance.test.js — #3977: the
// report-only switch RUN_AUTO_CLOSE_REPORT_ONLY is read at exactly one site in
// plugin/bin, so the record that enables closing (#3978) flips one line and
// deletes the constant. The declaration and the module.exports listing are not
// reads. Matching runs over stripComments(raw), so a comment naming the constant
// does not count; a stripper mis-parse is an offender, not a clean file.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict } = require('../../helpers/strip-comments');
const { RUN_AUTO_CLOSE_REPORT_ONLY } = require('../../../plugin/bin/lib/reconcile/archive-merged');

const REPO = path.join(__dirname, '..', '..', '..');
const NAME = 'RUN_AUTO_CLOSE_REPORT_ONLY';
const TOKEN = new RegExp(`\\b${NAME}\\b`, 'g');
const DECLARATION = new RegExp(`^\\s*const\\s+${NAME}\\s*=`);
const EXPORT_LISTING = new RegExp(`^\\s*(?:module\\.exports\\s*=\\s*\\{)?[\\w\\s,]*\\b${NAME}\\b[\\w\\s,]*(?:\\}\\s*;?)?\\s*$`);

// -> { reads: [{ file, line }], misparsed: string[] }
function scan(files) {
  const reads = [];
  const misparsed = [];
  for (const { file, raw } of files) {
    if (!raw.includes(NAME)) continue;
    const stripped = stripComments(raw);
    if (stripperVerdict(raw, stripped) !== 'ok') { misparsed.push(file); continue; }
    stripped.split('\n').forEach((text, i) => {
      if (!TOKEN.test(text)) return;
      TOKEN.lastIndex = 0;
      if (DECLARATION.test(text) || EXPORT_LISTING.test(text)) return;
      const count = text.match(TOKEN).length;
      for (let k = 0; k < count; k++) reads.push({ file, line: i + 1 });
    });
    TOKEN.lastIndex = 0;
  }
  return { reads, misparsed };
}

function binFiles() {
  const out = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else if (ent.isFile() && ent.name.endsWith('.js')) out.push({ file: path.relative(REPO, abs), raw: fs.readFileSync(abs, 'utf8') });
    }
  };
  walk(path.join(REPO, 'plugin', 'bin'));
  return out;
}

test('the report-only constant is true in this release', () => {
  assert.equal(RUN_AUTO_CLOSE_REPORT_ONLY, true);
});

test('RUN_AUTO_CLOSE_REPORT_ONLY is read at exactly one site in plugin/bin', () => {
  const { reads, misparsed } = scan(binFiles());
  assert.deepEqual(misparsed, [], 'a stripper mis-parse is an offender');
  assert.equal(reads.length, 1, JSON.stringify(reads));
  assert.equal(reads[0].file.split(path.sep).join('/'), 'plugin/bin/lib/reconcile/archive-merged.js');
});

test('scan self-test: a second read goes red, a comment and the declaration do not count', () => {
  const src = [
    `const ${NAME} = true;`,
    `// ${NAME} in a comment`,
    `const a = ${NAME} ? 1 : 2;`,
    `if (${NAME}) b();`,
    `module.exports = { a, ${NAME} };`,
  ].join('\n');
  assert.equal(scan([{ file: 'x.js', raw: src }]).reads.length, 2);
});

test('scan self-test: an unparseable file is reported, not read as clean', () => {
  const src = `const ${NAME} = true;\nconst s = \`unterminated ${'${'}x\n`;
  assert.deepEqual(scan([{ file: 'bad.js', raw: src }]).misparsed, ['bad.js']);
});
