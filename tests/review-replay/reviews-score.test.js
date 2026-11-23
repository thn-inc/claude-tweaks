'use strict';
const { test, before } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { run, makeWriteRepo } = require('../../tools/review-replay');
const { parseReviewItems, parseBranchReply } = require('../../tools/review-replay/reviews-score');
const { parseReviewCounts } = require('../../tools/pipeline-cost-report/guards');
const { armLabel, toPosix, REVIEWS_MANIFEST_FILE } = require('../../tools/review-replay/schema');
const { scratchDir } = require('../helpers/tmp-dir');
const { buildReviewsFixture, cleanEnv } = require('./reviews-fixture');

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
