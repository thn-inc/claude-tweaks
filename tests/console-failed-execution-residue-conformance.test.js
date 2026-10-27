// tests/console-failed-execution-residue-conformance.test.js — #4170: a Queue-writes item whose
// execution failed after `console-resolve.js` auto-resolved it is rewritten `keep-staged` so it reads
// as residue; refused-proposals.md carries the rewrite command, review-console.md step 7 routes a
// failed composer or create to it.
//
// Reading the live prose is the declared carve-out ([IL-80], skill-prose-conformance-tests): these
// sections restate a command that console-resolve.js executes, so editing them IS the response to a
// change there. Each `assert*` helper is the single assertion both the live-file test and its control
// call: the control doctors the live text in memory (the notEqual guard stops a replace that matched
// nothing) and expects the same helper to throw. The extracted commands are run, not just matched.
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const { readText } = require('./helpers/read-skill');

const ROOT = path.resolve(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const RESOLVE = require(path.join(ROOT, 'plugin', 'bin', 'console-resolve.js'));
const LOG_DECISION = require(path.join(ROOT, 'plugin', 'bin', 'log-decision.js'));
const { readRunResidue } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'residue.js'));

const REFUSED = read('plugin', 'skills', 'wrap-up', 'refused-proposals.md');
const REVIEW_CONSOLE = read('plugin', 'skills', 'wrap-up', 'review-console.md');

const HEADING = '## A failed execution is not a refusal';
const COMMAND = 'node "${CLAUDE_PLUGIN_ROOT}/bin/console-resolve.js" --run "{item-run-dir}" --set-item \'{name}\' --resolution keep-staged --reason \'{why}\'';

function doctor(text, pattern, replacement) {
  const out = text.replace(pattern, replacement);
  assert.notEqual(out, text, `control did not change the text: ${pattern}`);
  return out;
}

// --- the section and its command -------------------------------------------------

function failedExecutionSection(text) {
  const start = text.indexOf(`\n${HEADING}\n`);
  assert.notEqual(start, -1, `refused-proposals.md has no "${HEADING}" section`);
  const end = text.indexOf('\n## ', start + HEADING.length + 2);
  return text.slice(start, end === -1 ? undefined : end);
}

// The single line of the section's bash block.
function rewriteCommandLine(text) {
  const m = failedExecutionSection(text).match(/```bash\n([^\n]*)\n```/);
  assert.ok(m, 'the failed-execution section has no one-line bash block');
  return m[1];
}

function assertRefusedProposalsRoutesFailedExecution(text) {
  assert.equal(rewriteCommandLine(text), COMMAND, 'the failed-execution section lost its console-resolve.js --set-item command');
  const before = text.slice(0, text.indexOf(`\n${HEADING}\n`));
  assert.ok(!before.trimEnd().endsWith('renders in Queue writes as today.'), 'the failed-create sentence still closes the dry-run paragraph');
}

test('refused-proposals.md has the failed-execution section and its command', () => {
  assertRefusedProposalsRoutesFailedExecution(REFUSED);
});

test('control: a renamed heading or an edited command fails the section check', () => {
  assert.throws(() => assertRefusedProposalsRoutesFailedExecution(doctor(REFUSED, HEADING, '## A failed execution')), { message: /no "## A failed execution is not a refusal" section/ });
  assert.throws(() => assertRefusedProposalsRoutesFailedExecution(doctor(REFUSED, '--resolution keep-staged', '--resolution apply')), { message: /lost its console-resolve\.js --set-item command/ });
  const old = doctor(REFUSED, 'applied.\n\n## A failed', 'applied. A *failed* create (transport error on a valid proposal) is not a refusal — it renders in Queue writes as today.\n\n## A failed');
  assert.throws(() => assertRefusedProposalsRoutesFailedExecution(old), { message: /still closes the dry-run paragraph/ });
});

// --- the exit-5 split --------------------------------------------------------------

// Exit 5 is also an unknown/duplicate `{name}` or a non-rewritable item (item-resolution.js), so only a
// `no console.json` refusal may be dismissed; every other one must send the reader back to console.json.
function assertExit5Split(text) {
  const body = failedExecutionSection(text).replace(/\s+/g, ' ');
  assert.ok(body.includes('An exit 5 whose message names `no console.json`'), 'the section does not scope the nothing-to-do exit 5 to a `no console.json` message');
  assert.ok(body.includes('Any other exit-5 refusal'), 'the section does not say what any other exit-5 refusal means');
  assert.ok(!body.includes('Exit 5 means'), 'the section still treats every exit 5 as nothing to do');
}

test('the failed-execution section splits exit 5 into no-console.json and every other refusal', () => {
  assertExit5Split(REFUSED);
});

test('control: each half of the exit-5 split is load-bearing', () => {
  assert.throws(() => assertExit5Split(doctor(REFUSED, 'An exit 5 whose message names `no console.json`', 'An exit 5')), { message: /does not scope the nothing-to-do exit 5/ });
  assert.throws(() => assertExit5Split(doctor(REFUSED, 'Any other exit-5 refusal', 'Any other failure')), { message: /does not say what any other exit-5 refusal means/ });
  assert.throws(() => assertExit5Split(doctor(REFUSED, 'A can\'t-tell', 'Exit 5 means nothing. A can\'t-tell')), { message: /still treats every exit 5 as nothing to do/ });
});

// --- prose-code twin -------------------------------------------------------------

function rewriteFlags(text) {
  const flags = rewriteCommandLine(text).match(/--[a-z][a-z-]*/g) || [];
  assert.ok(flags.length > 0, 'the rewrite command passes no flags');
  return flags;
}

function assertFlagsInUsage(text, usage) {
  const missing = rewriteFlags(text).filter((f) => !usage.includes(f));
  assert.deepEqual(missing, [], `the rewrite command passes flags absent from console-resolve.js's USAGE: ${missing.join(' ')}`);
}

test("prose-code twin: every flag the rewrite command passes appears in console-resolve.js's USAGE", () => {
  assert.deepEqual(rewriteFlags(REFUSED).sort(), ['--reason', '--resolution', '--run', '--set-item']);
  assertFlagsInUsage(REFUSED, RESOLVE.USAGE);
  assert.throws(() => assertFlagsInUsage(REFUSED, doctor(RESOLVE.USAGE, '--set-item', '--set-itm')), { message: /absent from console-resolve\.js's USAGE: --set-item/ });
});

// --- extract-and-run -------------------------------------------------------------

// A real git checkout with policy `autonomy: unattended` and one run dir, as cli.test.js builds it.
function fixture(staged) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'failed-exec-residue-')));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  git('init', '-q'); git('config', 'user.email', 't@example.invalid'); git('config', 'user.name', 't'); git('commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), 'autonomy: unattended\n');
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-10-25T000000-record-7');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '');
  for (const [n, b] of Object.entries(staged)) fs.writeFileSync(path.join(runDir, 'staged', n), b);
  return { root, runDir };
}

// Shaped like cli.test.js's fakeExec: answers the git/gh reads the console-auto resolve makes.
function fakeExec(root) {
  return (cmd, args) => {
    if (cmd === 'git' && args[0] === 'rev-parse') return `${root}\n`;
    if (cmd === 'gh' && args[0] === 'issue' && args[1] === 'view') return JSON.stringify({ labels: [{ name: 'auto:merge' }], comments: [] });
    if (cmd === 'git' && args[0] === 'apply') return '';
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
}

function deps(fx) {
  const out = [];
  const err = [];
  return { d: { cwd: () => fx.root, mainRoot: fx.root, stdout: (s) => out.push(s), stderr: (s) => err.push(s), now: () => Date.parse('2026-10-25T12:00:00Z'), execFile: fakeExec(fx.root) }, out, err };
}

function fill(tokens, map) {
  return tokens.map((t) => Object.entries(map).reduce((s, [k, v]) => s.split(k).join(v), t));
}

// The rewrite command's argv after `node <script>`, placeholders filled.
function rewriteArgv(text, map) {
  const tokens = rewriteCommandLine(text).match(/"[^"]*"|'[^']*'|\S+/g).map((t) => (/^["']/.test(t) ? t.slice(1, -1) : t));
  return fill(tokens.slice(2), map);
}

function step7(text) {
  const line = text.split('\n').find((l) => l.startsWith('7. `Q#` queue writes'));
  assert.ok(line, 'review-console.md has no "7. `Q#` queue writes" step');
  return line;
}

// Step 7's first log-decision.js command (the SKIP line), argv after `node <script>`.
function step7SkipArgv(text, map) {
  const m = step7(text).match(/`node "\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/log-decision\.js" ([^`]*)`/);
  assert.ok(m, 'step 7 has no log-decision.js command to run');
  return fill(m[1].match(/"[^"]*"|'[^']*'|\S+/g).map((t) => (/^["']/.test(t) ? t.slice(1, -1) : t)), map);
}

// The two `{why}` strings refused-proposals.md names, read from its prose so rewording them is seen by the AC tests.
function whyTemplates(text) {
  const m = text.match(/`\{why\}` is `([^`]+)`\s+or\s+`([^`]+)`/);
  assert.ok(m, 'refused-proposals.md no longer names the {why} strings as "`{why}` is `…` or `…`"');
  return { create: m[1], shadowDup: m[2] };
}
const WHY_TEMPLATES = whyTemplates(REFUSED);
const whyOf = (template, code) => {
  assert.ok(template.includes('{code}'), `${template} carries no {code} placeholder`);
  return template.replace('{code}', code);
};

test('the {why} strings the AC tests use are the two the prose names', () => {
  assert.equal(whyOf(WHY_TEMPLATES.create, '1'), 'record create failed (exit 1)');
  assert.equal(whyOf(WHY_TEMPLATES.shadowDup, '2'), 'shadow-dup-proposal.js exited 2');
  assert.throws(() => whyTemplates(doctor(REFUSED, '`{why}` is', '`{why}` becomes')), { message: /no longer names the \{why\} strings/ });
});

const consoleJson = (runDir) => JSON.parse(fs.readFileSync(path.join(runDir, 'console.json'), 'utf8'));
const cleanup = (t, fx) => t.after(() => fs.rmSync(fx.root, { recursive: true, force: true }));

test('AC1.1: the documented rewrite, run on a console-auto fixture whose Queue write failed, leaves the item keep-staged and readRunResidue reports it', async (t) => {
  const fx = fixture({ 'leftover-1.md': 'Title: x\n\nbody\n' });
  cleanup(t, fx);
  assert.equal(await RESOLVE.run(['--run', fx.runDir, '--policy', 'console-auto'], deps(fx).d), 0);
  assert.equal(consoleJson(fx.runDir).items[0].resolution, 'apply');
  const argv = rewriteArgv(REFUSED, { '{item-run-dir}': fx.runDir, '{name}': 'leftover-1.md', '{why}': whyOf(WHY_TEMPLATES.create, '1') });
  const rewrite = deps(fx);
  assert.equal(await RESOLVE.run(argv, rewrite.d), 0, rewrite.err.join(''));
  const item = consoleJson(fx.runDir).items[0];
  assert.equal(item.resolution, 'keep-staged');
  assert.equal(item.reason, whyOf(WHY_TEMPLATES.create, '1'));
  assert.deepEqual(readRunResidue(fx.runDir).consoles[0].items.map((i) => i.id), ['leftover-1.md']);
});

test('AC2.1: a shadow-dup compose failure (exit 2 or 3) takes the same path and its SKIP line still appears', async (t) => {
  for (const code of ['2', '3']) {
    const fx = fixture({ 'leftover-1.md': 'a', 'leftover-1.md.shadow-dup': 'b' });
    cleanup(t, fx);
    const name = 'leftover-1.md.shadow-dup';
    assert.equal(await RESOLVE.run(['--run', fx.runDir, '--policy', 'console-auto'], deps(fx).d), 0);
    assert.equal(consoleJson(fx.runDir).items.find((i) => i.id === name).resolution, 'apply');

    const skipErr = [];
    const skipArgv = step7SkipArgv(REVIEW_CONSOLE, { '{item-run-dir}': fx.runDir, '{code}': code, '{name}': name });
    assert.equal(LOG_DECISION.run(skipArgv, { now: () => Date.parse('2026-10-25T12:00:00Z'), cwd: () => fx.root, mainRoot: fx.root, stdout: () => {}, stderr: (s) => skipErr.push(s) }), 0, skipErr.join(''));

    const why = whyOf(WHY_TEMPLATES.shadowDup, code);
    const rewrite = deps(fx);
    assert.equal(await RESOLVE.run(rewriteArgv(REFUSED, { '{item-run-dir}': fx.runDir, '{name}': name, '{why}': why }), rewrite.d), 0, rewrite.err.join(''));

    const decisions = fs.readFileSync(path.join(fx.runDir, 'decisions.md'), 'utf8');
    const skips = decisions.split('\n').filter((l) => l.startsWith('- SKIP ') && l.includes(`Shadow-dup proposal (skipped): condition: shadow-dup-proposal.js exited ${code} for ${name}`));
    assert.equal(skips.length, 1, decisions);
    const item = consoleJson(fx.runDir).items.find((i) => i.id === name);
    assert.equal(item.resolution, 'keep-staged');
    assert.equal(item.reason, why);
    assert.ok(readRunResidue(fx.runDir).consoles[0].items.some((i) => i.id === name));
  }
});

test('control: a rewrite command with a flag console-resolve.js lacks is refused by the same run', async (t) => {
  const fx = fixture({ 'leftover-1.md': 'Title: x\n\nbody\n' });
  cleanup(t, fx);
  assert.equal(await RESOLVE.run(['--run', fx.runDir, '--policy', 'console-auto'], deps(fx).d), 0);
  const mutated = doctor(REFUSED, '--set-item', '--bogus');
  const refused = deps(fx);
  assert.equal(await RESOLVE.run(rewriteArgv(mutated, { '{item-run-dir}': fx.runDir, '{name}': 'leftover-1.md', '{why}': 'x' }), refused.d), 2);
  assert.equal(consoleJson(fx.runDir).items[0].resolution, 'apply');
});

// --- the notification carries post-execution residue ------------------------------

// The Needs-a-human block console-resolve.js prints is computed before "On approval" executes, so it
// cannot list a Queue write a failed execution rewrote keep-staged; the PushNotification and the final
// stop carry `console-residue.js --run`'s stdout after execution instead.
const SHORT_CIRCUIT_HEADING = '## Auto-resolution short-circuit (`consoleAutoResolve`)';
const CARRIES_AFTER_EXECUTION = 'carry the residue as printed after that execution — the stdout of `node "${CLAUDE_PLUGIN_ROOT}/bin/console-residue.js" --run "$PIPELINE_RUN_DIR"`';
const STALE_CARRY = 'carry that block verbatim';

function assertNotificationCarriesPostExecutionResidue(text) {
  const start = text.indexOf(`\n${SHORT_CIRCUIT_HEADING}\n`);
  assert.notEqual(start, -1, `review-console.md has no "${SHORT_CIRCUIT_HEADING}" section`);
  const end = text.indexOf('\n## ', start + SHORT_CIRCUIT_HEADING.length + 2);
  const body = text.slice(start, end === -1 ? undefined : end).replace(/\s+/g, ' ');
  assert.ok(body.includes(CARRIES_AFTER_EXECUTION), 'the short-circuit does not say the PushNotification carries console-residue.js --run output printed after execution');
  assert.ok(!body.includes(STALE_CARRY), 'the short-circuit still carries the pre-execution Needs-a-human block verbatim');
  assert.ok(body.includes('after "On approval" has executed, carrying that `console-residue.js --run` output'), 'the PushNotification sentence is not ordered after execution');
}

test('the short-circuit carries console-residue.js --run output, printed after execution, into the PushNotification', () => {
  assertNotificationCarriesPostExecutionResidue(REVIEW_CONSOLE);
});

test('control: each half of the post-execution carry is load-bearing', () => {
  assert.throws(() => assertNotificationCarriesPostExecutionResidue(doctor(REVIEW_CONSOLE, 'carry the residue as printed after that execution', 'carry that block')), { message: /does not say the PushNotification carries console-residue\.js --run output/ });
  assert.throws(() => assertNotificationCarriesPostExecutionResidue(doctor(REVIEW_CONSOLE, 'render it with the table but do not carry it', 'carry that block verbatim')), { message: /still carries the pre-execution Needs-a-human block verbatim/ });
  assert.throws(() => assertNotificationCarriesPostExecutionResidue(doctor(REVIEW_CONSOLE, 'after "On approval" has executed, carrying', 'carrying')), { message: /not ordered after execution/ });
});
