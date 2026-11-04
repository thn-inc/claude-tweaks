'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { readText } = require('./helpers/read-skill');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

test('wrap-up SKILL.md calls wrap-up-pack.js --run exactly once, in Phase 3 (#1930 AC5)', () => {
  const skill = read('plugin/skills/wrap-up/SKILL.md');
  // The ledger-only `--print ledger` call is a narrowed re-count, not a second full pack (#3566).
  const fullPack = /wrap-up-pack\.js" --run "\$PIPELINE_RUN_DIR"(?! --print)/g;
  assert.strictEqual((skill.match(fullPack) || []).length, 1);
  const phase3 = skill.indexOf('## Phase 3');
  const phase4 = skill.indexOf('## Phase 4');
  fullPack.lastIndex = 0;
  const call = fullPack.exec(skill).index;
  assert.ok(phase3 < call && call < phase4, 'the call lives in Phase 3');
  const recount = skill.indexOf('wrap-up-pack.js" --run "$PIPELINE_RUN_DIR" --print ledger');
  assert.ok(phase3 < recount && recount < phase4, 'the ledger re-count call lives in Phase 3');
});

test('every pack-reading sub-file cites wrap-up-pack.json and states the absent-file fallback (#1930 AC5)', () => {
  for (const f of ['residue-sweep', 'unblocked-records', 'cleanup-procedures', 'review-console', 'auto-merge-short-circuit', 'summary-template']) {
    const t = read(`plugin/skills/wrap-up/${f}.md`);
    assert.ok(t.includes('wrap-up-pack.json'), `${f} cites the pack`);
    assert.ok(/absent/.test(t), `${f} states the absent-file fallback`);
  }
});

test('merge-check.md documents the --pack input and keeps the CLI path (#1930 AC6)', () => {
  const t = read('plugin/skills/assess-agent-autonomy/merge-check.md');
  assert.ok(t.includes('--pack'));
  assert.ok(t.includes('could-not-gather'));
  assert.ok(t.includes('bin/blast-radius.js'));
});

test('the pack keeps exactly the eight probe names the skill prose enumerates (#1930)', () => {
  const { PROBE_NAMES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'pack.js'));
  const skill = read('plugin/skills/wrap-up/SKILL.md');
  for (const n of PROBE_NAMES) assert.ok(skill.includes(`\`${n}\``), `SKILL.md names probe ${n}`);
  assert.strictEqual(PROBE_NAMES.length, 8);
  assert.ok(!PROBE_NAMES.includes('release'), 'the release probe was removed (#1930 review I5)');
  // The probe is gone (#1930 fix round 4), and #3310 removed its only
  // consumer, the pre-merge merge-size step.
  assert.ok(!PROBE_NAMES.includes('mergeSize'), 'the mergeSize probe was removed (#1930 fix round 4)');
  assert.ok(!skill.includes('`mergeSize`'), 'SKILL.md no longer enumerates mergeSize');
});

test('every pack field the pack produces has a prose consumer that reads it (#1930 review I5)', () => {
  const { PROBE_NAMES } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'pack.js'));
  const corpus = [
    'plugin/skills/wrap-up/SKILL.md', 'plugin/skills/wrap-up/residue-sweep.md', 'plugin/skills/wrap-up/unblocked-records.md',
    'plugin/skills/wrap-up/cleanup-procedures.md', 'plugin/skills/wrap-up/review-console.md', 'plugin/skills/wrap-up/review-console-interactive.md',
    'plugin/skills/wrap-up/auto-merge-short-circuit.md', 'plugin/skills/wrap-up/summary-template.md',
  ].map(read).join('\n');
  for (const n of PROBE_NAMES) assert.ok(corpus.includes(`pack.${n}`), `no prose consumer reads pack.${n}`);
});

// #4793 Q2: the `work-links: native` snippet in unblocked-records.md carries the
// same cross-repository filter pack.js applies. Each check has its own message,
// so a control can prove the check it targets (not whichever fails first).
const NATIVE_SNIPPET_MESSAGES = {
  require: 'native snippet requires { withoutCrossRepoBlockers, foreignBlockerBlocks } from bin/lib/issues/record.js',
  strip: 'native snippet removes crossRepoBlockers numbers before the includes(closedNum) test',
  foreign: 'native snippet keeps a dependent blocked by a foreign blocker that is not CLOSED',
  legacy: 'native snippet no longer tests the raw blockedBy.includes(closedNum)',
};

function nativeSnippetOf(text) {
  const at = text.indexOf("bin/resolve-blockers.js', records");
  assert.notStrictEqual(at, -1, 'the work-links: native snippet is present in unblocked-records.md');
  const start = text.lastIndexOf('```bash', at);
  const end = text.indexOf('\n```', at);
  assert.ok(start !== -1 && end !== -1, 'the native snippet sits in a bash fence');
  return text.slice(start, end);
}

function assertNativeSnippetSkipsCrossRepo(text) {
  // Collapse whitespace so a hard-wrapped snippet still matches.
  const snippet = nativeSnippetOf(text).replace(/\s+/g, ' ');
  assert.ok(
    snippet.includes("const { withoutCrossRepoBlockers, foreignBlockerBlocks } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/record.js')"),
    NATIVE_SNIPPET_MESSAGES.require,
  );
  assert.ok(
    snippet.includes('withoutCrossRepoBlockers(byNumber[r.number].blockedBy, byNumber[r.number].crossRepoBlockers).includes(closedNum)'),
    NATIVE_SNIPPET_MESSAGES.strip,
  );
  assert.ok(
    snippet.includes('!(byNumber[r.number].crossRepoBlockers || []).some(foreignBlockerBlocks)'),
    NATIVE_SNIPPET_MESSAGES.foreign,
  );
  assert.ok(!snippet.includes('byNumber[r.number].blockedBy.includes(closedNum)'), NATIVE_SNIPPET_MESSAGES.legacy);
}

test('#4793 Q2: the unblocked-records.md native snippet skips cross-repository blocker numbers', () => {
  assertNativeSnippetSkipsCrossRepo(read('plugin/skills/wrap-up/unblocked-records.md'));
});

test('#4793 Q2 go-red: each native-snippet check throws with its own message on a mutated copy', () => {
  const original = read('plugin/skills/wrap-up/unblocked-records.md');
  const call = 'withoutCrossRepoBlockers(byNumber[r.number].blockedBy, byNumber[r.number].crossRepoBlockers)';
  const mutations = {
    require: original.replace('const { withoutCrossRepoBlockers, foreignBlockerBlocks } = require(', 'const { withoutCrossRepoBlockers } = require('),
    strip: original.replace(call, 'byNumber[r.number].blockedBy'),
    foreign: original.replace(' && !(byNumber[r.number].crossRepoBlockers || []).some(foreignBlockerBlocks)', ''),
    legacy: original.replace('.map((r) => ({ number: r.number, title: r.title }));', '.map((r) => ({ number: r.number, title: r.title })); /* byNumber[r.number].blockedBy.includes(closedNum) */'),
  };
  for (const [key, mutated] of Object.entries(mutations)) {
    assert.notEqual(mutated, original, `${key}: the mutation matched nothing`);
    assert.throws(() => assertNativeSnippetSkipsCrossRepo(mutated), { message: NATIVE_SNIPPET_MESSAGES[key] }, key);
  }
});

// #4793: the body-declared half. Both snippets that decide dependents in a node
// body keep a dependent blocked by a `Blocked by owner/name#N` foreign blocker that
// is open or unreadable. A fact list (conformance-asserts.js) gives each check its
// own name, and assertEachPatternGoesRed proves each one by stripping only it.
const { missingFactsOf, assertEachPatternGoesRed } = require('./helpers/conformance-asserts');

const collapsed = (text) => text.replace(/\s+/g, ' ');
const REFS_JS = "require\\('\\$\\{CLAUDE_PLUGIN_ROOT\\}/bin/lib/issues/cross-repo-refs\\.js'\\)";
const STATES_JS = "require\\('\\$\\{CLAUDE_PLUGIN_ROOT\\}/bin/lib/issues/cross-repo-states\\.js'\\)";

// From the body-text paragraph to the native one: pass 1, the sentence, pass 2.
function bodyTextRegionOf(text) {
  const start = text.indexOf('`work-links: body-text`');
  const end = text.indexOf('`work-links: native`');
  assert.ok(start !== -1 && end > start, 'the work-links: body-text region is present in unblocked-records.md');
  return collapsed(text.slice(start, end));
}

const BODY_TEXT_FACTS = [
  [new RegExp(`const \\{ parseCrossRepoDependencies \\} = ${REFS_JS}`), 'body-text pass 1 requires parseCrossRepoDependencies from cross-repo-refs.js'],
  [/foreignRefs: parseCrossRepoDependencies\(r\.body\)/, 'body-text pass 1 maps foreignRefs: parseCrossRepoDependencies(r.body)'],
  [new RegExp(`const \\{ resolveForeignStates \\} = ${STATES_JS}`), 'body-text pass 2 requires resolveForeignStates from cross-repo-states.js'],
  [new RegExp(`const \\{ foreignEntries \\} = ${REFS_JS}`), 'body-text pass 2 requires foreignEntries from cross-repo-refs.js'],
  [/const \{ foreignBlockerBlocks \} = require\('\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/lib\/issues\/record\.js'\)/, 'body-text pass 2 requires foreignBlockerBlocks from record.js'],
  [/const states = resolveForeignStates\(dependents\.flatMap\(\(d\) => d\.foreignRefs\)\)/, 'body-text pass 2 resolves every dependent foreignRefs in one resolveForeignStates call'],
  [/!foreignEntries\(d\.foreignRefs, states\)\.some\(foreignBlockerBlocks\)/, 'body-text pass 2 keeps a dependent blocked by a foreign blocker that is not CLOSED'],
];

const NATIVE_BODY_FACTS = [
  [new RegExp(`const \\{ parseCrossRepoDependencies, foreignEntries, bodyOnlyForeign \\} = ${REFS_JS}`), 'native snippet requires parseCrossRepoDependencies, foreignEntries, bodyOnlyForeign from cross-repo-refs.js'],
  [new RegExp(`const \\{ resolveForeignStates \\} = ${STATES_JS}`), 'native snippet requires resolveForeignStates from cross-repo-states.js'],
  [/bodyOnlyForeign\(byNumber\[r\.number\]\.crossRepoBlockers \|\| \[\], foreignEntries\(parseCrossRepoDependencies\(r\.body\), new Map\(\)\)\)/, 'native snippet drops body refs already natively linked before the lookup'],
  [/const states = resolveForeignStates\(candidates\.flatMap\(bodyRefs\)\)/, 'native snippet resolves every candidate body ref in one resolveForeignStates call'],
  [/!foreignEntries\(bodyRefs\(r\), states\)\.some\(foreignBlockerBlocks\)/, 'native snippet keeps a dependent blocked by a body-declared foreign blocker that is not CLOSED'],
];

test('#4793: both unblocked-records.md snippets keep a dependent blocked by a body-declared foreign blocker', () => {
  const text = read('plugin/skills/wrap-up/unblocked-records.md');
  assert.deepStrictEqual(missingFactsOf(BODY_TEXT_FACTS)(bodyTextRegionOf(text)), []);
  assert.deepStrictEqual(missingFactsOf(NATIVE_BODY_FACTS)(collapsed(nativeSnippetOf(text))), []);
});

test('#4793 go-red: stripping any one body-declared foreign check turns exactly that check red', () => {
  const text = read('plugin/skills/wrap-up/unblocked-records.md');
  assertEachPatternGoesRed(bodyTextRegionOf(text), BODY_TEXT_FACTS, missingFactsOf(BODY_TEXT_FACTS));
  assertEachPatternGoesRed(collapsed(nativeSnippetOf(text)), NATIVE_BODY_FACTS, missingFactsOf(NATIVE_BODY_FACTS));
});

test('#4793: the body-text sentence names the foreign check and the native paragraph speaks of this repository\'s blockers', () => {
  const text = collapsed(read('plugin/skills/wrap-up/unblocked-records.md'));
  assert.ok(text.includes('no `Blocked by owner/name#N` line names another repository\'s blocker that is still open or whose state is unreadable'), 'body-text sentence names the foreign check');
  assert.ok(text.includes('every one of this repository\'s blockers'), 'native paragraph no longer claims every blocker is resolved');
  assert.ok(!text.includes('every one of the record\'s blockers'), 'the contradictory wording is gone');
});

test('every inputs field a closing-keyword reader relies on is produced by resolveInputs and read by prose (#3399)', () => {
  const { resolveInputs } = require(path.join(ROOT, 'plugin', 'bin', 'lib', 'wrap-up', 'pack.js'));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wrap-up-pack-3399-'));
  let inputs;
  try {
    const runDir = path.join(tmp, '.claude-tweaks', 'pipelines', 'r1');
    fs.mkdirSync(path.join(runDir, 'work'), { recursive: true });
    fs.writeFileSync(path.join(runDir, 'work', '3399-spec.md'), '---\nrecord: 3399\n---\n');
    const deps = {
      readFile: (p) => fs.readFileSync(p, 'utf8'),
      readdir: (p) => { try { return fs.readdirSync(p); } catch { return []; } },
      resolvePolicy: () => ({}),
      git: () => { throw new Error('no git'); },
      ghSync: () => { throw new Error('no gh'); },
    };
    inputs = resolveInputs({ runDir, cwd: tmp, deps });
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.ok(Array.isArray(inputs.closingRecords));
  assert.strictEqual(typeof inputs.parkedAtShaping, 'object');
  const corpus = ['cleanup-procedures-execution', 'execution-and-verification', 'review-console', 'cleanup-procedures']
    .map((f) => read(`plugin/skills/wrap-up/${f}.md`)).join('\n');
  for (const f of ['closingRecords', 'parkedAtShaping']) assert.ok(corpus.includes(`inputs.${f}`), `no prose consumer reads inputs.${f}`);
});
