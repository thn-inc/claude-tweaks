'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { readText } = require('./helpers/read-skill');
const { POLICY_KEYS, resolveValue } = require('../plugin/bin/lib/policy-schema');

const ROOT = path.join(__dirname, '..');
const RESOLVER = path.join(ROOT, 'plugin', 'bin', 'resolve-policy.js');

function resolveIn(policyText) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'declare-ct-'));
  try {
    if (policyText !== null) {
      fs.mkdirSync(path.join(dir, '.claude-tweaks'));
      fs.writeFileSync(path.join(dir, '.claude-tweaks', 'policy.yml'), policyText);
    }
    return execFileSync(process.execPath, [RESOLVER, '--values', 'declare-claude-tweaks'], { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('AC1.2: declare-claude-tweaks is a boolean row defaulting true', () => {
  const row = POLICY_KEYS.find((r) => r.key === 'declare-claude-tweaks');
  assert.ok(row, 'declare-claude-tweaks missing from POLICY_KEYS');
  assert.strictEqual(row.type, 'boolean');
  assert.strictEqual(row.default, true);
  assert.strictEqual(row.tier, 'advanced');
  assert.strictEqual(resolveValue('declare-claude-tweaks', undefined), true);
});

test('AC1.2: unset resolves true, false resolves false, malformed resolves true', () => {
  assert.strictEqual(resolveIn(null), 'true');
  assert.strictEqual(resolveIn('declare-claude-tweaks: false\n'), 'false');
  assert.strictEqual(resolveIn('declare-claude-tweaks: off\n'), 'true');
});

const STEP14 = readText(path.join(ROOT, 'plugin', 'skills', 'init', 'bootstrap', 'step-14-cloud-routine-parity.md'));
const INIT_SKILL = readText(path.join(ROOT, 'plugin', 'skills', 'init', 'SKILL.md'));
const collapse = (s) => s.replace(/\s+/g, ' ');

function extractTemplate(md) {
  const m = md.match(/```bash\r?\n(#!\/usr\/bin\/env bash[\s\S]*?)\r?\n```/);
  assert.ok(m, 'setup-script template fence not found');
  return m[1];
}

// Renders the template the way Step 14's prose says to: optedOut drops the bracketed
// declaration region and the PLUGIN_SPECS entry; both modes drop every `# (authoring: …)`
// note (a note may wrap: it runs through the first line ending in `)`). Plain `# (` comments
// are real script comments and stay.
function renderTemplate(template, { optedOut }) {
  let lines = template.split(/\r?\n/);
  if (optedOut) {
    const begin = lines.findIndex((l) => l.startsWith('# (authoring: begin claude-tweaks declaration'));
    const end = lines.findIndex((l) => l === '# (authoring: end claude-tweaks declaration)');
    assert.ok(begin !== -1 && end > begin, 'claude-tweaks declaration markers missing');
    lines = [...lines.slice(0, begin), ...lines.slice(end + 1)];
  }
  const out = [];
  let inNote = false;
  for (const l of lines) {
    if (!inNote && l.startsWith('# (authoring:')) inNote = !l.trimEnd().endsWith(')');
    else if (inNote) inNote = !l.trimEnd().endsWith(')');
    else out.push(optedOut && l.startsWith('PLUGIN_SPECS=') ? l.replace('claude-tweaks@claude-tweaks-marketplace ', '') : l);
  }
  return out.join('\n');
}

const TEMPLATE = extractTemplate(STEP14);

function assertDefaultRender(render) {
  const lost = 'default render lost a real script line';
  const lines = render.split('\n');
  const lostMsg = (what) => `${lost}: ${what}`;
  for (const needle of [
    'claude plugin marketplace add thn-inc/claude-tweaks-marketplace',
    'claude plugin marketplace update claude-tweaks-marketplace',
    'VERDICT=$(node -e',
    'npm install -g @playwright/cli',
    '# (claude-tweaks #129:',
    '# (/stories, /visual-review,',
  ]) {
    assert.ok(render.includes(needle), lostMsg(needle));
  }
  assert.ok(lines.includes('PLUGIN_SPECS="claude-tweaks@claude-tweaks-marketplace superpowers@claude-plugins-official"'), lostMsg('PLUGIN_SPECS line'));
  assert.ok(!lines.some((l) => l.startsWith('# (authoring:')), 'default render still carries an authoring note');
  assert.ok(!lines.some((l) => l.startsWith('# a matching') || l.startsWith('# enabledPlugins lists them')), 'default render kept a wrapped authoring-note continuation');
}

function assertOptedOut(render) {
  const lines = render.split('\n');
  assert.ok(!render.includes('claude-tweaks-marketplace'), 'opted-out render still names claude-tweaks-marketplace');
  assert.ok(lines.includes('PLUGIN_SPECS="superpowers@claude-plugins-official"'), 'opted-out PLUGIN_SPECS is not superpowers alone');
  assert.ok(render.includes('claude plugin marketplace add anthropics/claude-plugins-official'), 'opted-out render lost the claude-plugins-official add');
  assert.ok(render.includes('claude plugin marketplace update claude-plugins-official'), 'opted-out render lost the claude-plugins-official update');
  lines.forEach((l, i) => {
    if (l.endsWith('\\') && i + 1 < lines.length) {
      assert.ok(/^\s/.test(lines[i + 1]), 'opted-out render left a dangling line continuation at line ' + (i + 1));
    }
  });
}

test('AC1.1: default render keeps both claude-tweaks marketplace lines, both specs and the real script', () => {
  assertDefaultRender(renderTemplate(TEMPLATE, { optedOut: false }));
});

test('template extraction survives a CRLF checkout', () => {
  assert.strictEqual(extractTemplate(STEP14.replace(/\n/g, '\r\n')).replace(/\r/g, ''), TEMPLATE);
});

test('Review Focus (render keeps real comments) go-red', () => {
  // The mutated note is one complete `# (authoring: …)` line, so it closes on its own line and
  // swallows nothing after it: the only thing the render loses is the pinned needle.
  const realLine = '# (claude-tweaks #129: a Routine ran a build predating a shipped fix for days, reporting the';
  assert.ok(TEMPLATE.includes(realLine), 'the #129 comment line moved; update this control');
  const copy = TEMPLATE.replace(realLine, '# (authoring: a Routine ran a build predating a shipped fix for days)');
  assert.notEqual(copy, TEMPLATE);
  const exact = 'default render lost a real script line: # (claude-tweaks #129:';
  assert.throws(() => assertDefaultRender(renderTemplate(copy, { optedOut: false })), (err) => err.message === exact);
});

test('AC2.1/AC2.2: opted-out render has no claude-tweaks-marketplace line', () => {
  assertOptedOut(renderTemplate(TEMPLATE, { optedOut: true }));
});

test('AC2.1 go-red: the opted-out assertion catches a surviving claude-tweaks line', () => {
  const render = renderTemplate(TEMPLATE, { optedOut: false });
  assert.throws(() => assertOptedOut(render), { message: /opted-out render still names claude-tweaks-marketplace/ });
});

test('AC2.2 go-red: the render keeps the region without its end marker', () => {
  const marker = '# (authoring: end claude-tweaks declaration)';
  const doctored = TEMPLATE.split(/\r?\n/).filter((l) => l !== marker).join('\n');
  assert.notEqual(doctored, TEMPLATE);
  assert.throws(() => renderTemplate(doctored, { optedOut: true }), { message: /claude-tweaks declaration markers missing/ });
});

test('AC2.1: Apply never adds or re-adds claude-tweaks under the opt-out', () => {
  const text = collapse(STEP14);
  for (const literal of [
    'Under `declare-claude-tweaks: false`, add only `superpowers@claude-plugins-official: true` (plus the selected mirrors) and skip the `claude-tweaks-marketplace` entry below — never add or re-add either claude-tweaks entry.',
    'An entry the project already carries stays as it is, per the non-destructive merge; removing it is the maintainer\'s edit, not this step\'s.',
    'so the generated script carries no `claude-tweaks-marketplace` line',
    'the key, not the entry, decides what the script installs',
  ]) {
    assert.ok(text.includes(literal), 'missing: ' + literal);
  }
});

test('Present follow-up reads superpowers alone under the opt-out', () => {
  assert.ok(collapse(STEP14).includes('"the two candidates that are always-included" in this paragraph, read as superpowers alone'));
});

test('AC4.1 / Review Focus 1: Opt-out keeps superpowers and excludes claude-tweaks from mirrors', () => {
  const paragraphs = STEP14.split(/\r?\n\r?\n/).filter((p) => p.startsWith('**Opt-out.**'));
  assert.strictEqual(paragraphs.length, 1);
  const para = collapse(paragraphs[0]);
  assert.ok(para.includes('is then this step\'s only hard requirement'));
  assert.ok(para.includes('exclude it from the mirror candidates too'));
});

test('Review Focus 5: idempotent re-run counts superpowers alone as complete', () => {
  assert.ok(collapse(STEP14).includes('already declares every hard requirement (both, or superpowers alone under `declare-claude-tweaks: false`)'));
});

// The remaining copy edits, each pinned by the literal the edit inserts; the per-fact control
// strips one fact at a time and the same predicate must report exactly that fact.
const COPY_FACTS = [
  ['Detect hard-requirement qualifier', STEP14, 'are this step\'s two hard requirements (one — superpowers — under the Opt-out above)'],
  ['Opt-out reads the key once, before either settings file', STEP14, 'Resolve `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks` once, before reading either settings file.'],
  ['Present options read as superpowers alone', STEP14, 'every "claude-tweaks + superpowers" and "claude-tweaks and superpowers" phrase in the options above, and "the two hard deps"'],
  ['header comment names the key', STEP14, '# declare-claude-tweaks: false in .claude-tweaks/policy.yml leaves claude-tweaks out of this script.'],
  ['authoring notes are never written out', STEP14, 'Every `# (authoring: …)` note in the template is an authoring note, never written into the generated script; every other comment, `# (claude-tweaks #129: …` included, is written as it stands.'],
  ['opted-out script omits the declaration region', STEP14, 'also omit the lines between the begin and end claude-tweaks declaration notes, and drop `claude-tweaks@claude-tweaks-marketplace` from `PLUGIN_SPECS`'],
  ['Anti-Patterns row names the key', INIT_SKILL, 'Regenerated on every `/init` run from `.claude/settings.json` (and `declare-claude-tweaks`)'],
];

function missingFacts(facts) {
  return facts.filter(([, text, literal]) => !collapse(text).includes(literal)).map(([name]) => name);
}

test('Step 14 and init SKILL carry every remaining declare-claude-tweaks copy edit', () => {
  assert.deepStrictEqual(missingFacts(COPY_FACTS), []);
  for (const [name, text, literal] of COPY_FACTS) {
    const doctored = collapse(text).replace(literal, '');
    assert.notEqual(doctored, collapse(text), name);
    assert.deepStrictEqual(missingFacts(COPY_FACTS.map((f) => (f[0] === name ? [name, doctored, literal] : f))), [name]);
  }
});
