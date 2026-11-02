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
  const BULLET_MSG = '`#N` bullet names the resume remedy';
  const assertBulletClean = (text) => {
    const bullets = nBullet(text);
    assert.strictEqual(bullets.length, 1, 'expected exactly one `#N` direct bullet (anchor)');
    assert.doesNotMatch(bullets[0], /dispatch resume|\bresume\b/, BULLET_MSG);
  };
  assertBulletClean(SKILL);
  // go-red control: the same assertion on a mutated copy of the live bullet
  const [live] = nBullet(SKILL);
  const mutated = SKILL.replace(live, `${live} Remedy: dispatch resume #N.`);
  assert.notStrictEqual(mutated, SKILL);
  assert.throws(() => assertBulletClean(mutated), (e) => e.message.includes(BULLET_MSG));
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
  ['bind command', 'record-worktree --run "$GROUP_RUN_DIR"'],
  ['concurrency recheck', '--bound-run "{new run dir}"'],
  ['stateless log', 'log-decision.js" --run "{new run dir}" --status AUTO'],
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

// ---- resume.md: per-step claims (fix round 1) ----------------------------------------------

const stepParagraph = (text, label) => {
  const ps = text.split(/\r?\n\r?\n/).filter((p) => p.startsWith(`**Step ${label} `));
  assert.strictEqual(ps.length, 1, `expected exactly one **Step ${label}** paragraph`);
  return ps[0];
};

const STEP_CLAIMS = [
  // Step 6b: log-decision.js requires --status (exit 2 without it), so the line was never written.
  ['6b', 'the log-decision command carries --status AUTO', /log-decision\.js" --run "\{new run dir\}" --status AUTO --section/],
  // Step 6a: the stop path closes the bound run and covers every non-zero exit.
  ['6a', 'a stop closes the new run via close-run on $GROUP_RUN_DIR', /hooks\.js" close-run --run "\$GROUP_RUN_DIR"/],
  ['6a', 'exit 2 stops', /exit 2 \(`--bound-run` outside/],
  ['6a', 'exit 4 stops, the missing worktree stamp included', /exit 4 \(the run-dir listing failed, or the bound run carries no worktree stamp\)/],
  ['6a', 'exits fail closed', /Fail closed: exit 3, exit 2/],
  ['6a', 'a stop prints the stderr for exit 2/4', /the stderr for exit 2\/4/],
  // Step 4: only the mint runs.
  ['4', 'only the mint runs, Step 2 replaces the sibling check', /Only the mint runs: Step 2's CLI replaces Step 4's `check-sibling-sessions`/],
  // Step 3: a failed close-run is handled.
  ['3', 'a failed close-run or archive-run stops before the mint', /if `close-run` or `archive-run` fails[\s\S]{0,80}stop before minting/],
  // Step 2: exit 2 names the main checkout.
  ['2', 'exit 2 names an unresolved main checkout', /main checkout or repo slug unresolved/],
];

for (const [step, label, re] of STEP_CLAIMS) {
  test(`resume.md Step ${step}: ${label}`, () => assertPinned(stepParagraph(RESUME, step), re, label));
}

test('resume.md: {main} and {root} are defined before first use', () => {
  const defIdx = RESUME.indexOf("`{main}` below is the main checkout's root and `{root}` its `.claude-tweaks/pipelines/`");
  assert.notStrictEqual(defIdx, -1, 'placeholder definition missing');
  assert.ok(defIdx < RESUME.indexOf('{main}', defIdx + 8) && defIdx < RESUME.indexOf('{root}', defIdx + 8));
  assert.strictEqual(RESUME.slice(0, defIdx).includes('{root}'), false, '{root} used before it is defined');
  assert.strictEqual(RESUME.slice(0, defIdx).includes('{main}'), false, '{main} used before it is defined');
  // control: dropping the definition leaves the placeholders undefined
  const stripped = RESUME.replace("`{main}` below is the main checkout's root and `{root}` its `.claude-tweaks/pipelines/`.", '');
  assert.notStrictEqual(stripped, RESUME);
  assert.strictEqual(stripped.indexOf('`{main}` below is'), -1);
  assert.ok(stripped.indexOf('{main}') !== -1, 'control: placeholders are still used after stripping');
});

// Step 6a's stop sequence: every clause is pinned, in order, and each clause on its own.
const STOP_SEQUENCE = [
  ['print the line', 'print `line` verbatim (the stderr for exit 2/4)'],
  ['close-run', 'close-run --run "$GROUP_RUN_DIR"'],
  ['ExitWorktree keep', 'ExitWorktree(action: "keep")'],
  ['log-decision call', 'log-decision.js" --run "$GROUP_RUN_DIR" --status SKIP'],
  ['stop without dispatching', 'stop without dispatching either call'],
];
const STOP_MARKERS = STOP_SEQUENCE.map((s) => s[1]);

test('resume.md Step 6a: the stop runs line, close-run, ExitWorktree, log-decision, stop — in that order', () => {
  requireOrder(stepParagraph(RESUME, '6a'), STOP_MARKERS);
});

for (let i = 0; i < STOP_SEQUENCE.length - 1; i += 1) {
  test(`resume.md Step 6a order control: "${STOP_SEQUENCE[i][0]}" before "${STOP_SEQUENCE[i + 1][0]}" goes red when reversed`, () => {
    const par = stepParagraph(RESUME, '6a');
    assert.throws(() => requireOrder(par, [STOP_MARKERS[i + 1], STOP_MARKERS[i]]), /must come after/);
  });
}

for (const [label, marker] of STOP_SEQUENCE) {
  test(`resume.md Step 6a order control: deleting "${label}" goes red`, () => {
    const par = stepParagraph(RESUME, '6a');
    const mutated = par.replace(marker, 'zzz');
    assert.notStrictEqual(mutated, par);
    assert.throws(() => requireOrder(mutated, STOP_MARKERS), /marker missing/);
  });
}

// The stop is a stop: the paragraph must not tell the executor to carry on instead.
const STOP_CLAIMS = [
  ['log-decision call carries --run "$GROUP_RUN_DIR"', /log-decision\.js" --run "\$GROUP_RUN_DIR" --status SKIP/],
  ['log-decision call carries --status', /--status SKIP/],
  ['log-decision call carries --section "/dispatch"', /--section "\/dispatch"/],
  ['log-decision call carries the Degrade-trace --step "{step-name} (skipped)"', /--step "resume Step 7 dispatch \(skipped\)"/],
  ['log-decision call carries --reversibility n/a', /--reversibility n\/a/],
  ['log-decision text goes through --text-file', /--text-file "\{path\}"/],
  ['the temp path comes from session-tmp-resolve.js', /session-tmp-resolve\.js" DECISION_TEXT=decision-text-\{run-id\}-resume-stop\.md/],
  ['the log text is the Degrade-trace condition → fallback line', /one-line text `condition: \{the line, or the stderr with line breaks collapsed\} → fallback: nothing dispatched`/],
  ['the log cites the Degrade-trace rule', /`_shared\/auto-decision-log\.md`'s Degrade-trace rule/],
  ['a failed close-run does not end the sequence', /a failed `close-run` \(on the exit-2 path it refuses the same dir, exit 1\) does not end the sequence — the ExitWorktree, the log and the stop still run/],
  ['no session id fails closed on the own lock', /Without a `CLAUDE_CODE_SESSION_ID`, `record-worktree` stamps no `sessionId`, so this check refuses `live-sibling` on this session's own lock \(fails closed\)/],
  ['the printed reasons include stale-bound-run', /reason:'concurrent-resume'\|'live-sibling'\|'stale-bound-run', line\}/],
  ['the stop dispatches neither call', /then stop without dispatching either call\./],
];
for (const [label, re] of STOP_CLAIMS) {
  test(`resume.md Step 6a: ${label}`, () => assertPinned(stepParagraph(RESUME, '6a'), re, label));
}

test('resume.md Step 2: the refusal list names the bound-run scan and the close-run remedy', () => {
  assertPinned(stepParagraph(RESUME, '2'), /`concurrent-resume` while its owner may be live, `stale-bound-run` naming `hooks\.js close-run` on that dir when the owner-process probe proves it dead/, 'bound-run scan refusals');
});

test('resume.md Step 7: cites SKILL.md Step 5 and two-call-gate.md for the gate and teardown', () => {
  assertPinned(stepParagraph(RESUME, '7'), /`SKILL\.md` Step 5's gate between the calls and terminal-path teardown \(`two-call-gate\.md`\)/, 'gate citation');
});

test('resume.md Step 6a: nothing after the stop sentence hands off to Step 7', () => {
  const STOP = 'then stop without dispatching either call.';
  const handsOff = (par) => {
    const i = par.indexOf(STOP);
    assert.notStrictEqual(i, -1, 'stop sentence missing');
    return /Step 7|\bcontinue\b|\bproceed\b|\bgo on\b/i.test(par.slice(i + STOP.length));
  };
  const par = stepParagraph(RESUME, '6a');
  assert.strictEqual(handsOff(par), false);
  // controls: an appended hand-off, and a continuation sentence right after the stop, both go red
  assert.strictEqual(handsOff(par.replace(STOP, `${STOP} Then go on to Step 7.`)), true);
  assert.strictEqual(handsOff(`${par} Then go on to Step 7.`), true);
  assert.strictEqual(handsOff(par.replace(STOP, `${STOP} Then continue.`)), true);
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

test('open-pr report: an excluded record never reads no-pr', () => {
  assertPinned(afterBase(OPEN_PR), /same closing-reference connection[\s\S]{0,120}never `no-pr`/, 'shared connection');
});

// ---- #4849: the PR is found through the closing-reference connection, on any head -----------------

const CLOSE_OUT = read('close-out.md');

const CLOSING_REFERENCE_CLAIMS = [
  [RESUME, 'the closing-reference rule', /The PR is always found through the record's closing-reference connection \(`closedByPullRequestsReferences`, the one the queue's exclusion reads\), so any head name resolves/],
  [RESUME, 'the worktree derives from the PR head', /`worktreePath` derives from the PR's head/],
];
const STEP_2_CLAIMS = [
  ['multi-record refusal', /a PR closing more than one record \(`multi-record-pr`\)/],
  ['cross-repo refusal', /a PR from a fork or another repository \(`cross-repo-pr`\)/],
  ['a fork names the PR', /each naming the PR, never `no-pr`/],
  ['disposition values', /`disposition` \(`resume`, `close-out` or `close`; null for `no-pr`\)/],
  ['refusal shape', /\{eligible:false, issue, reason, line, prNumbers, disposition, remedy, headRefName\}/],
  ['liveRun on a refusal', /\(plus `liveRun: true` when a provably live owner refused it\)/],
  ['a non-draft PR never takes close', /a non-draft PR is never told to close, so a foreign, multi-record or cross-repo one reads `close-out` or review-by-hand/],
  ['no-pr keeps the plain dispatch remedy', /no open PR closes it \(a plain dispatch applies\)/],
  ['exact head and worktree sibling read', /an exact match on the PR's head and worktree \(`findSessionOnWorktree`\)/],
];
const STEP_6A_CLAIMS = [
  ['the worktree comes from the bound run stamp', /It reads the worktree from the bound run's own stamp \(what Step 6 wrote\)/],
  ['liveRun changes nothing', /a provably live owner adds `liveRun: true`, which changes nothing here — every exit 3 stops the same way/],
];
for (const [text, label, re] of CLOSING_REFERENCE_CLAIMS) test(`resume.md states ${label}`, () => assertPinned(text, re, label));
for (const [label, re] of STEP_2_CLAIMS) test(`resume.md Step 2 states ${label}`, () => assertPinned(stepParagraph(RESUME, '2'), re, label));
for (const [label, re] of STEP_6A_CLAIMS) test(`resume.md Step 6a states ${label}`, () => assertPinned(stepParagraph(RESUME, '6a'), re, label));

// The retired wording, named once: the fixed head the PR was once found from, and the old no-pr clause.
const RETIRED = ['worktree-dispatch-record-', 'no PR on the head branch'];
const retiredHits = (text) => RETIRED.filter((s) => text.includes(s));

test('resume.md no longer finds the PR from the fixed head', () => {
  assert.ok(RESUME.includes('## Claim cases and invariants'), 'retired-wording sweep needs a non-empty haystack');
  assert.deepStrictEqual(retiredHits(RESUME), []);
  for (const s of RETIRED) {
    assert.deepStrictEqual(retiredHits(`${RESUME}\nthe head branch \`${s}{N}\`\n`), [s], `control: ${s} is detected when planted`);
  }
});

test('close-out.md: close-out #N works with no claim held, taking the PR from the resume verdict', () => {
  const rows = CLOSE_OUT.split(/\r?\n/).filter((l) => l.startsWith('| `close-out #N[,#M,...]` |'));
  assert.strictEqual(rows.length, 1, 'expected exactly one `close-out #N` table row');
  assertPinned(rows[0], /with no claim held \(a stuck record's released claim\), take the PR from `bin\/dispatch-resume\.js --issue \{N\}`: `prNumber` when eligible, else its single `prNumbers` entry, and report and stop when it names none/, 'no-claim route');
  assertPinned(rows[0], /from its still-held claim/, 'the held-claim route is kept');
});

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

// ---- flow Step 2.8 + claims contract: RESUME_PR forwarding and the in-flight exception (Task 5) --

const { formatEntry } = require('../plugin/bin/lib/log-decision/append');
const { CLAIM_LOG_STEP, claimLogText, isClaimLogEntry } = require('../plugin/bin/lib/log-decision/claim-log');

const SKILLS_DIR = path.join(ROOT, 'plugin/skills');
const FLOW_SKILL_PATH = path.join(SKILLS_DIR, 'flow/SKILL.md');
const CLAIM_TARGETS_PATH = path.join(SKILLS_DIR, 'flow/claim-targets.md');
const ISSUE_CLAIMS_PATH = path.join(SKILLS_DIR, '_shared/issue-claims.md');
const FLOW_SKILL = readText(FLOW_SKILL_PATH);
const CLAIM_TARGETS = readText(CLAIM_TARGETS_PATH);
const ISSUE_CLAIMS = readText(ISSUE_CLAIMS_PATH);

// Slice [start, end) by two anchors, asserting both resolve and in order (a missing end anchor
// must not widen the region to the rest of the file).
function slice(text, startMarker, endMarker, what) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker);
  assert.notStrictEqual(start, -1, `${what}: start anchor missing`);
  assert.notStrictEqual(end, -1, `${what}: end anchor missing`);
  assert.ok(end > start, `${what}: end anchor must follow the start anchor`);
  return text.slice(start, end);
}
const flowStep28 = (t) => slice(t, '- 2.8 — Claim the targets.', '- 2.9 — ', 'flow Step 2.8');
const claimCommandBlock = (t) => slice(t, '## Claim every named target, all-or-abort', '**Log the claim (mandatory, #2492).**', 'claim-targets command block');
const inFlightVariant = (t) => slice(t, '- **3 (in-flight variant', '- **4** —', 'in-flight variant');
const logTheClaim = (t) => slice(t, '**Log the claim (mandatory, #2492).**', '**Mechanical backstop', 'Log the claim');
const lockStep4 = (t) => slice(t, "  4. **`state: 'tombstone'` or `'stale'`**", "  5. **`state: 'live'`**", 'The lock step 4');
const inFlightDetection = (t) => slice(t, '**In-flight detection at claim time (#315).**', '## Close-via-merge', 'In-flight detection');

const FLOW_CLAIMS = [
  ['the command carries --resume-pr "$RESUME_PR"', /--steps \{steps\} \[--keep-going\] --run "\$PIPELINE_RUN_DIR" \[--resume-pr "\$RESUME_PR"\]/],
  ['the flag is forwarded only when the invocation carries RESUME_PR=<url>', /only when the invocation carries `RESUME_PR=<url>` \(`dispatch resume`, #4588\)/],
];
for (const [label, re] of FLOW_CLAIMS) {
  test(`flow SKILL.md Step 2.8: ${label}`, () => assertPinned(flowStep28(FLOW_SKILL), re, label));
}

test('flow SKILL.md Step 2.8: the exit-code branch is unchanged and never reads resumedPr', () => {
  const step = flowStep28(FLOW_SKILL);
  assertPinned(step, /Exit 0 → Step 3 \(claimed, or already this run's\)\. Exit 3\/4\/5\/6 \(contested or in-flight \/ transient \/ unverified \/ claims branch uncreatable\) → stop before the Config Manifesto\./, 'exit-code branch');
  assert.doesNotMatch(step, /resumedPr/);
  assert.match(`${step}\nresumedPr`, /resumedPr/, 'control: the ban pattern detects a planted mention');
});

// "Still stops" pins: each one is tied to its own clause (the subject and its verdict adjacent, no
// span across sentences), so reversing one rule ("but not", "re-claims too") cannot be satisfied by
// a neighbouring clause's "still stops". One pair per site that restates the exception.
const STOPS = {
  claimTargets: {
    tombstone: /A `pr-opened:` tombstone still stops \(close-out owns it\)/,
    mismatch: /\ba\s+`'stale'`\s+claim\s+whose\s+link\s+differs\s+from\s+`<url>`\s+still\s+stops\s+too/,
  },
  lockStep4: {
    tombstone: /A\s+`pr-opened:`\s+tombstone\s+above\s+still\s+stops\s+whatever\s+`RESUME_PR`\s+says/,
    mismatch: /whatever\s+`RESUME_PR`\s+says,\s+and\s+so\s+does\s+a\s+verdict\s+whose\s+`link`\s+differs\./,
  },
  inFlightDetection: {
    tombstone: /a\s+`pr-opened:`\s+tombstone\s+still\s+stops,/,
    mismatch: /and\s+so\s+does\s+a\s+stale\s+claim\s+whose\s+link\s+differs\s+—/,
  },
};

test('claim-targets.md: the claim command block carries --resume-pr "$RESUME_PR"', () => {
  assertPinned(claimCommandBlock(CLAIM_TARGETS), /--run "\$PIPELINE_RUN_DIR" \[--resume-pr "\$RESUME_PR"\]/, 'command block flag');
});

const VARIANT_CLAIMS = [
  ['names the exception', /\*\*Resume exception \(#4588\)\.\*\*/],
  ['forwarding is keyed on RESUME_PR=<url> (dispatch resume)', /Only an invocation carrying `RESUME_PR=<url>` \(`dispatch resume`\)\s+forwards `--resume-pr "\$RESUME_PR"`/],
  ['no RESUME_PR keeps the #4423 stop unchanged', /[Ww]ithout it[\s\S]{0,80}unchanged \(#4423\)/],
  ['a stale claim whose link is exactly the url re-claims', /`'stale'` claim whose in-flight link is exactly `<url>`[\s\S]{0,120}ordinary conditional\s+write/],
  ['a pr-opened: tombstone still stops', STOPS.claimTargets.tombstone],
  ['a mismatched link still stops', STOPS.claimTargets.mismatch],
  ['the run branches on the exit code, not resumedPr', /exit code[\s\S]{0,40}never[\s\S]{0,40}`resumedPr`/],
];
for (const [label, re] of VARIANT_CLAIMS) {
  test(`claim-targets.md in-flight variant: ${label}`, () => assertPinned(inFlightVariant(CLAIM_TARGETS), re, label));
}

test('claim-targets.md: the #4423 in-flight stop is still stated without RESUME_PR (characterization)', () => {
  const variant = inFlightVariant(CLAIM_TARGETS);
  assertPinned(variant, /stdout instead carries `\{inFlight: \[\{issue, link\}\], released,\s+releaseFailed\}`/, 'inFlight envelope');
  assertPinned(variant, /`'stale'`\s+claim whose run's marker sits on an open PR \(#4423, `claim-store\.js`'s `staleClaimInFlightPr`\)/, 'stale in-flight stop');
  assertPinned(variant, /## Flow: Claim in-flight/, 'in-flight card');
});

test('claim-targets.md Log the claim: the MCP hand-logged line for a resumed reclaim names resume-pr: {url}', () => {
  const block = logTheClaim(CLAIM_TARGETS);
  const re = /claimed #\{n\} \(bin\/claim-targets\.js, transport: mcp, resume-pr: \{url\}\)/;
  assertPinned(block, re, 'MCP resume-pr log line');
  // The prose literal, with a sample url substituted, is a canonical claim entry for the shipped parser.
  const url = 'https://github.com/o/r/pull/12';
  const text = block.match(re)[0].replace('{n}', '4588').replace('{url}', url);
  assert.ok(!/[{}]/.test(text), `placeholder survived: ${text}`);
  const now = new Date(Date.UTC(2026, 9, 31, 12, 0, 0));
  const line = formatEntry({ status: 'AUTO', now, step: CLAIM_LOG_STEP, text, reversibility: 'high' });
  assert.strictEqual(isClaimLogEntry(line), true, line);
  assert.strictEqual(text, claimLogText(4588, 'mcp', url), 'the prose literal equals what the CLI writer produces');
  // go-red control: a respelled suffix is not a claim entry
  const bad = formatEntry({ status: 'AUTO', now, step: CLAIM_LOG_STEP, text: text.replace('resume-pr:', 'resumed:'), reversibility: 'high' });
  assert.strictEqual(isClaimLogEntry(bad), false);
});

const LOCK_CLAIMS = [
  ['names the exception', /Resume exception \(#4588\)/],
  ['keyed on RESUME_PR=<url> (dispatch resume)', /when the run carries `RESUME_PR=<url>` \(`dispatch resume`\)/],
  ['the verdict link must equal it exactly', /`"match": true` with a `link` exactly equal to it[\s\S]{0,80}conditional write/],
  ['a pr-opened: tombstone still stops', STOPS.lockStep4.tombstone],
  ['a mismatched link still stops', STOPS.lockStep4.mismatch],
  ['a failure verdict keeps its fail-open-with-a-line handling', /A `failure` verdict\s+keeps its fail-open-with-a-line handling/],
  ['the reclaim is logged with the resume-pr suffix', /`resume-pr: \{url\}` suffix/],
];
for (const [label, re] of LOCK_CLAIMS) {
  test(`issue-claims.md The lock step 4: ${label}`, () => assertPinned(lockStep4(ISSUE_CLAIMS), re, label));
}

test('issue-claims.md The lock step 4: the exception follows the stale-claim-pr.js call it modifies', () => {
  const step = lockStep4(ISSUE_CLAIMS);
  const call = step.indexOf('bin/stale-claim-pr.js');
  const exception = step.indexOf('Resume exception (#4588)');
  assert.notStrictEqual(call, -1, 'stale-claim-pr.js call missing');
  assert.notStrictEqual(exception, -1, 'exception missing');
  assert.ok(exception > call, 'the exception must follow the call it modifies');
  assert.ok(exception - call < 2200, 'the exception must sit next to the call');
  // control: the exception moved ahead of the call flips the comparison
  const moved = `Resume exception (#4588)\n${step}`;
  assert.ok(moved.indexOf('Resume exception (#4588)') < moved.indexOf('bin/stale-claim-pr.js'));
});

test('issue-claims.md In-flight detection: states the same narrowed exception', () => {
  const section = inFlightDetection(ISSUE_CLAIMS);
  assertPinned(section, /`--resume-pr <url>`/, 'flag');
  assertPinned(section, /Under `dispatch resume` \(#4588\)/, 'dispatch resume (#4588)');
  assertPinned(section, STOPS.inFlightDetection.tombstone, 'tombstone still stops');
  assertPinned(section, STOPS.inFlightDetection.mismatch, 'other link still stops');
});

test('issue-claims.md The lock step 4: the tombstone in-flight stop (#974) is kept (characterization)', () => {
  assertPinned(lockStep4(ISSUE_CLAIMS), /A still-`OPEN` state means a build for this issue already exists and reclaiming\s+would race it — stop here, do not write/, 'tombstone stop');
});
