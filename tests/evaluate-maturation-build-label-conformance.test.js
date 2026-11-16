'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripComments, stripperVerdict, STRIPPER_VERDICT_MESSAGES } = require('./helpers/strip-comments');
const { readText } = require('./helpers/read-skill');

// A merge grant counts only together with a live `auto:build` (#5734):
// evaluateMaturation (plugin/bin/lib/issues/grant-maturation.js) answers
// `no-build-grant` unless `hasBuildLabel === true`. The module cannot read labels
// itself, so every caller has to hand the build label over. A caller that omits it
// (or passes a constant) turns every maturation check into `no-build-grant`, or,
// worse, passes `true` without reading the live labels and lets a leftover
// `auto:merge` merge a record whose build grant was revoked.
//
// A "site" is any call of evaluateMaturation: `evaluateMaturation(`, with whitespace
// before the paren or optional chaining (`evaluateMaturation?.(`) also matched. The
// definition (`function evaluateMaturation(...)`) and prose outside a fence are not
// sites; a call-shaped mention inside a fence is judged like a call (fail closed). A site whose
// first argument is not an object literal (a variable) cannot be read, so it is an
// offender (fail closed). For an object literal, the call's own text, from its `{` to the matching `}`, must hold a top-level
// `hasBuildLabel:` property whose value text contains `includes('auto:build')`, so
// the value is a read of a label list, not a literal `true` or a bare variable.
//   - plugin/bin/**/*.js: judged over `stripComments` text, with `stripperVerdict`
//     reported as an offender (a mis-parse that blanks the call would read as clean).
//   - plugin/skills/**/*.md: each fenced block is judged on its own, over raw text
//     (a shell-wrapped `node -e` snippet is not JS the stripper models); the snippet
//     is run by a reader who never sees the other fences. The fence regex is anchored
//     on `\r?\n` and reads both ``` and ~~~ fences.
// Recall limits: a call reached through an alias or a computed property, a `hasBuildLabel:` that
// only appears in a nested object (the property is read at the call's top level, but
// a comment inside a markdown fence's object is raw text), and a value that names
// `includes('auto:build')` without it being the label list the caller fetched. The
// exact site-file roster below, beside the `>=` count, is what shows the matcher
// still matches in both trees.
const ROOT = path.join(__dirname, '..');
const BIN_ROOT = path.join(ROOT, 'plugin', 'bin');
const SKILLS_ROOT = path.join(ROOT, 'plugin', 'skills');
// `function evaluateMaturation({` (the definition) is not a site.
const SITE_RE = /(?<!\bfunction\s+)\bevaluateMaturation\s*(?:\?\.)?\(/g;
const FENCE_RE = /(```|~~~)[^\n]*\r?\n([\s\S]*?)\1/g;
const BUILD_VALUE_RE = /includes\(\s*(['"])auto:build\1\s*\)/;

// Manual withFileTypes walk: readdirSync's `recursive` option is ignored before
// Node 18.17, which would silently cover only the top level.
function walk(dir, ext) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

// The index just past the `}` matching the `{` at `open`, or -1 when unbalanced.
// Quoted strings are skipped so a brace inside one does not count.
function matchBrace(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i += 1; i < text.length && text[i] !== c; i += 1) if (text[i] === '\\') i += 1;
    } else if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

// Split an object body (text between the braces) into its top-level properties.
function topLevelProps(body) {
  const props = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < body.length; i += 1) {
    const c = body[i];
    if (c === "'" || c === '"' || c === '`') {
      for (i += 1; i < body.length && body[i] !== c; i += 1) if (body[i] === '\\') i += 1;
    } else if (c === '{' || c === '[' || c === '(') depth += 1;
    else if (c === '}' || c === ']' || c === ')') depth -= 1;
    else if (c === ',' && depth === 0) {
      props.push(body.slice(start, i));
      start = i + 1;
    }
  }
  props.push(body.slice(start));
  return props;
}

// text -> { sites, offenders: string[] }, offsets measured from `base` (line math)
function scanText(text, label, lineBase) {
  const offenders = [];
  let sites = 0;
  for (const m of text.matchAll(SITE_RE)) {
    sites += 1;
    const line = lineBase + text.slice(0, m.index).split('\n').length - 1;
    const open = m.index + m[0].length + text.slice(m.index + m[0].length).match(/^\s*/)[0].length;
    if (text[open] !== '{') {
      offenders.push(`${label}:${line}: evaluateMaturation call whose first argument is not an object literal cannot be checked for hasBuildLabel`);
      continue;
    }
    const end = matchBrace(text, open);
    if (end < 0) {
      offenders.push(`${label}:${line}: evaluateMaturation({ call whose braces never balance`);
      continue;
    }
    const prop = topLevelProps(text.slice(open + 1, end - 1))
      .map((p) => p.match(/^\s*hasBuildLabel\s*:\s*([\s\S]*)$/))
      .find(Boolean);
    if (!prop || !BUILD_VALUE_RE.test(prop[1])) {
      offenders.push(`${label}:${line}: evaluateMaturation call does not pass hasBuildLabel: <labels>.includes('auto:build')`);
    }
  }
  return { sites, offenders };
}

// raw JS -> { sites, offenders: string[] }
function jsScan(raw, label) {
  const stripped = stripComments(raw);
  const verdict = stripperVerdict(raw, stripped);
  if (verdict !== 'ok') return { sites: 0, offenders: [`${label}: ${STRIPPER_VERDICT_MESSAGES[verdict]}`] };
  return scanText(stripped, label, 1);
}

// raw markdown -> { sites, offenders: string[] }, each fence judged on its own
function mdScan(raw, label) {
  let sites = 0;
  const offenders = [];
  for (const m of raw.matchAll(FENCE_RE)) {
    const contentStart = m.index + m[0].length - 3 - m[2].length;
    const lineBase = raw.slice(0, contentStart).split('\n').length;
    const r = scanText(m[2], label, lineBase);
    sites += r.sites;
    offenders.push(...r.offenders);
  }
  return { sites, offenders };
}

function scanTree() {
  const siteFiles = [];
  let sites = 0;
  let files = 0;
  const offenders = [];
  const scanFiles = (root, ext, scan) => {
    for (const file of walk(root, ext)) {
      files += 1;
      const rel = path.relative(ROOT, file).split(path.sep).join('/');
      const r = scan(readText(file), rel);
      if (r.sites > 0) siteFiles.push(rel);
      sites += r.sites;
      offenders.push(...r.offenders);
    }
  };
  scanFiles(BIN_ROOT, '.js', jsScan);
  scanFiles(SKILLS_ROOT, '.md', mdScan);
  return { siteFiles: siteFiles.sort(), sites, files, offenders };
}

test('AC6.1: every evaluateMaturation call under plugin/ passes the build label', () => {
  const { offenders } = scanTree();
  assert.deepEqual(offenders, []);
});

test('AC6.1 floor: the known call sites are still matched, and no other file calls evaluateMaturation', () => {
  const { siteFiles, sites, files } = scanTree();
  // A lower count means the matcher stopped matching, not that the calls went away.
  assert.ok(files >= 100, `expected the walk to cover at least 100 files, covered ${files}`);
  assert.ok(sites >= 4, `expected at least 4 evaluateMaturation call sites, matched ${sites}`);
  assert.deepEqual(siteFiles, [
    'plugin/bin/lib/console/resolve.js',
    'plugin/bin/lib/reconcile/console-execute.js',
    'plugin/skills/dispatch/grant-maturation-gate.md',
    'plugin/skills/wrap-up/auto-merge-short-circuit.md',
  ]);
});

test('AC6.1 go-red: a js call without hasBuildLabel is flagged at its line', () => {
  const r = jsScan('evaluateMaturation({ hasMergeLabel: true });\n', 'planted.js');
  assert.equal(r.sites, 1);
  assert.deepEqual(r.offenders, [
    "planted.js:1: evaluateMaturation call does not pass hasBuildLabel: <labels>.includes('auto:build')",
  ]);
  const later = jsScan('const x = 1;\nconst y = 2;\nconst r = evaluateMaturation({\n  hasPendingLabel: p,\n});\n', 'later.js');
  assert.equal(later.offenders.length, 1);
  assert.match(later.offenders[0], /^later\.js:3: /);
});

test('AC6.1 go-red: a hasBuildLabel whose value is not a label read is flagged', () => {
  assert.equal(jsScan('evaluateMaturation({ hasBuildLabel: true, hasMergeLabel: true });\n', 'const.js').offenders.length, 1);
  assert.equal(jsScan('evaluateMaturation({ hasBuildLabel, hasMergeLabel: true });\n', 'shorthand.js').offenders.length, 1);
  assert.equal(jsScan("evaluateMaturation({ hasMergeLabel: labels.includes('auto:build') });\n", 'wrong-key.js').offenders.length, 1);
  assert.equal(
    jsScan("evaluateMaturation({ hasMergeLabel: x, note: { hasBuildLabel: labels.includes('auto:build') } });\n", 'nested.js').offenders.length,
    1,
    'a hasBuildLabel nested in another property is not the call property',
  );
});

test('AC6.1 control: a call passing the label read in either spelling is clean, and the definition is not a site', () => {
  assert.deepEqual(
    jsScan("evaluateMaturation({ hasBuildLabel: labels.includes('auto:build'), hasMergeLabel: labels.includes('auto:merge') });\n", 'a.js'),
    { sites: 1, offenders: [] },
  );
  assert.deepEqual(
    jsScan("evaluateMaturation({\n  hasBuildLabel: (grant.labels || []).includes('auto:build'),\n  now: new Date(),\n});\n", 'b.js'),
    { sites: 1, offenders: [] },
  );
  assert.deepEqual(
    jsScan('function evaluateMaturation({ hasBuildLabel, hasPendingLabel } = {}) {\n  return hasBuildLabel;\n}\nmodule.exports = { evaluateMaturation };\n', 'def.js'),
    { sites: 0, offenders: [] },
  );
});

test('AC6.1 go-red: a call inside a js comment is not a site, and live code after a comment opener still is', () => {
  assert.deepEqual(jsScan('// evaluateMaturation({ hasMergeLabel: true })\nmodule.exports = {};\n', 'comment.js'), { sites: 0, offenders: [] });
  assert.deepEqual(jsScan('/* evaluateMaturation({ hasMergeLabel: true }) */\nmodule.exports = {};\n', 'block.js'), { sites: 0, offenders: [] });
  const after = jsScan("const g = 'a/*b'; // see work/*-spec.md\nevaluateMaturation({ hasMergeLabel: true });\n", 'after.js');
  assert.equal(after.sites, 1);
  assert.match(after.offenders[0], /^after\.js:2: /);
});

test('AC6.1 go-red: a markdown fence is judged on its own, and a CRLF copy gives the same verdict', () => {
  const md = [
    'Prose that says evaluateMaturation({ hasMergeLabel: true }) outside any fence.',
    '',
    '```bash',
    "const keys = labels.includes('auto:build');",
    '```',
    '',
    '```bash',
    'node -e "',
    '  evaluateMaturation({',
    '    hasMergeLabel: labels.includes(\'auto:merge\'),',
    '  });',
    '"',
    '```',
    '',
  ].join('\n');
  const lf = mdScan(md, 'split.md');
  assert.equal(lf.sites, 1, 'prose outside a fence is not a site');
  assert.equal(lf.offenders.length, 1, 'the build label in another fence must not satisfy this one');
  assert.match(lf.offenders[0], /^split\.md:9: /);
  const crlf = mdScan(md.replace(/\n/g, '\r\n'), 'crlf.md');
  assert.equal(crlf.sites, 1);
  assert.equal(crlf.offenders.length, 1);
  assert.match(crlf.offenders[0], /^crlf\.md:9: /);
});

test('AC6.1 control: a markdown fence that passes the label read is clean', () => {
  const ok = [
    '```bash',
    'node -e "',
    '  const result = evaluateMaturation({',
    "    hasBuildLabel: labels.includes('auto:build'),",
    "    hasPendingLabel: labels.includes('auto:merge-pending'),",
    '    now: new Date(),',
    '  });',
    '"',
    '```',
    '',
  ].join('\n');
  assert.deepEqual(mdScan(ok, 'ok.md'), { sites: 1, offenders: [] });
  assert.deepEqual(mdScan(ok.replace(/\n/g, '\r\n'), 'ok-crlf.md'), { sites: 1, offenders: [] });
});

test('AC6.1 go-red: the js checker reports a stripper mis-parse as an offender, never a clean scan', () => {
  // The brief's own shape: a regex right after `)` is read as division. Literal-keeping
  // mode leaves this line intact, so the matcher still flags the call.
  const kept = jsScan("if (b) /'/.test(b); evaluateMaturation({ hasMergeLabel: true });\n", 'kept.js');
  assert.deepEqual(kept.offenders, [
    "kept.js:1: evaluateMaturation call does not pass hasBuildLabel: <labels>.includes('auto:build')",
  ]);
  // The `//` inside the string the misread opens blanks the live call, which the
  // compile oracle catches.
  const planted = 'if (b) /"/.test(b); const c = "//"; evaluateMaturation({ hasMergeLabel: true });\n';
  assert.equal(stripperVerdict(planted, stripComments(planted)), 'misparsed');
  const r = jsScan(planted, 'misparsed.js');
  assert.equal(r.offenders.length, 1);
  assert.ok(r.offenders[0].includes(STRIPPER_VERDICT_MESSAGES.misparsed));
});

test('AC6.1 go-red: a spaced call, an optional-chaining call and a variable argument are each flagged at their line', () => {
  const notObject = (line, file) => `${file}:${line}: evaluateMaturation call whose first argument is not an object literal cannot be checked for hasBuildLabel`;
  assert.deepEqual(jsScan('const a = 1;\nevaluateMaturation ({ hasMergeLabel: true });\n', 'spaced.js').offenders, [
    "spaced.js:2: evaluateMaturation call does not pass hasBuildLabel: <labels>.includes('auto:build')",
  ]);
  assert.deepEqual(jsScan('const a = 1;\nconst b = 2;\nm.evaluateMaturation?.({ hasMergeLabel: true });\n', 'optional.js').offenders, [
    "optional.js:3: evaluateMaturation call does not pass hasBuildLabel: <labels>.includes('auto:build')",
  ]);
  assert.deepEqual(jsScan('const args = {};\nconst r = evaluateMaturation(args);\n', 'variable.js').offenders, [notObject(2, 'variable.js')]);
  assert.deepEqual(jsScan('evaluateMaturation?.(args);\n', 'optvar.js').offenders, [notObject(1, 'optvar.js')]);
  // The spellings in a markdown fence, each at its own line.
  const md = ['```bash', 'evaluateMaturation (args)', 'evaluateMaturation?.({ a: 1 })', '```', ''].join('\n');
  assert.deepEqual(mdScan(md, 'f.md').offenders, [
    notObject(2, 'f.md'),
    "f.md:3: evaluateMaturation call does not pass hasBuildLabel: <labels>.includes('auto:build')",
  ]);
  // A compliant spaced call is clean.
  assert.deepEqual(jsScan("evaluateMaturation ({ hasBuildLabel: labels.includes('auto:build') });\n", 'okspaced.js'), { sites: 1, offenders: [] });
});

test('AC6.1 go-red: a tilde fence is read, and a CRLF copy gives the same verdict', () => {
  const md = ['~~~bash', 'evaluateMaturation({ hasMergeLabel: true })', '~~~', ''].join('\n');
  const lf = mdScan(md, 'tilde.md');
  assert.equal(lf.sites, 1);
  assert.match(lf.offenders[0], /^tilde\.md:2: /);
  const crlf = mdScan(md.replace(/\n/g, '\r\n'), 'tilde-crlf.md');
  assert.equal(crlf.sites, 1);
  assert.deepEqual(crlf.offenders, [
    "tilde-crlf.md:2: evaluateMaturation call does not pass hasBuildLabel: <labels>.includes('auto:build')",
  ]);
});

test('AC6.1 go-red: a call whose braces never balance is an offender at its line', () => {
  // Raw markdown is not compiled, so an unterminated object reaches the matcher.
  const md = ['```bash', 'evaluateMaturation({ hasMergeLabel: true', '```', ''].join('\n');
  const r = mdScan(md, 'open.md');
  assert.equal(r.sites, 1);
  assert.deepEqual(r.offenders, ['open.md:2: evaluateMaturation({ call whose braces never balance']);
});
