'use strict';

// #4611: wrap-up's prose around the acceptance packet. This suite reads the live skill
// files on purpose: the parent gate keeps the legacy `## Verification Brief` (Decision Q1)
// and the no-parent path posts a packet on either side of the oversight floor (Decision Q5).
// Go-red evidence is a mutation run against a scratch checkout (the task report's mutant table).

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { readPacket } = require('../plugin/bin/lib/wrap-up/packet-gather');

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
  assert.ok(failed.includes('needs-human line naming the pending label still on the record'), failed);
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
  assert.ok(!branch.includes('unless the line is already present'), 'an existing line is replaced, not left alone');
  assert.ok(branch.includes("matching `publishPacket`'s `replacePacketLine`: replace this record's existing `Acceptance packet:` line"), branch);
  assert.ok(branch.includes('append that line after a blank line when the body has none, and write nothing when the body already reads that way'), branch);
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

// ---- fix round 1: what the prose feeds the real CLI ----

const linksBullet = () => flat(between(step3(), '- **`{LINKS}`**', '**`app-route`/`rendered-page` plans whose'));
const gatherList = () => flat(between(step4(), 'acceptance-packet.js" gather', 'Gather non-zero'));

test('{LINKS} builds a url from the local base URL, since an Entry point is a route', () => {
  const bullet = linksBullet();
  assert.ok(bullet.includes('"url": "{local base URL}{route}"'), bullet);
  assert.ok(!bullet.includes('"url": "{entry point}"'), 'a bare route is refused as unparseable');
  assert.ok(bullet.includes('the same value `--local-base-url` carries'), 'the host check passes on the value it was built from');
  assert.ok(bullet.includes('`_shared/dev-url-detection.md`'), bullet);
});

test('the dead entry-point instruction is gone from the walk branch', () => {
  assert.ok(!step3().includes('Resolve the entry point'), 'it fed nothing once {LINKS} owns the url');
});

test('{LINKS} falls back to a command when no base URL resolves or the host would be refused', () => {
  const bullet = linksBullet();
  assert.ok(bullet.includes('for `cli`/`flow` plans and a `diff` plan\'s file path'), bullet);
  assert.ok(bullet.includes('when no base URL resolves or the host would be refused'), bullet);
  assert.ok(bullet.includes('an `infra` or `backend` surface'), 'a commands-only surface refuses every url');
});

test('--local-base-url is keyed to the plan kind as well as the surface', () => {
  const bullet = between(gatherList(), '- `--local-base-url` —', '- `--recordings`');
  assert.ok(bullet.includes('`app-route`/`rendered-page` plans'), bullet);
  assert.ok(bullet.includes('omitted when none resolves'), bullet);
});

test('each Try it group has its own link id, and a step cites its own group\'s', () => {
  const bullet = linksBullet();
  assert.ok(bullet.includes('`entry-point-{n}`'), bullet);
  assert.ok(bullet.includes('"id": "entry-point-1"'), bullet);
  assert.ok(!bullet.includes('"id": "entry-point"'), 'a shared id keeps only the first group\'s fact');
  const narrate = flat(between(step4(), '**Narrate.**', '**Render**'));
  assert.ok(narrate.includes('"refs": ["link:entry-point-1"]'), narrate);
  assert.ok(!narrate.includes('"link:entry-point"'), narrate);
});

test('the Try it narration sentence is pinned', () => {
  const narrate = flat(between(step4(), '**Narrate.**', '**Render**'));
  assert.ok(narrate.includes("Each Try it step (re-run the **Try it block** resolve line and read the file) becomes one `test-guide` claim citing its own group's `link:entry-point-{n}`, with its Precondition, Access and Expected in the claim text"), narrate);
});

test('the whole render call is pinned', () => {
  assert.ok(step4().includes('bin/acceptance-packet.js" render --facts "{FACTS}" --narrative "{NARRATIVE}" --out "{PACKET}" --dropped-out "{DROPPED}" --observation-plan "{PLAN}" --poster "{poster}"\n```'));
});

test('--recordings follows the route, not the commit', () => {
  const bullet = gatherList().slice(gatherList().indexOf('- `--recordings` —'));
  assert.ok(bullet.includes('only when the embeds survive the route above'), bullet);
  assert.ok(!bullet.includes('only when screenshots were committed'), bullet);
});

test('the MCP branch states the outcome of a failed label write and a failed PR-line write', () => {
  const branch = flat(exit4());
  assert.ok(branch.includes("A failed label write leaves the packet in place and skips the PR line, reported as the `gh` path's `labelApplied: false` is"), branch);
  assert.ok(branch.includes("A failed PR-line write does not fail the publish, reported as the `gh` path's `prLink` with `ok: false` is"), branch);
});

test('the failed-removal line names the stale packet only when there is one', () => {
  const failed = flat(between(exit1(), "`labelRemoval: 'failed'`", '`labelRemoval: null`'));
  assert.ok(failed.includes('and `stalePacket` when it names one'), failed);
});

test('on local-files the record file itself is --spec and {record-file}', () => {
  const spec = between(gatherList(), '- `--spec` —', '- `--report`');
  assert.ok(spec.includes('under `work-backend: local-files` the record file itself'), spec);
  const local = flat(step4().slice(step4().indexOf('`work-backend: local-files` — run')));
  assert.ok(local.includes('`{record-file}` is the record file itself'), local);
});

test('an Entry point already a full URL is used as is', () => {
  const bullet = linksBullet();
  assert.ok(bullet.includes('An Entry point already a full URL'), bullet);
  assert.ok(bullet.includes('is used as is'), bullet);
  const schema = read('_shared/observation-plan.md');
  assert.ok(schema.includes('Entry point: {deep link URL/route'), 'the schema still allows one');
});

test('a claim citing the Entry point link names its group', () => {
  const doc = flat(brief());
  assert.ok(!doc.includes('citing the Entry point link'), 'ambiguous with entry-point-{n}');
  assert.ok(flat(step3()).includes("citing the first group's `link:entry-point-1`"), 'the browser-unavailable note');
  assert.ok(flat(step4()).includes("citing the first group's `link:entry-point-1`, the URL in its text"), 'the evidence PR note');
});

test('{record-file} comes from a listing that holds closed records too', () => {
  const local = flat(step4().slice(step4().indexOf('`work-backend: local-files` — run')));
  assert.ok(local.includes("combined open+closed `queryRecords('specs', {})` / `queryRecords('specs', { closed: true })` listing"), local);
});

test('--surface falls back to the record body, so a no-header record keeps the commands-only rule', () => {
  const bullet = between(gatherList(), '- `--surface` —', '- `--local-base-url`');
  assert.ok(bullet.includes("the materialized header's `surface:`, else the record body's `Surface:` line"), bullet);
  assert.ok(bullet.includes('omitted with neither'), bullet);
  assert.ok(!bullet.includes('omitted with no header'), bullet);
});

test('evidence screenshots are links, with no image fence left to match', () => {
  const body = step4();
  assert.ok(!body.includes('![{description}]'), 'the fence is the plain url');
  assert.ok(body.includes('\nhttps://raw.githubusercontent.com/{owner}/{repo}/{commit-sha}/docs/demo-evidence/{record}/{NN}-{description}.png\n'), 'the plain url');
  assert.ok(flat(body).includes('The packet renders it as a plain link, not an embedded image'), 'states it');
  assert.ok(!flat(body).includes('the embedded image'), 'no embedded image left to fail');
});

test('the snapshot paragraph cites where {integration-branch} comes from', () => {
  const skill = read('wrap-up/SKILL.md');
  const snapshot = flat(between(skill, '**Snapshot the packet inputs', '\n\n'));
  assert.ok(snapshot.includes('`{integration-branch}` per `_shared/integration-branch.md`'), snapshot);
});

test('the call sites describe the packet, the below-floor case included', () => {
  const settle = flat(read('dispatch/settle-and-merge.md'));
  const short = flat(read('wrap-up/auto-merge-short-circuit.md'));
  const STEPS = 'gathering, posting the acceptance packet, then `demo:pending`; below the oversight floor it skips the bootstrap and the safety-net gate and posts the packet with no label';
  for (const [name, doc] of [['settle-and-merge', settle], ['auto-merge-short-circuit', short]]) {
    assert.ok(doc.includes(STEPS), `${name} states the steps`);
    assert.ok(!doc.includes('sourcing, posting, then `demo:pending`'), `${name} stale steps gone`);
  }
  assert.ok(settle.includes('One packet per record with no resolvable parent, and one label above the floor'));
  assert.ok(!settle.includes('One brief and one label per record'));
  const mapping = paragraphAt(read('dispatch/settle-and-merge.md'), 'This blanket mapping also covers').replace(/\s+/g, ' ');
  assert.ok(mapping.includes("`acceptance-packet.js post` exits 4 with `gh` absent, and that file's Step 4 then makes the same writes through `add_issue_comment` and `issue_write`"), mapping);
  assert.ok(!mapping.includes('the `verification-brief.md` calls (`gh issue comment`'), mapping);
  const console_ = read('wrap-up/review-console.md');
  assert.ok(console_.includes('no acceptance packet comment'));
  assert.ok(console_.includes('print the packet as a preview line'));
  assert.ok(!console_.includes('no Verification Brief comment'));
  const plan = flat(read('_shared/observation-plan.md').split('\n## ')[0]);
  assert.ok(plan.includes('of an acceptance packet (`_shared/acceptance-packet.md`), or of a legacy Verification Brief'), plan);
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

test('every Routing call site remains in ## Routing (AC6)', () => {
  const routing = section(brief(), '## Routing — read this before anything else, whatever invoked this file', '## Try it block (every record, before either branch)');
  for (const row of [
    "| `/claude-tweaks:wrap-up` Phase 4 execution's Acceptance-labeling bullet (`wrap-up/execution-and-verification.md`) |",
    "| `/claude-tweaks:wrap-up`'s auto-merge short-circuit (`wrap-up/review-console.md`) |",
    "| `/claude-tweaks:dispatch`'s group auto-merge gate (`dispatch/settle-and-merge.md`) |",
    "| `/claude-tweaks:dispatch`'s close-out step 3 (`dispatch/close-out.md`) |",
    '| `_shared/pr-first-merge-post-merge.md` Step 4.0b (post-merge) |',
    "| `/claude-tweaks:tidy`'s `Open parent gate` action (",
  ]) {
    assert.ok(routing.includes(row), `Routing keeps ${row}`);
  }
  // Each row is not enough: the routing must still end in the pending label above the floor.
  const rule = flat(routing);
  assert.ok(rule.includes('run the Parent-Gate Procedure below in place of — not alongside — Steps 1-4'), 'a parent-resolvable record');
  assert.ok(rule.includes('run the **Oversight-floor gate** below, then Steps 1-4, applying `demo:pending` to the record itself only when the gate says the record clears the floor'), 'any other record');
  const post = between(step4(), 'acceptance-packet.js" post', '\n```');
  assert.ok(post.includes('--label demo:pending'), `the post fence applies the pending label: ${post}`);
  assert.ok(flat(step4()).includes('`--label` omitted below the floor (Decision Q5)'), 'and drops it below the floor');
});

test('every pasted gather value has a stated grammar, and {surface} is pasted only inside the gather fence', () => {
  const doc = brief();
  const rule = flat(between(step4(), 'Several pasted values come from text the plugin did not write', '- `--run` —'));
  assert.ok(rule.includes('Paste a value only when it matches its grammar; otherwise omit its flag and say so in the summary'), rule);
  for (const literal of [
    '`{surface}`: exactly one of `web`, `mobile`, `desktop`, `backend`, `infra`, `terminal`',
    '`{integration-branch}` and `{head}`: letters, digits and `.` `_` `/` `-` only',
    '`{local-url}`: an `http://` or `https://` URL with no `"`, backtick, `$`, `\\` or whitespace',
    '(`{run-dir}`, `{spec}`, `{report}`, `{qa-report}`, `{stories-dir}`, and Post\'s `{record-file}`)',
  ]) {
    assert.ok(rule.includes(literal), `states ${literal}`);
  }
  // Every `--flag "{value}"` the gather fence pastes from non-plugin text is named by that rule.
  const fence = between(step4(), 'acceptance-packet.js" gather', '\n```');
  const governed = ['{surface}', '{integration-branch}', '{head}', '{local-url}', '{run-dir}', '{spec}', '{report}', '{qa-report}', '{stories-dir}'];
  for (const placeholder of governed) assert.ok(fence.includes(placeholder), `the fence pastes ${placeholder}`);
  const pasted = [...fence.matchAll(/\{[a-z-]+\}/g)].map((m) => m[0]);
  assert.deepStrictEqual(pasted.filter((p) => !governed.includes(p) && p !== '{N}'), [], 'no lowercase placeholder escapes the grammar rule');
  assert.ok(rule.includes('`{N}` and `{pr-number}`: digits only'), rule);
  // No other bash fence in the file pastes {surface}.
  const fences = [...doc.matchAll(/```bash\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.deepStrictEqual(fences.filter((f) => f.includes('{surface}')).length, 1, 'only the gather fence pastes {surface}');
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

// ---- Task 11: readers find the packet ----

const MARKER = '<!-- acceptance-packet: v1 -->';
const ENTRY = 'demo/entry-paths.md';
const DEMO = 'demo/SKILL.md';
const LANDED = '_shared/acceptance-labeling-landed.md';
const recordLookup = () => between(read(ENTRY), '## `#N` given: single-record lookup', '### PR run-comment lookup');
const packetRead = () => flat(paragraphAt(recordLookup(), '**Read the acceptance packet first**'));
const localFiles = () => flat(between(recordLookup(), '**`work-backend: local-files`:**', 'reconstructs the same way'));
const demoStep2 = () => section(read(DEMO), '## Step 2: Per-item walkthrough', '### The design contract this was built against');
const packetRender = () => flat(paragraphAt(demoStep2(), '**An acceptance packet renders as a packet.**'));
const liveTier = () => flat(section(read(LANDED), '## Live-state tier', '## Outcomes'));

test('demo #N names the packet marker before any legacy brief form and takes the earliest trusted one', () => {
  const doc = read(ENTRY);
  assert.ok(recordLookup().includes(MARKER), 'the lookup names the marker');
  assert.ok(doc.indexOf(MARKER) < doc.indexOf('## Verification Brief'), 'the marker comes first');
  const paragraph = packetRead();
  for (const literal of ['earliest trusted comment by `createdAt`', 'first line is exactly', '`_shared/acceptance-packet.md`', 'Trusted authors', 'skip notice']) {
    assert.ok(paragraph.includes(literal), `names ${literal}`);
  }
});

test('demo selects by a marker of any version, as readPacket does, and reads only v1', () => {
  const paragraph = packetRead();
  assert.ok(paragraph.includes('whose first line is exactly an acceptance-packet marker of any version'), paragraph);
  assert.ok(paragraph.includes('matching `readPacket`'), paragraph);
  assert.ok(paragraph.includes(`Read it if that line is \`${MARKER}\``), paragraph);
  assert.ok(paragraph.includes('even with a v1 comment later'), paragraph);
  const comment = (body, createdAt) => ({ body, createdAt, authorAssociation: 'OWNER', url: body });
  const read2 = readPacket([comment(MARKER, '2021-01-01T00:00:00Z'), comment('<!-- acceptance-packet: v2 -->', '2020-01-01T00:00:00Z')]);
  assert.strictEqual(read2.status, 'unreadable', 'the earliest marker of any version decides');
  assert.strictEqual(read2.version, 2);
});

test('a failed comment read falls through to the label and closing-commit recovery only', () => {
  const paragraph = packetRead();
  assert.ok(paragraph.includes('falls through only to the label check and the closing-commit recovery below, never to the legacy brief forms'), paragraph);
  assert.ok(!paragraph.includes('the lookup continues below'), paragraph);
});

test('the Skip text tells a below-floor record the truth: no scan resurfaces it', () => {
  const doc = flat(read(DEMO));
  const option = between(doc, '- Option 3 — for a label-backed entry', 'For a session-recall entry');
  assert.ok(option.includes('`exceedsOversightFloor`'), 'names the predicate that decides');
  const above = between(option, 'Above the floor:', 'Below the floor');
  assert.ok(above.includes("acceptance-gap scan will surface it again"), above);
  const below = option.slice(option.indexOf('Below the floor'));
  assert.ok(below.includes('below the oversight floor no disposition is owed'), below);
  assert.ok(below.includes('/claude-tweaks:demo #N still reads the packet'), below);
  assert.ok(!below.includes('acceptance-gap scan will surface'), below);
  const scan = flat(read('_shared/github-pr-scan-acceptance.md'));
  assert.ok(scan.includes('a record that closed below the floor never needed a disposition in the first place'), 'the premise stays true');
  assert.ok(flat(read('tidy/step-1-records.md')).includes('Shape 8 filters out below-floor candidates'), 'the premise stays true');
  const recovery = flat(between(recordLookup(), 'If the record carries **no** pending acceptance label', 'on disk'));
  assert.ok(recovery.includes('Above the oversight floor this is the population'), recovery);
  assert.ok(recovery.includes('both filter a below-floor record out, since it owes no disposition'), recovery);
});

test('the packet stands in for the brief, and the legacy forms are reached only with no trusted packet', () => {
  const paragraph = packetRead();
  assert.ok(paragraph.includes('its Test guide stands in for the Try it block'), paragraph);
  assert.ok(paragraph.includes('its `### Observation plan` appendix is the plan Step 2 walks'), paragraph);
  assert.ok(paragraph.includes('Only when no trusted packet exists does the lookup fall back'), paragraph);
});

test('the packet read does not depend on a pending label, so a below-floor packet has a reader (Decision Q5)', () => {
  const lookup = recordLookup();
  assert.ok(packetRead().includes("whatever the record's labels"), packetRead());
  assert.ok(packetRead().includes('carries a packet and no pending label'), packetRead());
  assert.ok(lookup.indexOf('**Read the acceptance packet first**') < lookup.indexOf('If the labels just fetched'), 'ahead of the label branch');
  assert.ok(lookup.indexOf('**Read the acceptance packet first**') < lookup.indexOf('recover that **closing'), 'ahead of the closing-commit recovery');
  const wrapUp = flat(belowFloor());
  assert.ok(wrapUp.includes('`/claude-tweaks:demo #N` reads its packet, whatever its labels'), wrapUp);
  assert.ok(!wrapUp.includes('closing-commit-reconstruction fallback'), wrapUp);
});

test('an unreadable packet stops the ref and a failed read is stated', () => {
  const paragraph = packetRead();
  assert.ok(paragraph.includes('makes it an `unreadable` packet'), paragraph);
  assert.ok(paragraph.includes('stop this ref'), paragraph);
  assert.ok(paragraph.includes('a legacy brief beside it never stands in'), paragraph);
  assert.ok(paragraph.includes('A failed read states so in one plain line above the verdict'), paragraph);
});

test('local-files reads the delimited packet first, then the legacy body section', () => {
  const paragraph = localFiles();
  const start = paragraph.indexOf('`<!-- acceptance-packet:start -->`');
  assert.notStrictEqual(start, -1, paragraph);
  assert.ok(paragraph.includes('`<!-- acceptance-packet:end -->`'), paragraph);
  assert.ok(paragraph.includes("whatever the record's facets"), paragraph);
  assert.ok(start < paragraph.indexOf('`## Verification Brief`'), 'the packet comes before the legacy section');
});

test('local-files delimiter wording matches the contract: whitespace around one changes nothing', () => {
  const paragraph = localFiles();
  assert.ok(!paragraph.includes('whole-line delimiters'), paragraph);
  assert.ok(paragraph.includes('each alone on its line, whitespace around it aside'), paragraph);
});

test('demo Step 2 renders a packet, never a fresh Try it block', () => {
  const step2 = demoStep2();
  const opener = step2.indexOf('**An acceptance packet renders as a packet.**');
  assert.notStrictEqual(opener, -1, 'the packet form is stated');
  assert.ok(opener < step2.indexOf('**Try it first'), 'ahead of the brief rules');
  assert.ok(opener < step2.indexOf('### Try it'), 'ahead of the first ### Try it mention');
  const paragraph = packetRender();
  for (const literal of [
    '`_shared/acceptance-packet.md`',
    'take its Test guide as the Try it block, hoisted to the top and rendered once',
    'render its remaining sections in order',
    'Never compose a fresh Try it block for a packet',
    "The packet's `### Observation plan` appendix is the plan the rest of this step walks",
    'A packet with no appendix',
    'apply to legacy briefs only',
  ]) {
    assert.ok(paragraph.includes(literal), `names ${literal}`);
  }
});

test('a packet on a record with no pending label takes the nothing-to-leave Skip wording and the no-variant Step 3 rule', () => {
  const doc = flat(read(DEMO));
  assert.ok(doc.includes('For a closing-commit reconstruction, or a packet on a record with no pending label (never pending'), 'Option 3');
  assert.ok(doc.includes('A closing-commit reconstruction, or a packet on a record with no pending label, needs no variant'), 'Step 3');
});

test('the landed check drops the stale premise and keeps the label check', () => {
  const doc = flat(read(LANDED));
  assert.ok(!doc.includes('issue pointer comment is a plain post'), 'the pointer premise is gone');
  assert.ok(doc.includes('demo:pending'), 'the label stays named');
  assert.ok(liveTier().includes('every record in the PR\'s `Fixes` lines carries a pending acceptance label'), liveTier());
  assert.ok(liveTier().includes('edits it in place'), 'the packet is edited in place on the record');
});

test('the live tier accepts a trusted packet comment on every Fixes record, wherever it takes a run comment', () => {
  const live = liveTier();
  const runComment = live.indexOf('<!-- run-comment: try-it -->');
  const packet = live.indexOf(`a trusted \`${MARKER}\` comment`);
  assert.ok(runComment !== -1 && packet > runComment, 'an alternative of the comment check');
  const clause = live.slice(runComment, live.indexOf('The tier lands'));
  for (const literal of ['every record in the PR\'s `Fixes` lines', 'at least one record', 'every comment read succeeded', 'an `unreadable` packet does not count', 'Decision Q5']) {
    assert.ok(clause.includes(literal), `names ${literal}`);
  }
});

test('the stale template citations are gone from the demo readers', () => {
  const skill = flat(read(DEMO));
  assert.ok(!skill.includes("`verification-brief.md`'s digest template"), 'SKILL.md Step 2');
  assert.ok(skill.includes('the template `wrap-up/verification-brief-parent-gate.md` now holds'), 'names where it lives');
  assert.ok(!skill.includes('brief plus `demo:pending`'), 'the floor paragraph');
  const entry = flat(read(ENTRY));
  assert.ok(!entry.includes("Step 4's `pr` object present branch"), 'the pointer paragraph');
  assert.ok(entry.includes('**A legacy brief under `pr-first` lives on the PR**'), entry);
  assert.ok(!entry.includes('`verification-brief.md` renders'), 'the session-recall shape');
  assert.ok(entry.includes("the same shape `wrap-up/verification-brief-parent-gate.md`'s template renders"), entry);
  assert.ok(entry.includes('**No comment anywhere carries the packet, the heading or the pointer**'), entry);
  assert.ok(entry.includes('a parent-linked sub-issue, or a below-floor record closed before the acceptance packet, had its walkthrough posted alone'), entry);
});

test('the stale brief wording is gone from the docs a reader meets first', () => {
  const readme = flat(readText(path.join(__dirname, '..', 'README.md')));
  assert.ok(readme.includes('posts an acceptance packet on the record, with demo:pending above the oversight floor'), 'README');
  assert.ok(!readme.includes('applies demo:pending + posts a Verification Brief on the record'), 'README');
  const card = read('help/reference-card.md');
  assert.ok(card.includes('| `/claude-tweaks:wrap-up` | Learnings (CLAUDE.md), acceptance packet (a parent\'s gate: Verification Brief) |'), 'the /help card');
  const ledger = flat(read('_shared/work-record.md'));
  assert.ok(!ledger.includes('applies `demo:pending` + posts the Verification Brief |'), 'the ledger row');
  assert.ok(ledger.includes('posts the acceptance packet, with `demo:pending` above the oversight floor'), 'the ledger row');
  assert.ok(ledger.includes('and posts an acceptance packet (`_shared/acceptance-packet.md`'), 'the axis bullet');
  assert.ok(!ledger.includes('and posts a Verification Brief (an issue comment'), 'the axis bullet');
  const lifecycle = flat(read('_shared/pr-early-run-lifecycle.md'));
  assert.ok(lifecycle.includes('only if a legacy pointer comment already exists on the issue'), lifecycle.slice(0, 80));
  assert.ok(lifecycle.includes('new runs post none'), 'names why');
  assert.ok(!lifecycle.includes('(Verification Brief routing,'), 'the routing it cited is gone');
});

test('the parent gate and comments prose no longer describe the retired below-floor path', () => {
  const gate = flat(read(PARENT_GATE));
  assert.ok(!gate.includes('same as a below-floor sub-issue record on the non-parent path'), 'Q5 retired it');
  assert.ok(gate.includes("like the non-parent path's below-floor record, no label"), 'the below-floor path');
  const comments = flat(read('_shared/pr-run-comments.md'));
  assert.ok(!comments.includes('which still post the plain marker'), 'new runs post no brief');
  assert.ok(comments.includes('single-spec runs, which posted the plain marker'));
});

test('the skill graph states the packet edges and no longer describes the brief as what wrap-up posts', () => {
  const graph = readText(path.join(__dirname, '..', 'docs', 'skill-graph.md'));
  const edge = '| `_shared/acceptance-packet.md` |';
  assert.ok(between(graph, '\n## demo\n', '\n## design-wrapper\n').includes(edge), 'the demo row');
  const wrapUp = graph.slice(graph.indexOf('\n## wrap-up\n'), graph.indexOf('\n## Provenance'));
  assert.ok(wrapUp.includes(edge), 'the wrap-up row');
  assert.ok(wrapUp.includes('`/wrap-up` posts the acceptance packet (`_shared/acceptance-packet.md`) and applies `demo:pending` above the oversight floor'), 'the /demo row');
  assert.ok(!wrapUp.includes('applies `demo:pending` and posts the Verification Brief'), 'the old /demo row');
  assert.ok(!wrapUp.includes('embedded in the brief for an above-floor record'), 'the old Try it placement');
  assert.ok(!graph.includes('`/wrap-up` (brief)'), 'the pr-run-comments row');
});
