// tests/issue-claims-stale-open-pr-conformance.test.js
// Pins _shared/issue-claims.md's "The lock" step 4 (#4423): the manual MCP claim path owes the same
// stale-claim in-flight check bin/claim-targets.js runs through claim-store.js's `staleClaimInFlightPr`
// — a TTL-expired claim whose run's marker sits on an open same-repo PR is in flight, not abandoned.
// Since #4596 step 4 calls bin/stale-claim-pr.js for that verdict instead of restating the marker-match
// rule, so the rule lives once, in code (tests/stale-claim-pr-cli.test.js pins it). Likewise
// claim-targets.md's resume route reads the PR body's `### Resume` line through bin/pr-resume-line.js
// since #4659, so that file no longer restates the line's shape.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { readText } = require('./helpers/read-skill');
const { HOST_DEFINITION, firstInvocation, exit3Sentence, listingLegProblems } = require('./helpers/stale-claim-host-pins');
const { RUN_ID_SHAPE } = require('../plugin/bin/lib/issues/claim-store');

const SKILLS = path.join(__dirname, '..', 'plugin', 'skills');
const ISSUE_CLAIMS = readText(path.join(SKILLS, '_shared', 'issue-claims.md'));
const CLAIM_TARGETS = path.join(SKILLS, 'flow', 'claim-targets.md');

function lockStep4() {
  const start = ISSUE_CLAIMS.indexOf("  4. **`state: 'tombstone'` or `'stale'`**");
  const end = ISSUE_CLAIMS.indexOf("  5. **`state: 'live'`**");
  assert.notEqual(start, -1, 'issue-claims.md must carry The lock step 4');
  assert.notEqual(end, -1, 'issue-claims.md must carry The lock step 5');
  assert.ok(end > start, 'step 5 must follow step 4');
  return ISSUE_CLAIMS.slice(start, end);
}

test('AC1.2: The lock step 4 names the stale-claim CLI on the MCP path (#4596)', () => {
  const step4 = lockStep4();
  assert.match(step4, /`'stale'` blob/, 'the check is keyed on the stale classification');
  assert.ok(step4.includes('bin/stale-claim-pr.js'), 'calls the one matcher implementation');
  assert.ok(step4.includes('--claim-file'), 'hands it the stale blob');
  assert.ok(step4.includes('--listing'), 'hands it the agent-fetched MCP listing');
  assert.ok(step4.includes('mcp__github__list_pull_requests'), 'lists open PRs through the MCP tool');
  assert.ok(step4.includes('staleClaimInFlightPr'), 'names the gh-CLI twin');
});

test('The lock step 4 runs the CLI first, lists PRs only on its exit 2 (gh absent), then re-runs with --listing (#4596)', () => {
  const step4 = lockStep4().replace(/\s+/g, ' ');
  const firstRun = step4.indexOf('bin/stale-claim-pr.js');
  const listing = step4.indexOf('mcp__github__list_pull_requests');
  assert.ok(firstRun !== -1 && listing > firstRun, 'the CLI runs before any MCP listing');
  assert.ok(!/stale-claim-pr\.js" --claim-file[^`]*--listing/.test(step4.slice(0, listing)), 'the first run carries no --listing');
  assert.match(step4, /Exit 2 means `gh` is absent: list the repo's open PRs/);
  assert.match(step4, /re-run it adding `--listing "\{that path\}"`/);
});

// #4794: the agent-composed call takes its host from origin through the seam. A bare --repo owner/repo
// means github.com, so the first call drops it; only the exit-3 re-run (an origin that does not parse,
// such as a sandbox proxy remote) and the MCP listing leg (the MCP's host is github.com, so listing and
// match share one host) pass one. `{host}` is defined once, here, at its first use in step 4.
// Step 4 also pins the sentence saying why the listing leg carries the MCP's host.
const WITH_REASON = { checkReason: true };
const TOMBSTONE_URL = 'https://{host}/{owner}/{repo}/pull/{number}';
const flatFile = () => ISSUE_CLAIMS.replace(/\s+/g, ' ');

test('AC1.2 (#4794): The lock step 4 first call carries no --repo; origin supplies the host', () => {
  const step4 = lockStep4().replace(/\s+/g, ' ');
  const call = firstInvocation(step4, 'step 4');
  assert.ok(call.includes('--claim-file "{CLASSIFY_INPUT path}"'), 'the invocation is the matcher call');
  assert.ok(!call.includes('--repo'), 'a bare --repo owner/repo would mean github.com');
  assert.ok(!step4.includes('--repo "{owner}/{repo}"'), 'no step-4 call passes a bare slug');
});

test('AC1.2 (#4794): exit 3 (origin does not parse) re-runs with a host-qualified --repo, never a bare owner/repo', () => {
  const step4 = lockStep4().replace(/\s+/g, ' ');
  assert.match(exit3Sentence(step4), /[Ee]xit 3/, 'the --repo sits in the exit-3 sentence');
  assert.ok(step4.includes('never a bare `owner/repo`'), 'a bare slug is ruled out');
});

test('AC1.2 (#4794): the --listing re-run adds --repo "github.com/{owner}/{repo}" (the MCP host), and only it does', () => {
  assert.deepEqual(listingLegProblems(lockStep4().replace(/\s+/g, ' '), WITH_REASON), []);
});

test('AC1.2 (#4794): `{host}` is defined once, and both tombstone sentences compare on it, not on github.com', () => {
  const flat = flatFile();
  const at = flat.indexOf(HOST_DEFINITION);
  assert.notEqual(at, -1, 'the definition is in the file, with its closing "else github.com"');
  assert.equal(flat.indexOf(HOST_DEFINITION, at + 1), -1, 'defined exactly once');
  assert.ok(lockStep4().replace(/\s+/g, ' ').includes(HOST_DEFINITION), 'defined in step 4, at its first use');
  assert.ok(!flat.includes('https://github.com/{owner}/{repo}/pull/{number}'), 'neither tombstone sentence pins github.com');
  assert.equal(flat.split(TOMBSTONE_URL).length - 1, 2, 'the step-4 and gh-path sentences both read {host}');
  assert.ok(flat.indexOf(HOST_DEFINITION) < flat.indexOf(TOMBSTONE_URL), 'the definition precedes the first use');
  assert.match(flat, /pull\/\{number\}`? URL[^.]*compared case-insensitively[^.]*trailing dots ignored/, 'the compare rule is stated');
});

// The gh-path tombstone sentence (the last `{host}` URL in the file) cites step 4's definition.
const refersBack = (flat) => flat.slice(flat.lastIndexOf(TOMBSTONE_URL)).slice(0, 200).includes('as defined in "The lock" step 4');

test('AC1.2 (#4794): the gh-path tombstone sentence refers back to the step-4 definition', () => {
  assert.ok(refersBack(flatFile()), 'it cites, not restates');
});

test('AC1.2 (#4794) control: each retargeted clause goes red alone', () => {
  const step4 = lockStep4().replace(/\s+/g, ' ');
  const flat = flatFile();
  const wrongHost = step4.replace('--repo "github.com/{owner}/{repo}"', '--repo "{host}/{owner}/{repo}"');
  assert.notEqual(wrongHost, step4);
  assert.ok(listingLegProblems(wrongHost, WITH_REASON).includes('missing'), 'the listing-leg check sees a changed host inside the span');
  const noReason = step4.replace("the MCP's host,", 'the host,');
  assert.notEqual(noReason, step4);
  assert.deepEqual(listingLegProblems(noReason, WITH_REASON), ['reason'], 'the listing-leg check sees a reworded reason');
  const bare = step4.replace('--claim-file "{CLASSIFY_INPUT path}"', '--claim-file "{CLASSIFY_INPUT path}" --repo "{owner}/{repo}"');
  assert.notEqual(bare, step4);
  assert.ok(firstInvocation(bare, 'step 4').includes('--repo'), 'the no---repo check sees a re-added bare --repo');
  const noClosing = flat.replace(', else `github.com`.', '.');
  assert.notEqual(noClosing, flat);
  assert.ok(!noClosing.includes(HOST_DEFINITION), 'trimming the closing fallback reds the definition pin');
  const noExit3 = step4.replace('Exit 3', 'Exit 4');
  assert.notEqual(noExit3, step4);
  assert.throws(() => assert.match(exit3Sentence(noExit3), /[Ee]xit 3/), 'the exit-3 attribution sees a missing exit 3');
  const noRefer = flat.replace('as defined in "The lock" step 4', 'as above');
  assert.notEqual(noRefer, flat);
  assert.ok(!refersBack(noRefer), 'the back-reference check sees a reworded citation');
  const twice = step4.replace('and match share one host)', 'and match share one host) --repo "github.com/{owner}/{repo}"');
  assert.notEqual(twice, step4);
  assert.deepEqual(listingLegProblems(twice, WITH_REASON), ['host carried by a call other than the listing leg'], 'the only-the-listing-leg check sees a second carrier');
  const github = flat.replace(TOMBSTONE_URL, 'https://github.com/{owner}/{repo}/pull/{number}');
  assert.notEqual(github, flat);
  assert.equal(github.split(TOMBSTONE_URL).length - 1, 1, 'the {host} count sees a reverted tombstone sentence');
});

test('AC1.1: The lock step 4 no longer restates the marker-match rule (#4596)', () => {
  const step4 = lockStep4().replace(/\s+/g, ' '); // prose wraps at ~98 columns
  for (const retired of [
    'claude-tweaks-run: {runId}',
    '<!-- claude-tweaks-run: {runId} -->',
    'head.repo.full_name',
    RUN_ID_SHAPE.source,
  ]) {
    assert.ok(!step4.includes(retired), `step 4 must not restate "${retired}" — bin/stale-claim-pr.js owns it`);
  }
});

test('The lock step 4 stale check fails open: a failed check falls through to the write (#4423)', () => {
  const step4 = lockStep4().replace(/\s+/g, ' ');
  assert.match(
    step4,
    /failure[^.]*non-zero exit[^.]*falls through to the write/,
    'a broken listing must never wedge the claim path',
  );
  assert.match(step4, /after one line saying the check failed — never silently/, 'as the gh twin\'s onError warning');
});

test('the run-id shape is restated only in flow/claim-targets.md (#4423, #4596)', () => {
  // bin/stale-claim-pr.js owns the stale-claim match now; the one remaining prose copy validates a run id
  // read from a tombstone's PR for the resume route, so it stays pinned to claim-store.js's RUN_ID_SHAPE.
  // The copy list is built by walking every skill file, never from a remembered list, so a new copy
  // anywhere under plugin/skills/ fails here (.claude/skills/prose-code-twin-pin).
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
  const copies = walk(SKILLS)
    .filter((f) => f.endsWith('.md') && readText(f).includes(RUN_ID_SHAPE.source))
    .map((f) => path.relative(SKILLS, f).split(path.sep).join('/'));
  assert.deepEqual(copies, ['flow/claim-targets.md'],
    'only flow/claim-targets.md states RUN_ID_SHAPE; every other skill file must call bin/stale-claim-pr.js');
});

function inFlightSection() {
  const text = readText(CLAIM_TARGETS);
  const start = text.indexOf('## Flow: Claim in-flight');
  assert.notEqual(start, -1, 'claim-targets.md must carry the in-flight card');
  const end = text.indexOf('\n- **4** —', start);
  assert.notEqual(end, -1, 'the in-flight section must end before the exit-4 bullet');
  return text.slice(start, end);
}

test('AC1.1, AC1.2: claim-targets.md no longer spells out the Resume line shape; it names the CLI (#4659)', () => {
  const text = readText(CLAIM_TARGETS).replace(/\s+/g, ' ');
  assert.ok(!text.includes('/claude-tweaks:flow "{target}" {next-step}'), 'the composed Resume-line template must be gone');
  const section = inFlightSection().replace(/\s+/g, ' ');
  assert.ok(!section.includes('PIPELINE_RUN_DIR="{run-dir}"'), 'the in-flight route must not restate the Resume line');
  assert.ok(section.includes('### Resume'), 'it still names the section it reads');
  assert.ok(section.includes('bin/pr-resume-line.js'), 'it names the CLI that parses it');
});

test('AC2.1: only a resume verdict routes into resume-confirmation.md; resolve or failure is the terminal card (#4659)', () => {
  const section = inFlightSection().replace(/\s+/g, ' ');
  assert.match(section, /pr-resume-line\.js" --body-file "\{body-file\}" --run-id "\{run-id\}"/);
  // two clauses end in the terminal card (the DISPATCH_HEADLESS skip and the verdict list); the verdict one is ours
  const terminal = section.split(/\. |; /)
    .filter((s) => s.includes('card above is the terminal output') && s.includes('`resolve`'));
  assert.equal(terminal.length, 1, 'exactly one terminal-card clause names the resolve verdict');
  assert.ok(terminal[0].includes('`failure`'), 'that clause also lists the CLI failure');
  assert.match(section, /`resume` verdict's own `target`/);
  // positive-only routing: every outcome the prose does not name (failed gh, non-zero exit, non-JSON stdout) keeps the card
  assert.match(section, /Route onward only on a `resume` verdict: follow `dispatch\/resume-confirmation\.md`/);
  assert.ok(!section.includes('Otherwise: follow'), 'routing must not be the complement of a stop list');
});
