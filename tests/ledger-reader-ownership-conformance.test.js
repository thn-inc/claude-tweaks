'use strict';
// tests/ledger-reader-ownership-conformance.test.js — pins #3687, re-pointed by #3897: ledger
// readers outside wrap-up resolve THIS run's ledger through `hooks.js resolve-ledger` (the
// read-side twin of `delete-ledger`, over `resolveLedgerPath`), never a bare
// `docs/plans/*-ledger.md` glob — which also matches ledgers inherited from the integration
// branch — and never by restating the old probe's `value.files` / `unattributedFiles`
// handling. The glob may survive only in an allow-listed passage (#3896): the documented
// reader fallback, or prose naming inherited / other runs' ledgers. Live-corpus read
// (skill-prose-conformance-tests: a convention this project enforces); go-red controls run
// the same assertion function against frozen pre-change text.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const flat = (s) => s.replace(/\s+/g, ' ');
const read = (rel) => flat(readText(path.join(SKILLS, rel)));

// The only passages allowed to name the bare glob in a live file, keyed by skill path. Each entry is
// the exact whitespace-flattened text of a whole sentence or clause; anything else is a this-run lookup.
const ALLOWED = {
  '_shared/ledger-format.md': [
    'Never committed, and never matched by the `docs/plans/*-ledger.md` fallback glob below.',
    "**Fallback, for a reader only:** on `unattributable`, or output with no report line (the verb refused its `--run`, printed usage, or is absent from this build), check `{run-dir}/ledger.md` first — if it exists, that is the ledger and the glob is not consulted — then read the `docs/plans/*-ledger.md` glob, knowing it also matches other runs' ledgers.",
  ],
  'ledger/SKILL.md': [
    'With no run dir at all, the `docs/plans/*-ledger.md` glob is the complete listing (the rule\'s no-run-dir fallback).',
    "plus every other `docs/plans/*-ledger.md` file — a by-name lookup the user directs, so inherited ledgers are candidates here, labeled as other runs'.",
    'With no run dir at all, default to the most recent `docs/plans/*-ledger.md` (the rule\'s no-run-dir fallback).',
  ],
  'review/code-mode-steps.md': [],
  'wrap-up/auto-merge-short-circuit.md': [],
};

// Every spelling of a docs/plans ledger lookup. Each regex is global; every match is one occurrence.
const LEDGER_LOOKUP_RES = [
  // a docs/plans path with a wildcard and "ledger" in it: docs/plans/*-ledger.md, docs/plans/*ledger*.md,
  // docs/plans/YYYY-MM-DD-*-ledger.md, docs/plans/*-record-{n}-ledger.md
  /docs\/plans\/(?=[^\s`"'|]*\*)(?=[^\s`"'|]*ledger)[^\s`"'|]*/g,
  // a wildcard ledger filename near a docs/plans mention: find docs/plans -name "*-ledger.md"
  /docs\/plans\b[^`\n]{0,80}?(?<=[\s"'])(?=[^\s`"'|]*\*)(?=[^\s`"'|]*ledger)[^\s`"'|]*/g,
  // a docs/plans listing filtered for ledgers, through any number of pipe stages:
  // ls docs/plans | grep ledger, ls -t docs/plans | head -1 | grep ledger, rg --files docs/plans | rg ledger
  /\b(?:ls|rg)\b[^`\n|]{0,40}?docs\/plans\b[^`\n|]{0,40}?(?:\|[^`\n|]{0,40}?)*?\|\s*(?:grep|rg)\b[^`\n|]*ledger/g,
];

// [start, end) index ranges of every occurrence of `re` (a global regex) in `text`.
function occurrenceRanges(text, re) {
  return [...text.matchAll(re)].map((m) => [m.index, m.index + m[0].length]);
}

// [start, end) index ranges of every (possibly overlapping) occurrence of the literal `passage` in `text`.
function passageRanges(text, passage) {
  const ranges = [];
  for (let at = text.indexOf(passage); at !== -1; at = text.indexOf(passage, at + 1)) {
    ranges.push([at, at + passage.length]);
  }
  return ranges;
}

// Occurrence-by-occurrence: every lookup occurrence must sit wholly inside an allow-listed passage.
// A passage that is no longer in the text is a failure, so a stale entry cannot silently allow nothing.
function assertNoBareGlob(text, label, allowed = []) {
  for (const passage of allowed) {
    assert.ok(text.includes(passage), `${label}: an allow-listed passage is no longer in the file: ${passage}`);
  }
  const allowedRanges = allowed.flatMap((passage) => passageRanges(text, passage));
  const bare = LEDGER_LOOKUP_RES.flatMap((re) => occurrenceRanges(text, re))
    .filter(([start, end]) => !allowedRanges.some(([allowedStart, allowedEnd]) => start >= allowedStart && end <= allowedEnd))
    .map(([start, end]) => text.slice(start, end));
  // Two patterns can match one occurrence; report each distinct matched text once.
  assert.strictEqual(bare.length, 0, `${label}: a this-run ledger lookup uses the bare docs/plans glob: ${JSON.stringify([...new Set(bare)])}`);
}

const PROBE_RESTATEMENT_RE = /value\.files|unattributedFiles|--print ledger/;

function assertRuleNamesVerb(text) {
  assert.ok(text.includes('hooks.js" resolve-ledger --run "{run-dir}"'), 'rule runs hooks.js resolve-ledger');
  for (const report of ['found', 'none', 'ambiguous', 'unattributable']) {
    assert.ok(text.includes('`' + report + '`'), `rule names the \`${report}\` report`);
  }
  assert.match(text, /`other-run:` lines are other runs' ledgers — never read, flipped, or deleted as this run's/);
  assert.match(text, /\*\*Fallback, for a reader only:\*\*/);
  assert.match(text, /check `\{run-dir\}\/ledger\.md` first — if it exists, that is the ledger and the glob is not consulted/);
  assert.match(text, /a caller that flips or deletes ledger rows or files never takes this fallback/);
  assert.match(text, /\(the verb refused its `--run`, printed usage, or is absent from this build\)/);
  assert.match(text, /Never substitute `delete-ledger` for it\./);
  assert.doesNotMatch(text, PROBE_RESTATEMENT_RE, 'rule no longer restates the old probe');
}

function assertNoProbeRestatement(files) {
  const offenders = Object.keys(files).filter((rel) => PROBE_RESTATEMENT_RE.test(files[rel]));
  assert.deepStrictEqual(offenders, [], `restates the probe's value.files / unattributedFiles handling: ${offenders.join(', ')}`);
}

function walkMarkdown(dir, rel = '') {
  const out = [];
  for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkMarkdown(dir, child));
    else if (entry.name.endsWith('.md')) out.push(child);
  }
  return out;
}

test('AC2.1: ledger-format.md resolves this run\'s ledger through hooks.js resolve-ledger and carries no bare glob lookup', () => {
  const text = read('_shared/ledger-format.md');
  assertRuleNamesVerb(text);
  assertNoBareGlob(text, '_shared/ledger-format.md', ALLOWED['_shared/ledger-format.md']);
});

test('go-red: the #3687 probe-based rule fails assertRuleNamesVerb', () => {
  const PRE = flat('**Resolution rule for a caller reading "the active ledger for this run" (#3687):** when a run dir resolves (`$PIPELINE_RUN_DIR` or the most-recent-matching run), run the ownership-aware ledger probe — `node "${CLAUDE_PLUGIN_ROOT}/bin/wrap-up-pack.js" --run "{run-dir}" --print ledger --json "{run-dir}/wrap-up-pack-ledger.json"` (its own `--json` file, so the `wrap-up-pack.json` another step reads keeps its other probes) — `{run-dir}` is the run dir just resolved, never a bare `$PIPELINE_RUN_DIR` that an inferred run leaves unset — and read its `value.files`.');
  assert.throws(() => assertRuleNamesVerb(PRE), /rule runs hooks\.js resolve-ledger/);
});

test('AC2.1 go-red: a bare glob lookup sentence fails, a fallback/inherited sentence passes', () => {
  assert.throws(() => assertNoBareGlob(flat('1. Find active ledger files: glob `docs/plans/*-ledger.md`. Then show counts.'), 'fixture'), /a this-run ledger lookup uses the bare docs\/plans glob/);
  assert.throws(() => assertNoBareGlob(flat('LEDGER_FILE=$(git -C "$WORKTREE_PATH" ls-files "docs/plans/*-record-{n}-ledger.md")'), 'fixture'), /a this-run ledger lookup uses the bare docs\/plans glob/);
  assert.throws(() => assertNoBareGlob(flat("if it exists, that's the active ledger; if not, fall back to the `docs/plans/*-ledger.md` glob."), 'fixture'), /a this-run ledger lookup uses the bare docs\/plans glob/);
  const FB = flat('Fallback: the `docs/plans/*-ledger.md` glob. It also matches inherited ledgers in `docs/plans/*-ledger.md`.');
  assert.doesNotThrow(() => assertNoBareGlob(FB, 'fixture', [FB]));
});

test('AC1.2 go-red: a this-run lookup sentence with "fallback" or "inherited" fails unless it is an allowed passage', () => {
  const LOOKUP = flat('When a run dir resolves, the fallback lookup is `docs/plans/*-ledger.md`, which also matches an inherited ledger.');
  assert.throws(() => assertNoBareGlob(LOOKUP, 'fixture'), /a this-run ledger lookup uses the bare docs\/plans glob/);
  assert.doesNotThrow(() => assertNoBareGlob(LOOKUP, 'fixture', [LOOKUP]));
});

test('AC2.2 go-red: the other docs/plans ledger lookup spellings fail; the Create location and a non-glob git lookup do not', () => {
  const SPELLINGS = [
    'Glob `docs/plans/*ledger*.md` for this run.',
    'Glob `docs/plans/YYYY-MM-DD-*-ledger.md` for this run.',
    'Run `find docs/plans -name "*-ledger.md"` to list this run.',
    'Run `ls docs/plans | grep ledger` to list this run.',
    'Run `ls -t docs/plans | head -1 | grep ledger` to list this run.',
    'Run `rg --files docs/plans | rg ledger` to list this run.',
  ];
  for (const s of SPELLINGS) assert.throws(() => assertNoBareGlob(flat(s), 'fixture'), /a this-run ledger lookup uses the bare docs\/plans glob/, s);
  assert.doesNotThrow(() => assertNoBareGlob(flat('Create `docs/plans/YYYY-MM-DD-{feature}-ledger.md` for the run.'), 'fixture'));
  assert.doesNotThrow(() => assertNoBareGlob(flat('1. Find the ledgers: `git -C "$WORKTREE_PATH" ls-files --error-unmatch -- "$LEDGER_FILE"`.'), 'fixture'));
});

test('AC1.3 go-red: a lowercase-continuation sentence after a glob cannot borrow an exempting word', () => {
  assert.throws(() => assertNoBareGlob(flat('Glob `docs/plans/*-ledger.md`. then read the inherited ledgers too.'), 'fixture'), /a this-run ledger lookup uses the bare docs\/plans glob/);
});

test('AC1.4 go-red: an allow-list passage is exact — text beside it fails, and an entry the file no longer has fails', () => {
  const F1 = ALLOWED['_shared/ledger-format.md'][0];
  assert.throws(() => assertNoBareGlob(`${F1} Also glob \`docs/plans/*-ledger.md\` here.`, 'fixture', [F1]), /a this-run ledger lookup uses the bare docs\/plans glob/);
  assert.throws(() => assertNoBareGlob(F1.replace('never matched', 'never really matched'), 'fixture', [F1]), /no longer in the file/);
  assert.throws(() => assertNoBareGlob(flat('No ledger lookup here.'), 'fixture', ['a passage the file no longer has']), /no longer in the file/);
});

test('AC3.1: no ledger reader in plugin/skills outside wrap-up/ restates the probe\'s value.files / unattributedFiles handling', () => {
  const files = {};
  for (const rel of walkMarkdown(SKILLS)) {
    if (rel.startsWith('wrap-up/')) continue;
    files[rel] = flat(readText(path.join(SKILLS, rel)));
  }
  assert.ok(Object.keys(files).length > 0, 'scan found skill files');
  assert.ok('_shared/ledger-format.md' in files && 'ledger/SKILL.md' in files, 'scan reaches the rule and its reader');
  assertNoProbeRestatement(files);
});

test('go-red: a reader restating the probe\'s unattributedFiles handling fails assertNoProbeRestatement', () => {
  assert.throws(
    () => assertNoProbeRestatement({ 'ledger/SKILL.md': flat("then list every other ledger file — the probe's `value.unattributedFiles`, or on the rule's fallback the remaining matches") }),
    /ledger\/SKILL\.md/,
  );
});

const RULE_CITE = "`_shared/ledger-format.md`'s resolution rule";
const READERS = ['ledger/SKILL.md', 'review/code-mode-steps.md', 'wrap-up/auto-merge-short-circuit.md'];

test('AC3.2: every reader cites the resolution rule and carries no bare glob lookup', () => {
  for (const rel of READERS) {
    const text = read(rel);
    assert.ok(text.includes(RULE_CITE), `${rel} cites ${RULE_CITE}`);
    assertNoBareGlob(text, rel, ALLOWED[rel]);
  }
});

test('review\'s QA Ledger Check names the verb', () => {
  assert.match(read('review/code-mode-steps.md'), /hooks\.js resolve-ledger/);
});

test('ledger listing marks this run\'s ledger first and each other-run ledger as another run\'s', () => {
  assert.match(read('ledger/SKILL.md'), /list its `this-run:` ledger\(s\) first, marked as this run's, then each `other-run:` ledger, marked as another run's/);
});

test('ledger resolve never defaults to another run\'s ledger when a run dir resolves', () => {
  const text = read('ledger/SKILL.md');
  assert.match(text, /on `none`, report `No ledger found for this run` rather than resolving another run's/);
});

test('ledger resolve with a run dir stops on unattributable or no report line — the gate flips rows', () => {
  assert.match(read('ledger/SKILL.md'), /on `unattributable` or no report line, report the verb's output and stop: the gate flips rows, so it never takes the rule's fallback/);
});

test('auto-merge short-circuit deletes through delete-ledger (the rule\'s writer branch), never a glob', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  assert.ok(text.includes('hooks.js" delete-ledger --run "$RUN_DIR"'));
  assert.match(text, /Handle its printed report exactly as `cleanup-procedures\.md`'s Item 2 paragraph does/);
  assert.match(text, /ownership-aware, never a glob, failing closed on a ledger it cannot attribute to this run/);
});

test('auto-merge short-circuit commits only a tracked deletion and leaves the ledger alone on any other report', () => {
  const text = read('wrap-up/auto-merge-short-circuit.md');
  assert.match(text, /ls-files --error-unmatch -- "\$LEDGER_FILE"/);
  assert.match(text, /Only a tracked `docs\/plans\/` path gets the deletion staged and committed/);
  assert.match(text, /Every other report except `not found` leaves the ledger on disk: commit nothing; the verb logs its `SKIP`, hand-log one where Item 2 says/);
});

test('AC2.1 go-red: the pre-#3687 reader sentences fail the no-bare-glob assertion', () => {
  const PRE = [
    '1. Find active ledger files: glob `docs/plans/*-ledger.md`. When a run dir resolves for this invocation, also check `{run-dir}/ledger.md`.',
    'Otherwise, resolve against `docs/plans/*-ledger.md` the same way the `{feature-name}` form does above.',
    'After confirming `TEST_PASSED`, read the open items ledger (`docs/plans/*-ledger.md`, or the run-dir-scoped alternate) and filter for entries with phase `test/qa`:',
    'LEDGER_FILE=$(git -C "$WORKTREE_PATH" ls-files "docs/plans/*-record-{n}-ledger.md")',
  ];
  for (const s of PRE) assert.throws(() => assertNoBareGlob(flat(s), 'pre-change'), /a this-run ledger lookup uses the bare docs\/plans glob/, `must go red: ${s}`);
});

module.exports = { assertNoBareGlob, read };
