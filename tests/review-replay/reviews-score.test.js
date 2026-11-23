'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, makeWriteRepo } = require('../../tools/review-replay');
const { parseReviewItems, parseBranchReply } = require('../../tools/review-replay/reviews-score');
const { parseReviewCounts } = require('../../tools/pipeline-cost-report/guards');
const { armLabel, toPosix, REVIEWS_MANIFEST_FILE, REVIEWS_FIXTURE_FILE } = require('../../tools/review-replay/schema');
const { scratchDir } = require('../helpers/tmp-dir');
const { buildReviewsFixture, buildBranchFixture, cleanEnv } = require('./reviews-fixture');

const PLUGIN_ROOT = path.join(__dirname, '..', '..', 'plugin');
const NOTES = [
  'Confirmed recall rewards an arm that behaves like the archive: the confirmed set comes from the archived tier\'s own output.',
  'A new row is neither noise nor signal until sampled.',
  'A clean repository holds two commits, so git log and git blame differ from the archived review.',
];
const ARMS = ['--arm', 'name=near,profile=fast', '--arm', 'name=far,profile=fast'];
const ONE_3A = ['--lens', '3a', '--max-per-lens', '1'];

let root;
const fixtures = {};
before(() => {
  root = scratchDir('rr-reviews-score-');
  fixtures.plain = buildReviewsFixture(path.join(root, 'plain'));
  fixtures.repeat = buildReviewsFixture(path.join(root, 'repeat'), { repeat: true });
  fixtures.edges = buildReviewsFixture(path.join(root, 'edges'), { edges: true });
});

function makeDeps(fx) {
  const logs = [];
  const errs = [];
  const git = (args) => execFileSync('git', args, { cwd: fx.mainRoot, env: cleanEnv(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  return { fs, git, writeRepo: makeWriteRepo(fx.mainRoot), pluginRoot: PLUGIN_ROOT, log: (s) => logs.push(s), err: (s) => errs.push(s), logs, errs };
}

// One extract-reviews run per (fixture, argv), shared by the tests that read it: score-reviews only reads --out.
const extractions = new Map();
// `arms` replaces the near and far arms.
function extracted(name, args = [], arms = ARMS) {
  const key = `${name}\0${[...arms, ...args].join(' ')}`;
  if (!extractions.has(key)) {
    extractions.set(key, (async () => {
      const fx = fixtures[name];
      const out = path.join(root, `out-${extractions.size}`);
      const deps = makeDeps(fx);
      const code = await run({ argv: ['extract-reviews', '--runs', fx.runsRoot, '--out', out, '--role', 'lens', '--transcripts', fx.transcripts, ...arms, ...args], deps });
      assert.equal(code, 0, deps.errs.join('\n'));
      return { fx, out, manifest: JSON.parse(fs.readFileSync(path.join(out, REVIEWS_MANIFEST_FILE), 'utf8')) };
    })());
  }
  return extractions.get(key);
}

const table = (...rows) => ['| Severity | Path:Line | Finding | Evidence |', '|---|---|---|---|', ...rows].join('\n');
const rowAt = (file, line) => `| high | ${file}:${line} | x | e |`;
const slotOf = (prompt) => prompt.name.split('/').pop();

let wfN = 0;
// A workflow directory for an extraction: one agent per arm x repeat x prompt, its first user message the identity
// line, one assistant entry 90 seconds later carrying its arm's effort (omitted for a null-effort arm) and its reply.
// replyFor({ arm, repeat, prompt, slot }) returns the reply, or undefined for an agent with no result.
function workflow(x, replyFor, { effortFor = (arm) => arm.effort } = {}) {
  wfN += 1;
  const dir = path.join(root, `wf-${wfN}`);
  fs.mkdirSync(dir);
  const started = [];
  const results = [];
  let n = 0;
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  for (const arm of x.manifest.arms) {
    for (let repeat = 1; repeat <= arm.repeat; repeat += 1) {
      for (const prompt of arm.prompts) {
        n += 1;
        const id = `ag-${n}`;
        const reply = replyFor({ arm, repeat, prompt, slot: slotOf(prompt) });
        const effort = effortFor(arm);
        const entries = [
          { type: 'user', timestamp: new Date(t0).toISOString(), message: { role: 'user', content: `Replay judge ${armLabel(arm.name, repeat, prompt.name)}.` } },
          {
            type: 'assistant', ...(effort === null ? {} : { effort }), timestamp: new Date(t0 + 90000).toISOString(),
            message: { id: `m-${n}`, usage: { output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, content: [{ type: 'text', text: reply === undefined ? '' : reply }] },
          },
        ];
        fs.writeFileSync(path.join(dir, `agent-${id}.jsonl`), `${entries.map((e) => JSON.stringify(e)).join('\n')}\n`);
        started.push({ type: 'started', agentId: id });
        if (reply !== undefined) results.push({ type: 'result', agentId: id, result: reply });
      }
    }
  }
  fs.writeFileSync(path.join(dir, 'journal.jsonl'), `${[...started, ...results].map((e) => JSON.stringify(e)).join('\n')}\n`);
  return dir;
}

async function scoreReviews(x, dir, extra = []) {
  const deps = makeDeps(x.fx);
  const code = await run({ argv: ['score-reviews', '--out', x.out, '--transcripts', dir, ...extra], deps });
  return { code, deps, json: deps.logs.length > 0 ? JSON.parse(deps.logs.join('\n')) : null };
}

const noFindings = () => 'No findings.';
const byArm = (map) => ({ arm }) => (Object.prototype.hasOwnProperty.call(map, arm.name) ? map[arm.name] : 'No findings.');

test('AC5.1: a row 3 lines off is caught, a far row is not', async () => {
  const x = await extracted('plain', ONE_3A);
  assert.deepEqual(x.manifest.arms.find((a) => a.name === 'near').prompts.map(slotOf), ['3a-a']);
  const r = await scoreReviews(x, workflow(x, byArm({ near: table(rowAt('src/a.js', 13)), far: table(rowAt('src/a.js', 30)) })));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.deepEqual(r.json.arms.near.lenses['3a'].confirmed, { caught: 1, of: 1, unlocated: 0 });
  assert.deepEqual(r.json.arms.far.lenses['3a'].confirmed, { caught: 0, of: 1, unlocated: 0 });
});

test('AC5.2: the NEAR_LINES boundary', async () => {
  const x = await extracted('plain', ONE_3A);
  const r = await scoreReviews(x, workflow(x, byArm({ near: table(rowAt('src/a.js', 15)), far: table(rowAt('src/a.js', 16)) })));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.deepEqual(r.json.arms.near.lenses['3a'].confirmed, { caught: 1, of: 1, unlocated: 0 });
  assert.deepEqual(r.json.arms.far.lenses['3a'].confirmed, { caught: 0, of: 1, unlocated: 0 });
});

test('per-slot recall sums the sides', async () => {
  const x = await extracted('repeat');
  const near = x.manifest.arms.find((a) => a.name === 'near');
  assert.deepEqual(near.prompts.filter((p) => p.lens === '3a').map(slotOf).sort(), ['3a-a', '3a-a.2', '3a-b']);
  const r = await scoreReviews(x, workflow(x, ({ arm, prompt }) => (arm.name === 'near' && prompt.lens === '3a' ? table(rowAt('src/a.js', 13)) : 'No findings.')));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  // 3a-a.2 re-reviews a later head, after the confirmed findings were fixed: it scores apart from first passes.
  assert.deepEqual(r.json.arms.near.lenses['3a'].confirmed, { caught: 2, of: 2, unlocated: 0 });
  assert.deepEqual(r.json.arms.near.lenses['3a'].confirmedRereview, { caught: 1, of: 1, unlocated: 0 });
  assert.deepEqual(r.json.arms.far.lenses['3a'].confirmed, { caught: 0, of: 2, unlocated: 0 });
  assert.deepEqual(r.json.arms.far.lenses['3a'].confirmedRereview, { caught: 0, of: 1, unlocated: 0 });
  // A re-review still counts everywhere else.
  assert.equal(r.json.arms.near.lenses['3a'].reviews, 3);
  assert.deepEqual(r.json.arms.near.lenses['3a'].archived, { caught: 1, of: 1 });
});

test('byRepeat counts first passes only', async () => {
  const x = await extracted('repeat', [], ['--arm', 'name=near,profile=fast,repeat=2', '--arm', 'name=far,profile=fast']);
  const r = await scoreReviews(x, workflow(x, ({ arm, prompt }) => (arm.name === 'near' && prompt.lens === '3a' ? table(rowAt('src/a.js', 13)) : 'No findings.')));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  const L = r.json.arms.near.lenses['3a'];
  assert.deepEqual(L.byRepeat, { 1: { caught: 2, of: 2 }, 2: { caught: 2, of: 2 } });
  assert.deepEqual(L.confirmedRereview, { caught: 2, of: 2, unlocated: 0 });
});

test('rows with no :line are counted in rowsUnlocated, not read as found-nothing', async () => {
  const x = await extracted('plain', ONE_3A);
  const unlocated = '| high | src/a.js | x | e |';
  const r = await scoreReviews(x, workflow(x, byArm({ near: table(unlocated), far: table(rowAt('src/a.js', 10), unlocated, unlocated) })));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.equal(r.json.arms.near.lenses['3a'].rowsUnlocated, 1);
  assert.deepEqual(r.json.arms.near.lenses['3a'].confirmed, { caught: 0, of: 1, unlocated: 0 });
  assert.equal(r.json.arms.far.lenses['3a'].rowsUnlocated, 2);
  assert.deepEqual(r.json.arms.far.lenses['3a'].confirmed, { caught: 1, of: 1, unlocated: 0 });
  assert.equal(r.json.arms.control.lenses['3a'].rowsUnlocated, 0);
});

test('a reviewer with no reply is no-reply, one with no identity is unidentified-agent, and both exit 3', async () => {
  const x = await extracted('plain', ONE_3A);
  // Agents are numbered in manifest order: ag-1 near, ag-2 far, ag-3 control.
  const dir = workflow(x, ({ arm }) => (arm.name === 'near' ? undefined : 'No findings.'));
  fs.rmSync(path.join(dir, 'agent-ag-2.jsonl'));
  const r = await scoreReviews(x, dir);
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.arms.near.notJudgedByReason, { 'no-reply': 1 });
  assert.deepEqual(r.json.arms.far.notJudgedByReason, { 'unidentified-agent': 1 });
  assert.equal(r.json.unidentifiedAgents, 1);
  assert.equal(r.json.arms.near.lenses['3a'].reviews, 0);
  assert.equal(r.json.arms.far.lenses['3a'].reviews, 0);
  assert.equal(r.json.arms.control.notJudged, 0);
});

test('an effort-mismatched reviewer whose reply does not parse is effort-mismatch', async () => {
  const x = await extracted('plain', ONE_3A, [...ARMS, '--arm', 'name=low,profile=fast,effort=low']);
  const r = await scoreReviews(x, workflow(x, ({ arm }) => (arm.name === 'low' ? 'I looked around.' : 'No findings.'), { effortFor: (arm) => (arm.name === 'low' ? 'medium' : arm.effort) }));
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.arms.low.notJudgedByReason, { 'effort-mismatch': 1 });
});

test('fixture counts per lens', async () => {
  const x = await extracted('plain');
  const r = await scoreReviews(x, workflow(x, noFindings));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.deepEqual(r.json.fixture.byLens['3b'], { selected: 1, excludedByReason: { 'report-unparsed': 1 } });
  assert.deepEqual(r.json.fixture.byLens['3a'], { selected: 2, excludedByReason: {} });
});

test('AC6.1: an unparseable reply is could-not-parse and exits 3', async () => {
  const x = await extracted('plain');
  const r = await scoreReviews(x, workflow(x, ({ arm, slot }) => (arm.name === 'near' && slot === '3a-a' ? 'I looked around.' : 'No findings.')));
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.arms.near.notJudgedByReason, { 'could-not-parse': 1 });
  assert.equal(r.json.arms.near.notJudged, 1);
  assert.equal(r.json.arms.near.scored, 2);
  // A review that was not judged is never a found-nothing review: it adds nothing to recall.
  assert.deepEqual(r.json.arms.near.lenses['3a'].confirmed, { caught: 0, of: 1, unlocated: 0 });
  assert.equal(r.json.arms.far.notJudged, 0);
});

test('AC6.2: No findings is a scored review with zero rows', async () => {
  const x = await extracted('plain');
  const r = await scoreReviews(x, workflow(x, ({ prompt }) => (prompt.lens === '3a' ? table(rowAt('src/a.js', 12)) : 'No findings.')));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.deepEqual(x.manifest.arms.find((a) => a.name === 'near').prompts.filter((p) => p.lens === '3b').map(slotOf), ['3b-a']);
  for (const name of ['near', 'far', 'control']) {
    const lens = r.json.arms[name].lenses['3b'];
    assert.equal(lens.reviews, 1, name);
    assert.equal(Object.values(lens.rowsBySeverity).reduce((s, v) => s + v, 0), 0, name);
    assert.equal(r.json.arms[name].notJudged, 0, name);
  }
  assert.deepEqual(r.json.arms.near.lenses['3a'].rowsBySeverity, { critical: 0, high: 2, medium: 0, low: 0, info: 0, overflow: 0 });
});

test('a reviewer recorded at the wrong effort is not judged, is counted at its recorded effort, and leaves the control arm judged', async () => {
  const x = await extracted('plain', ONE_3A, [...ARMS, '--arm', 'name=low,profile=fast,effort=low']);
  const r = await scoreReviews(x, workflow(x, noFindings, { effortFor: (arm) => (arm.name === 'low' ? 'medium' : arm.effort) }));
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.arms.low.notJudgedByReason, { 'effort-mismatch': 1 });
  assert.deepEqual(r.json.arms.low.recordedEffort, { medium: 1 });
  assert.equal(r.json.arms.low.lenses['3a'].reviews, 0);
  assert.equal(r.json.arms.control.notJudged, 0);
});

test('AC9.2: fidelity per lens from the control arm', async () => {
  const x = await extracted('plain');
  // Only the control arm's replies count: arm near catches every archived row, control only the 3a one.
  const r = await scoreReviews(x, workflow(x, ({ arm, slot }) => {
    if (slot === '3a-a' && (arm.name === 'control' || arm.name === 'near')) return table(rowAt('src/a.js', 10));
    if (slot === '3b-a' && arm.name === 'near') return table(rowAt('src/b.js', 4));
    return 'No findings.';
  }));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.deepEqual(r.json.fidelity['3a'], { caught: 1, of: 1, share: 1 });
  assert.deepEqual(r.json.fidelity['3b'], { caught: 0, of: 1, share: 0 });
  for (const [name, arm] of Object.entries(r.json.arms)) {
    assert.deepEqual(arm.lenses['3a'].fidelity, r.json.fidelity['3a'], name);
    assert.deepEqual(arm.lenses['3b'].fidelity, r.json.fidelity['3b'], name);
  }
  assert.deepEqual(r.json.arms.near.lenses['3b'].archived, { caught: 1, of: 1 });
});

test('fidelity aggregates every control arm, not only one named control', async () => {
  const x = await extracted('edges', [], ['--arm', 'name=near,profile=fast']);
  const controls = x.manifest.arms.filter((a) => a.name.startsWith('control.')).map((a) => a.name);
  assert.ok(controls.length >= 2, controls.join(', '));
  assert.ok(!x.manifest.arms.some((a) => a.name === 'control'));
  const r = await scoreReviews(x, workflow(x, ({ arm, slot }) => (arm.name !== 'near' && slot === '3a-a' ? table(rowAt('src/a.js', 10)) : 'No findings.')));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.deepEqual(r.json.fidelity['3a'], { caught: 1, of: 1, share: 1 });
  assert.deepEqual(r.json.fidelity['3f'], { caught: 0, of: 0, share: null });
  assert.equal(r.json.reference, 'near');
});

test('a slot whose unit has no readable decisions.md counts in confirmedMissingSource and adds nothing to confirmed', async () => {
  const x = await extracted('edges', [], ['--arm', 'name=near,profile=fast']);
  const r = await scoreReviews(x, workflow(x, () => table(rowAt('src/b.js', 2))));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  const near = r.json.arms.near.lenses;
  assert.deepEqual(near['3i'].confirmed, { caught: 0, of: 0, unlocated: 0 });
  assert.equal(near['3i'].confirmedMissingSource, 1);
  assert.equal(near['3i'].reviews, 1);
  assert.deepEqual(near['3g'].confirmed, { caught: 1, of: 1, unlocated: 0 });
  assert.equal(near['3g'].confirmedMissingSource, 0);
});

test('rows citing the absolute repo path still score', async () => {
  const x = await extracted('plain', ONE_3A);
  const r = await scoreReviews(x, workflow(x, ({ arm, prompt }) => (arm.name === 'near' ? table(rowAt(`${toPosix(prompt.repo)}/src/a.js`, 10)) : 'No findings.')));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.deepEqual(r.json.arms.near.lenses['3a'].confirmed, { caught: 1, of: 1, unlocated: 0 });
  assert.equal(r.json.arms.near.lenses['3a'].new, 0);
});

test('the output opens with the three notes', async () => {
  const x = await extracted('plain', ONE_3A);
  const r = await scoreReviews(x, workflow(x, noFindings));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.deepEqual(r.json.notes, NOTES);
  assert.equal(Object.keys(r.json)[0], 'notes');
});

test('archived, new, vsReference, byRepeat and cost per arm', async () => {
  const x = await extracted('plain', ONE_3A, ['--arm', 'name=near,profile=fast,repeat=2', '--arm', 'name=far,profile=fast']);
  const replies = {
    'near|1': table(rowAt('src/a.js', 13), rowAt('src/a.js', 40)),
    'near|2': table(rowAt('src/a.js', 40)),
    'far|1': table(rowAt('src/a.js', 40)),
  };
  const r = await scoreReviews(x, workflow(x, ({ arm, repeat }) => replies[`${arm.name}|${repeat}`] || 'No findings.'));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.equal(r.json.reference, 'near');
  const near = r.json.arms.near;
  assert.deepEqual(near.lenses['3a'].confirmed, { caught: 1, of: 2, unlocated: 0 });
  assert.deepEqual(near.lenses['3a'].byRepeat, { 1: { caught: 1, of: 1 }, 2: { caught: 0, of: 1 } });
  assert.deepEqual(near.lenses['3a'].archived, { caught: 1, of: 2 });
  assert.equal(near.lenses['3a'].new, 2);
  assert.equal(near.lenses['3a'].vsReference, null);
  assert.equal(near.scored, 2);
  assert.deepEqual(near.cost, { agents: 2, requests: 2, output: 20, cacheRead: 0, cacheCreate: 0, seconds: 180 });
  assert.equal(near.minutes, 3);
  assert.deepEqual(near.recordedEffort, { unrecorded: 2 });
  const far = r.json.arms.far.lenses['3a'];
  assert.ok(!('byRepeat' in far));
  // far's one repeat against both of near's: near raised 2 rows then 1, and far raised the a.js:40 one each time.
  assert.deepEqual(far.vsReference, { raised: 2, of: 3 });
  assert.deepEqual(r.json.arms.control.lenses['3a'].vsReference, { raised: 0, of: 3 });
  assert.equal(r.json.unidentifiedAgents, 0);
});

test('an unknown --reference exits 2 and a malformed manifest exits 1', async () => {
  const x = await extracted('plain', ONE_3A);
  const dir = workflow(x, noFindings);
  const bad = await scoreReviews(x, dir, ['--reference', 'nope']);
  assert.equal(bad.code, 2);
  assert.match(bad.deps.errs.join('\n'), /--reference: no arm "nope"/);
  assert.equal(bad.deps.logs.length, 0);
  const copy = path.join(root, 'malformed');
  fs.cpSync(x.out, copy, { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(copy, REVIEWS_MANIFEST_FILE), 'utf8'));
  fs.writeFileSync(path.join(copy, REVIEWS_MANIFEST_FILE), JSON.stringify({ ...manifest, kind: 'tiebreak' }));
  const malformed = await scoreReviews({ ...x, out: copy }, dir);
  assert.equal(malformed.code, 1);
  assert.match(malformed.deps.errs.join('\n'), /kind must be "reviews"/);
  assert.equal(malformed.deps.logs.length, 0);
});

test('score-reviews exits 2 when --out or --transcripts is missing', async () => {
  const deps = makeDeps(fixtures.plain);
  assert.equal(await run({ argv: ['score-reviews', '--out', root], deps }), 2);
  assert.equal(await run({ argv: ['score-reviews', '--transcripts', root], deps }), 2);
  assert.match(deps.errs.join('\n'), /score-reviews requires --transcripts/);
});

test('parseReviewItems: one item per counted line, located by its first path:line', () => {
  const text = ['### Issues', '#### Important (Should Fix)', '- src/x.js:10: null deref when y is unset', '- `/abs/src/a.js:3` and src/b.js:9 drift', '#### Minor', '1. naming could be clearer', '2. None.', '### Strengths', '- src/z.js:1 is tidy'].join('\n');
  const { items } = parseReviewItems(text);
  assert.deepEqual(items.map((i) => [i.sev, i.path, i.line]), [['important', 'src/x.js', 10], ['important', '/abs/src/a.js', 3], ['minor', null, null]]);
  assert.deepEqual(items[1].locations, [{ path: '/abs/src/a.js', line: 3 }, { path: 'src/b.js', line: 9 }]);
  assert.equal(items[0].text, 'src/x.js:10: null deref when y is unset');
  assert.deepEqual(parseReviewCounts(text), { critical: 0, important: 2, minor: 1 });
});

test('parseReviewItems agrees with parseReviewCounts', () => {
  const texts = [
    ['### Issues', '#### Important', '- src/x.js:10: bad', '#### Minor', '1. nit', '2. None.'].join('\n'),
    '#### Critical\n\n#### Important\nNone.\n#### Minor\n',
    '**Important**\n- src/x.js:1 bad',
    '',
  ];
  for (const t of texts) {
    const counts = parseReviewCounts(t);
    const parsed = parseReviewItems(t);
    assert.equal(parsed === null, counts === null);
    if (counts === null) continue;
    for (const sev of ['critical', 'important', 'minor']) {
      assert.equal(parsed.items.filter((i) => i.sev === sev).length, counts[sev]);
    }
  }
});

test('parseBranchReply: headings, "No issues", neither', () => {
  assert.deepEqual(parseBranchReply('#### Critical (Must Fix)\nNone.\n').items, []);
  assert.deepEqual(parseBranchReply('Reviewed it all. No issues found.').items, []);
  assert.equal(parseBranchReply('**Important**\n- src/x.js:1 bad'), null);
});

// ---- the task and whole-branch roles
const branchExtractions = new Map();
// One extract-reviews run per (role, fixture options): the branch fixture is `a` (fast) plus the control arms.
function extractedBranch(role, fxOpts = {}) {
  const key = `${role}\0${JSON.stringify(fxOpts)}`;
  if (!branchExtractions.has(key)) {
    branchExtractions.set(key, (async () => {
      const bRoot = path.join(root, `branch-${branchExtractions.size}`);
      const fx = buildBranchFixture(bRoot, fxOpts);
      const out = path.join(bRoot, 'out');
      const deps = makeDeps(fx);
      const code = await run({ argv: ['extract-reviews', '--runs', fx.runsRoot, '--out', out, '--role', role, '--transcripts', fx.transcripts, '--arm', 'name=a,profile=fast'], deps });
      assert.equal(code, 0, deps.errs.join('\n'));
      return { fx, out, manifest: JSON.parse(fs.readFileSync(path.join(out, REVIEWS_MANIFEST_FILE), 'utf8')) };
    })());
  }
  return branchExtractions.get(key);
}
const VERDICT = (v) => `Task quality: ${v}`;
const TASK_FIX = '#### Important\n- src/x.js:12 null\n\nTask quality: Needs fixes';

test('AC5.1: the Approved review replayed as Needs fixes is one verdict disagreement', async () => {
  const x = await extractedBranch('task');
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task' ? VERDICT('Needs fixes') : TASK_FIX)));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.equal(r.json.role, 'task');
  assert.deepEqual(r.json.arms.a.task.verdict, {
    agree: 1, disagree: 1, share: 0.5, byArchivedTier: { standard: { agree: 0, disagree: 1, share: 0 }, capable: { agree: 1, disagree: 0, share: 1 } },
  });
  assert.equal(r.json.arms.a.task.reviews, 2);
  assert.deepEqual(r.json.arms.a.task.itemsBySeverity, { critical: 0, important: 1, minor: 0 });
  // The headingless Needs fixes replay of review 1 has unknown items, so it is out of the per-review denominator.
  assert.deepEqual(r.json.arms.a.task.itemsPerReview, { critical: 0, important: 1, minor: 0 });
  assert.equal(r.json.arms.a.task.recall.replayItemsUnparsed, 1);
});

test('AC4.1: the unlocated Minor counts as unlocated 1 and is in no denominator', async () => {
  const x = await extractedBranch('task');
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task' ? VERDICT('Approved') : TASK_FIX)));
  assert.deepEqual(r.json.arms.a.task.recall, { caught: 1, of: 1, share: 1, unlocated: 1, itemsUnparsed: 0, replayItemsUnparsed: 0 });
});

test('task: a reply with no verdict line is notJudged could-not-parse, exit 3', async () => {
  const x = await extractedBranch('task');
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task' ? 'Looks fine to me.' : TASK_FIX)));
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.arms.a.notJudgedByReason, { 'could-not-parse': 1 });
  assert.equal(r.json.arms.a.scored, 1);
  assert.equal(r.json.arms.a.task.reviews, 1);
});

test('task: a missing reply is notJudged no-reply and adds nothing to the verdict tally', async () => {
  const x = await extractedBranch('task');
  const r = await scoreReviews(x, workflow(x, ({ arm, slot }) => (arm.name === 'a' && slot === 'task' ? undefined : TASK_FIX)));
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.arms.a.notJudgedByReason, { 'no-reply': 1 });
  assert.equal(r.json.arms.a.task.verdict.agree + r.json.arms.a.task.verdict.disagree, 1);
});

test('task: a replay far from the archived Important is not caught', async () => {
  const x = await extractedBranch('task');
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task' ? VERDICT('Approved') : '#### Important\n- src/x.js:16 null\n\nTask quality: Needs fixes')));
  assert.deepEqual(r.json.arms.a.task.recall, { caught: 0, of: 1, share: 0, unlocated: 1, itemsUnparsed: 0, replayItemsUnparsed: 0 });
});

test('task: an itemsUnparsed review scores its verdict and counts in recall.itemsUnparsed, not in of', async () => {
  const x = await extractedBranch('task', { boldLabel: true });
  const fixture = JSON.parse(fs.readFileSync(path.join(x.out, 'reviews-fixture.json'), 'utf8'));
  const t3 = fixture.slots.find((s) => s.agentId === 't3').name.split('/').pop();
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === t3 ? TASK_FIX : slot === 'task' ? VERDICT('Approved') : TASK_FIX)));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.equal(r.json.arms.a.task.reviews, 3);
  assert.equal(r.json.arms.a.task.verdict.agree, 3);
  assert.deepEqual(r.json.arms.a.task.recall, { caught: 1, of: 1, share: 1, unlocated: 1, itemsUnparsed: 1, replayItemsUnparsed: 0 });
});

test('task: a replay with a verdict but unparseable items scores its verdict and is neither found-nothing nor in the item rates', async () => {
  const x = await extractedBranch('task');
  const unparsed = '**Important**\n- src/x.js:12 null\n\nTask quality: Needs fixes';
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task' ? '#### Minor\n- a thing\n\nTask quality: Approved' : unparsed)));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  const t = r.json.arms.a.task;
  assert.deepEqual(t.verdict, { agree: 2, disagree: 0, share: 1, byArchivedTier: { standard: { agree: 1, disagree: 0, share: 1 }, capable: { agree: 1, disagree: 0, share: 1 } } });
  assert.deepEqual(t.recall, { caught: 0, of: 0, share: null, unlocated: 1, itemsUnparsed: 0, replayItemsUnparsed: 1 });
  assert.deepEqual(t.itemsBySeverity, { critical: 0, important: 0, minor: 1 });
  assert.deepEqual(t.itemsPerReview, { critical: 0, important: 0, minor: 1 });
  assert.equal(t.reviews, 2);
});

test('an item citing two locations is caught by a replay item near its second', async () => {
  const x = await extractedBranch('task');
  const copy = path.join(root, 'two-locations');
  fs.cpSync(x.out, copy, { recursive: true });
  const file = path.join(copy, 'archived-reports.json');
  const archived = JSON.parse(fs.readFileSync(file, 'utf8'));
  const key = Object.keys(archived.reports).find((k) => k.endsWith('/task.2'));
  archived.reports[key].items[0].locations.push({ path: 'src/q.js', line: 50 });
  fs.writeFileSync(file, JSON.stringify(archived));
  const reply = '#### Important\n- src/q.js:52 other\n\nTask quality: Needs fixes';
  const r = await scoreReviews({ ...x, out: copy }, workflow(x, ({ slot }) => (slot === 'task' ? VERDICT('Approved') : reply)));
  assert.deepEqual(r.json.arms.a.task.recall, { caught: 1, of: 1, share: 1, unlocated: 1, itemsUnparsed: 0, replayItemsUnparsed: 0 });
});

test('wholeBranch: recall of located items, the Critical-or-Important share, "No issues" scores zero items', async () => {
  const x = await extractedBranch('whole-branch');
  const near = await scoreReviews(x, workflow(x, () => '#### Minor\n- src/y.js:4 naming'));
  assert.equal(near.code, 0, near.deps.errs.join('\n'));
  assert.equal(near.json.role, 'whole-branch');
  assert.deepEqual(near.json.arms.a.wholeBranch, {
    reviews: 1, recall: { caught: 1, of: 1, share: 1, unlocated: 0 }, itemsBySeverity: { critical: 0, important: 0, minor: 1 },
    itemsPerReview: { critical: 0, important: 0, minor: 1 }, withCriticalOrImportant: { n: 0, share: 0 },
  });
  const important = await scoreReviews(x, workflow(x, () => '#### Important\n- src/y.js:40 far\n'));
  assert.deepEqual(important.json.arms.a.wholeBranch.recall, { caught: 0, of: 1, share: 0, unlocated: 0 });
  assert.deepEqual(important.json.arms.a.wholeBranch.withCriticalOrImportant, { n: 1, share: 1 });
  const none = await scoreReviews(x, workflow(x, () => 'Reviewed it. No issues found.'));
  assert.equal(none.code, 0, none.deps.errs.join('\n'));
  assert.deepEqual(none.json.arms.a.wholeBranch.itemsBySeverity, { critical: 0, important: 0, minor: 0 });
  assert.equal(none.json.arms.a.wholeBranch.recall.caught, 0);
  assert.equal(none.json.arms.a.wholeBranch.reviews, 1);
});

test('wholeBranch: an archived item with no location counts as unlocated and is in no denominator', async () => {
  const x = await extractedBranch('whole-branch');
  const copy = path.join(root, 'wb-unlocated');
  fs.cpSync(x.out, copy, { recursive: true });
  const file = path.join(copy, 'archived-reports.json');
  const archived = JSON.parse(fs.readFileSync(file, 'utf8'));
  const [key] = Object.keys(archived.reports);
  archived.reports[key].items.push({ sev: 'minor', text: 'vague', path: null, line: null, locations: [] });
  fs.writeFileSync(file, JSON.stringify(archived));
  const r = await scoreReviews({ ...x, out: copy }, workflow(x, () => '#### Minor\n- src/y.js:4 naming'));
  assert.deepEqual(r.json.arms.a.wholeBranch.recall, { caught: 1, of: 1, share: 1, unlocated: 1 });
});

test('wholeBranch: a bold-label-only reply is could-not-parse', async () => {
  const x = await extractedBranch('whole-branch');
  const r = await scoreReviews(x, workflow(x, () => '**Important**\n- src/y.js:2 bad'));
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.arms.a.notJudgedByReason, { 'could-not-parse': 1 });
  assert.equal(r.json.arms.a.wholeBranch.reviews, 0);
});

test('fixture summary: selected and excluded per reason and per archived tier', async () => {
  const x = await extractedBranch('task', { pointer: 'gone' });
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task' ? VERDICT('Approved') : TASK_FIX)));
  assert.deepEqual(r.json.fixture, {
    selected: { total: 2, byArchivedTier: { standard: 1, capable: 1 } }, excludedByReason: { 'prompt-file-gone': 1 }, excludedByTier: { standard: 1 },
  });
  assert.deepEqual(Object.keys(r.json), ['notes', 'role', 'fixture', 'unidentifiedAgents', 'unidentifiedCost', 'arms']);
});

test('fixture summary: an exclusion with no tier lands under unknown and the per-tier total equals the per-reason total', async () => {
  const x = await extractedBranch('task', { pointer: 'gone' });
  // A run-level exclusion carries no tier: add one beside the tiered prompt-file-gone row.
  const copy = path.join(root, 'tierless');
  fs.cpSync(x.out, copy, { recursive: true });
  const file = path.join(copy, 'reviews-fixture.json');
  const fixture = JSON.parse(fs.readFileSync(file, 'utf8'));
  fixture.excluded.push({ run: 'run-without-review', reason: 'no-review' });
  fs.writeFileSync(file, JSON.stringify(fixture));
  const r = await scoreReviews({ ...x, out: copy }, workflow(x, ({ slot }) => (slot === 'task' ? VERDICT('Approved') : TASK_FIX)));
  const { excludedByReason, excludedByTier } = r.json.fixture;
  assert.deepEqual(excludedByTier, { standard: 1, unknown: 1 });
  assert.deepEqual(excludedByReason, { 'prompt-file-gone': 1, 'no-review': 1 });
  const sum = (o) => Object.values(o).reduce((n, v) => n + v, 0);
  assert.equal(sum(excludedByTier), sum(excludedByReason));
});

// ---- the task-vs-branch role
const TVB_NEAR = '#### Important (Should Fix)\n- src/x.js:12: may be null\n';
const tvbOf = (r) => r.json.arms.a.taskVsBranch;
const pickKeys = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k]]));

test('AC3.1: a replay Important item 2 lines from the task item is caught 1 of 1, nothing not raised', async () => {
  const x = await extractedBranch('task-vs-branch');
  const r = await scoreReviews(x, workflow(x, () => TVB_NEAR));
  assert.equal(r.code, 0, r.deps.errs.join('\n'));
  assert.equal(r.json.role, 'task-vs-branch');
  const tvb = tvbOf(r);
  assert.deepEqual(pickKeys(tvb.caught, ['caught', 'of', 'unlocated']), { caught: 1, of: 1, unlocated: 0 });
  assert.deepEqual(tvb.reviews, { taskHead: 1, finalHead: 1 });
  assert.deepEqual(tvb.notRaised, []);
});

test('AC3.2: a reply raising nothing near it is 0 of 1 and lists the item', async () => {
  const x = await extractedBranch('task-vs-branch');
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task-vs-branch' ? 'No issues found.' : TVB_NEAR)));
  const tvb = tvbOf(r);
  assert.deepEqual(pickKeys(tvb.caught, ['caught', 'of']), { caught: 0, of: 1 });
  assert.deepEqual(tvb.notRaised, [{ run: x.fx.runName, taskReview: 'task-vs-branch', repeat: 1, path: 'src/x.js', line: 10, severity: 'important', text: 'src/x.js:10: null deref when y is unset' }]);
});

test('AC7.1 (score half): caught and baselineRecall are both reported for the review', async () => {
  const x = await extractedBranch('task-vs-branch');
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task-vs-branch' ? 'No issues found.' : '#### Important (Should Fix)\n- src/x.js:9: null\n')));
  const tvb = tvbOf(r);
  assert.equal(tvb.caught.bySeverity.important.of, 1);
  assert.deepEqual(tvb.caught.bySeverity.critical, { caught: 0, of: 0, share: null });
  assert.deepEqual(pickKeys(tvb.baselineRecall, ['caught', 'of', 'share']), { caught: 1, of: 1, share: 1 });
  assert.deepEqual(tvb.baselineRecall.bySeverity.important, { caught: 1, of: 1, share: 1 });
  assert.deepEqual(tvb.caught.byTaskTier, { capable: { caught: 0, of: 1, share: 0 } });
});

test('taskVsBranch: a reply with no heading and no "no issues" line is could-not-parse, exit 3', async () => {
  const x = await extractedBranch('task-vs-branch');
  const r = await scoreReviews(x, workflow(x, ({ slot }) => (slot === 'task-vs-branch' ? '**Important**\n- src/x.js:10 bad' : TVB_NEAR)));
  assert.equal(r.code, 3);
  assert.deepEqual(r.json.arms.a.notJudgedByReason, { 'could-not-parse': 1 });
  assert.equal(tvbOf(r).reviews.taskHead, 0);
  assert.equal(tvbOf(r).caught.of, 0);
});

test('taskVsBranch: fixture summary counts task reviews, not slots, and reports slots and notQualifying from totals', async () => {
  const x = await extractedBranch('task-vs-branch');
  const r = await scoreReviews(x, workflow(x, () => TVB_NEAR));
  const { selected } = r.json.fixture;
  assert.equal(selected.total, 1);
  assert.deepEqual(selected.byTaskTier, { capable: 1 });
  assert.equal(selected.slots, 2);
  const written = JSON.parse(fs.readFileSync(path.join(x.out, REVIEWS_FIXTURE_FILE), 'utf8'));
  assert.equal(selected.notQualifying, written.totals.notQualifying);
  assert.equal(selected.slots, written.totals.slots);
});

test('taskVsBranch: a not-raised item records the repeat that missed it', async () => {
  const x = await extractedBranch('task-vs-branch');
  const out = path.join(path.dirname(x.out), 'out-repeat');
  const deps = makeDeps(x.fx);
  const code = await run({ argv: ['extract-reviews', '--runs', x.fx.runsRoot, '--out', out, '--role', 'task-vs-branch', '--transcripts', x.fx.transcripts, '--arm', 'name=a,profile=fast,repeat=2'], deps });
  assert.equal(code, 0, deps.errs.join('\n'));
  const y = { fx: x.fx, out, manifest: JSON.parse(fs.readFileSync(path.join(out, REVIEWS_MANIFEST_FILE), 'utf8')) };
  const wf = workflow(y, ({ repeat, slot }) => (slot === 'task-vs-branch' && repeat === 2 ? 'No issues found.' : TVB_NEAR));
  const tvb = tvbOf(await scoreReviews(y, wf));
  assert.deepEqual(tvb.notRaised.map((n) => n.repeat), [2]);
  assert.deepEqual(pickKeys(tvb.caught, ['caught', 'of']), { caught: 1, of: 2 });
});
