'use strict';

// #5053 Task 7 — the bare-drain restart. Pins `dispatch/SKILL.md` Step 2.5, the
// `dispatch/answered-resumes.md` procedure (check, verdict, ingest, in that order; only an eligible
// resume spends budget), `dispatch/resume.md`'s ingest after Step 2's eligible verdict and Step 7's
// `needs:answer` removal, the one sweep exception to "a resume never passes --headless" in
// `resume.md` and `task-prompt.md`, the open-pr report's `needs:answer` line, design-notes' draft-PR
// section, the `/answer` reply form named in the contract row and `_shared/work-record.md`, and AC10:
// no skill text instructs an agent to post an `/answer` comment.
//
// Reads the live prose: it is new in this change and is the declared contract, so updating it with
// this suite is the intended response to a change (skill-prose-conformance-tests). Each presence
// claim is proven on an in-memory mutation of the live text that turns exactly its own fact red;
// each ordering claim by permuting paragraphs and matching the ordering message.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { missingFactsOf, assertEachPatternGoesRed, sectionOf, lineStartingWith } = require('./helpers/conformance-asserts');

const ROOT = path.join(__dirname, '..');
const SKILLS = path.join(ROOT, 'plugin', 'skills');
const read = (...p) => {
  const file = path.join(SKILLS, ...p);
  return fs.existsSync(file) ? readText(file) : '';
};
const SKILL = read('dispatch', 'SKILL.md');
const ANSWERED = read('dispatch', 'answered-resumes.md');
const RESUME = read('dispatch', 'resume.md');
const TASK_PROMPT = read('dispatch', 'task-prompt.md');
const OPEN_PR = read('dispatch', 'open-pr-exclusion-report.md');
const DESIGN = read('dispatch', 'design-notes.md');
const CONTRACT = read('_shared', 'auto-mode-contract.md');
const WORK_RECORD = read('_shared', 'work-record.md');

const flat = (s) => s.replace(/\s+/g, ' ');
const paragraphs = (text) => text.split('\n\n');
function paragraphStarting(text, prefix) {
  const found = paragraphs(text).filter((p) => p.startsWith(prefix));
  assert.equal(found.length, 1, `expected exactly one paragraph starting ${prefix}`);
  return found[0];
}
function requireOrder(text, markers) {
  let last = -1;
  for (const m of markers) {
    const idx = text.indexOf(m);
    assert.notEqual(idx, -1, `marker missing: ${m}`);
    assert.ok(idx > last, `${m} must come after the previous marker`);
    last = idx;
  }
}
function swapParagraphs(text, prefixA, prefixB) {
  const ps = paragraphs(text);
  const a = ps.findIndex((p) => p.startsWith(prefixA));
  const b = ps.findIndex((p) => p.startsWith(prefixB));
  assert.ok(a !== -1 && b !== -1 && a !== b, 'swap anchors must start two different paragraphs');
  [ps[a], ps[b]] = [ps[b], ps[a]];
  return ps.join('\n\n');
}
// A fact list pinned on one region: live is clean, and stripping each pattern turns only its own fact red.
function pinFacts(region, facts) {
  const missingOf = missingFactsOf(facts);
  assert.deepEqual(missingOf(region), []);
  assertEachPatternGoesRed(region, facts, missingOf);
}
// A rewrite (not a deletion) of one clause must turn exactly the named fact red.
function rewriteGoesRed(region, facts, from, to, fact) {
  const mutated = region.replace(from, to);
  assert.notEqual(mutated, region, `control: "${from}" not found`);
  assert.deepEqual(missingFactsOf(facts)(mutated), [fact]);
}

// ---- AC4.1: SKILL.md Step 2.5 runs only on the bare form --------------------------------------

const STEP_2 = '### Step 2: Pull the authorized queue and group per record';
const STEP_25 = '### Step 2.5: Answered resumes (bare form only)';
const STEP_3 = '### Step 3: Select';
function step25Section(text) {
  const s = text.indexOf(STEP_25);
  assert.notEqual(s, -1, 'Step 2.5 heading missing');
  const e = text.indexOf(`\n${STEP_3}`, s);
  assert.notEqual(e, -1, 'Step 3 heading missing after Step 2.5');
  return text.slice(s, e);
}
const STEP_25_FACTS = [
  [/Bare drain only: the `#N`, `#N,#M,\.\.\.`, `close-out` and `resume` forms never run it\./, 'only the bare form runs Step 2.5'],
  [/Read `answered-resumes\.md` in this skill's directory and follow it/, 'Step 2.5 reads answered-resumes.md'],
  [/each eligible resume spends one `--budget` unit/, 'each eligible resume spends one --budget unit'],
  [/The rest of `\{budget\}` goes to Step 3\./, 'the remaining budget goes to Step 3'],
];

test('AC4.1: SKILL.md Step 2.5 runs only on the bare form', () => {
  pinFacts(step25Section(SKILL), STEP_25_FACTS);
});

test('AC4.1 control: dropping any non-bare form from the exclusion sentence goes red on its own fact', () => {
  const section = step25Section(SKILL);
  for (const token of ['`#N`, ', '`#N,#M,...`, ', '`close-out` and ', 'and `resume` forms']) {
    rewriteGoesRed(section, STEP_25_FACTS, token, token.includes('resume') ? 'and the forms' : '', 'only the bare form runs Step 2.5');
  }
});

test('AC4.1: Step 2.5 sits between Step 2 and Step 3', () => {
  requireOrder(SKILL, [STEP_2, STEP_25, STEP_3]);
});

test('AC4.1 order controls: Step 2.5 moved after Step 3, or before Step 2, goes red; a deleted heading reads missing', () => {
  const section = step25Section(SKILL);
  const without = SKILL.replace(`${section}\n`, '');
  assert.notEqual(without, SKILL);
  const after = without.replace(`${STEP_3}\n`, `${STEP_3}\n\n${section}\n`);
  assert.notEqual(after, without);
  assert.throws(() => requireOrder(after, [STEP_2, STEP_25, STEP_3]), /must come after/);
  const before = without.replace(`${STEP_2}\n`, `${section}\n${STEP_2}\n`);
  assert.notEqual(before, without);
  assert.throws(() => requireOrder(before, [STEP_2, STEP_25, STEP_3]), /must come after/);
  assert.throws(() => requireOrder(without, [STEP_2, STEP_25, STEP_3]), /marker missing/);
});

const LOOP_FACTS = [[/repeat until `\{budget\}` attempts \(counting the answered resumes\)/, "the drain loop counts Step 2.5's resumes toward {budget}"]];
test("AC4.3: the bare drain loop counts Step 2.5's resumes toward {budget}", () => {
  const loop = lineStartingWith(SKILL, 'Loop: run the `next` ranking');
  assert.ok(loop, 'drain Loop line missing');
  pinFacts(loop, LOOP_FACTS);
});

// ---- AC4.2: answered-resumes.md — check, then verdict, then ingest -----------------------------

const CHECK = 'plan-review-answer.js" --issue {n} --check`';
const VERDICT = 'dispatch-resume.js" --issue {n} --queue`';
const INGEST = 'plan-review-answer.js" --issue {n}`';
const P_LIST = '**1. List.**';
const P_CHECK = '**2. Check.**';
const P_ORDER = '**3. Order.**';
const P_VERDICT = '**4. Verdict.**';
const P_INGEST = '**5. Ingest, then resume.**';

test('answered-resumes.md exists', () => {
  assert.ok(ANSWERED.startsWith('# Dispatch Step 2.5 — Answered Resumes'), 'answered-resumes.md missing or retitled');
});

test('AC4.2: answered-resumes.md calls plan-review-answer.js before dispatch-resume.js --queue, and ingests after it', () => {
  assert.ok(ANSWERED.indexOf('plan-review-answer.js') <= ANSWERED.indexOf(CHECK), 'the first plan-review-answer.js call is not the --check');
  requireOrder(ANSWERED, [CHECK, VERDICT, INGEST]);
  // each call sits in its own step's paragraph
  assert.ok(paragraphStarting(ANSWERED, P_CHECK).includes(CHECK), 'the --check call is not in step 2');
  assert.ok(paragraphStarting(ANSWERED, P_VERDICT).includes(VERDICT), 'the verdict call is not in step 4');
  assert.ok(paragraphStarting(ANSWERED, P_INGEST).includes(INGEST), 'the ingest call is not in step 5');
});

test('AC4.2 order controls: swapping check/verdict or verdict/ingest goes red; a deleted call reads missing', () => {
  for (const [a, b] of [[P_CHECK, P_VERDICT], [P_VERDICT, P_INGEST]]) {
    const swapped = swapParagraphs(ANSWERED, a, b);
    assert.notEqual(swapped, ANSWERED);
    assert.throws(() => requireOrder(swapped, [CHECK, VERDICT, INGEST]), /must come after/, `${a} / ${b}`);
  }
  const absent = ANSWERED.split(VERDICT).join('zzz');
  assert.notEqual(absent, ANSWERED);
  assert.throws(() => requireOrder(absent, [CHECK, VERDICT, INGEST]), /marker missing/);
});

const LIST_FACTS = [
  [/`gh issue list --label needs:answer --state open --json number --limit \{backlog-fetch-limit\}`/, 'the needs:answer list command'],
  [/An empty list prints `\[\]` with exit 0, also when the label does not exist yet/, 'an empty list is not an error'],
];
const CHECK_FACTS = [
  [/Exit 3 \(no trusted `\/answer` reply yet, or no question comment\): leave the record untouched\./, 'check exit 3 leaves the record untouched'],
  [/Exit 2 or 4: print its stderr line and leave the record untouched\./, 'check exit 2/4 prints stderr and leaves it'],
  [/Exit 0: keep the record, with the `questionCreatedAt` its JSON line carries\./, 'check exit 0 keeps questionCreatedAt'],
];
const ORDER_FACTS = [[/Sort the kept records by `questionCreatedAt`, oldest first\./, 'oldest question first (D5)']];
test('answered-resumes.md steps 1-3: list, check, order', () => {
  pinFacts(paragraphStarting(ANSWERED, P_LIST), LIST_FACTS);
  pinFacts(paragraphStarting(ANSWERED, P_CHECK), CHECK_FACTS);
  pinFacts(paragraphStarting(ANSWERED, P_ORDER), ORDER_FACTS);
});

// ---- AC4.3: only eligible resumes count against --budget ---------------------------------------

const VERDICT_FACTS = [
  [/while `\{budget\}` attempts remain/, 'the verdict runs only while budget remains'],
  [/Refused \(exit 3\): print its `line`, or its `remedy` in its place under `resume\.md` Step 2's rule; spend nothing and write nothing\./, 'a refused verdict spends nothing and writes nothing'],
  [/The body and `needs:answer` stay as they were, so the next bare drain retries the record\./, 'a refused record is retried by the next drain'],
  [/Exit 2 or 4: print the stderr line; it too spends nothing and writes nothing\./, 'a failed verdict read spends nothing'],
];
const INGEST_FACTS = [
  [/On an eligible verdict \(exit 0\), run `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/plan-review-answer\.js" --issue \{n\}`/, 'the ingest runs only on an eligible verdict'],
  [/run `resume\.md` Steps 3-8 for the record/, 'the sweep runs resume.md Steps 3-8'],
  [/render the first call \(and the second, as for any group\) with `--headless` exactly when this firing is headless/, 'the sweep passes --headless exactly when the firing is headless'],
  [/this resume spends one `--budget` unit/, 'an eligible resume spends one --budget unit'],
  [/A non-zero ingest exit \(2 or 4\) prints its stderr line, dispatches nothing and spends nothing\./, 'a failed ingest spends nothing'],
];

test('AC4.3: the refused branch spends nothing, and the eligible branch spends one --budget unit', () => {
  pinFacts(paragraphStarting(ANSWERED, P_VERDICT), VERDICT_FACTS);
  pinFacts(paragraphStarting(ANSWERED, P_INGEST), INGEST_FACTS);
});

// The only place a `--budget` unit is spent is the eligible branch (step 5).
const unitSpendsOutsideIngest = (text) => {
  const ingest = paragraphStarting(text, P_INGEST);
  return (text.replace(ingest, '').match(/`--budget` unit/g) || []).length;
};
test('AC4.3: no paragraph but the eligible branch spends a --budget unit', () => {
  assert.equal(unitSpendsOutsideIngest(ANSWERED), 0);
  const verdict = paragraphStarting(ANSWERED, P_VERDICT);
  const planted = ANSWERED.replace(verdict, `${verdict} A refused record spends one \`--budget\` unit.`);
  assert.notEqual(planted, ANSWERED);
  assert.equal(unitSpendsOutsideIngest(planted), 1, 'control: a unit spent on the refused branch is counted');
});

test('AC4.3 control: a refused verdict that spends budget goes red on its own fact', () => {
  rewriteGoesRed(paragraphStarting(ANSWERED, P_VERDICT), VERDICT_FACTS, 'spend nothing and write nothing.', 'spend one unit.', 'a refused verdict spends nothing and writes nothing');
});

// ---- resume.md: the ingest runs only after Step 2's eligible verdict; Step 7 removes needs:answer --

const R_VERDICT = 'dispatch-resume.js" --issue {N}`';
const R_INGEST = 'plan-review-answer.js" --issue {N}`';
const R_STEP_2 = '**Step 2 — ';
const R_STEP_2A = '**Step 2a — ';
const R_STEP_3 = '**Step 3 — ';
const STEP_2A_FACTS = [
  [/Once Step 2's verdict is eligible \(exit 0\), and before Step 3, run `node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/plan-review-answer\.js" --issue \{N\}`/, 'the ingest runs only after an eligible verdict'],
  [/A refused verdict runs no ingest and writes nothing\./, 'a refused verdict runs no ingest'],
  [/The ingest's exit never blocks the resume/, 'the ingest never blocks an eligible resume'],
  [/exit 2 or 4 prints the stderr line as a concern/, 'ingest exit 2/4 is a concern'],
  [/The bare-drain sweep runs this ingest itself and enters at Step 3\./, 'the sweep enters at Step 3'],
];

test("resume.md ingests only after Step 2's eligible verdict and Step 7 removes needs:answer", () => {
  requireOrder(RESUME, [R_VERDICT, R_INGEST, R_STEP_3]);
  pinFacts(paragraphStarting(RESUME, R_STEP_2A), STEP_2A_FACTS);
  assert.ok(!paragraphStarting(RESUME, R_STEP_2).includes('plan-review-answer'), 'Step 2 (the verdict) runs the ingest');
});

test('resume.md order controls: swapping Step 2/2a or Step 2a/3 goes red; Step 2 planting the ingest is caught', () => {
  for (const [a, b] of [[R_STEP_2, R_STEP_2A], [R_STEP_2A, R_STEP_3]]) {
    const swapped = swapParagraphs(RESUME, a, b);
    assert.notEqual(swapped, RESUME);
    assert.throws(() => requireOrder(swapped, [R_VERDICT, R_INGEST, R_STEP_3]), /must come after/, `${a} / ${b}`);
  }
  const step2 = paragraphStarting(RESUME, R_STEP_2);
  const planted = RESUME.replace(step2, `${step2} Exit 3: run plan-review-answer.js first.`);
  assert.ok(paragraphStarting(planted, R_STEP_2).includes('plan-review-answer'), 'control: a planted ingest in Step 2 is seen');
});

const STEP_7_FACTS = [
  [/when the record still carries `needs:answer` \(`gh issue view \{N\} --json labels`\), remove it with `gh issue edit \{N\} --remove-label needs:answer`/, 'Step 7 removes a remaining needs:answer'],
  [/pass `--headless` \(`DISPATCH_HEADLESS=1 `\) only for a sweep-originated resume \(`answered-resumes\.md`\) in a headless firing/, 'resume.md names the sweep exception'],
  [/a typed resume never passes it/, 'a typed resume never passes --headless (resume.md)'],
];
test('resume.md Step 7: removes needs:answer before rendering, and only a headless sweep passes --headless', () => {
  const step7 = paragraphStarting(RESUME, '**Step 7 — ');
  pinFacts(step7, STEP_7_FACTS);
  requireOrder(step7, ['--remove-label needs:answer', 'Render the first call']);
  assert.throws(() => requireOrder(step7, ['Render the first call', '--remove-label needs:answer']), /must come after/);
});

test('resume.md Step 7 control: a typed resume allowed to pass --headless goes red on its own fact', () => {
  rewriteGoesRed(paragraphStarting(RESUME, '**Step 7 — '), STEP_7_FACTS, 'a typed resume never passes it', 'a typed resume may pass it', 'a typed resume never passes --headless (resume.md)');
});

const ENTRY_FACTS = [[/A human types it, or the bare-drain sweep \(`answered-resumes\.md`, `SKILL\.md` Step 2\.5\) runs it for an answered record/, 'resume.md names its two entries']];
test('resume.md names both entries, and no longer says it is never fired by a Routine', () => {
  pinFacts(RESUME, ENTRY_FACTS);
  assert.ok(!RESUME.includes('never fired by a Routine'), 'the retired human-only entry clause survives');
  assert.ok(`${RESUME} never fired by a Routine`.includes('never fired by a Routine'), 'control');
});

// ---- task-prompt.md: the one exception to "no call of a resume carries DISPATCH_HEADLESS=1" -----

const TASK_FACTS = [
  [/A typed `dispatch resume` comes from a human, so no call of a resume carries `DISPATCH_HEADLESS=1 `/, 'a typed resume never carries DISPATCH_HEADLESS=1 (task-prompt.md)'],
  [/with one exception: a sweep-originated resume \(`answered-resumes\.md`\) in a headless firing carries it as any headless drain group does\./, 'task-prompt.md names the sweep exception'],
];
const taskResumeParagraph = () => paragraphStarting(TASK_PROMPT, '**Resume (#4588).**');
test('task-prompt.md names the sweep exception', () => {
  pinFacts(taskResumeParagraph(), TASK_FACTS);
});

test('task-prompt.md control: widening the exception to a typed resume goes red on its own fact', () => {
  rewriteGoesRed(taskResumeParagraph(), TASK_FACTS, 'so no call of a resume carries', 'so a call of a resume may carry', 'a typed resume never carries DISPATCH_HEADLESS=1 (task-prompt.md)');
  rewriteGoesRed(taskResumeParagraph(), TASK_FACTS, 'a sweep-originated resume (`answered-resumes.md`) in a headless firing', 'any resume', 'task-prompt.md names the sweep exception');
});

// ---- open-pr report, design notes -----------------------------------------------------------

const OPEN_PR_FACTS = [
  [/A named record carrying `needs:answer` \(its labels from the `#N` form's own fetch\) renders this line in place of that one/, 'a needs:answer record takes its own line'],
  [/`#\{N\} awaits a plan-review answer on its draft PR #\{pr\} — reply \/answer on its question comment, or add a \*\*Decision\*\* paragraph to the body and run \/claude-tweaks:dispatch resume #\{N\}`/, 'the needs:answer line'],
];
test('open-pr report: a needs:answer record renders the awaits-an-answer line', () => {
  pinFacts(OPEN_PR, OPEN_PR_FACTS);
});

const DESIGN_FACTS = [
  [/its number, its body markers and session links, and the pushed plan commits/, 'resume reuses the PR number, markers, links and commits'],
  [/Step 2's `open-pr` exclusion holds the unanswered record out of every drain, so no second exclusion is needed/, 'the open-pr exclusion holds the record'],
  [/re-reviews its plan from scratch by design/, 'the next build re-reviews from scratch'],
  [/#4958's converged round/, 'cites #4958'],
];
test('design-notes.md: why the plan-review stop keeps the draft PR', () => {
  pinFacts(sectionOf(DESIGN, '## Why the plan-review stop keeps the draft PR'), DESIGN_FACTS);
});

// ---- the required reply form, named without telling an agent to post one ----------------------

const CONTRACT_FACTS = [[/a human answers by a reply on the question comment whose first line starts `\/answer`/, 'the contract row names the /answer reply form']];
const WORK_RECORD_FACTS = [[/resolution: a human's reply on the question comment whose first line starts `\/answer`/, 'work-record.md names the /answer reply form']];
test('the contract row and work-record.md name the required reply form', () => {
  const row = lineStartingWith(CONTRACT, '| HARD-GATE / BLOCKED / STOP conditions');
  assert.ok(row, 'HARD-GATE row missing');
  pinFacts(row, CONTRACT_FACTS);
  const bullet = flat(WORK_RECORD.slice(WORK_RECORD.indexOf('At the retry ceiling (`dispatch-retry-ceiling`)'), WORK_RECORD.indexOf('- `auto:*` labels are only ever originated')));
  assert.ok(bullet.length > 50, 'grant bullet slice empty');
  pinFacts(bullet, WORK_RECORD_FACTS);
});

// ---- AC10: no skill text instructs an agent to post an `/answer` comment -----------------------
//
// The unit is a sentence, not a line: a sentence instructs a post when it names a posting command
// (`gh issue comment`, `gh pr comment`, `add_issue_comment`, a `gh api …/comments` call) together
// with `/answer`, or puts a posting verb in front of `/answer` (post / write / add / leave / create /
// submit / send / reply — "reply" only as a verb, not after an article) within one clause-sized
// window, or makes an `/answer` comment or reply the object of a passive posting verb. Every such
// sentence must be on ALLOWED below, with the reason it is not an instruction to an agent.

const ANSWER = /\/answer\b/;
const POST_COMMAND = /gh (?:issue|pr) comment|add_issue_comment|create_issue_comment|gh api\b.{0,120}\/comments/i;
const VERB_BEFORE = /\b(?:post|posts|posting|write|writes|writing|add|adds|adding|leave|leaves|create|creates|submit|submits|send|sends|(?<!\b(?:a|an|the|its|each|every|trusted|human|human's)\s)(?:reply|replies))\b.{0,60}?\/answer\b/i;
const PASSIVE_AFTER = /\/answer\b.{0,40}?\b(?:comment|reply)\b.{0,30}?\b(?:posted|written|added|left|created|submitted|sent)\b/i;
const instructsPost = (s) => ANSWER.test(s) && (POST_COMMAND.test(s) || VERB_BEFORE.test(s) || PASSIVE_AFTER.test(s));

// Paragraphs, list items, table rows and headings are blocks; a block splits into sentences.
const sentencesOf = (text) => text
  .split(/\n\s*\n|\n(?=\s*(?:[-*] |\d+\. |\||#))/)
  .flatMap((block) => flat(block).trim().split(/(?<=[.!?])\s+(?=[A-Z`*(_"'[])|\s\|\s/))
  .filter(Boolean);

function postingSentences(dir) {
  const hits = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.md')) {
        for (const s of sentencesOf(readText(p))) if (instructsPost(s)) hits.push({ file: path.relative(dir, p).split(path.sep).join('/'), sentence: s });
      }
    }
  };
  walk(dir);
  return hits;
}

// [file, anchor inside the sentence, why it is not an instruction to an agent]
const ALLOWED = [
  ['build/plan-review.md', 'reply with a comment whose first line starts `/answer`', 'the closing instruction the posted question gives the human'],
  ['dispatch/reporting.md', 'reply `/answer …` on that question comment', "the plan-review relay's instruction to the human"],
  ['_shared/label-bootstrap.md', 'reply /answer on the question comment', 'the needs:answer label description, read by a human'],
  ['dispatch/open-pr-exclusion-report.md', 'reply /answer on its question comment', 'the rendered line a human reads'],
  ['dispatch/answered-resumes.md', 'It never posts an `/answer` comment', 'a prohibition'],
];
const unallowed = (hits) => hits.filter((h) => !ALLOWED.some(([file, anchor]) => h.file === file && h.sentence.includes(anchor)));
const staleAllowed = (hits) => ALLOWED.filter(([file, anchor]) => hits.filter((h) => h.file === file && h.sentence.includes(anchor)).length !== 1)
  .map(([file, anchor]) => `${file}: ${anchor}`);

test('AC10: no skill text instructs an agent to post an /answer comment', () => {
  const hits = postingSentences(SKILLS);
  assert.ok(hits.length >= ALLOWED.length, 'the sweep found fewer sentences than the allowlist names — the walker is broken');
  assert.deepEqual(unallowed(hits).map((h) => `${h.file}: ${h.sentence}`), [], 'a sentence instructs an agent to post an /answer comment');
});

test('AC10: every allowlist entry still matches exactly one live sentence (shrink the list otherwise)', () => {
  assert.deepEqual(staleAllowed(postingSentences(SKILLS)), [], 'stale ALLOWED entry — shrink the list');
});

test('AC10 detector controls: posting instructions are caught; mentions in separate sentences are not', () => {
  for (const s of [
    'Then post an `/answer` comment on the question.',
    'Run `gh issue comment {n} --body-file {f}` with a body whose first line is `/answer`.',
    'Call `add_issue_comment` with `/answer` as its first line.',
    'Write a comment whose first line starts `/answer` on the record.',
    'An `/answer` reply is then posted by the sweep.',
    'Reply `/answer yes` on the question comment.',
  ]) assert.ok(instructsPost(s), `not caught: ${s}`);
  for (const s of [
    'A human answers by a reply on the question comment whose first line starts `/answer`.',
    'Exit 3 (no trusted `/answer` reply yet, or no question comment): leave the record untouched.',
  ]) assert.ok(!instructsPost(s), `false positive: ${s}`);
  // per-line co-occurrence across two sentences is not an instruction
  assert.deepEqual(sentencesOf('Read the `/answer` replies. Post the summary comment to the PR.\n').filter(instructsPost), []);
});

test('AC10 controls: a planted instruction is reported, and a doctored allowlist anchor reads stale', () => {
  const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'answer-post-'));
  try {
    fs.mkdirSync(path.join(tmp, 'dispatch'));
    fs.writeFileSync(path.join(tmp, 'dispatch', 'x.md'), '# X\n\nRead the record.\nThen post an `/answer`\ncomment with `gh issue comment {n}`.\n');
    const hits = postingSentences(tmp);
    assert.deepEqual(unallowed(hits).map((h) => h.file), ['dispatch/x.md']);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  const live = postingSentences(SKILLS);
  const dropped = live.filter((h) => !h.sentence.includes(ALLOWED[4][1]));
  assert.notEqual(dropped.length, live.length, 'control: the answered-resumes.md entry has no live hit');
  assert.deepEqual(staleAllowed(dropped), [`${ALLOWED[4][0]}: ${ALLOWED[4][1]}`]);
});
