// tests/standalone-run-dir-closeout-conformance.test.js — pins #4138: a skill that mints a standalone
// pipeline run directory records no owning session, so session end never marks it `interrupted`; unless
// the skill closes it on every exit after its mint, a stop on any early branch leaves it `active`
// forever. release/SKILL.md Step 8's "Every exit runs the close-out" paragraph is the model. This suite
// derives every skill that mints a standalone run directory from the live skill corpus (so a new minter
// cannot slip in unlisted), requires each to be an enumerated minter or a recorded exemption, and pins
// the every-exit close-out statement in each minter's own prose, each fact with a go-red proof.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const RUN_DIR_RESOLUTION = path.join(SKILLS, '_shared', 'run-dir-resolution.md');

// Every skill that mints a standalone run directory. A derived mint site or an allowlisted skill outside
// this list (and outside the exemptions below) fails the enumeration test.
const MINTERS = ['backlog', 'dispatch', 'harness-health', 'init', 'release', 'specify', 'sweep', 'tidy', 'wrap-up'];

const EXEMPT_FILES = {
  'flow/materialize.md': "/build's record-mode directory is run-dir-resolution.md step 3, not step 4: it is deliberately inherited by the record's later standalone /test, /review and /wrap-up, whose cleanup item 8 closes and archives it",
};
const EXEMPT_SKILLS = {
  capture: "on step 4's allowlist but its prose has no mint site (the exempt-non-minter test below pins that); it logs to decisions.md only when a directory already resolves (routing.md's Headless bar, \"If a run directory resolves, log …\")",
};

const P_STATEMENT = [/\*\*Every exit runs the close-out\.\*\*/, 'the minter states every exit runs the close-out'];
const P_CLOSE = [/close-run --run/, 'the close-out runs close-run with an explicit --run'];
const P_INHERITED = [/An \*\*(?:inherited|adopted)\*\* directory is never closed/, 'an inherited directory is never closed'];

// One entry per minter (or an array of entries when a minter pins several slices):
// { file (relative to plugin/skills), from (heading line prefix), to (next heading prefix, null = EOF), patterns }.
const PINS = {
  release: { file: 'release/SKILL.md', from: '## Step 8', to: '## Next Actions', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED] },
  sweep: [
    { file: 'sweep/SKILL.md', from: '## Step 4: Close-out', to: '## Next Actions', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/tidy --approve[\s\S]{0,200}archiv/, 'archival stays with tidy --approve']] },
    { file: 'sweep/SKILL.md', from: '## Failure propagation', to: '## Step 4: Close-out', patterns: [[/Step 4's close-out still runs/, 'a failure halt still runs Step 4\'s close-out']] },
  ],
  specify: [
    { file: 'specify/next-mode-closeout.md', from: '## Zero eligible or budget exhausted', to: null, patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/nothing eligible this firing[\s\S]{0,400}close-run/, 'the nothing-eligible exit still closes'], [/RUN_DIR_FILE="[^\n]*specify-next-rundir\.txt\)"\nnode "[^\n]*hooks\.js"/, 'the close-out fence re-resolves RUN_DIR_FILE right before the hooks.js close-run call']] },
    { file: 'specify/next-mode-shape.md', from: '## Failure self-report', to: null, patterns: [[/next-mode-closeout\.md`'s close-out still runs/, 'a firing-ending failure still runs the close-out']] },
  ],
  backlog: [
    { file: 'backlog/SKILL.md', from: '## Component-Skill Contract', to: '## Anti-Patterns', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/any `refine` form that resolves it[^\n]{0,120}?`#N\[,#M\.\.\.\]`, or `--reset-breaker`/, 'the statement covers every refine form that resolves its own directory'], [/`overview` and `attention` never resolve or write a run directory/, 'overview and attention mint nothing to close']] },
    { file: 'backlog/refine-closing-summary.md', from: '**Close the run dir.**', to: null, patterns: [P_INHERITED] },
    { file: 'backlog/refine-headless.md', from: '## Step 5: Report', to: '## Cap tracking', patterns: [P_CLOSE] },
  ],
  dispatch: [
    { file: 'dispatch/SKILL.md', from: '### Step 1:', to: '### Step 2:', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED] },
    { file: 'dispatch/SKILL.md', from: '### Step 3:', to: '### Step 4:', patterns: [[/Step 1's close-out still runs/, 'the zero-eligible stop still runs Step 1\'s close-out']] },
  ],
  init: { file: 'init/SKILL.md', from: '## Phase 9: Present Summary and Confirm', to: '## Important Notes', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/Interactive's per-phase "Done" \("Stop here"\) once the mint has run/, 'the per-phase "Done" stop is named'], [/Scope Selection Gate's own "Done" \(Option 4\) stops after Phase 0, before any mint/, 'the Scope Gate\'s "Done" precedes the mint']] },
  'harness-health': { file: 'harness-health/dream-pass.md', from: '## Running it', to: '## Reviewing proposals', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED] },
  'wrap-up': { file: 'wrap-up/SKILL.md', from: '### Establish the run directory (unconditional)', to: '### Diff-derived ceremony default', patterns: [P_STATEMENT, P_CLOSE, [/Stop and re-engage/, 'the resumable halt stays open'], [/A `--dry-run` run skips execution entirely/, 'a --dry-run run, which skips item 8, closes a created directory itself'], [/a verify exit 3 too, since Execute approved actions runs item 8 before its Verify execution/, 'a verify exit 3 still reaches item 8']] },
  tidy: { file: 'tidy/SKILL.md', from: '## Step 7.5: Verify Execution', to: '## Routine Configuration', patterns: [P_STATEMENT, P_CLOSE, P_INHERITED, [/--approve[\s\S]{0,300}archiv/, 'archival stays with --approve']] },
};

// --- Slicing and the fact/go-red assertion ----------------------------------------------------------
function sliceOf(text, from, to) {
  const start = text.indexOf(`\n${from}`);
  assert.notEqual(start, -1, `extraction pattern is out of sync: no "${from}" heading`);
  if (to === null) return text.slice(start);
  const end = text.indexOf(`\n${to}`, start + 1);
  assert.notEqual(end, -1, `extraction pattern is out of sync: no "${to}" heading after "${from}"`);
  return text.slice(start, end);
}

const missingFactsOf = (patterns) => (text) => patterns.filter(([pattern]) => !pattern.test(text)).map(([, fact]) => fact);
const globally = (pattern) => new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);

// Every fact present in `text`; then removing ALL of one pattern's matches turns exactly that fact red.
function assertFactsAndGoRed(text, patterns, message) {
  const missingOf = missingFactsOf(patterns);
  const missing = missingOf(text);
  assert.deepEqual(missing, [], `${message} — missing: ${missing.join('; ')}`);
  for (const [pattern, fact] of patterns) {
    const doctored = text.replace(globally(pattern), '');
    assert.notEqual(doctored, text, `anchor text for "${fact}" not found — proof cannot discriminate`);
    assert.deepEqual(missingOf(doctored), [fact], `removing only "${fact}" must turn exactly that assertion red`);
  }
}

// --- Mint-site derivation ---------------------------------------------------------------------------
const D1 = /resolve-run-dir\b[^\n]*--standalone\s+(?![<\[])\S/;
const D2 = /--spec-slug\s+"?[\w-]+-standalone"?\s+--create/;
const D3 = /\bcreate\b[^\n]*\{ISO-timestamp\}-[\w{}-]+-standalone\//;

function derivedMintSites(corpus) {
  const sites = [];
  for (const { file, text } of corpus) {
    const skill = file.split('/')[0];
    text.split('\n').forEach((line, i) => {
      let kind = null;
      if (line.includes('--create') && D1.test(line)) kind = 'D1';
      else if (D2.test(line)) kind = 'D2';
      else if (D3.test(line)) kind = 'D3';
      if (kind) sites.push({ skill, file, line: i + 1, kind });
    });
  }
  return sites;
}

function walkMarkdown(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (rel === '' && entry.name === '_shared') continue;
    const relPath = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkMarkdown(path.join(dir, entry.name), relPath));
    else if (entry.name.endsWith('.md')) out.push({ file: relPath, text: readText(path.join(dir, entry.name)) });
  }
  return out;
}

function allowlistSkills(text) {
  const m = /standalone-auto allowlist \(([^)]*)\)/.exec(text);
  assert.ok(m, 'extraction pattern is out of sync: run-dir-resolution.md has no "standalone-auto allowlist (…)" parenthetical');
  const names = [...m[1].matchAll(/`([^`]+)`/g)].map(([, name]) => name.replace(/^\/(?:claude-tweaks:)?/, ''));
  assert.ok(names.length > 0, 'extraction pattern is out of sync: the standalone-auto allowlist parenthetical names no skill — an empty parse must never read as a clean result');
  return names;
}

function uncovered(sites, allowlist) {
  const siteMisses = sites.filter((s) => !MINTERS.includes(s.skill) && !(s.file in EXEMPT_FILES) && !(s.skill in EXEMPT_SKILLS));
  const nameMisses = allowlist.filter((n) => !MINTERS.includes(n) && !(n in EXEMPT_SKILLS));
  return [...siteMisses, ...nameMisses];
}

const exemptSkillMints = (sites) => sites.filter((s) => s.skill in EXEMPT_SKILLS);

function assertNoUncovered(corpus, allowlistText) {
  const misses = uncovered(derivedMintSites(corpus), allowlistSkills(allowlistText));
  assert.deepEqual(misses, [], `a standalone run-dir mint site or allowlisted skill is neither an enumerated minter nor a recorded exemption: ${JSON.stringify(misses)}`);
}

function assertNoExemptSkillMints(corpus) {
  const mints = exemptSkillMints(derivedMintSites(corpus));
  assert.deepEqual(mints, [], `an exempt non-minter skill has a standalone run-dir mint site: ${JSON.stringify(mints)}`);
}

const CORPUS = walkMarkdown(SKILLS);
const ALLOWLIST_TEXT = readText(RUN_DIR_RESOLUTION);

test('AC1.1: the mint-site derivation finds the known sentinel sites', () => {
  const files = new Set(derivedMintSites(CORPUS).map((s) => s.file));
  for (const f of ['release/SKILL.md', 'specify/next-mode.md', 'sweep/SKILL.md', 'wrap-up/SKILL.md', 'harness-health/dream-pass.md', 'tidy/step-6-auto.md', 'init/phase-3-classification.md']) {
    assert.ok(files.has(f), `the derivation no longer finds the mint site in ${f} — a broken regex must never read as "no minters"`);
  }
});

test('AC1.1: every derived mint site and allowlisted skill is an enumerated minter or a recorded exemption', () => {
  assertNoUncovered(CORPUS, ALLOWLIST_TEXT);
});

test('AC1.1 go-red: an allowlisted name that is not an enumerated minter is reported uncovered', () => {
  assert.deepEqual(uncovered([], ['fakeskill']), ['fakeskill']);
  assert.throws(() => assertNoUncovered([], 'standalone-auto allowlist (`/claude-tweaks:fakeskill`)'), /fakeskill/);
});

test('AC1.1 go-red: an allowlist parenthetical naming no skill is not a clean parse', () => {
  assert.throws(() => allowlistSkills('standalone-auto allowlist (none)'), /names no skill/);
});

test('AC1.1: an exempt non-minter has no mint site', () => {
  assertNoExemptSkillMints(CORPUS);
});

test('AC1.1 go-red: a fake skill\'s mint line is reported uncovered', () => {
  const corpus = [...CORPUS, { file: 'fake/SKILL.md', text: 'node x/bin/hooks.js resolve-run-dir --standalone fake --create' }];
  assert.throws(() => assertNoUncovered(corpus, ALLOWLIST_TEXT), /fake\/SKILL\.md/);
});

test('AC1.1 go-red: a mint line added to capture is reported', () => {
  const corpus = [...CORPUS, { file: 'capture/SKILL.md', text: 'node x/bin/hooks.js resolve-run-dir --standalone capture --create' }];
  assert.throws(() => assertNoExemptSkillMints(corpus), /capture\/SKILL\.md/);
});

test('AC1.1: run-dir-resolution.md step 4 states the every-exit close-out duty (with go-red)', () => {
  assertFactsAndGoRed(ALLOWLIST_TEXT, [
    [/closes a directory it created on every exit after its mint/, 'every minter closes a directory it created on every exit after its mint'],
    [/standalone-run-dir-closeout-conformance\.test\.js/, 'the conformance suite that enumerates the minters is named'],
  ], 'run-dir-resolution.md step 4 must state the every-exit close-out duty');
});

// Every minter in MINTERS needs at least one entry in `pins`, every entry at least one pattern, and
// P_STATEMENT among that minter's patterns — the same assertion the live test and its go-reds share.
// An empty entry list or an entry with `patterns: []` would otherwise pass the per-minter loop vacuously.
function assertEveryMinterPinned(pins) {
  const gaps = MINTERS.flatMap((m) => {
    const entries = [].concat(pins[m] || []);
    if (entries.length === 0) return [`${m}: no pin entry`];
    const out = entries.filter((e) => !e.patterns || e.patterns.length === 0).map((e) => `${m}: ${e.file} (${e.from}) pins no pattern`);
    if (!entries.some((e) => (e.patterns || []).includes(P_STATEMENT))) out.push(`${m}: no entry pins P_STATEMENT`);
    return out;
  });
  assert.deepEqual(gaps, []);
}

test('AC1.1: every enumerated minter carries a pin that includes the statement', () => {
  assertEveryMinterPinned(PINS);
});

test('AC1.1 go-red: dropping a minter\'s pin from a copy of PINS is reported by name', () => {
  const { 'harness-health': dropped, ...rest } = PINS;
  assert.ok(dropped, 'the live PINS carries no harness-health key — the go-red cannot discriminate');
  assert.throws(() => assertEveryMinterPinned(rest), /harness-health: no pin entry/);
});

test('AC1.1 go-red: a minter whose pin is an empty entry list is reported', () => {
  assert.throws(() => assertEveryMinterPinned({ ...PINS, release: [] }), /release: no pin entry/);
});

test('AC1.1 go-red: an entry with no patterns is reported', () => {
  const [first, ...others] = [].concat(PINS.sweep);
  assert.ok(others.length > 0, 'the live sweep pin has one entry — the go-red cannot isolate an empty-patterns entry');
  assert.throws(() => assertEveryMinterPinned({ ...PINS, sweep: [first, { ...others[0], patterns: [] }] }), /sweep: sweep\/SKILL\.md \(## Failure propagation\) pins no pattern/);
});

test('AC1.1 go-red: a minter whose entries omit P_STATEMENT is reported', () => {
  const stripped = [].concat(PINS.dispatch).map((e) => ({ ...e, patterns: e.patterns.filter((p) => p !== P_STATEMENT) }));
  assert.throws(() => assertEveryMinterPinned({ ...PINS, dispatch: stripped }), /dispatch: no entry pins P_STATEMENT/);
});

for (const [key, pin] of Object.entries(PINS)) {
  test(`AC1.1: ${key} states the every-exit close-out (with go-red)`, () => {
    for (const { file, from, to, patterns } of [].concat(pin)) {
      assertFactsAndGoRed(sliceOf(readText(path.join(SKILLS, file)), from, to), patterns, `${file} (${from}) must state the every-exit close-out`);
    }
  });
}

test('AC1.1 go-red: removing the statement from release\'s Step 8 trips its pin', () => {
  const { file, from, to, patterns } = PINS.release;
  const live = sliceOf(readText(path.join(SKILLS, file)), from, to);
  const doctored = live.replace(globally(P_STATEMENT[0]), '');
  assert.notEqual(doctored, live, 'the live slice carries no statement to strip');
  assert.throws(() => assertFactsAndGoRed(doctored, patterns, 'release Step 8'), /every exit runs the close-out/);
});
