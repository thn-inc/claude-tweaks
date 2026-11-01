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
  ['Apply ensures the marketplace entry unless opted out', STEP14, 'always (unless opted out above) ensure a `claude-tweaks-marketplace` entry'],
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

// /routine fleet's cloud-parity check (Task 3): sliced by heading, both anchors asserted.
const FLEET = readText(path.join(ROOT, 'plugin', 'skills', 'routine', 'fleet.md'));

function fleetSlice(text, from, to, label) {
  const start = text.indexOf(from);
  const end = start === -1 ? -1 : text.indexOf(to, start + from.length);
  assert.ok(start !== -1 && end !== -1, label + ' anchors missing');
  return collapse(text.slice(start, end));
}

const fleetStep2 = (text) => fleetSlice(text, '## Step 2 — Cloud-parity honesty check', '## Step 3 —', 'fleet Step 2');
const fleetStep5 = (text) => fleetSlice(text, '## Step 5 — Fleet summary', '\n## Fleet status (aggregation)', 'fleet Step 5');
// (the next heading after Step 5 is named, not matched as "\n## ": Step 5's own fenced template opens with a "## Fleet: Provisioning Complete" line)

const FLEET_OPT_OUT_LINE = '`Cloud parity: declare-claude-tweaks is false, so this project does not declare claude-tweaks for cloud firings — they will not have claude-tweaks installed by the project declaration, and fleet routines need it installed in the sandbox some other way.`';

function assertFleetOptOut(text) {
  assert.ok(fleetStep2(text).includes(FLEET_OPT_OUT_LINE), 'fleet opt-out print line missing');
}

test('AC3.1/AC3.2: opted-out fleet check prints the informational line naming the cloud consequence', () => {
  assertFleetOptOut(FLEET);
});

const FLEET_REPLACES_FIRST = 'At `false`, Step 5\'s opt-out "OK" alternative replaces the first one, kept entry or not.';

function assertFleetReplacesFirst(text) {
  assert.ok(fleetStep2(text).includes(FLEET_REPLACES_FIRST), 'fleet replaces-first sentence missing');
}

test('AC3.1: at false the opt-out OK alternative replaces the first one', () => {
  assertFleetReplacesFirst(FLEET);
  const doctored = FLEET.replace(FLEET_REPLACES_FIRST, '');
  assert.notEqual(doctored, FLEET);
  assert.throws(() => assertFleetReplacesFirst(doctored), { message: /fleet replaces-first sentence missing/ });
});

test('AC3.1: a missing claude-tweaks declaration is no gap under the opt-out', () => {
  const step2 = fleetStep2(FLEET);
  for (const literal of [
    'a missing claude-tweaks declaration is no gap and never reaches item 3\'s prompt',
    'Step 14\'s setup script leaves claude-tweaks out at `false` even when a kept claude-tweaks entry remains, so print this line at `false` whatever items 2-3 find',
    '`node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks`',
    'only item 1\'s opt-out line prints, when it applies',
  ]) {
    assert.ok(step2.includes(literal), 'missing: ' + literal);
  }
  const step5Literal = '"OK — superpowers declared, setup script present; declare-claude-tweaks is false, so cloud firings will not have claude-tweaks installed by the project declaration, and fleet routines need it installed in the sandbox some other way."';
  assert.ok(fleetStep5(FLEET).includes(step5Literal), 'missing: ' + step5Literal);
});

test('AC4.1 / Review Focus 4: superpowers stays required and gaps still prompt', () => {
  const step2 = fleetStep2(FLEET);
  assert.ok(step2.includes('only `superpowers@claude-plugins-official` must be declared'));
  assert.ok(step2.includes('If either check fails, report the specific gap'));
});

test('AC3.2 go-red: the opt-out line guard fails when the print line is stripped', () => {
  const doctored = FLEET.replace(FLEET_OPT_OUT_LINE.slice(1, -1), '');
  assert.notEqual(doctored, FLEET);
  assert.throws(() => assertFleetOptOut(doctored), { message: /fleet opt-out print line missing/ });
  const noAnchor = FLEET.replace('## Step 2 — Cloud-parity honesty check', '## Step 2 — renamed');
  assert.notEqual(noAnchor, FLEET);
  assert.throws(() => assertFleetOptOut(noAnchor), { message: /fleet Step 2 anchors missing/ });
});

test('AC1.1: default fleet path unchanged', () => {
  const step2 = fleetStep2(FLEET);
  assert.ok(step2.includes('confirm `claude-tweaks@claude-tweaks-marketplace` and `superpowers@claude-plugins-official` are both declared'));
  assert.ok(step2.includes('Both checks passing is a silent pass-through'));
  assert.ok(step2.includes('At `true` (the default) the check is as written'), 'missing: the default-branch sentence');
});

// Ordering pins (final review): each marker must exist, then positions must increase. The
// existence half is asserted first so a reworded marker (indexOf -1) cannot pass as "earlier".
function requireOrder(text, markers, label) {
  let last = -1;
  let prev = null;
  for (const m of markers) {
    const idx = text.indexOf(m);
    assert.notStrictEqual(idx, -1, `${label}: marker missing: ${m}`);
    assert.ok(idx > last, `${label}: ${m} must come after ${prev}`);
    last = idx;
    prev = m;
  }
}

const FLEET_RESOLVE_SENTENCE = 'First resolve `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values declare-claude-tweaks`.';
const FLEET_CHECK_SENTENCE = 'Run the same declaration check `skills/init/bootstrap/step-14-cloud-routine-parity.md`\'s Detect section runs: read this project\'s `.claude/settings.json#enabledPlugins`, confirm `claude-tweaks@claude-tweaks-marketplace` and `superpowers@claude-plugins-official` are both declared.';
const FLEET_AT_TRUE_SENTENCE = 'At `true` (the default) the check is as written.';
const fleetItem1Order = (step2) => requireOrder(step2, [FLEET_RESOLVE_SENTENCE, FLEET_CHECK_SENTENCE, FLEET_AT_TRUE_SENTENCE], 'fleet Step 2 item 1');

test('F5: fleet Step 2 item 1 resolves the key before the declaration check it qualifies', () => {
  const step2 = fleetStep2(FLEET);
  fleetItem1Order(step2);
  // Permutation control: both sentences are present, the check now leads the resolve.
  const swapped = step2.replace(`${FLEET_RESOLVE_SENTENCE} ${FLEET_CHECK_SENTENCE}`, `${FLEET_CHECK_SENTENCE} ${FLEET_RESOLVE_SENTENCE}`);
  assert.notEqual(swapped, step2);
  assert.throws(() => fleetItem1Order(swapped), { message: /must come after/ });
  // Second permutation control: the `At true` sentence now sits before the check it follows.
  const atTrueFirst = step2.replace(`${FLEET_CHECK_SENTENCE} ${FLEET_AT_TRUE_SENTENCE}`, `${FLEET_AT_TRUE_SENTENCE} ${FLEET_CHECK_SENTENCE}`);
  assert.notEqual(atTrueFirst, step2);
  assert.throws(() => fleetItem1Order(atTrueFirst), { message: /At `true` \(the default\) the check is as written\. must come after Run the same declaration check/ });
  // Deletion control: the existence half goes red on its own message.
  const missing = step2.replace(FLEET_RESOLVE_SENTENCE, '');
  assert.notEqual(missing, step2);
  assert.throws(() => fleetItem1Order(missing), { message: /marker missing/ });
});

// Step 14 authoring notes and Apply wording the final review found unpinned.
const PLUGIN_SPECS_NOTE = '# (authoring: when declare-claude-tweaks resolves false, drop claude-tweaks@claude-tweaks-marketplace from PLUGIN_SPECS)';

function assertPluginSpecsNote(template) {
  assert.ok(template.split(/\r?\n/).includes(PLUGIN_SPECS_NOTE), 'PLUGIN_SPECS opt-out authoring note missing from the template');
}

test('F3a: the template carries the PLUGIN_SPECS opt-out authoring note as its own line', () => {
  assertPluginSpecsNote(TEMPLATE);
  const stripped = TEMPLATE.split(/\r?\n/).filter((l) => l !== PLUGIN_SPECS_NOTE).join('\n');
  assert.notEqual(stripped, TEMPLATE);
  assert.throws(() => assertPluginSpecsNote(stripped), { message: /PLUGIN_SPECS opt-out authoring note missing/ });
});

const OPT_OUT_PARAGRAPH = '**Opt-out.** Resolve';
const DETECT_PARAGRAPH = '**Detect.** Read the current project';
const step14OptOutOrder = (text) => requireOrder(collapse(text), [OPT_OUT_PARAGRAPH, DETECT_PARAGRAPH], 'Step 14');

test('F3c: Step 14 states the Opt-out paragraph before the Detect paragraph', () => {
  step14OptOutOrder(STEP14);
  const paragraphs = STEP14.split(/\r?\n\r?\n/);
  const optIdx = paragraphs.findIndex((p) => p.startsWith('**Opt-out.**'));
  const detIdx = paragraphs.findIndex((p) => p.startsWith('**Detect.**'));
  assert.ok(optIdx !== -1 && detIdx > optIdx, 'Opt-out/Detect paragraphs not found in live order');
  assert.strictEqual(paragraphs.filter((p) => p.startsWith('**Opt-out.**') || p.startsWith('**Detect.**')).length, 2);
  // Permutation control: swap the two whole paragraphs, so both markers survive in the wrong order.
  const permuted = paragraphs.slice();
  [permuted[optIdx], permuted[detIdx]] = [permuted[detIdx], permuted[optIdx]];
  const swapped = permuted.join('\n\n');
  assert.notEqual(swapped, STEP14);
  assert.throws(() => step14OptOutOrder(swapped), { message: /must come after/ });
  // Deletion control: drop the Opt-out paragraph, the existence half reports it.
  const kept = paragraphs.filter((p) => !p.startsWith('**Opt-out.**'));
  assert.strictEqual(paragraphs.length - kept.length, 1);
  assert.throws(() => step14OptOutOrder(kept.join('\n\n')), { message: /marker missing/ });
});
