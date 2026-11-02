'use strict';

// #4611: wrap-up's prose around the acceptance packet. This suite reads the live skill
// files on purpose: the parent gate keeps the legacy `## Verification Brief` (Decision Q1)
// and the no-parent path posts a packet on either side of the oversight floor (Decision Q5).
// Go-red evidence is a mutation run against a scratch checkout (the task report's mutant table).

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const read = (rel) => readText(path.join(SKILLS, rel));
const PARENT_GATE = 'wrap-up/verification-brief-parent-gate.md';

function section(doc, startHeading, endHeading) {
  const start = doc.indexOf(`\n${startHeading}\n`);
  assert.notStrictEqual(start, -1, `missing heading ${startHeading}`);
  const end = doc.indexOf(`\n${endHeading}\n`, start);
  assert.notStrictEqual(end, -1, `missing heading ${endHeading}`);
  return doc.slice(start, end);
}

function paragraphAt(doc, opening) {
  const start = doc.indexOf(opening);
  assert.notStrictEqual(start, -1, `missing paragraph ${opening}`);
  const end = doc.indexOf('\n\n', start);
  assert.notStrictEqual(end, -1, `unterminated paragraph ${opening}`);
  return doc.slice(start, end);
}

test('parent gate holds the legacy brief template', () => {
  const compose = section(read(PARENT_GATE), '## Compose the parent brief', '## Apply the gate');
  const fence = compose.match(/\n```markdown\n([\s\S]*?)\n```\n/);
  assert.ok(fence, 'the section must hold a fenced markdown block');
  const body = fence[1];
  assert.ok(body.startsWith('## Verification Brief\n\n### The ask'), 'the fence opens on the brief heading');
  for (const literal of ['### Confirmed', '### Observation plan', '_Posted by {poster}. Resolve with `/claude-tweaks:demo`._']) {
    assert.ok(body.includes(literal), `the fence holds ${literal}`);
  }
  assert.ok(!compose.includes('Render the same'), 'the section no longer points at a template elsewhere');
});

test('the template sentence follows the fence and names the record that retires it', () => {
  const compose = section(read(PARENT_GATE), '## Compose the parent brief', '## Apply the gate');
  const sentence = compose.indexOf(
    'Render this template — the legacy Verification Brief, kept for the parent gate until the feature-level '
    + 'acceptance record (#4617) moves parents to the acceptance packet (`_shared/acceptance-packet.md`) — with:',
  );
  assert.notStrictEqual(sentence, -1, 'the replacement sentence is present on one line');
  assert.ok(compose.indexOf('\n```markdown\n') < sentence, 'the fence sits above the sentence');
});

test('the fail-open fallback lands the Try it block in the packet, with the label only above the floor (Decision Q5)', () => {
  const ret = paragraphAt(read(PARENT_GATE), '**Return to the Try it post').replace(/\s+/g, ' ');
  const fallback = ret.slice(ret.indexOf('The one exception is the fail-open fallback'), ret.indexOf('The parent-side'));
  assert.ok(fallback.includes('`_shared/acceptance-packet.md`'), 'the fallback names the packet contract');
  assert.ok(fallback.includes('Test guide'), 'the fallback names where the block lands');
  assert.ok(fallback.includes('with the pending label only above it'), 'the label stays above the floor');
  assert.ok(!fallback.includes('Posting it alone'), 'the below-floor post is retired on this path');
  assert.ok(!fallback.includes("Step 4's template"), 'the fallback no longer points at the brief template');
});

test('the no-parent descriptions state the packet, with the label only above the floor (Decision Q5)', () => {
  const doc = read(PARENT_GATE);
  const failOpen = paragraphAt(doc, '**Fail open on every `gh` call').replace(/\s+/g, ' ');
  assert.ok(failOpen.includes('a packet either way, with the pending label only above the floor'), 'Fail open states the packet');
  assert.ok(!failOpen.includes('when it clears the floor'), 'Fail open no longer limits the fallback to above the floor');
  const noParent = paragraphAt(doc, '**No parent resolvable**').replace(/\s+/g, ' ');
  assert.ok(noParent.includes('gets a packet, with the pending label only above the floor'), 'the no-parent branch states the packet');
  assert.ok(!noParent.includes('exactly as today'), 'the no-parent branch no longer describes the old path');
});

test('a note ahead of the template says whose sections its references mean, and those sections exist', () => {
  const compose = section(read(PARENT_GATE), '## Compose the parent brief', '## Apply the gate');
  const fence = compose.indexOf('\n```markdown\n');
  const note = compose.slice(compose.lastIndexOf('\n\n', fence - 2), fence);
  for (const literal of ['**Try it block**', "`verification-brief.md`'s `## Try it block`, its Step 2 and its Step 3"]) {
    assert.ok(note.includes(literal), `the note names ${literal}`);
  }
  const brief = read('wrap-up/verification-brief.md');
  for (const heading of ['\n## Try it block', '\n## Step 2:', '\n## Step 3:']) {
    assert.ok(brief.includes(heading), `verification-brief.md keeps ${heading.trim()}`);
  }
});

test('the parent gate no longer cites Step 4 for a template or a write it does not hold', () => {
  const doc = read(PARENT_GATE);
  const compose = section(doc, '## Compose the parent brief', '## Apply the gate');
  for (const stale of ["Step 4's kind-keyed", "Step 4's per-record", 'same condition Step 4']) {
    assert.ok(!compose.includes(stale), `Compose no longer says ${stale}`);
  }
  assert.ok(compose.includes('composes no `### Branch` section'), 'Compose states the Branch rule itself');
  const apply = doc.slice(doc.indexOf('\n## Apply the gate\n')).replace(/\s+/g, ' ');
  assert.ok(!apply.includes('same write Step 4'), 'Apply no longer cites Step 4 for the local-files write');
  assert.ok(!apply.includes("Step 4 (`verification-brief.md`)'s existing invariant"), 'Apply no longer cites a brief invariant in Step 4');
  assert.ok(apply.includes('the same order Step 4 (`verification-brief.md`) keeps for its own comment'), 'Apply keeps the post-before-label citation');
});

// ---- Step 4: the packet pipeline (Task 10) ----

const BRIEF = 'wrap-up/verification-brief.md';
const STEP_3 = '## Step 3: Gather the packet inputs';
const STEP_4 = '## Step 4: Compose and post the brief';
const brief = () => read(BRIEF);
const step3 = () => section(brief(), STEP_3, STEP_4);
const step4 = () => brief().slice(brief().indexOf(`\n${STEP_4}\n`));
const flat = (text) => text.replace(/\s+/g, ' ');

// A span from one opener up to the next one, so a branch's own words are what a test reads.
function between(text, from, to) {
  const start = text.indexOf(from);
  assert.notStrictEqual(start, -1, `missing ${from}`);
  const end = text.indexOf(to, start + from.length);
  assert.notStrictEqual(end, -1, `missing ${to} after ${from}`);
  return text.slice(start, end);
}

const exit1 = () => between(step4(), '- **Exit 1**', '- **Exit 2**');
const exit2 = () => between(step4(), '- **Exit 2**', '- **Exit 4**');
const exit4 = () => between(step4(), '- **Exit 4**', '`work-backend: local-files`');
const belowFloor = () => between(brief(), '**`exceeds: false`**', '**`exceeds: true`**');

test('Step 4 names gather, render and post in that order and cites the contract', () => {
  const body = step4();
  const at = ['acceptance-packet.js" gather', 'acceptance-packet.js" render', 'acceptance-packet.js" post'].map((literal) => body.indexOf(literal));
  assert.ok(at.every((index) => index !== -1), `each subcommand is named: ${at}`);
  assert.deepStrictEqual([...at].sort((a, b) => a - b), at, 'gather, then render, then post');
  assert.ok(body.includes('`_shared/acceptance-packet.md`'), 'Step 4 cites the contract');
});

test('the Step 4 temp paths come from session-tmp-resolve', () => {
  assert.ok(step4().includes('session-tmp-resolve.js" FACTS=packet-facts-{N}.json NARRATIVE=packet-narrative-{N}.json PACKET=packet-{N}.md DROPPED=packet-dropped-{N}.json'));
});

test('no literal /tmp/ path outside the timing block', () => {
  const doc = brief();
  const timing = between(doc, "Then post the run's Timing table", 'the events and manifest travel with the archive');
  assert.ok(timing.includes('/tmp/pr-timing-{issue}.md'), 'the timing block stays as it was');
  assert.ok(!doc.replace(timing, '').includes('/tmp/'), 'the rest of the file holds no literal /tmp/ path');
});

test('gather call names every flag', () => {
  const body = step4();
  for (const flag of [
    '--record', '--out', '--run', '--spec', '--report', '--stories-dir', '--story-results', '--ac-results',
    '--base', '--head', '--links', '--surface', '--local-base-url', '--recordings',
  ]) {
    assert.ok(between(body, 'acceptance-packet.js" gather', 'Gather non-zero').includes(flag), `names ${flag}`);
  }
  for (const banned of ['--expected-checks', '--decisions', '$PIPELINE_RUN_DIR/decisions.md']) {
    assert.ok(!body.includes(banned), `no ${banned}`);
  }
});

test('gather passes --stories-dir always, and render stops on any non-zero exit', () => {
  const gather = flat(between(step4(), 'acceptance-packet.js" gather', 'Gather non-zero'));
  assert.ok(gather.includes('`--stories-dir` always'), 'never conditional on QA stories existing');
  assert.ok(gather.includes('a tag-only negative story reads as a routine pass'), 'states why');
  const fence = between(step4(), 'acceptance-packet.js" gather', '\n```');
  assert.ok(fence.includes('--stories-dir'), 'the fenced call carries the flag');
  const render = flat(between(step4(), 'acceptance-packet.js" render', '**Post.**'));
  assert.ok(render.includes('Any other non-zero exit stops the same way, with no re-render'), render);
});

test('gather inputs resolve after cleanup', () => {
  // The gather's own list: the screenshot routing above it names the archive path too.
  const inputs = between(step4(), 'acceptance-packet.js" gather', 'Gather non-zero');
  for (const literal of ['archive/{run-id}', 'packet-inputs', 'headRefOid', 'issue_read']) {
    assert.ok(inputs.includes(literal), `names ${literal}`);
  }
});

test('wrap-up Phase 1 runs the snapshot', () => {
  const phase1 = section(read('wrap-up/SKILL.md'), '## Phase 1: ESTABLISH — what happened here?', '## Phase 2: ROUTE — where does each learning belong?');
  assert.ok(phase1.includes('node "${CLAUDE_PLUGIN_ROOT}/bin/acceptance-packet.js" snapshot --run "{run-dir}" --base "origin/{integration-branch}"'));
  const closeOut = phase1.indexOf('**Every exit runs the close-out.**');
  assert.ok(closeOut !== -1 && closeOut < phase1.indexOf('acceptance-packet.js" snapshot'), 'after the close-out paragraph');
  const snapshot = flat(between(phase1, '**Snapshot the packet inputs', '\n\n'));
  for (const literal of ['record mode', 'log-decision.js', 'never stops the run', "`_shared/acceptance-packet.md`'s `## Pipeline`"]) {
    assert.ok(snapshot.includes(literal), `names ${literal}`);
  }
});

test('ac-results shape is stated, with one example of each id kind', () => {
  const body = flat(step3());
  assert.ok(body.includes('{ "1": "met", "2a": "not met", "AC1": "partially met" }'), 'a numbered id and a positional id');
  assert.ok(body.includes('`parseAcceptanceCriteria`'), 'names where the keys come from');
  assert.ok(body.includes('positional `AC1`, `AC2` for bulleted criteria'));
  assert.ok(body.includes('passes no `--ac-results`'), 'a review with no table');
});

test('Step 3 feeds gather from the same evidence sources', () => {
  const body = flat(step3());
  for (const literal of ['`--recordings`', '`--run`', '`--report`', '`link` input', '`cli`/`flow`']) {
    assert.ok(body.includes(literal), `names ${literal}`);
  }
});

test('failed gather and render post nothing', () => {
  const body = flat(step4());
  assert.ok(body.includes('"schemaVersion": 1'), 'the narrative envelope');
  assert.ok(body.includes('Gather non-zero: report it in the summary and log it, post nothing, apply no label'), 'gather');
  assert.ok(body.includes('Exit 1: fix the narrative the stderr names and re-render once. A second exit 1: report it in the summary and log it, post nothing, apply no label'), 'render');
});

test('the exit-1 branch reports what labelRemoval says happened, by branch', () => {
  const branch = flat(exit1());
  assert.ok(!branch.includes('already cleared'), 'never claims a clearing the result does not report');
  assert.ok(branch.includes('the label is not applied'));
  assert.ok(branch.includes('`stalePacket`'));
  assert.ok(between(exit1(), "`labelRemoval: 'removed'`", "`labelRemoval: 'absent'`").includes('was removed'));
  assert.ok(between(exit1(), "`labelRemoval: 'absent'`", "`labelRemoval: 'failed'`").includes('no pending label was there'));
  const failed = flat(between(exit1(), "`labelRemoval: 'failed'`", '`labelRemoval: null`'));
  assert.ok(failed.includes('needs-human line naming the pending label still on the record and the stale packet'), failed);
  const nothing = flat(exit1().slice(exit1().indexOf('`labelRemoval: null`')));
  for (const literal of ['nothing was cleared', 'failed comment read', 'unreadable existing packet', 'any pending label is still there', '`labelApplied: false`']) {
    assert.ok(nothing.includes(literal), `the null branch names ${literal}`);
  }
});

test('exit 2 is report-and-post-nothing, exit 4 is the MCP path', () => {
  const malformed = flat(exit2());
  assert.ok(malformed.includes('no marker on its first line'), malformed);
  assert.ok(malformed.includes('post nothing, apply no label'), malformed);
  assert.ok(malformed.includes('never the MCP path'), malformed);
  assert.ok(!malformed.includes('add_issue_comment'), 'exit 2 never posts');
  assert.ok(exit4().includes('gh` is absent'), 'exit 4 is the absent-gh signal');
});

test('exit-4 MCP path: existing packet is reported, posts nothing, applies no label (Decision Q4)', () => {
  const branch = flat(exit4());
  const existing = branch.indexOf('An existing packet: report the failed edit naming that packet\'s url, post nothing, apply no label, and clear the pending label');
  assert.notStrictEqual(existing, -1, branch);
  const post = branch.indexOf('`add_issue_comment`');
  assert.ok(post > existing, 'only no packet posts');
  assert.ok(branch.indexOf('`update_pull_request`') > post, 'the PR line follows the post');
  assert.ok(branch.includes('`Acceptance packet: {comment url}`'));
  assert.ok(branch.includes('unless the line is already present'));
  assert.ok(branch.includes("matching `publishPacket`'s step 4"));
  assert.ok(branch.includes('A failed read or an `unreadable` packet: report it, write nothing'), 'the two read outcomes make no write');
});

test('exit-4 clearing reads first and writes the complete array', () => {
  const branch = flat(exit4());
  const existing = branch.indexOf('An existing packet:');
  const read = branch.indexOf('`get_labels`');
  assert.ok(read > existing, 'the clearing comes after the existing-packet sentence');
  assert.ok(branch.indexOf('`mergeLabelNames`') > read);
  assert.ok(branch.includes('only when `demo:pending` or `accept:pending` is present'));
  assert.ok(branch.includes('no write when neither is present'));
  assert.ok(branch.includes('Full-replace hazard'));
  assert.ok(branch.includes('A failed clearing gets the same needs-human line'));
});

test('the local-files branch runs the local subcommand, --pending above the floor only', () => {
  const branch = flat(step4().slice(step4().indexOf('`work-backend: local-files` — run')));
  assert.ok(branch.includes('acceptance-packet.js" local --record-file "{record-file}" --body-file "{PACKET}" --pending'), branch);
  assert.ok(branch.includes('`--pending` omitted below the floor'), branch);
});

test('verification-brief.md holds exactly one template, the packet', () => {
  assert.ok(!brief().includes('## Verification Brief\n\n### The ask'), 'the legacy template moved to the parent gate');
  assert.ok(!step4().includes('```markdown'), 'Step 4 fences no markdown template');
  assert.ok(!step4().includes('Render this exact template'));
  assert.ok(!step4().includes('gh issue comment'), 'the brief posting block is gone');
});

test('post is named before anything applies demo:pending', () => {
  const body = step4();
  const post = body.indexOf('acceptance-packet.js" post');
  assert.notStrictEqual(post, -1);
  assert.ok(post < body.indexOf('demo:pending'), 'no earlier sentence applies the label');
  assert.ok(flat(body).includes('`post` posts or edits the packet before it adds the label'));
});

test('--pr and --label are conditional on the stated rules', () => {
  const body = flat(step4());
  assert.ok(body.includes('`--pr` only when `run-state.json` carries a `pr` object'));
  assert.ok(body.includes('`--label` omitted below the floor (Decision Q5)'));
});

test('below the floor posts the packet without --label (Decision Q5)', () => {
  const bullet = flat(belowFloor());
  assert.ok(bullet.includes('Step 4 posts the packet without `--label`'), bullet);
  assert.ok(bullet.includes('no `demo:pending` bootstrap'), bullet);
  assert.ok(bullet.includes('Step 2.5'), 'skips the safety net');
  assert.ok(bullet.includes('Record the exemption (#2383)'), bullet);
  assert.ok(bullet.includes('`/claude-tweaks:demo #N`'), bullet);
  assert.ok(!bullet.includes('Skip Step 1 through'), bullet);
});

test('Posting it alone is for parent-linked sub-issues only', () => {
  const paragraph = flat(paragraphAt(brief(), '**Posting it alone**'));
  assert.ok(paragraph.includes('parent-linked sub-issue'), paragraph);
  assert.ok(!paragraph.includes('exceeds: false'), paragraph);
  assert.ok(!paragraph.includes('below the floor'), paragraph);
  assert.ok(!flat(brief()).includes('A below-floor record gets no comment on the issue'));
});

test('no stale pre-Q5 wording in the Try it and no-parent prose', () => {
  const doc = flat(brief());
  for (const stale of ["Step 4's template read", 'embeds it in its brief', 'every other record posts it alone', 'exactly as the non-parent path always has']) {
    assert.ok(!doc.includes(stale), `gone: ${stale}`);
  }
  const noParent = flat(paragraphAt(brief(), '**No parent resolvable**'));
  assert.ok(noParent.includes('gets a packet, with `demo:pending` only above the floor'), noParent);
});

test('the Branch paragraph describes a packet on the record', () => {
  const paragraph = flat(paragraphAt(step4(), '**Branch (`integration-model: pr-first` only'));
  assert.ok(!paragraph.includes('posts *on* the run'), paragraph);
  assert.ok(paragraph.includes('the packet sits on the record'), paragraph);
});

test('the five Routing call sites remain in ## Routing (AC6)', () => {
  const routing = section(brief(), '## Routing — read this before anything else, whatever invoked this file', '## Try it block (every record, before either branch)');
  for (const row of [
    "| `/claude-tweaks:wrap-up` Phase 4 execution's Acceptance-labeling bullet (`wrap-up/execution-and-verification.md`) |",
    "| `/claude-tweaks:wrap-up`'s auto-merge short-circuit (`wrap-up/review-console.md`) |",
    "| `/claude-tweaks:dispatch`'s group auto-merge gate (`dispatch/settle-and-merge.md`) |",
    "| `/claude-tweaks:dispatch`'s close-out step 3 (`dispatch/close-out.md`) |",
    "| `/claude-tweaks:tidy`'s `Open parent gate` action (",
  ]) {
    assert.ok(routing.includes(row), `Routing keeps ${row}`);
  }
});

test('try-it.md names the packet\'s Test guide', () => {
  const doc = read('_shared/try-it.md');
  assert.ok(flat(doc.slice(0, doc.indexOf('\n## Shape\n'))).includes("feeds the packet's Test guide"), 'the consumer line');
  const where = flat(doc.slice(doc.indexOf('\n## Where it appears\n')));
  assert.ok(where.includes("the record's acceptance packet"), where);
  assert.ok(!where.includes("in the record's Verification Brief"), where);
});

test('the execution prose describes the packet', () => {
  const doc = flat(read('wrap-up/execution-and-verification.md'));
  assert.ok(doc.includes('posting the acceptance packet'), 'the Acceptance labeling bullet');
  assert.ok(!doc.includes('posting the Verification Brief'));
});
