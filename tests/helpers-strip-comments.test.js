'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict } = require('./helpers/strip-comments');

function newlineIndices(s) {
  const out = [];
  for (let i = 0; i < s.length; i++) if (s[i] === '\n') out.push(i);
  return out;
}

test('blanks comments to spaces and keeps every offset and newline', () => {
  const input = "a(); // x\n/* y\nz */ b();";
  const out = stripComments(input);
  assert.equal(out.length, input.length);
  assert.deepEqual(newlineIndices(out), newlineIndices(input));
  assert.ok(out.includes('a();'));
  assert.ok(out.includes('b();'));
  assert.ok(!out.includes('x'));
  assert.ok(!out.includes('y'));
  assert.ok(!out.includes('z'));
});

test('a /* or // inside a string, template or line comment opens no comment', () => {
  const input = [
    "const g = '/*';",
    'live1();',
    '// see work/*-spec.md',
    'live2();',
    'const t = `${d}//x/*`;',
    'live3();',
    '/* end */',
  ].join('\n');
  const out = stripComments(input);
  assert.ok(out.includes('live1();'));
  assert.ok(out.includes('live2();'));
  assert.ok(out.includes('live3();'));
});

test('an escaped quote does not end the string', () => {
  const out = stripComments("const s = 'it\\'s /* no'; live(); /* x */");
  assert.ok(out.includes('live();'));
  assert.ok(out.includes('/* no'));
});

test('a multi-line template keeps its // and /*; a quoted string does not cross a newline', () => {
  const template = 'const t = `a\n// b\n/* c`; live();';
  assert.equal(stripComments(template), template);

  const unterminated = "const s = 'x\n// gone";
  const out = stripComments(unterminated);
  assert.equal(out.length, unterminated.length);
  assert.ok(!out.includes('// gone'));
});

test('a regex ending in an escaped slash is not a // comment', () => {
  const out = stripComments("r.replace(/^origin\\//, ''); live();");
  assert.ok(out.includes('live();'));
});

test('a quote inside a regex with no later literal on the line blanks no code', () => {
  const out = stripComments("/'/.test(s); live(); // note");
  assert.ok(out.includes('live();'));
});

test('stripperVerdict reads real comments, a hashbang and a top-level return as ok', () => {
  assert.equal(stripperVerdict("// a /* b\nconst s = 'x // y'; /* multi\n line */ live();"), 'ok');
  assert.equal(stripperVerdict('#!/usr/bin/env node\n// x\nlive();'), 'ok');
  assert.equal(stripperVerdict('if (x) return 1;\nlive();'), 'ok');
});

test('stripperVerdict reports each residual mis-parse shape (a regex after ) or }) as misparsed', () => {
  assert.equal(stripperVerdict("const x = 'a'; if (x) /'/.test(x); const b = 'p//q'; fs.realpathSync(b);"), 'misparsed');
  assert.equal(stripperVerdict('if (a) /"/.test(a); const b = "//"; live();'), 'misparsed');
  assert.equal(stripperVerdict('function f() {} /`/.test(s); const b = `x // y`; live();'), 'misparsed');
  assert.equal(stripperVerdict('if (x) /[/*]/.test(x); live(); /* c */'), 'misparsed');
  // A lazily compiled body: the mis-parse sits inside a function.
  assert.equal(
    stripperVerdict('function outer() { function inner() { if (x) /[/*]/.test(x); live(); } return inner; } /* c */'),
    'misparsed',
  );
});

test('stripperVerdict reports raw text that does not compile as unparseable', () => {
  assert.equal(stripperVerdict('const a = ;'), 'unparseable');
});

test('stripperVerdict judges a supplied stripped text', () => {
  assert.equal(stripperVerdict('live();', 'live('), 'misparsed');
});

test('AC1.1/AC1.2: a quote or backtick inside a regex no longer swallows the comment after it', () => {
  assert.equal(
    stripComments("const r = /['\"`]/; // it's gone\nlive(); // a `tick` too"),
    "const r = /['\"`]/;             \nlive();                ",
  );
});

test('AC1.1: // and /* inside a regex character class are kept verbatim', () => {
  const src = 'const r = /[//]/, s = /[/*]/; live();';
  assert.equal(stripComments(src), src);
});

test('AC1.1: division never opens a regex', () => {
  assert.equal(stripComments('a / b // c'), 'a / b     ');
  assert.equal(stripComments('f(x) / 2; live(); // gone'), 'f(x) / 2; live();        ');
  // A keyword as a property name, and non-ASCII / $ identifiers.
  assert.equal(
    stripComments("a.return / 2; x.in / 3; ü / 4; $x / 5; // it's gone"),
    "a.return / 2; x.in / 3; ü / 4; $x / 5;             ",
  );
  // A `/` after postfix or prefix ++/-- is division (a deliberate deviation from the
  // plain punctuator rule: a regex can never follow ++/--); a single + still starts a regex.
  assert.equal(stripComments("n = i++ / 2; // it's gone"), "n = i++ / 2;             ");
  assert.equal(stripComments("n = i-- / 2; // it's gone"), "n = i-- / 2;             ");
  assert.equal(stripComments("x = ++i / 2; // it's gone"), "x = ++i / 2;             ");
  assert.equal(stripComments("a = b + /'/.source; // it's gone"), "a = b + /'/.source;             ");
});

test('AC1.1: return and typeof introduce a regex', () => {
  assert.equal(
    stripComments("function f() { return /'/.test(s); } // it's gone"),
    "function f() { return /'/.test(s); }             ",
  );
  assert.equal(stripComments("const t = typeof /'/; // it's gone"), "const t = typeof /'/;             ");
  // Unicode whitespace after the keyword is not part of the word.
  assert.equal(
    stripComments("function f(s) { return /'/.test(s); } // it's gone"),
    "function f(s) { return /'/.test(s); }             ",
  );
});

test("AC1.1: a template's nested ${} code is scanned, and its closing } returns to the template", () => {
  assert.equal(
    stripComments("const t = `a${ '/' + \"`\" }b`; // it's gone"),
    "const t = `a${ '/' + \"`\" }b`;             ",
  );
});

test("AC1.1: a { } pair inside a template's ${} does not end the ${} early", () => {
  assert.equal(
    stripComments("const t = `${ {a: 1}.a + '`' }`; // it's gone"),
    "const t = `${ {a: 1}.a + '`' }`;             ",
  );
  assert.equal(
    stripComments("const t = `a${ `b${ {k: 1}.k }c` + {z: 2}.z + '`' }d`; // it's gone"),
    "const t = `a${ `b${ {k: 1}.k }c` + {z: 2}.z + '`' }d`;             ",
  );
});

test('AC1.1: an escaped slash does not end a regex', () => {
  assert.equal(stripComments("const r = /a\\/b'/; // it's gone"), "const r = /a\\/b'/;             ");
});

test('the hashbang line is kept and unterminated constructs at EOF do not throw', () => {
  assert.equal(stripComments('#!/usr/bin/env node\n// x\nlive();'), '#!/usr/bin/env node\n    \nlive();');
  assert.equal(stripComments('live(); /* open'), 'live();        ');
  for (const src of ['const t = `open ${ a', 'const r = /open', "const s = 'open"]) {
    assert.equal(stripComments(src).length, src.length);
  }
});

const REPO_ROOT = path.join(__dirname, '..');
const BIN_DIR = path.join(REPO_ROOT, 'plugin', 'bin');

function binFiles(dir = BIN_DIR) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...binFiles(full));
    else if (/\.c?js$/.test(entry.name)) out.push(full);
  }
  return out;
}

// `{file}:{line}` for every whole-line // comment that survives stripping.
function survivingWholeLineComments(file) {
  const raw = fs.readFileSync(file, 'utf8').split('\n');
  const stripped = stripComments(raw.join('\n')).split('\n');
  const rel = path.relative(REPO_ROOT, file);
  const offenders = [];
  let seen = 0;
  raw.forEach((line, i) => {
    if (!/^\s*\/\/\s*\S/.test(line)) return;
    seen++;
    if (stripped[i].trim() !== '') offenders.push(`${rel}:${i + 1}`);
  });
  return { offenders, seen };
}

test('AC2.2: no whole-line // comment of the three measured files survives stripping', () => {
  const measured = [
    'plugin/bin/lib/code-health/candidates-dead-code.js',
    'plugin/bin/lib/issues/grouping.js',
    'plugin/bin/lib/impeccable-engine/index.js',
  ];
  const offenders = [];
  for (const rel of measured) {
    const { offenders: o, seen } = survivingWholeLineComments(path.join(REPO_ROOT, rel));
    assert.ok(seen > 0, `${rel} has no whole-line // comment, so the check would be vacuous`);
    offenders.push(...o);
  }
  assert.deepEqual(offenders, []);
});

test('AC2.1: no whole-line // comment survives stripping in any plugin/bin file', () => {
  const offenders = binFiles().flatMap((file) => survivingWholeLineComments(file).offenders);
  assert.deepEqual(offenders, []);
});

test('AC3.1: stripperVerdict is ok for every plugin/bin file', () => {
  const bad = [];
  for (const file of binFiles()) {
    const verdict = stripperVerdict(fs.readFileSync(file, 'utf8'));
    if (verdict !== 'ok') bad.push(`${path.relative(REPO_ROOT, file)}: ${verdict}`);
  }
  assert.deepEqual(bad, []);
});

test('AC4.1: the helper requires only node: built-ins', () => {
  const text = fs.readFileSync(path.join(__dirname, 'helpers', 'strip-comments.js'), 'utf8');
  const required = [...text.matchAll(/require\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  assert.ok(required.length > 0);
  assert.deepEqual(
    required.filter((r) => !r.startsWith('node:')),
    [],
  );
});
