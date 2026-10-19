// tests/timing-prose-conformance.test.js — #1928 and #3413 prose pins.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { TIERS, ROLE_PATTERNS } = require('../plugin/bin/lib/timing/derive.js');
const ROOT = path.join(__dirname, '..');
const read = (p) => readText(path.join(ROOT, p));
const CONTRACT = 'plugin/skills/_shared/timing-render.md';

test('#1928: multi-spec.md cites the run-dir layout sub-file', () => {
  const ms = read('plugin/skills/flow/multi-spec.md');
  assert.match(ms, /multispec-run-dir-layout\.md/);
  assert.match(ms, /\$RUN_ROOT\/\.claude-tweaks\/pipelines\/\{ISO-timestamp\}-spec-\{N1\}-\{N2\}-\{N3\}\//, 'the anchoring diagram stays in multi-spec.md');
});

test('#1928: the layout sub-file documents manifest.yml phases[] and the latest phase', () => {
  const sub = read('plugin/skills/flow/multispec-run-dir-layout.md');
  assert.match(sub, /phases:\s*\n\s+- phase: /, 'the YAML example shows the phases[] list');
  assert.match(sub, /`phases\[\]`[^.]*append-only|append-only[^.]*`phases\[\]`/i);
  assert.match(sub, /spec-status/);
});

test('#1928 AC6: both summary templates carry a ### Timing section rendered from phase-timing.js', () => {
  for (const f of ['plugin/skills/flow/summary-template.md', 'plugin/skills/wrap-up/summary-template.md']) {
    const t = read(f);
    assert.match(t, /^### Timing$/m, f);
    assert.match(t, /bin\/phase-timing\.js" --run "\$PIPELINE_RUN_DIR" --markdown/, f);
  }
});

test('#1928: the multi-spec summary also carries a ### Timing section, rendered at the parent level', () => {
  const t = read('plugin/skills/flow/multispec-summary.md');
  assert.match(t, /^### Timing$/m);
  assert.match(t, /bin\/phase-timing\.js" --run "(\$PIPELINE_RUN_DIR|\$MULTISPEC_PARENT_DIR)" --markdown/);
});

test('#1928 AC6: pr-run-comments.md has a timing comment kind with its producer', () => {
  const t = read('plugin/skills/_shared/pr-run-comments.md');
  // #2970 extended this row's Marker cell with the multi-spec `timing:{spec}` form (same shape
  // as #2592's verdict row), so the base marker is asserted without an end-of-line anchor here.
  assert.match(t, /^\| `timing` \| `\/claude-tweaks:wrap-up`[^|]*\| `<!-- run-comment: timing -->`/m);
  assert.match(t, /^\| `\/claude-tweaks:wrap-up` \([^)]*verification-brief\.md[^)]*\) \| `timing`/m);
  assert.match(read('plugin/skills/wrap-up/verification-brief.md'), /run-comment: timing/);
});

test('#1928 AC6: reporting.md prints the per-group timing line from timing.json', () => {
  const t = read('plugin/skills/dispatch/reporting.md');
  assert.match(t, /`timing: call-1 \{m\}m · call-2 \{m\}m · verify \{n\} run\(s\) \(\{modes\}\)/, 'the #1929 token-clause extension keeps this literal as a prefix');
  assert.match(t, /timing\.json/);
});

test('#1928: the canonical verify.js snippets pass --run "$PIPELINE_RUN_DIR"', () => {
  const v = read('plugin/skills/test/verification.md');
  const snippets = [...v.matchAll(/```bash\n([\s\S]*?)```/g)].map((m) => m[1]).filter((b) => b.includes('bin/verify.js') && b.includes('--cmd'));
  assert.ok(snippets.length >= 2, 'both the canonical and the --scope invocation');
  for (const s of snippets) assert.match(s, /--run "\$PIPELINE_RUN_DIR"/);
  assert.match(v, /empty[^.]*no `verify` event|no `verify` event[^.]*empty/i);
});

test('#1928: docs name the timing module, the CLI, and the flow/wrap-up table source', () => {
  const ps = read('docs/plugin-structure.md');
  assert.match(ps, /^plugin\/bin\/lib\/timing\/ /m);
  assert.match(ps, /^node plugin\/bin\/phase-timing\.js --run <dir> \[--json\] \[--markdown\]/m);
  assert.match(ps, /verify\.js[^\n]*\[--run <dir>\]/);
  const sg = read('docs/skill-graph.md');
  const flow = sg.slice(sg.indexOf('\n## flow\n'), sg.indexOf('\n## ', sg.indexOf('\n## flow\n') + 1));
  const wrap = sg.slice(sg.indexOf('\n## wrap-up\n'), sg.indexOf('\n## ', sg.indexOf('\n## wrap-up\n') + 1));
  const dispatch = sg.slice(sg.indexOf('\n## dispatch\n'), sg.indexOf('\n## ', sg.indexOf('\n## dispatch\n') + 1));
  assert.match(flow, /`bin\/phase-timing\.js`/);
  assert.match(wrap, /`bin\/phase-timing\.js`/);
  assert.match(dispatch, /`bin\/phase-timing\.js`/);
});

test('#1929 AC5: the three summary Timing blocks, the PR timing command, and pr-run-comments.md pass --auto-transcript after --markdown', () => {
  // #3413: the three summary templates' Timing sections cite _shared/timing-render.md, which carries the note line (pinned by #3413 AC2).
  const noteExempt = new Set(['plugin/skills/_shared/pr-run-comments.md', 'docs/journeys/read-where-a-pipeline-run-spent-its-minutes-1928.md', 'docs/journeys/see-which-phase-spent-the-tokens-1929.md', 'plugin/skills/flow/summary-template.md', 'plugin/skills/wrap-up/summary-template.md', 'plugin/skills/flow/multispec-summary.md']);
  for (const f of ['plugin/skills/flow/summary-template.md', 'plugin/skills/wrap-up/summary-template.md', 'plugin/skills/flow/multispec-summary.md', 'plugin/skills/wrap-up/verification-brief.md', 'plugin/skills/_shared/pr-run-comments.md', 'docs/journeys/read-where-a-pipeline-run-spent-its-minutes-1928.md', 'docs/journeys/see-which-phase-spent-the-tokens-1929.md']) {
    const t = read(f);
    assert.match(t, /bin\/phase-timing\.js"? --run "(\$PIPELINE_RUN_DIR|\$MULTISPEC_PARENT_DIR)" --markdown --auto-transcript/, f);
    if (!noteExempt.has(f)) assert.match(t, /tokens: transcript not found/, `${f} must say the note line renders verbatim`);
  }
});

test('#1929 AC5: reporting.md carries the token clause on its timing line', () => {
  const t = read('plugin/skills/dispatch/reporting.md');
  assert.match(t, /`timing: call-1 \{m\}m · call-2 \{m\}m · verify \{n\} run\(s\) \(\{modes\}\) · \{k\} tokens in \/ \{m\} out`/);
  assert.match(t, /--transcript/, 'dispatch passes both agent transcripts explicitly');
});

test('#1929: docs name the transcript reader, the new flags, and the guard counts', () => {
  const ps = read('docs/plugin-structure.md');
  assert.match(ps, /^plugin\/bin\/lib\/timing\/ [^\n]*transcript\.js/m);
  assert.match(ps, /^node plugin\/bin\/phase-timing\.js --run <dir> \[--json\] \[--markdown\] \[--transcript <path> \.\.\.\] \[--auto-transcript\]/m);
  assert.match(read('docs/hooks.md'), /timing\.json[^\n]*(gate-denial|guard)/);
});

test('#3375 M3: docs and the verification brief name the Dispatches section', () => {
  const ps = read('docs/plugin-structure.md');
  assert.match(ps, /^plugin\/bin\/lib\/timing\/ [^\n]*readDispatches[^\n]*aggregateDispatches/m);
  assert.match(ps, /^node plugin\/bin\/phase-timing\.js --run <dir>[^\n]*Dispatches/m);
  assert.match(read('plugin/skills/wrap-up/verification-brief.md'), /`tokens: transcript not found \(\.\.\.\)` line[^\n]*Dispatches/);
});

// #3413: the Timing render contract. The tier and role vocabularies are parsed out of the
// contract's Dispatches paragraph and compared as Sets against derive.js's exports.
function contractTiers(text) {
  const start = text.indexOf('one by model tier (');
  const end = text.indexOf('), one by role', start);
  if (start < 0 || end < 0) return [];
  return [...text.slice(start, end).matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}
function contractRoles(text) {
  const open = 'one by role (';
  const start = text.indexOf(open);
  const end = text.indexOf('). ', start); // the list closes at ")." — a role name may itself carry parentheses
  if (start < 0 || end < 0) return [];
  return text.slice(start + open.length, end).split(', ').map((s) => s.trim());
}
function assertVocabMatches(text, tiers, roles) {
  const ct = contractTiers(text);
  const cr = contractRoles(text);
  assert.ok(ct.length > 0, 'contract tier list parsed');
  assert.ok(cr.length > 0, 'contract role list parsed');
  assert.deepStrictEqual(new Set(ct), new Set(tiers), 'contract tier set');
  assert.deepStrictEqual(new Set(cr), new Set(roles), 'contract role set');
}

test('#3413 AC2: the timing-render contract carries the phase-table and Dispatches render rules', () => {
  const t = read(CONTRACT);
  const checks = [
    [/\| Tier \| Dispatches \| Agent-seconds \| Elapsed \(min\) \| Tokens \(in\/out\) \| Cache \(read\/create\) \|/, 'tier header'],
    [/\| Role \| Dispatches \| Agent-seconds \| Elapsed \(min\) \| Tokens \(in\/out\) \| Cache \(read\/create\) \|/, 'role header'],
    [/dispatches: subagent transcripts not found/, 'not-found line'],
    [/`Dispatches \(\{run window \| whole session — no run events\}; …\):` line heads the tables/, 'scope line'],
    [/`dispatch agent-\{id\}: ` followed by `transcript not found \(\.\.\.\)`/, 'per-dispatch line'],
    [/`dispatches: \{n\} outside the run window excluded`/, 'excluded line'],
    [/not comparable to phase minutes/, 'comparability (minutes)'],
    [/never summed with the phase table/, 'comparability (tokens)'],
    [/rendered verbatim below the `Tokens \(in\/out\)` footnote that follows the Guard denials line/, 'placement'],
    [/`tokens: transcript not found/, 'token note line'],
    [/\| Phase \| Minutes \| Verify \|/, 'phase table header'],
    [/^Guard denials: /m, 'guard denials line'],
    [/\(below the phase rows, above `total`\)/, 'normalized unattributed placement'],
    [/`dispatch agent-\{id\}: ` followed by[^\n]*`meta not found \(description null\)`/, 'per-dispatch meta-not-found form'],
    [/`dispatch agent-\{id\}: ` followed by[^\n]*`transcript has no usage rows`/, 'per-dispatch no-usage-rows form'],
    [/a phase with no event reads `unattributed`/, 'phase with no event reads unattributed'],
    [/cache reads and cache creation are separate fields/, 'Tokens (in/out) footnote cache sentence'],
  ];
  for (const [re, msg] of checks) assert.match(t, re, `${CONTRACT}: ${msg}`);
  assert.doesNotMatch(t, /rendered verbatim below the Guard denials line/, `${CONTRACT}: stale placement`);
  assert.doesNotMatch(t, /`total`'s neighbor rows/, `${CONTRACT}: stale unattributed placement`);
  assert.match(t, /\*\*Archive-path rule\.\*\*[^\n]*archive\/\{run-id\}\/` as `--run`/, `${CONTRACT}: archive rule`);
  const header = t.slice(0, t.indexOf('## Phase table'));
  assert.match(header, /wrap-up\/summary-template\.md/, `${CONTRACT}: header names wrap-up template`);
  assert.match(header, /flow\/summary-template\.md/, `${CONTRACT}: header names flow template`);
  assert.match(header, /flow\/multispec-summary\.md/, `${CONTRACT}: header names multi-spec template`);
});

test('#3413 AC4: the contract\'s tier and role sets equal derive.js TIERS and ROLE_PATTERNS', () => {
  const roles = [...ROLE_PATTERNS.map((p) => p.role), 'unlabelled'];
  const original = read(CONTRACT);
  assertVocabMatches(original, TIERS, roles);

  const noCapableTier = original.replace('`capable`, ', '');
  assert.notEqual(noCapableTier, original, 'control mutation applied: `capable`, removed');
  assert.throws(() => assertVocabMatches(noCapableTier, TIERS, roles), { message: /contract tier set/ });

  const noLensRole = original.replace(', lens reviewer', '');
  assert.notEqual(noLensRole, original, 'control mutation applied: lens reviewer removed');
  assert.throws(() => assertVocabMatches(noLensRole, TIERS, roles), { message: /contract role set/ });

  const parenRole = original.replace(', lens reviewer', ', lens reviewer, odd (name)');
  assert.notEqual(parenRole, original, 'control mutation applied: parenthesized role added');
  assert.ok(contractRoles(parenRole).includes('odd (name)'), 'a parenthesized role name does not truncate the parsed list');

  assert.throws(() => assertVocabMatches(original, [...TIERS, 'ultra'], roles), { message: /contract tier set/ });
});

const TEMPLATES = {
  'plugin/skills/wrap-up/summary-template.md': '$PIPELINE_RUN_DIR',
  'plugin/skills/flow/summary-template.md': '$PIPELINE_RUN_DIR',
  'plugin/skills/flow/multispec-summary.md': '$MULTISPEC_PARENT_DIR',
};
const collapse = (s) => s.replace(/\s+/g, ' ');
// Frozen control: the pre-#3413 Timing prose (Dispatches paragraph, phase-table note, Tier header).
const PRE_3413_DISPATCHES = [
  "When the CLI prints a `tokens: transcript not found (...)` line, render it verbatim above the table — blank token columns are a fact about the run, not a formatting error (#1929).",
  "Under `--auto-transcript`/`--transcript` the CLI also appends a Dispatches section (#3375), rendered verbatim below the `Tokens (in/out)` footnote that follows the Guard denials line — never composed by hand. It carries two tables over the run's subagent dispatches, scoped to the `run window` (or the `whole session` when the run has no events): one by model tier (`fast`, `standard`, `capable`, `frontier`; an `unmapped` row carries the raw model names), one by role (implementer, task review, re-review, whole-branch review, plan review, lens reviewer, unlabelled). `Agent-seconds` sums each dispatch's span with overlap kept;",
  '| Tier | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |',
  '| Phase | Minutes | Verify | Tokens (in/out) | Proc. KB | Tool RTs |',
  '| Role | Dispatches | Agent-seconds | Elapsed (min) | Tokens (in/out) | Cache (read/create) |',
].join('\n');
const RETIRED_PROSE = [/sums each dispatch's span with overlap kept/, /blank token columns are a fact about the run/, /\| Tier \| Dispatches \|/, /\| Phase \| Minutes \| Verify \|/, /\| Role \| Dispatches \|/];
const RETIRED = [...RETIRED_PROSE, /rendered verbatim below the Guard denials line/];

test('#3413 AC1: each Timing template cites the contract, keeps its own invocation, and no longer restates the body', () => {
  // Control: the frozen pre-extraction text trips each absence check, except the stale-placement one (which it does not contain).
  for (const re of RETIRED_PROSE) assert.match(collapse(PRE_3413_DISPATCHES), re, `control: ${re}`);
  for (const [f, runVar] of Object.entries(TEMPLATES)) {
    const t = read(f);
    assert.match(t, /^### Timing$/m, f);
    // Scoped to the Timing section: a citation elsewhere in the template (e.g. the Needs-a-human back-reference) does not count.
    const section = t.slice(t.search(/^### Timing$/m)).split(/\n### /)[0];
    assert.match(section, /`_shared\/timing-render\.md`/, `${f} Timing section cites the contract`);
    const esc = runVar.replace(/\$/g, '\\$');
    assert.match(section, new RegExp(`bin/phase-timing\\.js" --run "${esc}" --markdown --auto-transcript`), `${f} Timing section keeps its own invocation`);
    for (const re of RETIRED) assert.doesNotMatch(collapse(t), re, `${f} still restates ${re}`);
  }
});

test('#3413 AC5: the Needs-a-human archive back-references name the contract', () => {
  for (const f of ['plugin/skills/flow/summary-template.md', 'plugin/skills/flow/multispec-summary.md']) {
    const t = read(f);
    assert.doesNotMatch(t, /Timing section's rule|as for Timing/, f);
    const start = t.indexOf('**Needs-a-human residue');
    const para = t.slice(start, t.indexOf('\n\n', start));
    assert.match(para, /`_shared\/timing-render\.md`'s archive-path rule/, `${f} names the contract`);
    assert.match(para, /console-residue\.js" --run "\$(PIPELINE_RUN_DIR|MULTISPEC_PARENT_DIR)"/, `${f} keeps the console-residue literal`);
  }
});
