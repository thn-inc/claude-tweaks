'use strict';
// #3792: skill call sites that put git- or user-supplied text into a log-decision.js
// entry pass it through `--text-file`, never a double-quoted `--text` (a file name,
// path list, stderr reason or branch name may carry `"`, `$`, a backtick or `\`).
// Canonical rule: _shared/auto-decision-log.md's "Text from git or a user" paragraph.
// One row per migrated site; later migrations append rows to SITES.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const TEXT_FILE = '--text-file "{text-file}"';
const CANONICAL = 'Text from git or a user';
const WINDOW = 400;

// `content` is the exact text-file line (= the former `--text` argument); for a prose-only site
// (D2/B1/C1/E1/Q1 — no inline fence, the former form named no text at all) it is the unique
// anchor the clause introduces for the text-file line.
const SITES = [
  { id: 'W1', file: 'plugin/skills/flow/multispec-parallel-waves.md', content: 'condition: preflight-records.js --waves exited non-zero ({stderr reason}) → fallback: sequential run.' },
  { id: 'W2', file: 'plugin/skills/flow/multispec-parallel-waves.md', content: '#{N} merged; git worktree remove refused ({reason}); {worktreePath} and {worktreeBranch} left for manual cleanup.' },
  { id: 'W3', file: 'plugin/skills/flow/multispec-parallel-waves.md', content: '#{N} conflicted at merge-back ({paths}); re-run sequentially.' },
  { id: 'W4', file: 'plugin/skills/flow/multispec-parallel-waves.md', content: 'condition: per-spec worktree unavailable ({reason}) → fallback: sequential' },
  { id: 'G1', file: 'plugin/skills/flow/steps-and-gates.md', content: 'the filled note line' },
  { id: 'D1', file: 'plugin/skills/dispatch/two-call-gate.md', content: 'Artifact check failed: {message}' },
  { id: 'T1', file: 'plugin/skills/tidy/release-note-repair.md', content: '{ref}: {stderr reason} → not written' },
  { id: 'P1', file: 'plugin/skills/_shared/pr-check-gate.md', content: 'PR #{pr} checks red at {headRefOid short}, but every failing check ({names}) is also failing on {baseBranch} at {baseSha short} — inherited, passed with caveat' },
  { id: 'P2', file: 'plugin/skills/_shared/pr-check-gate.md', content: "PR #{pr} checks {state} at {headRefOid short} ({pending names, or 'HEAD not yet pushed'}) — passed with caveat" },
  { id: 'P3', file: 'plugin/skills/_shared/pr-check-gate.md', content: 'condition: pr-checks.js {state}{: reason} → fallback: local verification only' },
  { id: 'K1', file: 'plugin/skills/_shared/git-discipline.md', content: "caught PR #{pr}'s branch up with origin/{integration-branch} before the next phase ({before short} → {after short}); re-pushed" },
  { id: 'L1', file: 'plugin/skills/_shared/local-merge-auto-finish.md', content: 'Merged {feature-branch} into {base-branch} (commit {sha}), pushed. [outcome: merged]' },
  { id: 'L2', file: 'plugin/skills/_shared/local-merge-auto-finish.md', content: 'Local merge into {base-branch} failed ({conflict|failed verification}) — reverted, worktree and branch preserved. [outcome: pending-review]' },
  { id: 'A1', file: 'plugin/skills/wrap-up/auto-merge-short-circuit.md', content: '#{n} merge-check verdict not confirmed in decisions.md (latest: {latest}{detail}) — treated as needs-human, Review Console renders normally' },
  { id: 'A2', file: 'plugin/skills/wrap-up/auto-merge-short-circuit.md', content: "#{n} has {k} can't-tell finding(s) ({ids}) — {consoleAutoResolve not granted at {ceiling} | filing failed: {reason}}; short-circuit refused, Review Console renders normally" },
  { id: 'F1', file: 'plugin/skills/feedback/upstream-draft.md', content: 'Unresolved target: {the raw value}. Kept placeholder; no AskUserQuestion in {mode}.' },
  { id: 'R1', file: 'plugin/skills/build/plan-review.md', content: 'condition: plan-review record comment failed ({reason}) → fallback: the committed clarification section is the trail' },
  { id: 'R2', file: 'plugin/skills/build/plan-audit.md', content: 'amended plan for {N} unlisted spec path(s) — listed {paths}; waived {paths}' },
  { id: 'D2', file: 'plugin/skills/dispatch/two-call-gate.md', content: 'condition: {stderr line} → fallback: PR-bookend check not run' },
  { id: 'B1', file: 'plugin/skills/dispatch/task-prompt.md', content: 'condition: {stderr line} → fallback: PR-bookend check not run' },
  { id: 'B2', file: 'plugin/skills/backlog/refine-record.md', content: 'Backlog refine #{n}: {choice(s)} — {labels/state changed}' },
  { id: 'C1', file: 'plugin/skills/flow/claim-targets.md', content: 'condition: {stderr line} → fallback: PR-bookend check not run' },
  { id: 'E1', file: 'plugin/skills/_shared/pr-early-run-lifecycle.md', content: 'holding that one line' },
  { id: 'Q1', file: 'plugin/skills/build/plan-authoring-checks.md', content: 'holding one line carrying the criterion it covers' },
  { id: 'V1', file: 'plugin/skills/wrap-up/verification-brief.md', content: 'screenshot commit for #{record}: PR state {state} → {current branch | evidence PR #{m} ({url})}' },
];

const collapse = (text) => text.replace(/\s+/g, ' ');

// Throws an Error naming `--text-file` when the site still passes its text as a quoted `--text`
// or lacks the file-based form / the canonical citation / carries an escape instruction.
function checkSite(text, site) {
  const flat = collapse(text);
  if (flat.includes('--text "' + site.content) || flat.includes("--text '" + site.content)) {
    throw new Error(`${site.id}: text passed as a quoted --text, not --text-file`);
  }
  const idx = flat.indexOf(site.content);
  if (idx < 0 || flat.lastIndexOf(site.content) !== idx) {
    throw new Error(`${site.id}: content must appear exactly once (as the --text-file line)`);
  }
  const before = flat.slice(Math.max(0, idx - WINDOW), idx);
  if (!before.includes(TEXT_FILE)) {
    throw new Error(`${site.id}: no --text-file "{text-file}" before its text`);
  }
  const win = flat.slice(Math.max(0, idx - WINDOW), idx + site.content.length + WINDOW);
  if (!win.includes(CANONICAL)) {
    throw new Error(`${site.id}: --text-file site does not cite _shared/auto-decision-log.md's "${CANONICAL}" paragraph`);
  }
  if (/escape any|'\\''|single-quoted/i.test(win)) {
    throw new Error(`${site.id}: --text-file site carries an escape instruction; the file form needs none`);
  }
}

// Puts the site back to a quoted `--text`: the last `--text-file "{text-file}"` within the
// WINDOW chars before the content becomes `--text "<content>"`.
function revertSite(text, site) {
  const flat = collapse(text);
  const idx = flat.indexOf(site.content);
  assert.ok(idx >= 0, `${site.id}: content not found, nothing to revert`);
  const start = Math.max(0, idx - WINDOW);
  const at = flat.slice(start, idx).lastIndexOf(TEXT_FILE);
  assert.ok(at >= 0, `${site.id}: no ${TEXT_FILE} within ${WINDOW} chars before the content`);
  const pos = start + at;
  const reverted = flat.slice(0, pos) + `--text "${site.content}"` + flat.slice(pos + TEXT_FILE.length);
  assert.notStrictEqual(reverted, flat, `${site.id}: revert must change the text`);
  return reverted;
}

for (const site of SITES) {
  test(`AC1.2/AC2.1/AC2.2/AC3.1 pin: ${site.id} ${site.file} reads its text from --text-file`, () => {
    assert.doesNotThrow(() => checkSite(read(site.file), site));
  });

  // Go-red control: the SAME checkSite the pin uses must throw once the site reverts.
  test(`AC3.1 go-red: ${site.id} reverted to --text throws`, () => {
    assert.throws(() => checkSite(revertSite(read(site.file), site), site), /quoted --text, not --text-file/);
  });
}

// Repo-wide sweep (AC1): every `plugin/skills/**/*.md` is scanned for a quoted `--text`
// whose argument interpolates a `{placeholder}` naming git- or user-supplied text.
// `\bfile` (word boundary on `file` only): `ceremony-profile` is not a file name. `path` stays
// unbounded so `{worktreePath}` still matches.
const GIT_TEXT = /reason|paths?\b|path|message|branch|names|\bfile|error|detail|raw|stderr|output|note|title|subject|label|target|url|value|command|choice/i;

// On `collapse(text)`: every quoted `--text "…"` / `--text '…'` argument, and inside it every
// `{name}` (not a shell `${VAR}`) whose name reads as git- or user-supplied text. The two
// quote forms are separate alternatives so an apostrophe inside a double-quoted argument
// ("the first call's HEAD") does not end the match early and hide the site. The double-quoted
// alternative takes an escaped inner quote (`"…\"…{paths}"`) as part of the argument, and an
// optional backslash line continuation between `--text` and its argument (`--text \` newline
// `"…"`, which collapses to `--text \ "…"`) is skipped.
const QUOTED_TEXT = /--text\s+(?:\\\s+)?(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/g;

function scanQuotedGitText(text) {
  const hits = [];
  for (const m of collapse(text).matchAll(QUOTED_TEXT)) {
    const arg = m[1] ?? m[2];
    for (const p of arg.matchAll(/(?<!\$)\{([^{}]*)\}/g)) {
      if (GIT_TEXT.test(p[1])) hits.push({ arg, placeholder: p[1] });
    }
  }
  return hits;
}

// Quoted `--text` calls whose git-text-looking placeholder is NOT git- or user-supplied text.
// An entry allows ONE placeholder in ONE file's argument: `placeholder` is the exact `{…}` name
// (braces omitted), `fragment` a substring of the argument it sits in, `why` what the value
// really is. A different git-text placeholder added to an allowlisted argument is still a hit.
const ALLOW = [
  { file: 'plugin/skills/dispatch/two-call-gate.md', placeholder: 'reason', fragment: 'no runner pass stamp verifies the first call', why: '`{reason}` is the closed enum from `checkFirstCallStamp` (worktree-unrecorded|stamp-read-failed|stamp-absent|stamp-not-head|report-missing)' },
  { file: 'plugin/skills/tidy/actions-github-issues.md', placeholder: 'reason', fragment: 'acceptance labeling not landed ({reason})', why: '`{reason}` is a closed enum; the paragraph before it forbids logging a non-bare-word `verify.json` string' },
  { file: 'plugin/skills/tidy/actions-github-issues.md', placeholder: 'command', fragment: 'recommended {command}', why: '`{command}` is the recommendation the skill itself composes (`/claude-tweaks:dispatch close-out #{record}` or `/claude-tweaks:demo #{record}`), not git or user text' },
  { file: 'plugin/skills/build/micro-plan.md', placeholder: 'plan-path', fragment: 'micro-plan composed directly at {plan-path}', why: '`{plan-path}` is an agent-composed `docs/superpowers/plans/...` path, not git or user text' },
  { file: 'plugin/skills/build/plan-review.md', placeholder: 'ceremony-profile=fast-lane (roster tag plan-review) | trivial plan: fewer than 3 file references and no Scope keywords: | resumed build: plan already reviewed this run, spec and plan unchanged since', fragment: 'ceremony-profile=fast-lane (roster tag plan-review)', why: 'the braces enumerate literal skip conditions the agent picks from, not a substituted value (the placeholder only matches the file pattern through the words "file references")' },
];

function listSkillFiles(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listSkillFiles(full));
    else if (entry.name.endsWith('.md')) out.push(full);
  }
  return out;
}

const skillFiles = () => listSkillFiles(path.join(ROOT, 'plugin', 'skills'))
  .map((abs) => path.relative(ROOT, abs).split(path.sep).join('/'));

// The triple (file, exact placeholder, argument fragment): allowing one placeholder never blinds
// the rest of its argument.
const matchesAllow = (a, file, hit) => a.file === file && a.placeholder === hit.placeholder && hit.arg.includes(a.fragment);
const isAllowed = (file, hit) => ALLOW.some((a) => matchesAllow(a, file, hit));

test('AC1.1: no skill passes git- or user-supplied text in a quoted --text', () => {
  const hits = [];
  for (const file of skillFiles()) {
    for (const hit of scanQuotedGitText(read(file))) {
      if (!isAllowed(file, hit)) hits.push({ file, ...hit });
    }
  }
  assert.deepStrictEqual(hits, []);
});

test('AC1.1 go-red: scanQuotedGitText flags a reverted site', () => {
  assert.strictEqual(scanQuotedGitText('--text "#{N} conflicted at merge-back ({paths}); re-run sequentially."').length, 1);
  assert.strictEqual(scanQuotedGitText('--text "the first call\'s HEAD ({reason}) → fallback"').length, 1);
  assert.deepStrictEqual(scanQuotedGitText('--text "dispatch: #${NUM} excluded"'), []);
  assert.deepStrictEqual(scanQuotedGitText('--text-file "{text-file}"'), []);
});

// Scanner shapes the first regex missed: an escaped inner quote ended the argument early, a
// backslash line continuation left `\` between `--text` and its argument, and a newline
// between `--text` and the argument (collapses to one space). Each must still flag the hit.
test('AC1.1 go-red: scanQuotedGitText flags an escaped inner quote, a backslash continuation and a multi-line --text', () => {
  const escaped = scanQuotedGitText('--text "git said \\"no\\" for {paths}; re-run"');
  assert.deepStrictEqual(escaped.map((h) => h.placeholder), ['paths']);
  const continued = scanQuotedGitText('log-decision.js --status AUTO \\\n  --text \\\n  "conflicted at merge-back ({paths})" --reversibility high');
  assert.deepStrictEqual(continued.map((h) => h.placeholder), ['paths']);
  const multiLine = scanQuotedGitText('log-decision.js --status AUTO --text\n  "conflicted at merge-back ({paths})"');
  assert.deepStrictEqual(multiLine.map((h) => h.placeholder), ['paths']);
  // The single-quoted form and the safe `--text-file` form stay as before.
  assert.deepStrictEqual(scanQuotedGitText("--text 'git said {stderr}'").map((h) => h.placeholder), ['stderr']);
  assert.deepStrictEqual(scanQuotedGitText('--text \\\n  --text-file "{text-file}"'), []);
});

test('AC1.1 go-red: the widened GIT_TEXT names flag, and `ceremony-profile` does not', () => {
  for (const name of ['title', 'subject', 'label', 'target', 'url', 'value', 'command']) {
    assert.strictEqual(scanQuotedGitText(`--text "x {record ${name}}"`).length, 1, name);
  }
  assert.strictEqual(scanQuotedGitText('--text "{worktreePath} left"').length, 1);
  assert.deepStrictEqual(scanQuotedGitText('--text "skipped: {ceremony-profile=fast-lane | trivial plan}"'), []);
});

// `{choice(s)}` carries a human's free-text override (backlog refine-record's Step 3 gate).
test('AC1.1 go-red: scanQuotedGitText flags a {choice(s)} placeholder', () => {
  assert.deepStrictEqual(scanQuotedGitText('--text "Backlog refine #{n}: {choice(s)} — done"').map((h) => h.placeholder), ['choice(s)']);
});

test('AC1.1: every ALLOW entry still matches a live hit (file, placeholder, fragment)', () => {
  for (const a of ALLOW) {
    const hits = scanQuotedGitText(read(a.file));
    assert.ok(hits.some((h) => matchesAllow(a, a.file, h)), `stale ALLOW entry: ${a.file} / {${a.placeholder}} / ${a.fragment}`);
  }
});

// An allowlisted argument is not blind: a git-text placeholder other than the allowed one, in the
// same file and argument, is still a hit. Runs the same `isAllowed` the sweep uses.
test('AC1.1 go-red: an ALLOW entry does not allow a different placeholder in the same argument', () => {
  for (const a of ALLOW) {
    const own = { arg: `x ${a.fragment} y`, placeholder: a.placeholder };
    const other = { arg: `x ${a.fragment} y {stderr reason}`, placeholder: 'stderr reason' };
    assert.strictEqual(isAllowed(a.file, own), true, `${a.file} / {${a.placeholder}}: own placeholder must be allowed`);
    assert.strictEqual(isAllowed(a.file, other), false, `${a.file}: {stderr reason} must not ride on the {${a.placeholder}} entry`);
    assert.strictEqual(isAllowed('plugin/skills/other.md', own), false, `${a.file}: the entry is file-scoped`);
  }
});
