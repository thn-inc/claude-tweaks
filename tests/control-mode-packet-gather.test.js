'use strict';
// #4620: the acceptance packet's gather reads the decisions a control-mode Review Console carried
// ({runDir}/packet-facts/decisions.json) and the packet renders them under "Decisions left for you".
// The writer is the real console-resolve.js run(), not a hand-written file, for the AC1.1 case.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { scratchDir } = require('./helpers/tmp-dir');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { readText } = require('./helpers/read-skill');
const { initRepo } = require('./helpers/git-fixtures');

const ROOT = path.join(__dirname, '..');
const consoleResolve = require(path.join(ROOT, 'plugin', 'bin', 'console-resolve.js'));
const packet = require(path.join(ROOT, 'plugin', 'bin', 'acceptance-packet.js'));
const { validateFactsShape } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'packet-validate'));
const { renderPacket } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'packet-render'));
const { SECTIONS } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'packet-contract'));
const { decisionFacts: gatherDecisionFacts } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'packet-gather'));
const { DECISION_RENDER_FIELDS } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'console', 'decision-facts'));

const HEADING = 'Decisions left for you';
const SUGGESTION = 'decide whether the finding holds; fix it or decline';
const NOTE = (runDir) => `could not read ${runDir}/packet-facts/decisions.json — carried decisions not shown`;

function checkout({ staged = {}, policy = 'control-mode: on\n' } = {}) {
  const root = fs.realpathSync(scratchDir('control-mode-gather-'));
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  initRepo(root, { name: 't', email: 't@example.invalid', cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }); git('commit', '-q', '--allow-empty', '-m', 'init');
  fs.mkdirSync(path.join(root, '.claude-tweaks'), { recursive: true });
  fs.writeFileSync(path.join(root, '.claude-tweaks', 'policy.yml'), policy);
  const runDir = path.join(root, '.claude-tweaks', 'pipelines', '2026-09-06T000000-record-7');
  fs.mkdirSync(path.join(runDir, 'staged'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
  fs.writeFileSync(path.join(runDir, 'work', '7-spec.md'), '---\nrecord: 7\n---\n');
  fs.writeFileSync(path.join(runDir, 'decisions.md'), '');
  for (const [n, b] of Object.entries(staged)) fs.writeFileSync(path.join(runDir, 'staged', n), b);
  return { root, runDir, out: path.join(root, 'facts.json') };
}

async function consoleRun(fx) {
  const execFile = (cmd, args) => {
    if (cmd === 'git' && args[0] === 'rev-parse') return `${fx.root}\n`;
    throw new Error(`unexpected exec: ${cmd} ${args.join(' ')}`);
  };
  const d = { cwd: () => fx.root, mainRoot: fx.root, stdout: () => {}, stderr: () => {}, now: () => Date.parse('2026-09-06T12:00:00Z'), execFile };
  assert.strictEqual(await consoleResolve.run(['--run', fx.runDir, '--policy', 'console-auto'], d), 0);
}

function gather(fx, extra = []) {
  let err = '';
  const code = packet.run(['gather', '--record', '7', '--out', fx.out, '--run', fx.runDir, ...extra], {
    cwd: () => fx.root, mainRoot: fx.root, stdout: () => {}, stderr: (s) => { err += s; },
  });
  return { code, err, facts: code === 0 ? JSON.parse(fs.readFileSync(fx.out, 'utf8')) : null };
}

const writeDecisions = (fx, content) => {
  fs.mkdirSync(path.join(fx.runDir, 'packet-facts'), { recursive: true });
  fs.writeFileSync(path.join(fx.runDir, 'packet-facts', 'decisions.json'), typeof content === 'string' ? content : JSON.stringify(content));
};

const renderOf = (facts) => renderPacket(facts, { schemaVersion: 1, claims: [] }).markdown;
function sectionLines(markdown, heading) {
  const lines = markdown.split('\n');
  const start = lines.indexOf(`### ${heading}`);
  assert.notStrictEqual(start, -1, `no heading ${heading}`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith('### '));
  return (end === -1 ? rest : rest.slice(0, end)).filter((l) => l !== '');
}
const decisionFacts = (facts) => facts.facts.filter((f) => f.kind === 'decision');

test('AC1.1: a contested finding carried by console-resolve.js appears under Decisions left for you', async () => {
  const fx = checkout({ staged: { 'review-contested-1.md': 'contested' } });
  await consoleRun(fx);
  const { code, err, facts } = gather(fx);
  assert.strictEqual(code, 0, err);
  const decisions = decisionFacts(facts);
  assert.strictEqual(decisions.length, 1, JSON.stringify(decisions));
  const [d] = decisions;
  assert.strictEqual(d.id, 'decision:review:review-contested-1.md');
  assert.strictEqual(d.source, 'decision-items');
  assert.strictEqual(d.origin, 'review');
  assert.ok(d.evidenceRef.endsWith('/staged/review-contested-1.md'), d.evidenceRef);
  assert.strictEqual(d.suggestedResolution, SUGGESTION);
  assert.ok(d.text.startsWith('Contested findings: review-contested-1.md'), d.text);
  assert.deepStrictEqual(validateFactsShape(facts).errors, []);
  const lines = sectionLines(renderOf(facts), HEADING);
  assert.deepStrictEqual(lines, [`- ${d.text} — decide: ${SUGGESTION}`]);
});

test('a decision fact without suggestedResolution renders today\'s line unchanged', () => {
  const facts = {
    schemaVersion: 1, record: 7, surface: null, allowedHosts: [], partial: [], refused: [],
    facts: [{ id: 'decision:a', kind: 'decision', status: 'passed', source: 'decision-items', text: 'Pick one' }],
  };
  assert.deepStrictEqual(sectionLines(renderOf(facts), HEADING), ['- Pick one']);
});

test('a credential in suggestedResolution is withheld, not rendered', () => {
  const secret = 'hunter2';
  const facts = {
    schemaVersion: 1, record: 7, surface: null, allowedHosts: [], partial: [], refused: [],
    facts: [{ id: 'decision:a', kind: 'decision', status: 'passed', source: 'decision-items', text: 'Pick one', suggestedResolution: `the password=${secret}` }],
  };
  const markdown = renderOf(facts);
  assert.ok(!markdown.includes(secret), markdown);
});

const PROSE = path.join(ROOT, 'plugin', 'skills', '_shared', 'acceptance-packet.md');
const FIELDS = ['origin', 'summary', 'evidenceRef', 'suggestedResolution'];
function assertFieldsListed(prose) {
  assert.deepStrictEqual([...DECISION_RENDER_FIELDS], FIELDS, 'DECISION_RENDER_FIELDS is the four optional render fields');
  const line = prose.split('\n').find((l) => l.startsWith('A fact is `{ id, kind, status')) ?? '';
  const factsDocument = prose.slice(prose.indexOf('**The facts document**'), prose.indexOf('**Fact kinds:**'));
  for (const field of FIELDS) {
    assert.ok(factsDocument.includes(`\`${field}\``), `acceptance-packet.md does not list the decision field ${field} (${line.slice(0, 30)})`);
  }
}

test('acceptance-packet.md lists each decision field as an optional render field, and OPTIONAL_TEXT_FIELDS carries each', () => {
  const prose = readText(PROSE);
  assertFieldsListed(prose);
  // control: drop suggestedResolution from the prose and the assertion goes red
  assert.throws(() => assertFieldsListed(prose.replace(/`suggestedResolution`/g, '`x`')), /does not list the decision field suggestedResolution/);
  // the validator holds each field to a string, so OPTIONAL_TEXT_FIELDS carries it
  for (const field of FIELDS) {
    const facts = { schemaVersion: 1, record: 7, surface: null, allowedHosts: [], partial: [], refused: [], facts: [{ id: 'decision:a', kind: 'decision', status: 'passed', source: 'decision-items', [field]: 5 }] };
    assert.ok(validateFactsShape(facts).errors.some((e) => e.path.endsWith(`.${field}`)), field);
  }
});

test('decisionFacts copies each string field, leaves absent and non-string ones absent, and {id,text} yields today\'s fact', () => {
  const [full] = gatherDecisionFacts([{ id: 'decision:review:abc', text: 't', origin: 'review', summary: 's', evidenceRef: 'e', suggestedResolution: 'r' }]);
  assert.deepStrictEqual(full, { id: 'decision:review:abc', kind: 'decision', status: 'passed', source: 'decision-items', text: 't', origin: 'review', summary: 's', evidenceRef: 'e', suggestedResolution: 'r' });
  const [partial] = gatherDecisionFacts([{ id: 'x', text: 't', origin: 'console', summary: 5, suggestedResolution: null }]);
  assert.deepStrictEqual(Object.keys(partial).sort(), ['id', 'kind', 'origin', 'source', 'status', 'text']);
  assert.deepStrictEqual(gatherDecisionFacts([{ id: 'x', text: 't' }]), [{ id: 'decision:x', kind: 'decision', status: 'passed', source: 'decision-items', text: 't' }]);
});

test('AC4.5: a carried coordination item with spaces and # in its id renders one line', () => {
  const fx = checkout();
  const id = 'decision:review:decision:- STAGED 09:59:00 — x#ab12cd34';
  writeDecisions(fx, [{ id, text: 't' }]);
  const { code, err, facts } = gather(fx);
  assert.strictEqual(code, 0, err);
  const decisions = decisionFacts(facts);
  assert.strictEqual(decisions.length, 1);
  assert.match(decisions[0].id, /^decision:[A-Za-z0-9._\/#:@%-]+$/);
  assert.deepStrictEqual(sectionLines(renderOf(facts), HEADING), ['- t']);
});

test('an unreadable decisions.json is stated as partial, never silence', () => {
  const fx = checkout();
  writeDecisions(fx, '{');
  const { code, err, facts } = gather(fx);
  assert.strictEqual(code, 0, err);
  assert.ok(facts.partial.includes(NOTE(fx.runDir)), JSON.stringify(facts.partial));
  assert.strictEqual(decisionFacts(facts).length, 0);
});

test('a decisions.json with a malformed entry is stated as partial too', () => {
  const fx = checkout();
  writeDecisions(fx, [{ id: 'decision:a', text: 't', suggestedResolution: 5 }]);
  const { facts } = gather(fx);
  assert.ok(facts.partial.includes(NOTE(fx.runDir)), JSON.stringify(facts.partial));
  assert.strictEqual(decisionFacts(facts).length, 0);
});

test('AC5.1: no decisions.json omits the section and adds no partial note', () => {
  const fx = checkout();
  const { code, err, facts } = gather(fx);
  assert.strictEqual(code, 0, err);
  assert.strictEqual(decisionFacts(facts).length, 0);
  assert.ok(!facts.partial.some((n) => n.includes('decisions.json')), JSON.stringify(facts.partial));
  assert.ok(!renderOf(facts).includes(`### ${HEADING}`));
  assert.ok(SECTIONS.some(({ key }) => key === 'decisions'));
});

test('a named --decision-items wins over the run-dir file', () => {
  const fx = checkout();
  writeDecisions(fx, [{ id: 'decision:review:from-run', text: 'run' }]);
  const named = path.join(fx.root, 'named.json');
  fs.writeFileSync(named, JSON.stringify([{ id: 'named', text: 'named one' }]));
  const { facts } = gather(fx, ['--decision-items', named]);
  assert.deepStrictEqual(decisionFacts(facts).map((f) => f.text), ['named one']);
  // and an unreadable named file keeps its own note, with the run-dir file still not consulted
  const bad = gather(fx, ['--decision-items', path.join(fx.root, 'missing.json')]);
  assert.strictEqual(decisionFacts(bad.facts).length, 0);
  assert.ok(bad.facts.partial.some((n) => n.includes('--decision-items')), JSON.stringify(bad.facts.partial));
});

function assertBriefNamesRead(brief) {
  const start = brief.indexOf('Pass no `--scope`');
  const slice = brief.slice(start, brief.indexOf('Gather non-zero', start)).replace(/\s+/g, ' ');
  assert.ok(slice.includes('packet-facts/decisions.json'), 'the Step 4 slice does not name packet-facts/decisions.json');
  assert.ok(slice.includes('with no `--decision-items`'), 'the Step 4 slice does not say the read happens with no --decision-items');
}

test('verification-brief names the run-dir decisions.json read', () => {
  const brief = readText(path.join(ROOT, 'plugin', 'skills', 'wrap-up', 'verification-brief.md'));
  assertBriefNamesRead(brief);
  assert.throws(() => assertBriefNamesRead(brief.replace('packet-facts/decisions.json', 'x')), /does not name packet-facts\/decisions\.json/);
  assert.throws(() => assertBriefNamesRead(brief.replace('with no `--decision-items`', 'x')), /with no --decision-items/);
});
