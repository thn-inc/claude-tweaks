'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// The acceptance packet links the recording and never embeds it (#4612): no module
// that composes the packet may emit a markdown image `![alt](url)` or an `<img>`
// tag, because an embedded recording or screenshot would put the page's pixels,
// and anything the page showed, into a surface the reviewer did not opt into. This
// scan walks plugin/bin/lib/wrap-up and plugin/bin/lib/walkthrough and flags a
// source line holding either shape.
//
// Comments are blanked and literals are kept, so a string or template that would
// emit the image counts and prose that names it does not. A stripper mis-parse
// (`misparsed`/`unparseable`) is reported as an offender, since blanked code would
// otherwise read as a clean file.
//
// Limit: an emission assembled from fragments (`'!' + '[a](' + url + ')'`) is
// invisible to a text scan. The render test for the Recording section covers the
// rendered output, which is where that case is caught.
const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = [
  path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up'),
  path.join(ROOT, 'plugin', 'bin', 'lib', 'walkthrough'),
];
const MIN_FILES = 10;

const IMAGE_TAILS = ['(', '['];
const IMG_TAG = /<img\b/i;

// Inline `![alt](url)`, reference `![alt][ref]`, and an alt holding its own brackets or a stray `]`:
// a `]` before a link tail that closes an image opener, or closes nothing once one has opened on this
// line. Brackets are matched, not searched for, since a regex's `(?<![a-z])[` holds a `![` and `](`
// with no image in it. One pass over one line, so a long line stays linear.
function holdsMarkdownImage(line) {
  const open = [];
  let imageSeen = false;
  for (let at = 0; at < line.length; at += 1) {
    if (line[at] === '\\') {
      at += 1;
    } else if (line[at] === '[') {
      const isImage = line[at - 1] === '!';
      open.push(isImage);
      imageSeen ||= isImage;
    } else if (line[at] === ']') {
      const closed = open.pop();
      if ((closed === true || (closed === undefined && imageSeen)) && IMAGE_TAILS.includes(line[at + 1])) return true;
    }
  }
  return false;
}

// Manual withFileTypes walk: `{ recursive: true }` is ignored before Node 18.17.
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

// `[{ line, what }]` for every stripper verdict that is not `ok` (line 0, the
// verdict message) and every non-comment line that holds an image emission.
function offendersIn(source) {
  const stripped = stripComments(source);
  const out = [];
  const verdict = stripperVerdict(source, stripped);
  if (verdict !== 'ok') out.push({ line: 0, what: STRIPPER_VERDICT_MESSAGES[verdict] });
  stripped.split('\n').forEach((text, i) => {
    if (holdsMarkdownImage(text)) out.push({ line: i + 1, what: 'a markdown image `![alt](url)`' });
    if (IMG_TAG.test(text)) out.push({ line: i + 1, what: 'an `<img>` tag' });
  });
  return out;
}

test('AC2.4: no module under wrap-up or walkthrough emits an image', () => {
  const files = SCAN_DIRS.flatMap(listJs);
  assert.ok(
    files.length >= MIN_FILES,
    `walked ${files.length} files, expected at least ${MIN_FILES}: a low count means the walk went blind, not that the modules went away`,
  );
  const offenders = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    for (const { line, what } of offendersIn(readText(file))) offenders.push(`${rel}:${line} ${what}`);
  }
  assert.deepEqual(offenders, []);
});

test('AC2.5: a planted emission goes red', () => {
  const planted = ["const s = '![a](b)';", 'const t = `<img src="x">`;'].join('\n');
  const found = offendersIn(planted);
  assert.deepEqual(found.map((o) => o.line), [1, 2]);
  assert.ok(found.every((o) => o.line > 0), 'a clean compile must raise no stripper-verdict offender');
});

test('AC2.5: an uppercase <IMG tag and an empty-alt image are flagged', () => {
  assert.deepEqual(offendersIn("const s = '<IMG src=x>';").map((o) => o.line), [1]);
  assert.deepEqual(offendersIn("const s = '![](u)';").map((o) => o.line), [1]);
});

test('AC2.5: a reference-style image and a ] inside the alt are flagged', () => {
  for (const line of [
    "const s = '![alt][ref]';",
    "const s = '![alt][]';",
    "const s = '![a]b](u)';",
    "const s = '![a[b]c](u)';",
    "const s = '![a[b]c][ref]';",
    "const s = '![a\\\\]b](u)';",
    'const s = `![${alt}][${ref}]`;',
    'const s = `![${alt[0]}](${url})`;',
  ]) {
    assert.deepEqual(offendersIn(line).map((o) => o.line), [1], line);
  }
});

test('AC2.5: the image scan stays on one line, and leaves what has no image shape', () => {
  assert.deepEqual(offendersIn("const a = '![';\nconst b = '](u)';"), [], 'an opener and a tail on two lines are no image');
  assert.deepEqual(offendersIn("const a = '](u)'; const b = '![';"), [], 'a tail before the opener is no image');
  for (const line of [
    'const a = !b[0];',
    "const a = !['x'].includes(y);",
    "const a = '[x](u)';",
    "const a = '[x][y]';",
    'const re = /(?<![a-z0-9.+-])(?:[a-z][a-z0-9+.-]{0,31}:)/;',
  ]) {
    assert.deepEqual(offendersIn(line), [], line);
  }
});

test('AC2.5: a comment that names an image flags nothing', () => {
  const source = [
    '// ![a](b)',
    '/* <img src="x"> */',
    '/*',
    ' * ![a](b) and <img src="x">',
    ' */',
    'const ok = 1;',
  ].join('\n');
  assert.deepEqual(offendersIn(source), []);
});

test('AC2.5: a planted line after a "/*" string is still flagged', () => {
  const source = ["const open = '/*';", "const s = '![a](b)';"].join('\n');
  assert.deepEqual(offendersIn(source).map((o) => o.line), [2]);
});

test('AC2.5: a reference-style image after a "/*" string is still flagged', () => {
  const source = ["const open = '/*';", "const s = '![a][b]';"].join('\n');
  assert.deepEqual(offendersIn(source).map((o) => o.line), [2]);
});

test('AC2.5: a stripper mis-parse is reported as an offender, not a clean scan', () => {
  // The regex after `)` is read as division, so its `/*` opens a comment that
  // blanks the planted emission and the stripped text no longer compiles.
  const source = ['if (b) /[/*]/.test(b);', "const s = '![a](b)';", '/* x */'].join('\n');
  assert.equal(stripperVerdict(source, stripComments(source)), 'misparsed', 'the fixture must actually mis-parse');
  assert.deepEqual(offendersIn(source), [{ line: 0, what: STRIPPER_VERDICT_MESSAGES.misparsed }]);
});

test('AC2.5: a file that does not compile is reported as an offender', () => {
  const found = offendersIn("export const s = 1;\nconst t = 'x';");
  assert.deepEqual(found, [{ line: 0, what: STRIPPER_VERDICT_MESSAGES.unparseable }]);
});
