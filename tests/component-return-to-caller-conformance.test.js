'use strict';
// tests/component-return-to-caller-conformance.test.js — pins #4117: an inline-invoked
// component mode that ends on a bare "Output ONLY these lines" render must say, right after
// the render template, that control returns to the caller and the caller's next step runs in
// the same turn. Without it a model rendered ceremony-check's verdict as its whole reply and
// ended /flow's Manifesto turn before config.yml was written.
// Reads the live corpus on purpose: this is a convention enforced against every future
// addition (skill-prose-conformance-tests' Decision Framework), never a frozen fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');

const RETURN_LINE = '**Return to caller:** this output is consumed by the calling skill — control returns to the caller, whose next step runs in this same turn; never end the turn on this render.';
const OUTPUT_ONLY = 'Output ONLY';
// Inline-invoked modes that end on a bare render, whether or not they say "Output ONLY".
const ROSTER = [
  'assess-agent-autonomy/ceremony-check.md',
  'assess-agent-autonomy/failure-check.md',
  'assess-agent-autonomy/grant-check.md',
  'assess-agent-autonomy/merge-check.md',
  'challenge/SKILL.md',
];

const collapse = (s) => s.replace(/\s+/g, ' ');

function walkMarkdown(root) {
  const corpus = new Map();
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) visit(abs);
      else if (entry.name.endsWith('.md')) {
        corpus.set(path.relative(root, abs).split(path.sep).join('/'), readText(abs));
      }
    }
  };
  visit(root);
  return corpus;
}

function outputOnlyFiles(corpus) {
  return [...corpus].filter(([, text]) => text.includes(OUTPUT_ONLY)).map(([rel]) => rel).sort();
}

const lacksLine = (text) => !collapse(text).includes(collapse(RETURN_LINE));

// The single `## Step 3: Render` / `### Step 3: Render` heading's section, up to the next
// heading of any level; the last section of a file runs to end of file (explicit fallback).
function renderSection(text) {
  const headings = [...text.matchAll(/^#{2,3} Step 3: Render[ \t]*$/gm)];
  if (headings.length !== 1) throw new Error(`expected exactly one Step 3: Render heading, found ${headings.length}`);
  const start = headings[0].index + headings[0][0].length;
  const rest = text.slice(start);
  const next = rest.search(/^#{1,6} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

// The line must sit inside the render section, after the render template's closing fence.
function placementOk(text) {
  let section;
  try { section = renderSection(text); } catch { return false; }
  const open = section.indexOf('```');
  const close = open === -1 ? -1 : section.indexOf('```', open + 3);
  const line = section.indexOf(RETURN_LINE);
  return open !== -1 && close !== -1 && line !== -1 && line > close;
}

function offenders(corpus) {
  const bad = new Set(outputOnlyFiles(corpus).filter((rel) => lacksLine(corpus.get(rel))));
  for (const rel of ROSTER) {
    const text = corpus.get(rel);
    if (text === undefined || !placementOk(text)) bad.add(rel);
  }
  return [...bad].sort();
}

const CORPUS = walkMarkdown(SKILLS);

test('AC1.1: every plugin/skills/**/*.md containing "Output ONLY" carries the return-to-caller line', () => {
  const files = outputOnlyFiles(CORPUS);
  assert.ok(files.length >= 3, `sweep found only ${files.length} "Output ONLY" files — haystack is vacuous`);
  for (const rel of ['assess-agent-autonomy/ceremony-check.md', 'assess-agent-autonomy/grant-check.md', 'challenge/SKILL.md']) {
    assert.ok(files.includes(rel), `expected ${rel} in the "Output ONLY" sweep`);
  }
  assert.deepEqual(files.filter((rel) => lacksLine(CORPUS.get(rel))), []);
});

test('roster: each inline mode carries the line in its Step 3 Render section, after the render fence', () => {
  assert.deepEqual(offenders(CORPUS), []);
});

test('AC1.1 go-red: removing the line from any one file reports exactly that file', () => {
  const targets = [...new Set([...outputOnlyFiles(CORPUS), ...ROSTER])].sort();
  assert.ok(targets.length >= ROSTER.length);
  for (const rel of targets) {
    const original = CORPUS.get(rel);
    const mutated = original.replace(RETURN_LINE, '');
    assert.notEqual(mutated, original, `${rel}: the strip matched nothing`);
    const corpus = new Map(CORPUS).set(rel, mutated);
    assert.deepEqual(offenders(corpus), [rel], `${rel}: removal must be reported as exactly this file`);
  }
});

test('placement go-red: the line moved above the render fence is rejected', () => {
  const rel = 'assess-agent-autonomy/ceremony-check.md';
  const original = CORPUS.get(rel);
  assert.equal(placementOk(original), true);
  const heading = original.match(/^#{2,3} Step 3: Render[ \t]*$/m)[0];
  const permuted = original.replace(`\n${RETURN_LINE}\n`, '\n').replace(heading, `${heading}\n\n${RETURN_LINE}\n`);
  assert.notEqual(permuted, original);
  assert.equal(placementOk(permuted), false);
  assert.deepEqual(offenders(new Map(CORPUS).set(rel, permuted)), [rel]);
});

test('walker go-red: a nested "Output ONLY" file without the line is found and reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-return-to-caller-'));
  try {
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a', 'b', 'mode.md'), '## Step 3: Render\n\nOutput ONLY these lines, no preamble:\n\n```\nX: y\n```\n');
    fs.writeFileSync(path.join(dir, 'a', 'ok.md'), `Output ONLY these lines:\n\n\`\`\`\nX: y\n\`\`\`\n\n${RETURN_LINE}\n`);
    const corpus = walkMarkdown(dir);
    assert.deepEqual(outputOnlyFiles(corpus), ['a/b/mode.md', 'a/ok.md']);
    assert.deepEqual(outputOnlyFiles(corpus).filter((rel) => lacksLine(corpus.get(rel))), ['a/b/mode.md']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

module.exports = { RETURN_LINE, collapse };
