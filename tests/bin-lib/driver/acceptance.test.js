'use strict';
// acceptance.js decideRoute: the pure acceptance route table. Every floor verdict the
// expectations rely on is computed with the real exceedsOversightFloor, never hand-typed.
const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const LIB = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib');
const { decideRoute } = require(path.join(LIB, 'driver', 'acceptance'));
const { exceedsOversightFloor } = require(path.join(LIB, 'issues', 'oversight-floor'));

const FLOORS = { riskFloor: 'high', sizeFloor: 'high' };
const LOW = { risk: 'low', size: 'low' };
const OVER = { risk: 'high', size: 'low' };

const gate = (state, extra) => ({ code: 0, verdict: { parent: state === 'no-parent' ? null : 7, state, exceeds: null, ...extra } });
const NO_PARENT_ROUTES = ['no-parent-exempt', 'no-parent-gated'];

test('fixtures: LOW is under the floors and OVER exceeds them, per the real predicate', () => {
  assert.strictEqual(exceedsOversightFloor(LOW, FLOORS).exceeds, false);
  assert.strictEqual(exceedsOversightFloor(OVER, FLOORS).exceeds, true);
});

test('decideRoute', async (t) => {
  for (const state of ['incomplete', 'gated', 'resolved']) {
    await t.test(`code 0, state ${state} -> try-it-only, no labels`, () => {
      const r = decideRoute({ gate: gate(state), facets: OVER, floors: FLOORS });
      assert.deepStrictEqual(r, { route: 'try-it-only', labels: [] });
    });
  }

  await t.test('code 0, due, exceeds false -> try-it-only', () => {
    const r = decideRoute({ gate: gate('due', { exceeds: false }), facets: OVER, floors: FLOORS });
    assert.deepStrictEqual(r, { route: 'try-it-only', labels: [] });
  });

  await t.test('code 0, due, exceeds true -> due-exceeds, label on the parent', () => {
    const r = decideRoute({ gate: gate('due', { exceeds: true }), facets: LOW, floors: FLOORS });
    assert.deepStrictEqual(r, { route: 'due-exceeds', labels: [{ on: 'parent', label: 'demo:pending' }] });
  });

  await t.test('code 0, no-parent, floor not exceeded -> no-parent-exempt', () => {
    const f = exceedsOversightFloor(LOW, FLOORS);
    assert.strictEqual(f.exceeds, false);
    const r = decideRoute({ gate: gate('no-parent'), facets: LOW, floors: FLOORS });
    assert.deepStrictEqual(r, { route: 'no-parent-exempt', labels: [] });
  });

  await t.test('code 0, no-parent, risk high under high floors -> no-parent-gated, label on the record', () => {
    const f = exceedsOversightFloor({ risk: 'high', size: 'low' }, FLOORS);
    assert.strictEqual(f.exceeds, true);
    const r = decideRoute({ gate: gate('no-parent'), facets: { risk: 'high', size: 'low' }, floors: FLOORS });
    assert.deepStrictEqual(r, { route: 'no-parent-gated', labels: [{ on: 'record', label: 'demo:pending' }] });
  });

  await t.test('code 0, no-parent, risk undefined -> unscored -> no-parent-gated', () => {
    const f = exceedsOversightFloor({ risk: undefined, size: 'low' }, FLOORS);
    assert.strictEqual(f.reason, 'unscored');
    const r = decideRoute({ gate: gate('no-parent'), facets: { risk: undefined, size: 'low' }, floors: FLOORS });
    assert.strictEqual(r.route, 'no-parent-gated');
    assert.deepStrictEqual(r.labels, [{ on: 'record', label: 'demo:pending' }]);
  });

  await t.test('code 0, no-parent, out-of-vocabulary risk -> no-parent-gated', () => {
    const facets = { risk: 'extreme', size: 'low' };
    const f = exceedsOversightFloor(facets, FLOORS);
    assert.strictEqual(f.exceeds, true);
    assert.strictEqual(f.reason, 'unscored');
    const r = decideRoute({ gate: gate('no-parent'), facets, floors: FLOORS });
    assert.strictEqual(r.route, 'no-parent-gated');
    assert.deepStrictEqual(r.labels, [{ on: 'record', label: 'demo:pending' }]);
  });

  for (const [name, size] of [['missing', undefined], ['out-of-vocabulary', 'huge']]) {
    await t.test(`code 0, no-parent, ${name} size -> unscored -> no-parent-gated`, () => {
      assert.strictEqual(exceedsOversightFloor({ risk: 'low', size: 'low' }, FLOORS).exceeds, false);
      const facets = { risk: 'low', size };
      const f = exceedsOversightFloor(facets, FLOORS);
      assert.strictEqual(f.exceeds, true);
      assert.strictEqual(f.reason, 'unscored');
      const r = decideRoute({ gate: gate('no-parent'), facets, floors: FLOORS });
      assert.deepStrictEqual(r, { route: 'no-parent-gated', labels: [{ on: 'record', label: 'demo:pending' }] });
    });
  }

  await t.test('code 0, no-parent, size over its floor -> no-parent-gated', () => {
    const facets = { risk: 'low', size: 'high' };
    assert.strictEqual(exceedsOversightFloor(facets, FLOORS).reason, 'size');
    assert.strictEqual(decideRoute({ gate: gate('no-parent'), facets, floors: FLOORS }).route, 'no-parent-gated');
  });

  await t.test('the floors come from the caller: a stricter floor gates a low-risk record', () => {
    const floors = { riskFloor: 'low', sizeFloor: 'high' };
    assert.strictEqual(exceedsOversightFloor(LOW, floors).exceeds, true);
    assert.strictEqual(decideRoute({ gate: gate('no-parent'), facets: LOW, floors }).route, 'no-parent-gated');
  });

  await t.test('due with exceeds null -> route null', () => {
    const r = decideRoute({ gate: gate('due', { exceeds: null }), facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, null);
    assert.match(r.error, /due/);
  });

  await t.test("due with exceeds 'true' (a string) -> route null", () => {
    const r = decideRoute({ gate: gate('due', { exceeds: 'true' }), facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, null);
    assert.ok(r.error);
  });

  await t.test('an unknown state -> route null, error names it', () => {
    const r = decideRoute({ gate: gate('bogus'), facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, null);
    assert.match(r.error, /bogus/);
    assert.strictEqual('labels' in r, false);
  });

  await t.test('code 0 with a null verdict is unparseable -> falls back, never null', () => {
    const r = decideRoute({ gate: { code: 0, verdict: null }, facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, 'no-parent-exempt');
    assert.strictEqual(r.fallback, 'parent-gate failed');
  });

  for (const [name, verdict] of [['a string', 'due'], ['a number', 5], ['an array', []], ['an object with no state', {}]]) {
    await t.test(`code 0 with ${name} as the parsed verdict -> route null, never the fallback`, () => {
      const r = decideRoute({ gate: { code: 0, verdict }, facets: LOW, floors: FLOORS });
      assert.strictEqual(r.route, null);
      assert.ok(r.error);
      assert.strictEqual('fallback' in r, false);
      assert.strictEqual('labels' in r, false);
    });
  }

  for (const code of [1, 2, 3]) {
    await t.test(`AC8: exit ${code} falls back to the floor, never null, never a skip`, () => {
      const exempt = decideRoute({ gate: { code, verdict: null }, facets: LOW, floors: FLOORS });
      assert.ok(NO_PARENT_ROUTES.includes(exempt.route));
      assert.deepStrictEqual(exempt, { route: 'no-parent-exempt', labels: [], fallback: 'parent-gate failed' });
      const gated = decideRoute({ gate: { code, verdict: null }, facets: OVER, floors: FLOORS });
      assert.ok(NO_PARENT_ROUTES.includes(gated.route));
      assert.deepStrictEqual(gated, {
        route: 'no-parent-gated', labels: [{ on: 'record', label: 'demo:pending' }], fallback: 'parent-gate failed',
      });
    });
  }

  await t.test('a non-zero exit with a parseable due/exceeds verdict still falls back to the floor', () => {
    const r = decideRoute({ gate: { code: 3, verdict: { state: 'due', exceeds: true } }, facets: LOW, floors: FLOORS });
    assert.strictEqual(r.route, 'no-parent-exempt');
    assert.strictEqual(r.fallback, 'parent-gate failed');
  });

  await t.test('a clean verdict carries no fallback key', () => {
    const r = decideRoute({ gate: gate('resolved'), facets: LOW, floors: FLOORS });
    assert.strictEqual('fallback' in r, false);
  });
});

// ---- runAcceptance and the renderers ----

const { describe, after } = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const { runAcceptance, renderTryIt, renderParentBrief, renderObservationPlan, neutralizeLines } = require(path.join(LIB, 'driver', 'acceptance'));
const { ACCEPTANCE_RESULT_SCHEMA } = require(path.join(LIB, 'driver', 'roles.js'));

const roots = [];
after(() => { for (const r of roots) fs.rmSync(r, { recursive: true, force: true }); });

const GROUP = {
  name: 'Run the thing', precondition: 'none', access: 'none', entryPoint: 'node bin/x.js', steps: ['Run it', 'Read the output'], expected: 'It prints ok',
};
const PLAN = { kind: 'cli', entryPoint: 'node bin/x.js', prepare: [], inspect: ['Run it and read the output'] };
const CLAIM = { section: 'what-changed', text: 'It adds x.', refs: ['change:1'] };
const SUB = { number: 7, title: 'Sub', state: 'CLOSED', stateReason: 'COMPLETED', pr: 70 };
const verdictFor = (state, extra) => ({ parent: state === 'no-parent' ? null : 42, state, exceeds: null, subIssues: [SUB], skipped: [], ...extra });
const result = (extra) => ({ tryIt: [], observationPlan: {}, claims: [], parentBrief: {}, ...extra });
const ok = (extra) => ({ status: 'ok', result: result(extra) });

// Each route: the parent-gate verdict and record labels that make decideRoute pick it, and a valid worker envelope.
const ROUTES = {
  'try-it-only': { verdict: verdictFor('incomplete'), envelope: ok({ tryIt: [GROUP] }) },
  'due-exceeds': {
    verdict: verdictFor('due', { exceeds: true }),
    envelope: ok({ tryIt: [GROUP], parentBrief: { ask: 'The ask', whatShipped: 'What shipped', tryItEndToEnd: [{ ...GROUP, name: 'End to end', steps: ['Do it (#7)'] }] } }),
  },
  'no-parent-exempt': { verdict: verdictFor('no-parent'), recordLabels: ['risk:low', 'size:low'], envelope: ok({ tryIt: [GROUP], observationPlan: PLAN, claims: [CLAIM] }) },
  'no-parent-gated': { verdict: verdictFor('no-parent'), recordLabels: ['risk:high', 'size:low'], envelope: ok({ tryIt: [GROUP], observationPlan: PLAN, claims: [CLAIM] }) },
};

const flagOf = (args, name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const readIf = (p) => (p ? fs.readFileSync(p, 'utf8') : undefined);

// Scripted fake deps recording every call. A packet CLI call reads its input files at call time, so the
// recorded body is what the CLI would have been handed. `over.exit` sets per-script exit codes.
function harness(route, over = {}) {
  const spec = { ...ROUTES[route], ...over };
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acceptance-test-'));
  roots.push(root);
  const runDir = path.join(root, 'run');
  const worktree = path.join(root, 'wt');
  fs.mkdirSync(runDir, { recursive: true });
  fs.mkdirSync(worktree, { recursive: true });
  const calls = [];
  const events = [];
  const exit = spec.exit || {};
  let gathers = 0;
  const deps = {
    node: (script, args, opts = {}) => {
      const base = path.basename(script);
      const rec = { kind: 'node', script: base, sub: base === 'acceptance-packet.js' ? args[0] : undefined, args, opts };
      calls.push(rec);
      if (spec.nodeThrows === base) throw new Error('spawn failed');
      if (base === 'resolve-policy.js') return spec.policy || { code: 0, stdout: 'high\nhigh\n', stderr: '' };
      if (base === 'parent-gate.js') return spec.gate || { code: 0, stdout: JSON.stringify(spec.verdict), stderr: '' };
      if (base === 'set-verify-expectations.js') return { code: exit.sve || 0, stdout: '', stderr: '' };
      if (base !== 'acceptance-packet.js') throw new Error(`unexpected node ${base}`);
      if (rec.sub === 'gather') {
        const code = (exit.gather || [])[gathers] || 0;
        gathers += 1;
        rec.links = flagOf(args, '--links') ? JSON.parse(fs.readFileSync(flagOf(args, '--links'), 'utf8')) : null;
        if (code === 0) fs.writeFileSync(flagOf(args, '--out'), JSON.stringify({ facts: [{ id: 'change:1' }], partial: [] }));
        return { code, stdout: '', stderr: '' };
      }
      if (rec.sub === 'render') {
        rec.narrative = JSON.parse(fs.readFileSync(flagOf(args, '--narrative'), 'utf8'));
        rec.plan = fs.readFileSync(flagOf(args, '--observation-plan'), 'utf8');
        const code = exit.render || 0;
        if (code === 0) fs.writeFileSync(flagOf(args, '--out'), '<!-- acceptance-packet -->\npacket\n');
        return { code, stdout: '', stderr: '' };
      }
      if (rec.sub === 'post') {
        rec.body = readIf(flagOf(args, '--body-file'));
        return { code: exit.post || 0, stdout: '', stderr: '' };
      }
      throw new Error(`unexpected packet subcommand ${rec.sub}`);
    },
    git: (args, opts = {}) => {
      calls.push({ kind: 'git', args, opts });
      return args.includes('--name-only') ? 'plugin/bin/x.js\n' : 'diff --git a/x b/x\n+line\n';
    },
    gh: (args) => {
      const rec = { kind: 'gh', args };
      calls.push(rec);
      if (spec.ghThrow && spec.ghThrow(args)) throw new Error('gh failed');
      rec.bodyText = readIf(flagOf(args, '--body-file'));
      for (let i = 0; i < args.length - 1; i += 1) {
        const m = args[i] === '-F' ? /^(body|query)=@(.+)$/.exec(args[i + 1]) : null;
        if (m) rec[`${m[1]}Text`] = fs.readFileSync(m[2], 'utf8');
      }
      if (args[0] === 'issue' && args[1] === 'view') {
        const json = flagOf(args, '--json');
        if (json === 'labels') return JSON.stringify({ labels: (spec.recordLabels || ['risk:low', 'size:low']).map((name) => ({ name })) });
        if (json === 'title,body') return JSON.stringify({ title: 'Rec', body: 'Rec body' });
        if (json === 'title,body,comments') return JSON.stringify({ title: 'Parent', body: spec.parentBody || 'Parent body', comments: spec.parentComments || [] });
      }
      if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ comments: spec.prComments || [] });
      if (args[0] === 'label' && args[1] === 'list') return JSON.stringify((spec.existingLabels || []).map((name) => ({ name })));
      return '';
    },
    writeFile: (p, text) => { fs.writeFileSync(p, text); },
    mkdirSync: (p, o) => { fs.mkdirSync(p, o); },
    launchWorker: async (opts) => {
      calls.push({ kind: 'launchWorker', opts });
      const e = spec.envelope;
      if (e instanceof Error) throw e;
      return e;
    },
    runner: () => ({}),
    emit: (step, status, ms, detail, extra) => events.push({ step, status, ms, detail, extra }),
    now: () => 1,
    platform: 'linux',
    env: { H: '1' },
  };
  const shared = { activeWorker: null, policy: { 'express-driver-wall-clock-minutes': { value: 30 }, 'express-driver-spend-ceiling-dollars': { value: 5 } } };
  const ctx = { record: 7, pr: 70, repo: 'o/r', branch: 'drive-7', base: 'main', head: 'drive-7', runDir, runRoot: root, mainCheckout: root, worktree };
  const env = { deps, shared, readFile: (p) => fs.readFileSync(p, 'utf8') };
  const isForgeWrite = (c) => (c.kind === 'gh' && ((c.args[0] === 'issue' && ['comment', 'edit'].includes(c.args[1])) || (c.args[0] === 'pr' && c.args[1] === 'comment')
    || (c.args[0] === 'api' && c.args[1] === 'graphql') || (c.args[0] === 'label' && c.args[1] === 'create')))
    || (c.kind === 'node' && c.sub === 'post');
  return {
    env, ctx, calls, events,
    run: () => runAcceptance(env, ctx),
    writes: () => calls.filter(isForgeWrite),
    gh: (a, b) => calls.filter((c) => c.kind === 'gh' && c.args[0] === a && (b === undefined || c.args[1] === b)),
    packet: (sub) => calls.filter((c) => c.kind === 'node' && c.sub === sub),
    launches: () => calls.filter((c) => c.kind === 'launchWorker'),
    labelsPassed: () => calls.filter((c) => c.sub === 'post').flatMap((c) => c.args.filter((a, i) => c.args[i - 1] === '--label')),
  };
}

// Every line's code spans removed, per CommonMark's leftmost matching run (packet-render.test.js's helper).
function outsideCodeSpans(line) {
  let out = '';
  let at = 0;
  while (at < line.length) {
    if (line[at] === '\\') {
      out += line.slice(at, at + 2);
      at += 2;
    } else if (line[at] === '`') {
      const run = /^`+/.exec(line.slice(at))[0];
      let closed = -1;
      for (let close = at + run.length; close < line.length;) {
        const next = line.indexOf('`', close);
        if (next === -1) break;
        const nextRun = /^`+/.exec(line.slice(next))[0];
        if (nextRun.length === run.length) { closed = next; break; }
        close = next + nextRun.length;
      }
      if (closed === -1) { out += run; at += run.length; } else { at = closed + run.length; }
    } else {
      out += line[at];
      at += 1;
    }
  }
  return out;
}

function assertNeutral(text) {
  for (const line of text.split('\n')) {
    const bare = outsideCodeSpans(line);
    assert.doesNotMatch(bare, /(?<!\\)@octocat/, line);
    assert.doesNotMatch(bare, /(?<![\\\w])#\d+/, line);
    assert.doesNotMatch(bare, /https?:\/\//, line);
    assert.doesNotMatch(line, /^# /, line);
  }
}

const HOSTILE = {
  name: '@octocat Fixes #12', precondition: 'Fixes\n#12', access: 'https://evil.example/x', entryPoint: '# Heading',
  steps: ['@\noctocat', 'Fixes\n#12', 'see https://evil.example/y'], expected: 'closes #12 for @octocat',
};

describe('renderers', () => {
  test('renderTryIt emits the try-it.md Shape, one group per feature, the five fields in order', () => {
    const second = { ...GROUP, name: 'Second', steps: ['One'] };
    assert.strictEqual(renderTryIt([GROUP, second]), [
      '### Try it', '',
      '**Run the thing**', '- Precondition: none', '- Access: none', '- Entry point: node bin/x.js', '- Steps:', '  1. Run it', '  2. Read the output', '- Expected: It prints ok', '',
      '**Second**', '- Precondition: none', '- Access: none', '- Entry point: node bin/x.js', '- Steps:', '  1. One', '- Expected: It prints ok',
    ].join('\n'));
  });

  test('renderTryIt takes the end-to-end heading', () => {
    assert.ok(renderTryIt([GROUP], '### Try it — end to end').startsWith('### Try it — end to end\n\n**Run the thing**'));
  });

  test('renderTryIt neutralizes every worker value', () => {
    const text = renderTryIt([HOSTILE]);
    assertNeutral(text);
    assert.ok(text.includes('`#12`'));
    assert.ok(text.includes('`@octocat`'));
  });

  test('renderObservationPlan emits the observation-plan.md Schema lines', () => {
    assert.strictEqual(renderObservationPlan({ kind: 'flow', entryPoint: 'node x', prepare: ['npm ci', 'npm run seed'], inspect: ['Open a', 'Open b'] }), [
      '### Observation plan', '- Surface: flow', '- Entry point: node x', '- Prepare:', '  - npm ci', '  - npm run seed', '- Inspect:', '  - Open a', '  - Open b',
    ].join('\n'));
    assert.strictEqual(renderObservationPlan(PLAN), [
      '### Observation plan', '- Surface: cli', '- Entry point: node bin/x.js', '- Prepare: none', '- Inspect:', '  - Run it and read the output',
    ].join('\n'));
  });

  test('renderObservationPlan neutralizes the values', () => {
    assertNeutral(renderObservationPlan({ kind: 'cli', entryPoint: '# https://evil.example/x', prepare: ['@octocat'], inspect: ['Fixes\n#12'] }));
  });

  test('renderParentBrief emits the parent-gate template with the fixed footer', () => {
    const brief = { ask: 'Why', whatShipped: 'This', tryItEndToEnd: [{ ...GROUP, name: 'E2E' }] };
    const text = renderParentBrief(brief, { confirmed: ['F1: x'], poster: 'plugin/bin/drive.js' });
    assert.strictEqual(text, [
      '## Verification Brief', '', '### The ask', 'Why', '', '### What shipped', 'This', '',
      renderTryIt(brief.tryItEndToEnd, '### Try it — end to end'), '',
      '### Confirmed', 'F1: x', '', '---', '', '_Posted by `plugin/bin/drive.js`. Resolve with `/claude-tweaks:demo`._',
    ].join('\n'));
  });

  test('renderParentBrief neutralizes worker text and the confirmed rows', () => {
    const text = renderParentBrief({ ask: '# Heading\n@octocat', whatShipped: 'Fixes #12 https://evil.example/x', tryItEndToEnd: [HOSTILE] },
      { confirmed: ['F1: @octocat fixes #12'], poster: 'plugin/bin/drive.js' });
    assertNeutral(text);
  });

  test('neutralizeLines maps inline over each line', () => {
    assert.strictEqual(neutralizeLines('# Head\n@octocat\nplain'), '\\# Head\n`@octocat`\nplain');
  });
});

describe('runAcceptance: parent routes', () => {
  test('try-it-only posts exactly one PR comment with the marker and makes no parent write', async () => {
    const h = harness('try-it-only');
    const r = await h.run();
    assert.deepStrictEqual({ completed: r.completed, route: r.route }, { completed: true, route: 'try-it-only' });
    const w = h.writes();
    assert.strictEqual(w.length, 1);
    assert.deepStrictEqual(w[0].args.slice(0, 5), ['pr', 'comment', '70', '--repo', 'o/r']);
    assert.ok(w[0].bodyText.startsWith('<!-- run-comment: try-it -->\n\n### Try it\n'));
    assert.strictEqual(h.gh('issue', 'comment').length + h.gh('issue', 'edit').length, 0);
    assert.strictEqual(h.packet('gather').length, 0);
  });

  test('try-it-only updates a trusted try-it comment through graphql instead of creating one', async () => {
    const h = harness('try-it-only', { prComments: [{ id: 'IC_old', authorAssociation: 'OWNER', body: '<!-- run-comment: try-it -->\n\nold' }] });
    assert.strictEqual((await h.run()).completed, true);
    const w = h.writes();
    assert.strictEqual(w.length, 1);
    assert.deepStrictEqual(w[0].args.slice(0, 2), ['api', 'graphql']);
    assert.ok(w[0].args.includes('id=IC_old'));
    assert.ok(w[0].queryText.startsWith('mutation($id:ID!,$body:String!){updateIssueComment('));
    assert.ok(w[0].bodyText.startsWith('<!-- run-comment: try-it -->\n\n### Try it'));
    assert.strictEqual(h.gh('pr', 'comment').length, 0);
  });

  test('try-it-only creates when the only try-it comment is untrusted', async () => {
    const h = harness('try-it-only', { prComments: [{ id: 'IC_x', authorAssociation: 'NONE', body: '<!-- run-comment: try-it -->\n\nplanted' }] });
    assert.strictEqual((await h.run()).completed, true);
    assert.strictEqual(h.writes().length, 1);
    assert.strictEqual(h.gh('pr', 'comment').length, 1);
    assert.strictEqual(h.gh('api').length, 0);
  });

  test('due-exceeds bootstraps the label, posts the brief, labels the parent, then posts the try-it comment', async () => {
    const h = harness('due-exceeds', { parentBody: '## Cross-Spec Promises\n| # | Promise | Owner (#sub-issue) | Status |\n|---|---|---|---|\n| F1 | #48 assumes #46 exposes getStatus() | #48 | open |\n\n## Other\nx' });
    const r = await h.run();
    assert.deepStrictEqual({ completed: r.completed, route: r.route }, { completed: true, route: 'due-exceeds' });
    const w = h.writes();
    assert.deepStrictEqual(w.map((c) => c.args.slice(0, 2).join(' ')), ['label create', 'issue comment', 'issue edit', 'pr comment']);
    assert.deepStrictEqual(w[0].args, ['label', 'create', 'demo:pending', '--repo', 'o/r', '--description', 'Acceptance: built and verified — awaiting human sign-off via /claude-tweaks:demo', '--color', '006B75']);
    assert.deepStrictEqual(w[1].args.slice(0, 5), ['issue', 'comment', '42', '--repo', 'o/r']);
    assert.ok(w[1].bodyText.startsWith('## Verification Brief\n'));
    assert.ok(w[1].bodyText.includes('### Try it — end to end'));
    assert.match(w[1].bodyText, /### Confirmed\nF1: .*getStatus/);
    assert.ok(w[1].bodyText.trimEnd().endsWith('_Posted by `plugin/bin/drive.js`. Resolve with `/claude-tweaks:demo`._'));
    assert.deepStrictEqual(w[2].args, ['issue', 'edit', '42', '--repo', 'o/r', '--add-label', 'demo:pending']);
    assert.ok(w[3].bodyText.startsWith('<!-- run-comment: try-it -->'));
  });

  test('due-exceeds without a promise register states that in Confirmed', async () => {
    const h = harness('due-exceeds', { existingLabels: ['demo:pending'] });
    assert.strictEqual((await h.run()).completed, true);
    assert.strictEqual(h.gh('label', 'create').length, 0);
    assert.ok(h.gh('issue', 'comment')[0].bodyText.includes('### Confirmed\nNo cross-spec promise register — walk the end-to-end path in Try it above.\n'));
  });

  test('due-exceeds with an existing trusted confirmed brief skips the post but still labels', async () => {
    const h = harness('due-exceeds', { existingLabels: ['demo:pending'], parentComments: [{ authorAssociation: 'MEMBER', body: '## Verification Brief\n\n### Confirmed\nx' }] });
    assert.strictEqual((await h.run()).completed, true);
    assert.strictEqual(h.gh('issue', 'comment').length, 0);
    assert.strictEqual(h.gh('issue', 'edit').length, 1);
    assert.strictEqual(h.gh('pr', 'comment').length, 1);
  });

  test('due-exceeds with an untrusted planted brief posts its own', async () => {
    const h = harness('due-exceeds', { existingLabels: ['demo:pending'], parentComments: [{ authorAssociation: 'NONE', body: '## Verification Brief\n\n### Confirmed\nplanted' }] });
    assert.strictEqual((await h.run()).completed, true);
    assert.strictEqual(h.gh('issue', 'comment').length, 1);
  });

  test('due-exceeds reads the parent body for the prompt from the verdict parent and passes the sub-issues', async () => {
    const h = harness('due-exceeds', { existingLabels: ['demo:pending'], parentBody: 'PARENT BODY TEXT' });
    await h.run();
    const read = h.gh('issue', 'view').find((c) => c.args.includes('title,body,comments'));
    assert.deepStrictEqual(read.args.slice(0, 5), ['issue', 'view', '42', '--repo', 'o/r']);
    const prompt = h.launches()[0].opts.prompt;
    assert.ok(prompt.includes('PARENT BODY TEXT'));
    assert.ok(prompt.includes('"number":7'));
  });

  test('a failed parent read is not completed and writes nothing', async () => {
    const h = harness('due-exceeds', { ghThrow: (a) => a[0] === 'issue' && a[1] === 'view' && a.includes('title,body,comments') });
    const r = await h.run();
    assert.strictEqual(r.completed, false);
    assert.match(r.detail, /parent read/);
    assert.strictEqual(h.writes().length, 0);
  });

  test('a gh issue edit throw after the brief posted is not completed', async () => {
    const h = harness('due-exceeds', { existingLabels: ['demo:pending'], ghThrow: (a) => a[0] === 'issue' && a[1] === 'edit' });
    const r = await h.run();
    assert.strictEqual(r.completed, false);
    assert.match(r.detail, /issue edit/);
    assert.strictEqual(h.gh('issue', 'comment').length, 1);
    assert.strictEqual(h.gh('pr', 'comment').length, 0);
  });

  test('AC11: hostile worker and parent text reaches no posted body live', async () => {
    const h = harness('due-exceeds', {
      existingLabels: ['demo:pending'],
      parentBody: '## Cross-Spec Promises\n| # | Promise | Owner | Status |\n|---|---|---|---|\n| F1 | @octocat fixes #12 https://evil.example/x | #48 | open |\n',
      envelope: ok({ tryIt: [HOSTILE], parentBrief: { ask: '# Heading\n@octocat', whatShipped: 'Fixes #12\nhttps://evil.example/x', tryItEndToEnd: [HOSTILE] } }),
    });
    assert.strictEqual((await h.run()).completed, true);
    const bodies = h.writes().map((c) => c.bodyText).filter(Boolean);
    assert.strictEqual(bodies.length, 2);
    for (const b of bodies) assertNeutral(b);
  });

  test('AC11: hostile worker text in a try-it-only comment is neutral', async () => {
    const h = harness('try-it-only', { envelope: ok({ tryIt: [HOSTILE] }) });
    assert.strictEqual((await h.run()).completed, true);
    assertNeutral(h.writes()[0].bodyText);
  });

  test('a worker-returned labels field is never read', async () => {
    const h = harness('due-exceeds', { existingLabels: ['demo:pending'], envelope: { status: 'ok', result: { ...ROUTES['due-exceeds'].envelope.result, labels: ['accept:approved'] } } });
    assert.strictEqual((await h.run()).completed, true);
    assert.deepStrictEqual(h.gh('issue', 'edit').map((c) => c.args.filter((a) => a.includes(':'))), [['demo:pending']]);
  });
});

describe('runAcceptance: no-parent routes', () => {
  test('AC5: no-parent-gated runs gather, worker, links, gather, render, post --label demo:pending', async () => {
    const h = harness('no-parent-gated', { envelope: { status: 'ok', result: { ...ROUTES['no-parent-gated'].envelope.result, labels: ['accept:approved'] } } });
    const r = await h.run();
    assert.deepStrictEqual({ completed: r.completed, route: r.route }, { completed: true, route: 'no-parent-gated' });
    const order = h.calls
      .filter((c) => c.sub || c.kind === 'launchWorker' || (c.kind === 'gh' && ['issue', 'label'].includes(c.args[0]) && ['edit', 'create', 'comment'].includes(c.args[1])))
      .map((c) => c.sub || (c.kind === 'launchWorker' ? 'launchWorker' : c.args[0]));
    assert.deepStrictEqual(order, ['gather', 'launchWorker', 'gather', 'render', 'label', 'post']);
    assert.strictEqual(h.launches()[0].opts.role, 'acceptance');
    assert.deepStrictEqual(h.labelsPassed(), ['demo:pending']);
    const [g1, g2] = h.packet('gather');
    assert.strictEqual(g1.args.includes('--links'), false);
    assert.strictEqual(g2.args.includes('--links'), true);
    for (const g of [g1, g2]) {
      assert.strictEqual(g.args.includes('--spec'), false);
      assert.strictEqual(flagOf(g.args, '--surface'), 'backend');
      assert.strictEqual(flagOf(g.args, '--base'), 'origin/main');
      assert.strictEqual(flagOf(g.args, '--head'), 'drive-7');
      assert.strictEqual(flagOf(g.args, '--record'), '7');
      assert.strictEqual(flagOf(g.args, '--run'), h.ctx.runDir);
      assert.strictEqual(g.opts.cwd, h.ctx.worktree);
    }
    const render = h.packet('render')[0];
    assert.strictEqual(flagOf(render.args, '--poster'), 'plugin/bin/drive.js');
    const post = h.packet('post')[0];
    assert.deepStrictEqual(['--record', '--pr', '--repo'].map((f) => flagOf(post.args, f)), ['7', '70', 'o/r']);
    assert.strictEqual(post.body, '<!-- acceptance-packet -->\npacket\n');
    assert.strictEqual(h.calls.some((c) => c.script === 'set-verify-expectations.js'), false);
    assert.strictEqual(h.gh('pr', 'comment').length, 0, 'the Try it block reaches the packet, never a separate comment');
    assert.strictEqual(h.gh('issue', 'comment').length, 0);
  });

  test('the links file is a command entry per Try it group and the narrative cites it', async () => {
    const second = { ...GROUP, name: 'Second', entryPoint: 'node bin/y.js', precondition: 'plugin updated', access: 'maintainer', steps: ['Run y'], expected: 'y ok' };
    const h = harness('no-parent-gated', { envelope: ok({ tryIt: [GROUP, second], observationPlan: PLAN, claims: [CLAIM] }) });
    assert.strictEqual((await h.run()).completed, true);
    assert.deepStrictEqual(h.packet('gather')[1].links, [
      { id: 'entry-point-1', label: 'Run the thing', command: 'node bin/x.js' },
      { id: 'entry-point-2', label: 'Second', command: 'node bin/y.js' },
    ]);
    const { narrative } = h.packet('render')[0];
    assert.strictEqual(narrative.schemaVersion, 1);
    assert.deepStrictEqual(narrative.claims[0], CLAIM);
    const guide = narrative.claims.filter((c) => c.section === 'test-guide');
    assert.strictEqual(guide.length, 3);
    assert.deepStrictEqual(guide.map((c) => c.refs), [['link:entry-point-1'], ['link:entry-point-1'], ['link:entry-point-2']]);
    assert.ok(guide[2].text.includes('Run y') && guide[2].text.includes('plugin updated') && guide[2].text.includes('maintainer') && guide[2].text.includes('y ok'));
    assert.ok(guide[0].text.includes('Run it'));
  });

  test('the observation plan file is the rendered plan', async () => {
    const h = harness('no-parent-gated');
    await h.run();
    assert.strictEqual(h.packet('render')[0].plan, `${renderObservationPlan(PLAN)}\n`);
  });

  test('no-parent-exempt passes no label and marks the record oversight-exempt', async () => {
    const h = harness('no-parent-exempt');
    const r = await h.run();
    assert.deepStrictEqual({ completed: r.completed, route: r.route }, { completed: true, route: 'no-parent-exempt' });
    assert.deepStrictEqual(h.labelsPassed(), []);
    assert.strictEqual(h.packet('post')[0].args.includes('--label'), false);
    assert.strictEqual(h.gh('label').length, 0);
    const sve = h.calls.find((c) => c.script === 'set-verify-expectations.js');
    assert.deepStrictEqual(sve.args, ['--run', h.ctx.runDir, '--oversight-exempt', '7']);
    assert.strictEqual(h.calls.indexOf(sve) > h.calls.findIndex((c) => c.sub === 'post'), true);
  });

  test('no-parent-gated creates nothing when the label exists', async () => {
    const h = harness('no-parent-gated', { existingLabels: ['demo:pending', 'other'] });
    await h.run();
    assert.strictEqual(h.gh('label', 'create').length, 0);
  });

  test('AC8: a parent-gate exit 3 still runs the no-parent path and names the fallback', async () => {
    const h = harness('no-parent-gated', { gate: { code: 3, stdout: '', stderr: 'gh failed' } });
    const r = await h.run();
    assert.strictEqual(r.completed, true);
    assert.strictEqual(r.route, 'no-parent-gated');
    assert.match(r.detail, /parent-gate failed/);
    assert.strictEqual(h.packet('post').length, 1);
  });

  test('parent-gate and policy are called with the documented arguments', async () => {
    const h = harness('try-it-only');
    await h.run();
    const g = h.calls.find((c) => c.script === 'parent-gate.js');
    assert.deepStrictEqual(g.args, ['--sub-issue', '7', '--closing', '7', '--backend', 'github-issues']);
    const p = h.calls.find((c) => c.script === 'resolve-policy.js');
    assert.deepStrictEqual(p.args, ['--run', h.ctx.runDir, '--values', 'risk-floor', 'size-floor']);
  });
});

describe('runAcceptance: failures and bounds', () => {
  const FAILS = [
    ['gather exit 1', 'no-parent-gated', { exit: { gather: [1] } }, /gather exit 1/],
    ['second gather exit 1', 'no-parent-gated', { exit: { gather: [0, 1] } }, /gather exit 1/],
    ['render exit 1', 'no-parent-gated', { exit: { render: 1 } }, /render exit 1/],
    ['render exit 3', 'no-parent-gated', { exit: { render: 3 } }, /render exit 3/],
    ['post exit 1', 'no-parent-gated', { exit: { post: 1 } }, /post exit 1/],
    ['post exit 2', 'no-parent-gated', { exit: { post: 2 } }, /post exit 2/],
    ['post exit 4', 'no-parent-gated', { exit: { post: 4 } }, /post exit 4/],
    ['post exit 5', 'no-parent-exempt', { exit: { post: 5 } }, /post exit 5/],
    ['observation plan app-route', 'no-parent-gated', { envelope: ok({ tryIt: [GROUP], observationPlan: { ...PLAN, kind: 'app-route' }, claims: [] }) }, /observation plan kind app-route needs the visual-review safety net/],
    ['observation plan rendered-page', 'no-parent-exempt', { envelope: ok({ tryIt: [GROUP], observationPlan: { ...PLAN, kind: 'rendered-page' }, claims: [] }) }, /observation plan kind rendered-page needs the visual-review safety net/],
    ['parent-gate bogus state', 'try-it-only', { verdict: verdictFor('bogus') }, /bogus/],
    ['set-verify-expectations exit 3', 'no-parent-exempt', { exit: { sve: 3 } }, /set-verify-expectations exit 3/],
    ['policy floors fail', 'try-it-only', { policy: { code: 1, stdout: '', stderr: 'x' } }, /policy/],
    ['policy floors garbage', 'try-it-only', { policy: { code: 0, stdout: 'high\n', stderr: '' } }, /policy/],
    ['record labels unreadable', 'try-it-only', { ghThrow: (a) => a.includes('labels') }, /facets|labels/],
    ['pr comments unreadable', 'try-it-only', { ghThrow: (a) => a[0] === 'pr' && a[1] === 'view' }, /pr view/],
    ['pr comment throws', 'try-it-only', { ghThrow: (a) => a[0] === 'pr' && a[1] === 'comment' }, /pr comment/],
    ['label create throws', 'no-parent-gated', { ghThrow: (a) => a[0] === 'label' && a[1] === 'create' }, /label/],
    ['worker launch throws', 'try-it-only', { envelope: new Error('spawn') }, /launch/],
    ['worker status not ok', 'try-it-only', { envelope: { status: 'timeout' } }, /worker/],
    ['worker result not an object', 'try-it-only', { envelope: { status: 'ok', result: 'x' } }, /worker/],
    ['tryIt empty', 'try-it-only', { envelope: ok({ tryIt: [] }) }, /tryIt/],
    ['tryIt step list empty', 'try-it-only', { envelope: ok({ tryIt: [{ ...GROUP, steps: [] }] }) }, /tryIt/],
    ['tryIt field blank', 'try-it-only', { envelope: ok({ tryIt: [{ ...GROUP, expected: '  ' }] }) }, /tryIt/],
    ['tryIt step not a string', 'try-it-only', { envelope: ok({ tryIt: [{ ...GROUP, steps: [3] }] }) }, /tryIt/],
    ['parentBrief missing ask', 'due-exceeds', { existingLabels: ['demo:pending'], envelope: ok({ tryIt: [GROUP], parentBrief: { whatShipped: 'x', tryItEndToEnd: [GROUP] } }) }, /parentBrief/],
    ['parentBrief bad end-to-end group', 'due-exceeds', { existingLabels: ['demo:pending'], envelope: ok({ tryIt: [GROUP], parentBrief: { ask: 'a', whatShipped: 'x', tryItEndToEnd: [{ name: 'n' }] } }) }, /parentBrief/],
    ['observationPlan prepare not strings', 'no-parent-gated', { envelope: ok({ tryIt: [GROUP], observationPlan: { ...PLAN, prepare: [1] }, claims: [] }) }, /observationPlan/],
    ['observationPlan unknown kind', 'no-parent-gated', { envelope: ok({ tryIt: [GROUP], observationPlan: { ...PLAN, kind: 'telepathy' }, claims: [] }) }, /observationPlan/],
    ['claims not an array', 'no-parent-gated', { envelope: ok({ tryIt: [GROUP], observationPlan: PLAN, claims: {} }) }, /claims/],
  ];
  for (const [name, route, over, detail] of FAILS) {
    test(`AC7: ${name} is not completed, names the step, and never throws`, async () => {
      const h = harness(route, over);
      const r = await h.run();
      assert.strictEqual(r.completed, false);
      assert.match(r.detail, detail);
      assert.strictEqual(h.events.length, 1);
      assert.strictEqual(h.events[0].status, 'stop');
    });
  }

  test('a failed render writes nothing to the forge', async () => {
    const h = harness('no-parent-gated', { exit: { render: 1 } });
    await h.run();
    assert.strictEqual(h.packet('post').length, 0);
    assert.strictEqual(h.writes().length, 0);
  });

  test('a validation failure launches the worker once and writes nothing to the forge', async () => {
    const h = harness('try-it-only', { envelope: ok({ tryIt: [] }) });
    await h.run();
    assert.strictEqual(h.launches().length, 1);
    assert.strictEqual(h.writes().length, 0);
  });

  test('emits one merge-acceptance event with the route', async () => {
    const h = harness('try-it-only');
    const r = await h.run();
    assert.strictEqual(h.events.length, 1);
    assert.strictEqual(h.events[0].step, 'merge-acceptance');
    assert.strictEqual(h.events[0].status, 'ok');
    assert.deepStrictEqual(h.events[0].extra, { route: 'try-it-only' });
    assert.strictEqual(r.detail, h.events[0].detail);
  });

  test('a failure after the route is known still reports the route', async () => {
    const h = harness('no-parent-gated', { exit: { post: 4 } });
    const r = await h.run();
    assert.strictEqual(r.route, 'no-parent-gated');
    assert.deepStrictEqual(h.events[0].extra, { route: 'no-parent-gated' });
  });

  test('the launch is the acceptance role with its own settings dir, the result schema and the ceilings', async () => {
    const h = harness('try-it-only');
    await h.run();
    const o = h.launches()[0].opts;
    assert.strictEqual(o.role, 'acceptance');
    assert.strictEqual(o.cwd, h.ctx.worktree);
    assert.strictEqual(o.schema, ACCEPTANCE_RESULT_SCHEMA);
    assert.strictEqual(o.settingsDir, path.join(h.ctx.runDir, 'acceptance-worker'));
    assert.deepStrictEqual(o.ceilings, { wallClockMs: 30 * 60000, spendCeiling: 5 });
    assert.ok(o.prompt.includes('route: try-it-only'));
    assert.ok(fs.existsSync(path.join(h.ctx.runDir, 'acceptance')));
  });

  test('a bad ceiling is a stop before any launch', async () => {
    const h = harness('try-it-only');
    h.env.shared.policy['express-driver-spend-ceiling-dollars'] = { value: 'lots' };
    const r = await h.run();
    assert.strictEqual(r.completed, false);
    assert.strictEqual(h.launches().length, 0);
  });

  test('never rejects on a missing env, missing deps or a throwing node', async () => {
    for (const env of [undefined, {}, { deps: {} }]) {
      const r = await runAcceptance(env, { record: 7 });
      assert.strictEqual(r.completed, false);
    }
    const h = harness('try-it-only', { nodeThrows: 'resolve-policy.js' });
    assert.strictEqual((await h.run()).completed, false);
  });

  test('the graphql mutation file is the mutation packet-post.js sends, without its query= prefix', async () => {
    const source = fs.readFileSync(path.join(LIB, 'wrap-up', 'packet-post.js'), 'utf8');
    const h = harness('try-it-only', { prComments: [{ id: 'IC_old', authorAssociation: 'OWNER', body: '<!-- run-comment: try-it -->\n\nold' }] });
    await h.run();
    const mutation = h.writes()[0].queryText;
    assert.ok(source.includes(`'query=${mutation}'`), 'packet-post.js EDIT_COMMENT_QUERY is query= plus this text');
  });

  test('a throwing emit never changes the result', async () => {
    const h = harness('try-it-only');
    h.env.deps.emit = () => { throw new Error('sink'); };
    assert.strictEqual((await h.run()).completed, true);
  });
});
