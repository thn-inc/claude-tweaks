'use strict';
// tests/review-routing-line-prose-conformance.test.js — pins that
// skills/review/step3-routing.md cites bin/review-routing-line.js for every
// Step 3 Routing log line (#4488). Each bullet's cited command is executed
// against a fixture run dir, and the appended line must carry the route's
// release-gate token.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../plugin/bin/review-routing-line');
const { readText } = require('./helpers/read-skill');

const MD_PATH = path.join(__dirname, '..', 'plugin', 'skills', 'review', 'step3-routing.md');
const md = readText(MD_PATH);
const NOW = new Date(2026, 7, 16, 9, 5, 7).getTime();

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rrl-prose-'));
  roots.push(root);
  const main = path.join(root, 'main');
  const runDir = path.join(main, '.claude-tweaks', 'pipelines', '2026-08-16T090000-spec-12');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  return { main, runDir };
}

function deps(main, out) {
  return { now: () => NOW, cwd: () => main, mainRoot: main, stdout: (s) => out.push(['out', s]), stderr: (s) => out.push(['err', s]) };
}

// Shell-ish tokenizer for the cited commands: a double- or single-quoted span is one argv token, quotes stripped.
// A single-quoted span is literal (no expansion), which is what the real shell does with it.
function argvOf(command) {
  return [...command.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]);
}

function citedCommand(bulletLabel) {
  const bullet = md.split('\n').find((l) => l.startsWith(`- **${bulletLabel}** —`));
  assert.ok(bullet, `the ${bulletLabel} bullet must exist`);
  const span = bullet.match(/`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/review-routing-line\.js"[^`]*)`/);
  assert.ok(span, `the ${bulletLabel} bullet must cite review-routing-line.js in a backticked command`);
  return span[1];
}

// Fill the placeholders the way a real Step 3 routing site would, then drop the `node <script>` prefix.
function instantiate(command, severity, runDir, at = 'src/a.js:12') {
  const filled = command
    .split('"$PIPELINE_RUN_DIR"').join(`"${runDir}"`)
    .split('{severity}').join(severity)
    .split('{category}').join('security')
    .split('{file:line}').join(at)
    .split('{hash}').join('abc1234')
    .split('{n}').join('3');
  assert.doesNotMatch(filled, /\{[a-z:]+\}/, `every placeholder must be filled: ${filled}`);
  return argvOf(filled).slice(2);
}

const CASES = [
  { label: 'AUTO', severity: 'low', status: 'AUTO', token: 'applied low-severity' },
  { label: 'STAGED', severity: 'high', status: 'STAGED', token: 'high-severity finding' },
  { label: 'KEPT-PROMPT', severity: 'critical', status: 'KEPT-PROMPT', token: 'critical finding' },
];

for (const c of CASES) {
  test(`the ${c.label} bullet's cited composer command appends a ${c.status} line carrying its release token`, () => {
    const { main, runDir } = fixture();
    const out = [];
    const argv = instantiate(citedCommand(c.label), c.severity, runDir);
    assert.equal(run(argv, deps(main, out)), 0, `exit 0 for: ${argv.join(' ')}`);
    const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
    assert.match(text, new RegExp(`^- ${c.status} `, 'm'));
    assert.ok(text.includes(c.token), `appended line must carry "${c.token}": ${text}`);
  });
}

// #3792: a file name is git-supplied text — a double-quoted `$postId` would expand to empty in the real shell.
const DOLLAR_AT = 'app/routes/posts.$postId.tsx:12';

for (const c of CASES) {
  test(`the ${c.label} bullet single-quotes --category and --at, and a $-bearing location survives verbatim into the line`, () => {
    const command = citedCommand(c.label);
    assert.ok(command.includes("--category '{category}' --at '{file:line}'"), `--category and --at must be single-quoted: ${command}`);
    const { main, runDir } = fixture();
    const out = [];
    const argv = instantiate(command, c.severity, runDir, DOLLAR_AT);
    assert.equal(argv[argv.indexOf('--at') + 1], DOLLAR_AT, 'the single-quoted span tokenizes to exactly the location');
    assert.equal(run(argv, deps(main, out)), 0, `exit 0 for: ${argv.join(' ')}`);
    const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
    assert.ok(text.includes(DOLLAR_AT), `the $-bearing location must be logged verbatim: ${text}`);
  });
}

// #4484: the record-proposal paragraph is not a `- **Label** —` bullet, so it gets its own finder.
function recordProposalParagraph() {
  const paragraph = md.split('\n').find((l) => l.startsWith('**Staging a record proposal'));
  assert.ok(paragraph, 'step3-routing.md must carry a paragraph starting "**Staging a record proposal"');
  return paragraph;
}

// Each clause is one literal the paragraph must carry, so removing it turns exactly that clause red.
const RECORD_PROPOSAL_CLAUSES = [
  ['--id review-followup-1', 'stages under a review-followup id with a starting slot'],
  ['--allocate', 'allocates the number'],
  ['from the path its first stdout line prints', 'takes {n} from the path stage-item.js prints'],
  ['a literal `{n}` passed to `--id` exits 2', 'warns that a literal {n} id exits 2'],
  ['Finding: {severity} {category}', 'writes the Finding: header line'],
  ['above the blank line', 'places the Finding: line above the header blank line'],
  ["`tidy/console-backfill.md`'s File step", 'cites the File step for the body-after-blank-line convention'],
  ['session-tmp-resolve.js" --value review-followup-proposal.md', 'resolves a .md scratch path'],
  ['written `deferred`, its Resolution naming `staged/', 'writes the staged proposal ledger row deferred, naming its staged path'],
  ["Before composing, apply `_shared/materiality-floor.md`'s floor test", 'applies the materiality floor before composing'],
  ['other than `tangential` goes to the digest container', 'routes a below-floor non-tangential finding to the digest'],
  ['(`isMaterialityDuplicate`)', 'runs the digest dedup check'],
  ['`AUTO … materiality-floor:` audit line', 'logs the materiality-floor audit line'],
  ['skips the compose, stage and composer-log steps', 'skips compose, stage and composer-log for a digest-routed finding'],
  ['row is written `accepted`', 'writes the digest-routed ledger row accepted'],
  ['naming the digest comment URL on', 'names the digest comment URL in the digest-routed ledger row'],
  ['entry on `local-files`', 'names the specs/digest.md entry in the digest-routed ledger row on local-files'],
  ['when a run directory resolves', 'logs the audit line only when a run directory resolves'],
  ['end-of-run summary states the digest comment URL', 'states the digest comment URL and count in the end-of-run summary'],
  ['A `tangential` finding, or one that clears the floor, is staged', 'stages a tangential or floor-clearing finding'],
  ['A digest entry is not a work record', 'states a digest entry is not a work record'],
];

function missingRecordProposalClauses(paragraph) {
  return RECORD_PROPOSAL_CLAUSES.filter(([literal]) => !paragraph.includes(literal)).map(([, fact]) => fact);
}

function assertRecordProposalClauses(paragraph) {
  assert.deepEqual(missingRecordProposalClauses(paragraph), [], 'the record-proposal paragraph is missing clauses');
}

test('#4484: the record-proposal paragraph cites a composer command that stages a review-followup line', () => {
  const paragraph = recordProposalParagraph();
  const span = paragraph.match(/`(node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/review-routing-line\.js"[^`]*)`/);
  assert.ok(span, 'the record-proposal paragraph must cite review-routing-line.js in a backticked command');
  const { main, runDir } = fixture();
  const out = [];
  const argv = instantiate(span[1], 'high', runDir);
  assert.equal(run(argv, deps(main, out)), 0, `exit 0 for: ${argv.join(' ')}`);
  const text = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.match(text, /^- STAGED /m);
  assert.ok(text.includes('high-severity finding'), `appended line must carry "high-severity finding": ${text}`);
  assert.ok(text.includes('Stage path: staged/review-followup-3.md'), `appended line must name the review-followup stage path: ${text}`);
  assertRecordProposalClauses(paragraph);
});

for (const [literal, fact] of RECORD_PROPOSAL_CLAUSES) {
  test(`#4484 go-red: removing the clause that ${fact} turns that clause red`, () => {
    const paragraph = recordProposalParagraph();
    const doctored = paragraph.split(literal).join('');
    assert.notEqual(doctored, paragraph, `anchor: "${literal}" not found — proof cannot discriminate`);
    assert.deepEqual(missingRecordProposalClauses(doctored), [fact]);
    assert.throws(() => assertRecordProposalClauses(doctored));
  });
}

test('step3-routing.md carries no hand-typed Step 3 Routing template', () => {
  assert.doesNotMatch(md, /`[^`\n]*\{time\} — Step 3 Routing:/);
});
