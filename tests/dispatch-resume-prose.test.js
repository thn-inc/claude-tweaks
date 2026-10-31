'use strict';

// Conformance pins for `dispatch resume #N` (#4588): the SKILL.md Input row and `#N` bullet,
// `resume.md`'s procedure and step order, the open-pr report's verdict-gated remedy suffix, and
// `task-prompt.md`'s first-call `RESUME_PR` / `{resume-context}` rules.
//
// Reads the live prose: these files are the declared contract for the resume form, so updating
// them together with this suite is the intended response to a change (skill-prose-conformance-tests).
// Every presence claim carries a go-red control: strip the matches from the read text and assert
// the same pattern no longer matches. Ordering claims are proven by permuting step paragraphs;
// absence claims by appending the banned text and asserting the helper throws its own message.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const DISPATCH_DIR = path.join(ROOT, 'plugin/skills/dispatch');
const read = (name) => {
  const p = path.join(DISPATCH_DIR, name);
  return fs.existsSync(p) ? readText(p) : '';
};
const SKILL = read('SKILL.md');
const RESUME = read('resume.md');
const OPEN_PR = read('open-pr-exclusion-report.md');
const TASK_PROMPT = read('task-prompt.md');

// One presence claim: matches the live text AND stops matching once every match is stripped.
function assertPinned(text, re, label) {
  assert.match(text, re, `${label}: missing`);
  const global = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const stripped = text.replace(global, '');
  assert.notStrictEqual(stripped, text, `${label}: control stripped nothing`);
  assert.doesNotMatch(stripped, re, `${label}: pattern survives its own stripping (cannot go red)`);
}

// ---- SKILL.md -------------------------------------------------------------------------------

const inputRow = (text) => text.split(/\r?\n/).filter((l) => l.startsWith('| `resume #N` |'));
const nBullet = (text) => text.split(/\r?\n/).filter((l) => l.startsWith('**`#N`** — direct.'));
const hintLine = (text) => text.split(/\r?\n/).find((l) => l.startsWith('argument-hint:')) || '';
// Lines naming `dispatch resume` outside the Input row and the frontmatter hint.
const strayResumeMentions = (text) => text.split(/\r?\n/)
  .filter((l) => /dispatch resume/.test(l) && !l.startsWith('| `resume #N` |') && !l.startsWith('argument-hint:'));

test('SKILL.md: Input table carries one `resume #N` row that cites resume.md', () => {
  const rows = inputRow(SKILL);
  assert.strictEqual(rows.length, 1, 'expected exactly one `resume #N` Input row');
  assert.match(rows[0], /`resume\.md`/);
  const stripped = SKILL.replace(rows[0], '');
  assert.strictEqual(inputRow(stripped).length, 0, 'control: row removal must leave no row');
});

test('SKILL.md: argument-hint advertises `resume #N`', () => {
  assertPinned(hintLine(SKILL), /\[resume #N\]/, 'argument-hint resume token');
});

test('SKILL.md: the `#N` bullet is not edited to name the resume remedy', () => {
  const bullets = nBullet(SKILL);
  assert.strictEqual(bullets.length, 1, 'expected exactly one `#N` direct bullet (anchor)');
  assert.doesNotMatch(bullets[0], /dispatch resume|\bresume\b/);
  // go-red control: the same check on a bullet that did gain the remedy
  const edited = `${bullets[0]} Remedy: dispatch resume #N.`;
  assert.match(edited, /dispatch resume/);
});

test('SKILL.md: `dispatch resume` appears only in the Input row and argument-hint', () => {
  assert.deepStrictEqual(strayResumeMentions(SKILL), []);
  const planted = `${SKILL}\nSee dispatch resume for more.\n`;
  assert.deepStrictEqual(strayResumeMentions(planted), ['See dispatch resume for more.']);
});

// ---- the remedy form lives in one dispatch file ---------------------------------------------

const REMEDY = '/claude-tweaks:dispatch resume';
function remedyFiles(dir) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md') && readText(p).includes(REMEDY)) hits.push(path.relative(dir, p));
    }
  };
  walk(dir);
  return hits.sort();
}

test('dispatch directory: only open-pr-exclusion-report.md names the remedy form', () => {
  assert.ok(fs.readdirSync(DISPATCH_DIR).filter((f) => f.endsWith('.md')).length > 20, 'walk floor');
  assert.deepStrictEqual(remedyFiles(DISPATCH_DIR), ['open-pr-exclusion-report.md']);
  // go-red control: the same walk over a tree where a second file also names it
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'resume-remedy-'));
  try {
    fs.mkdirSync(path.join(tmp, 'sub'));
    fs.writeFileSync(path.join(tmp, 'a.md'), `run ${REMEDY} #1\n`);
    fs.writeFileSync(path.join(tmp, 'sub', 'b.md'), `run ${REMEDY} #2\n`);
    fs.writeFileSync(path.join(tmp, 'c.md'), 'dispatch resume only\n');
    assert.deepStrictEqual(remedyFiles(tmp), ['a.md', path.join('sub', 'b.md')]);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---- resume.md: names ------------------------------------------------------------------------

const RESUME_CLAIMS = [
  ['the gatherer CLI', /bin\/dispatch-resume\.js/],
  ['--issue flag', /--issue/],
  ['RESUME_PR', /RESUME_PR/],
  ['record-worktree --dispatch', /record-worktree --dispatch/],
  ['Worktree-resume exemption', /exempt[^.]*`sibling-session-check\.md`'s Worktree-resume check|Worktree-resume[^.]*exempt/],
  ['close-out remedy', /\/claude-tweaks:dispatch close-out #\{N\}|`close-out`/],
  ['backlog refine remedy', /\/claude-tweaks:backlog refine #\{?N\}?/],
  ['close-run', /close-run/],
  ['archive-run', /archive-run/],
  ['--bound-run', /--bound-run/],
  ['uncommitted', /uncommitted/],
  ['another host', /another host/],
  ['orphaned-run cleanup', /orphaned-run/],
  ['DISPATCH_HEADLESS', /DISPATCH_HEADLESS/],
  ['bot:parked', /bot:parked/],
  ['Blocked by', /Blocked by/],
  ['localBranchExists', /localBranchExists/],
  ['swept: stale claim', /swept: stale claim/],
  ['run-mismatch', /run-mismatch/],
  ['PR marker as the prior run source', /`claude-tweaks-run:` marker/],
  ['own kept lock exclusion', /own kept lock/],
  ['Closed rule', /Closed rule/],
];

test('resume.md exists and is non-trivial', () => {
  assert.ok(RESUME.startsWith('# Dispatch — Resume'), 'resume.md missing or empty');
});

for (const [label, re] of RESUME_CLAIMS) {
  test(`resume.md names ${label}`, () => assertPinned(RESUME, re, label));
}

// ---- resume.md: step order -------------------------------------------------------------------

// Steps are bold-labelled paragraphs: `**Step 3 — …`.
const stepParagraphs = (text) => text.split(/\r?\n\r?\n/);
function requireOrder(text, markers) {
  let last = -1;
  for (const m of markers) {
    const idx = text.indexOf(m);
    assert.notStrictEqual(idx, -1, `marker missing: ${m}`);
    assert.ok(idx > last, `${m} must come after the previous marker`);
    last = idx;
  }
}
function swapParagraphs(text, markerA, markerB) {
  const ps = stepParagraphs(text);
  const a = ps.findIndex((p) => p.includes(markerA));
  const b = ps.findIndex((p) => p.includes(markerB));
  assert.ok(a !== -1 && b !== -1 && a !== b, 'swap anchors must sit in two different paragraphs');
  [ps[a], ps[b]] = [ps[b], ps[a]];
  return ps.join('\n\n');
}

// Unique first-occurrence markers, one per step; each appears nowhere earlier in resume.md.
const ORDER = [
  ['gatherer run', 'dispatch-resume.js" --issue {N}'],
  ['archive-run before the mint', 'hooks.js" archive-run --run'],
  ['mint', 'resolve-run-dir --create'],
  ['bind', 'record-worktree --dispatch'],
  ['concurrency recheck', '--bound-run "{new run dir}"'],
  ['stateless log', 'log-decision.js'],
  ['dispatch', 'RESUME_PR="{prUrl}" '],
];

test('resume.md: steps run in order — gatherer, archive, mint, bind, --bound-run, log, dispatch', () => {
  requireOrder(RESUME, ORDER.map((o) => o[1]));
});

for (let i = 0; i < ORDER.length - 1; i += 1) {
  const [labelA, a] = ORDER[i];
  const [labelB, b] = ORDER[i + 1];
  test(`resume.md order control: swapping "${labelA}" and "${labelB}" goes red`, () => {
    const swapped = swapParagraphs(RESUME, a, b);
    assert.notStrictEqual(swapped, RESUME);
    assert.throws(() => requireOrder(swapped, ORDER.map((o) => o[1])), /must come after/);
  });
}

test('resume.md order control: a deleted marker goes red with its own message', () => {
  const absent = RESUME.split(ORDER[1][1]).join('zzz');
  assert.notStrictEqual(absent, RESUME);
  assert.throws(() => requireOrder(absent, ORDER.map((o) => o[1])), /marker missing/);
});

// ---- resume.md: things it must not say ------------------------------------------------------

const BANNED = [
  ['a PR-body write', /gh pr edit/],
  ['a dispatch-exclusions.json eligibility requirement', /dispatch-exclusions/],
  ['a git write aimed at the stalled worktree', /git(?: -C \S+)? (?:commit|stash|push|checkout)\b/],
];
const bannedHits = (text) => BANNED.filter(([, re]) => re.test(text)).map(([label]) => label);

test('resume.md: carries no PR-body write, exclusions requirement or stalled-worktree git write', () => {
  assert.ok(RESUME.includes('## Claim cases and invariants'), 'banned sweep needs a non-empty haystack');
  assert.deepStrictEqual(bannedHits(RESUME), []);
});

for (const [label, re] of BANNED) {
  test(`resume.md ban control: ${label} is detected when planted`, () => {
    const sample = {
      'a PR-body write': 'run gh pr edit 12 --body x',
      'a dispatch-exclusions.json eligibility requirement': 'requires dispatch-exclusions.json',
      'a git write aimed at the stalled worktree': 'git -C {worktreePath} stash',
    }[label];
    assert.match(sample, re);
    assert.deepStrictEqual(bannedHits(`${RESUME}\n${sample}\n`), [label]);
  });
}

// ---- open-pr-exclusion-report.md -------------------------------------------------------------

const BASE_LINE = '`#{N} already has an open PR (#{pr}) — not re-dispatch-eligible until that PR merges or closes`';
const afterBase = (text) => {
  const i = text.indexOf(BASE_LINE);
  assert.notStrictEqual(i, -1, 'base line missing');
  return text.slice(i + BASE_LINE.length);
};

test('open-pr report: the base line is byte-identical and still the rendered template', () => {
  assert.ok(OPEN_PR.includes(BASE_LINE));
  assert.ok(!OPEN_PR.replace(BASE_LINE, '').includes(BASE_LINE), 'base line appears exactly once');
});

const OPEN_PR_CLAIMS = [
  ['gatherer CLI', /bin\/dispatch-resume\.js/],
  ['--issue', /--issue \{N\}/],
  ['exit 0 appends', /`exit 0`/],
  ['the suffix', /; it is #\{N\}'s own stalled build — run \/claude-tweaks:dispatch resume #\{N\}/],
  ['any other exit renders the line unchanged', /any other exit[\s\S]{0,120}unchanged/],
];

for (const [label, re] of OPEN_PR_CLAIMS) {
  test(`open-pr report: the sentence after the base line names ${label}`, () => {
    assertPinned(afterBase(OPEN_PR), re, label);
  });
}

// ---- task-prompt.md ---------------------------------------------------------------------------

const resumeParagraph = (text) => {
  const ps = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith('**Resume (#4588).**'));
  assert.strictEqual(ps.length, 1, 'expected exactly one Resume paragraph in task-prompt.md');
  return ps[0];
};

const TASK_CLAIMS = [
  ['RESUME_PR is set only for dispatch resume', /Only `dispatch resume`[\s\S]{0,40}adds `RESUME_PR="\{pr-url\}" `/],
  ['a resume never carries DISPATCH_HEADLESS=1', /no call of a resume carries `DISPATCH_HEADLESS=1 `/],
  ['the resume-context block', /`\{resume-context\}` after the filled first-call template[\s\S]{0,60}omits it entirely outside resume/],
  ['the context template', /Resuming stalled run \{priorRunId\} on PR \{prUrl\}; last logged phase: \{section\} \{step\}; open defects: \{each\}/],
  ['lastPhase fallback', /`last logged phase: none recorded`/],
  ['openDefects fallback', /`open defects: none recorded`/],
  ['first-call continuation keeps both', /first-call continuation keeps both/],
  ['alreadyOwned no-op', /`RESUME_PR` is then a no-op[\s\S]{0,120}`alreadyOwned`/],
  ['second call carries neither', /second call and its continuations carry neither/],
];

for (const [label, re] of TASK_CLAIMS) {
  test(`task-prompt.md Resume paragraph: ${label}`, () => assertPinned(resumeParagraph(TASK_PROMPT), re, label));
}

test('task-prompt.md: the claim-targets row lists --resume-pr', () => {
  assertPinned(TASK_PROMPT, /\[--run "\{minted-run-dir\}"\] \[--resume-pr "\{pr-url\}"\]/, 'claim-targets --resume-pr');
});

test('task-prompt.md: the Continuation call paragraph is not edited', () => {
  assertPinned(TASK_PROMPT, /Every other sentence stays verbatim\./, 'continuation sentence');
});

test('task-prompt.md: the fenced first-call template carries no RESUME_PR or resume-context', () => {
  const fences = TASK_PROMPT.match(/```[\s\S]*?```/g) || [];
  assert.ok(fences.length > 0, 'fence extraction floor');
  assert.deepStrictEqual(fences.filter((f) => /RESUME_PR|resume-context/.test(f)), []);
  assert.deepStrictEqual(['```\nRESUME_PR="x"\n```'].filter((f) => /RESUME_PR|resume-context/.test(f)).length, 1);
});
