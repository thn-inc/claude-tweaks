'use strict';
// tests/component-return-to-caller-conformance.test.js — pins #4117: an inline-invoked
// component mode that ends on a bare "Output ONLY these lines" render must say, right after
// the render template, that control returns to the caller and the caller's next step runs in
// the same turn. Without it a model rendered ceremony-check's verdict as its whole reply and
// ended /flow's Manifesto turn before config.yml was written.
// Also sweeps every `## Output to caller` section (design-wrapper's mode return contracts):
// the line must close the section, after its last shape block.
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
const OUTPUT_TO_CALLER_RE = /^## Output to caller[ \t]*$/m;
// Inline-invoked modes that end on a bare render, whether or not they say "Output ONLY".
const ROSTER = [
  'assess-agent-autonomy/ceremony-check.md',
  'assess-agent-autonomy/failure-check.md',
  'assess-agent-autonomy/grant-check.md',
  'assess-agent-autonomy/merge-check.md',
  'challenge/SKILL.md',
];

function collapse(s) {
  return s.replace(/\s+/g, ' ');
}

// The shipped line is one physical line on its own: every placement and sweep predicate matches it
// that way, so a hard-wrapped or inlined copy is reported rather than tolerated by one and not another.
const LINE_RE = new RegExp(`^${RETURN_LINE.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[ \\t]*$`, 'm');

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

function sortedFilesWhere(corpus, predicate) {
  return [...corpus].filter(([, text]) => predicate(text)).map(([rel]) => rel).sort();
}

function outputOnlyFiles(corpus) {
  return sortedFilesWhere(corpus, (text) => text.includes(OUTPUT_ONLY));
}

function outputToCallerFiles(corpus) {
  return sortedFilesWhere(corpus, (text) => OUTPUT_TO_CALLER_RE.test(text));
}

function lacksLine(text) {
  return !LINE_RE.test(text);
}

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
  const line = LINE_RE.exec(section)?.index ?? -1;
  return open !== -1 && close !== -1 && line !== -1 && line > close;
}

// The single `## Output to caller` heading's section, up to the next `#`/`##` heading; the
// last section of a file runs to end of file (explicit fallback).
function outputSection(text) {
  const headings = [...text.matchAll(/^## Output to caller[ \t]*$/gm)];
  if (headings.length !== 1) throw new Error(`expected exactly one Output to caller heading, found ${headings.length}`);
  const rest = text.slice(headings[0].index + headings[0][0].length);
  const next = rest.search(/^#{1,2} /m);
  return next === -1 ? rest : rest.slice(0, next);
}

// The line must follow every shape block: after the section's last fence.
function outputSectionOk(text) {
  let section;
  try { section = outputSection(text); } catch { return false; }
  const line = LINE_RE.exec(section)?.index ?? -1;
  const lastFence = section.lastIndexOf('```');
  return line !== -1 && lastFence !== -1 && line > lastFence;
}

function offenders(corpus) {
  const bad = new Set(outputOnlyFiles(corpus).filter((rel) => lacksLine(corpus.get(rel))));
  for (const rel of ROSTER) {
    const text = corpus.get(rel);
    if (text === undefined || !placementOk(text)) bad.add(rel);
  }
  for (const rel of outputToCallerFiles(corpus)) {
    if (!outputSectionOk(corpus.get(rel))) bad.add(rel);
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
  const targets = [...new Set([...outputOnlyFiles(CORPUS), ...ROSTER, ...outputToCallerFiles(CORPUS)])].sort();
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

const DESIGN_WRAPPER_MODES = ['doctor', 'explore', 'live', 'polish', 'pre-build', 'reset-recommendations', 'review', 'shape', 'survey', 'test']
  .map((mode) => `design-wrapper/modes/${mode}.md`);

test('Output to caller: every design-wrapper return contract carries the line after its last shape', () => {
  const files = outputToCallerFiles(CORPUS);
  assert.ok(files.length >= 10, `sweep found only ${files.length} "## Output to caller" files — haystack is vacuous`);
  for (const rel of DESIGN_WRAPPER_MODES) {
    assert.ok(files.includes(rel), `expected ${rel} in the "## Output to caller" sweep`);
  }
  assert.deepEqual(offenders(CORPUS), []);
});

test('Output to caller placement go-red: the line moved above the last shape block is rejected', () => {
  const rel = 'design-wrapper/modes/test.md';
  const original = CORPUS.get(rel);
  assert.equal(outputSectionOk(original), true);
  const heading = original.match(OUTPUT_TO_CALLER_RE)[0];
  const permuted = original.replace(`\n${RETURN_LINE}\n`, '\n').replace(heading, `${heading}\n\n${RETURN_LINE}\n`);
  assert.notEqual(permuted, original);
  assert.equal(outputSectionOk(permuted), false);
  assert.deepEqual(offenders(new Map(CORPUS).set(rel, permuted)), [rel]);
});

test('malformed shapes fail closed: a missing or doubled heading is rejected, never skipped', () => {
  const fenced = '```\nX: y\n```\n';
  assert.equal(placementOk(`intro\n\n${fenced}\n${RETURN_LINE}\n`), false, 'no Step 3: Render heading');
  assert.equal(placementOk(`## Step 3: Render\n\n${fenced}\n## Step 3: Render\n\n${fenced}\n${RETURN_LINE}\n`), false, 'two Step 3: Render headings');
  assert.equal(outputSectionOk(`intro\n\n${fenced}\n${RETURN_LINE}\n`), false, 'no Output to caller heading');
  assert.equal(outputSectionOk(`## Output to caller\n\n${fenced}\n## Output to caller\n\n${fenced}\n${RETURN_LINE}\n`), false, 'two Output to caller headings');
});

test('own-line match: a hard-wrapped or inlined copy of the line is reported by every predicate', () => {
  const wrapped = RETURN_LINE.replace('control returns', 'control\nreturns');
  const inlined = `Note: ${RETURN_LINE}`;
  const fenced = '```\nX: y\n```\n';
  for (const [name, variant] of [['wrapped', wrapped], ['inlined', inlined]]) {
    assert.equal(lacksLine(`Output ONLY these lines:\n\n${fenced}\n${variant}\n`), true, `${name}: sweep`);
    assert.equal(placementOk(`## Step 3: Render\n\n${fenced}\n${variant}\n`), false, `${name}: render placement`);
    assert.equal(outputSectionOk(`## Output to caller\n\n${fenced}\n${variant}\n`), false, `${name}: output section`);
  }
});

test('walker go-red: a nested "Output ONLY" file without the line is found and reported', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-return-to-caller-'));
  try {
    fs.mkdirSync(path.join(dir, 'a', 'b'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a', 'b', 'mode.md'), '## Step 3: Render\n\nOutput ONLY these lines, no preamble:\n\n```\nX: y\n```\n');
    fs.mkdirSync(path.join(dir, 'a', 'c'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'a', 'c', 'ret.md'), '## Output to caller\n\n```json\n{}\n```\n');
    fs.writeFileSync(path.join(dir, 'a', 'ok.md'), `Output ONLY these lines:\n\n\`\`\`\nX: y\n\`\`\`\n\n${RETURN_LINE}\n`);
    const corpus = walkMarkdown(dir);
    assert.deepEqual(outputOnlyFiles(corpus), ['a/b/mode.md', 'a/ok.md']);
    assert.deepEqual(outputOnlyFiles(corpus).filter((rel) => lacksLine(corpus.get(rel))), ['a/b/mode.md']);
    assert.deepEqual(outputToCallerFiles(corpus), ['a/c/ret.md']);
    assert.equal(outputSectionOk(corpus.get('a/c/ret.md')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const DOC = readText(path.join(ROOT, 'docs', 'skill-authoring.md'));
const DOC_FACTS = {
  heading: '**Return to caller after a bare render.**',
  line: RETURN_LINE,
  placement: 'immediately after the render template',
};

function componentContractRegion(text) {
  const start = text.indexOf('- **Component-skill contract**');
  const end = text.indexOf('- **Next Actions placement**');
  if (start === -1 || end === -1 || end < start) throw new Error('Component-skill contract bullet anchors not found');
  return text.slice(start, end);
}

function missingDocFacts(text) {
  const region = collapse(componentContractRegion(text));
  return Object.entries(DOC_FACTS).filter(([, needle]) => !region.includes(collapse(needle))).map(([name]) => name);
}

test('AC2.1: docs/skill-authoring.md Component-skill contract states the return-to-caller convention', () => {
  assert.deepEqual(missingDocFacts(DOC), []);
});

test('AC2.1 go-red: stripping any one convention fact reports exactly that fact', () => {
  const region = componentContractRegion(DOC);
  for (const [name, needle] of Object.entries(DOC_FACTS)) {
    const strippedRegion = region.replace(needle, '');
    assert.notEqual(strippedRegion, region, `${name}: the strip matched nothing`);
    assert.deepEqual(missingDocFacts(DOC.replace(region, () => strippedRegion)), [name]);
  }
});

module.exports = { RETURN_LINE, collapse };
