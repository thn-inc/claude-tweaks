'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run, parseArgs } = require('../../../plugin/bin/pr-checklist');
const { composePrEarlyBody } = require('../../../plugin/bin/lib/flow/pr-body');

const RUN_ID = '2026-10-19T000001-record-1';
const FOREIGN_RUN_ID = '2026-01-01T000000-record-9';

const created = [];
test.after(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
});

// Fake-.git anchored fixture, same shape as tests/bin-lib/pr-checks/cli.test.js:
// a main checkout's .git is a directory; mainRoot is injected so resolveTarget never spawns git.
function fixture(runState, { spec = false } = {}) {
  const main = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prchecklist-cli-'));
  created.push(main);
  fs.mkdirSync(path.join(main, '.git'), { recursive: true });
  let runDir = path.join(main, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(runDir, { recursive: true });
  if (spec) {
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
    runDir = path.join(runDir, 'spec-1');
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify({ status: 'active' }));
  } else if (runState) {
    fs.writeFileSync(path.join(runDir, 'run-state.json'), JSON.stringify(runState));
  }
  return { main, runDir };
}

function earlyBody(runId = RUN_ID) {
  return composePrEarlyBody({ runId, specSummary: 'Original summary.', target: '#1', nextStep: 'test', fixesLines: [] });
}

// A fake gh serving `pr view` from a mutable prBody and recording `pr edit` args + stdin.
function makeDeps(main, { prBody, ...over } = {}) {
  const out = []; const err = []; const ghCalls = []; const edits = [];
  const h = {
    prBody,
    deps: {
      cwd: () => main,
      mainRoot: main,
      ghAvailable: () => true,
      gh: (args, input) => {
        ghCalls.push(args);
        if (args[0] === 'pr' && args[1] === 'view') return JSON.stringify({ body: h.prBody });
        if (args[0] === 'pr' && args[1] === 'edit') { edits.push({ args, input }); return ''; }
        throw new Error(`unexpected gh ${args.join(' ')}`);
      },
      stdout: (s) => out.push(s),
      stderr: (s) => err.push(s),
      ...over,
    },
    out, err, ghCalls, edits,
    json: () => JSON.parse(out.join('')),
  };
  return h;
}

test('parseArgs: shapes and rejections', () => {
  assert.deepEqual(parseArgs(['--run', 'r', '--phase', 'build']), {
    run: 'r', phase: 'build', remove: false, fixes: [], summaryFile: null, help: false,
  });
  const full = parseArgs(['--run', 'r', '--phase', 'polish', '--remove', '--fixes', '1,22', '--summary-file', 's.md']);
  assert.equal(full.remove, true);
  assert.deepEqual(full.fixes, [1, 22]);
  assert.equal(full.summaryFile, 's.md');
  assert.ok(parseArgs(['--bogus']).error);
  assert.ok(parseArgs(['--run', 'r', '--phase', 'deploy']).error);
  assert.ok(parseArgs(['--run', '--phase', 'build']).error);
  assert.ok(parseArgs(['--run', 'r', '--phase', 'build', '--fixes', '0']).error);
  assert.ok(parseArgs(['--run', 'r', '--phase', 'build', '--fixes', '1,x']).error);
});

test('AC1.1: one call flips build and writes a body identical except that row', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.edits.length, 1);
  assert.deepEqual(h.edits[0].args, ['pr', 'edit', '7', '--body-file', '-']);
  assert.equal(h.edits[0].input, h.prBody.replace('- [ ] build', '- [x] build'));
  const j = h.json();
  assert.equal(j.action, 'written');
  assert.equal(j.row, 'checked');
  assert.equal(j.pr, 7);
  assert.equal(j.phase, 'build');
  assert.deepEqual(j.restored, []);
});

test('AC1.1: --remove drops the polish row only', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', runDir, '--phase', 'polish', '--remove'], h.deps), 0);
  assert.equal(h.edits.length, 1);
  assert.equal(h.edits[0].input, h.prBody.replace('- [ ] polish\n', ''));
  assert.equal(h.json().row, 'removed');
});

test('already-checked row is a no-op with no write', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody().replace('- [ ] build', '- [x] build') });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.edits.length, 0);
  const j = h.json();
  assert.equal(j.action, 'no-op');
  assert.equal(j.row, 'already-checked');
});

test('--remove on an already-checked row is a no-op with no write', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody().replace('- [ ] polish', '- [x] polish') });
  assert.equal(run(['--run', runDir, '--phase', 'polish', '--remove'], h.deps), 0);
  assert.equal(h.edits.length, 0);
  const j = h.json();
  assert.equal(j.action, 'no-op');
  assert.equal(j.row, 'already-checked');
});

test('missing markers are repaired and logged', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: 'Hand-written body\n' });
  assert.equal(run(['--run', runDir, '--phase', 'build', '--fixes', '1'], h.deps), 0);
  assert.equal(h.edits.length, 1);
  const written = h.edits[0].input;
  assert.ok(written.startsWith(`<!-- claude-tweaks-run: ${RUN_ID} -->`));
  assert.ok(written.includes('- [x] build'));
  assert.ok(written.includes('Fixes #1'));
  assert.ok(written.includes('Hand-written body'));
  assert.deepEqual(h.json().restored, ['run marker', 'phases block', 'fixes block']);
  const log = fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');
  assert.ok(log.includes('restored run marker, phases block, fixes block on PR #7'));
  assert.match(log, /PR checklist refresh/);
  assert.match(log, /Reversibility: high/);
});

test('a decisions.md write failure is swallowed into the envelope, never an exit change', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: 'Hand-written body\n', appendDecision: () => { throw new Error('disk full'); } });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.edits.length, 1);
  const j = h.json();
  assert.equal(j.action, 'written');
  assert.equal(j.logFailed, true);
});

test('AC2.1: a body naming a different run id is refused and nothing is written', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody(FOREIGN_RUN_ID) });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 4);
  assert.equal(h.edits.length, 0);
  const msg = h.err.join('');
  assert.match(msg, /run marker mismatch/);
  assert.ok(msg.includes(FOREIGN_RUN_ID));
  assert.ok(msg.includes(RUN_ID));
  assert.ok(msg.includes('nothing written'));
});

test('AC2.1: the mismatch wins over an already-checked row', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody(FOREIGN_RUN_ID).replace('- [ ] build', '- [x] build') });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 4);
  assert.equal(h.edits.length, 0);
});

test('per-spec run dir uses the parent run id and PR', () => {
  const { main, runDir } = fixture({ pr: { number: 9 } }, { spec: true });
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.edits.length, 1);
  assert.deepEqual(h.edits[0].args, ['pr', 'edit', '9', '--body-file', '-']);
  assert.equal(h.json().action, 'written');
});

test('no pr in run-state is status data', () => {
  const { main, runDir } = fixture({});
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.json().action, 'no-pr');
  assert.equal(h.ghCalls.length, 0);
});

test('gh absent is status data', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody(), ghAvailable: () => false });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  const j = h.json();
  assert.equal(j.action, 'gh-absent');
  assert.equal(j.pr, 7);
  assert.equal(h.ghCalls.length, 0);
});

test('gh pr edit failure exits 5', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody() });
  const view = h.deps.gh;
  h.deps.gh = (args, input) => {
    if (args[1] === 'edit') throw new Error('HTTP 502');
    return view(args, input);
  };
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 5);
  assert.match(h.err.join(''), /HTTP 502/);
});

test('gh pr view failure exits 5 and writes nothing', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody() });
  h.deps.gh = (args) => { h.ghCalls.push(args); throw new Error('HTTP 503'); };
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 5);
  assert.match(h.err.join(''), /HTTP 503/);
  assert.equal(h.edits.length, 0);
});

test('a pr view whose body is not a string is a read failure (exit 5), never a coerced empty body', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: null });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 5);
  assert.match(h.err.join(''), /body/);
  assert.equal(h.edits.length, 0);
});

test('unparseable pr view output exits 5', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody(), gh: () => 'not json' });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 5);
});

const REVERSAL_LINE = '- AUTO 10:00:00 — build: premise reversed: A → B. Reversibility: high.\n';

test('premise reversal without --summary-file reports uncovered and writes checklist-only', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), REVERSAL_LINE);
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 0);
  assert.equal(h.edits.length, 1);
  assert.ok(!h.edits[0].input.includes('Revised during build:'));
  assert.equal(h.edits[0].input, h.prBody.replace('- [ ] build', '- [x] build'));
  const j = h.json();
  assert.deepEqual(j.summary.uncovered, ['A → B']);
  assert.equal(j.summary.reason, 'summary-required');
  assert.equal(j.summary.changed, false);
});

test('--summary-file applies the Spec summary revision in the same write', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  fs.writeFileSync(path.join(runDir, 'decisions.md'), REVERSAL_LINE);
  const summaryFile = path.join(main, 'summary.md');
  fs.writeFileSync(summaryFile, 'Revised one-paragraph summary.\n');
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', runDir, '--phase', 'build', '--summary-file', summaryFile], h.deps), 0);
  assert.equal(h.edits.length, 1);
  const written = h.edits[0].input;
  assert.ok(written.includes('Revised during build: A → B'));
  assert.ok(written.includes('Revised one-paragraph summary.'));
  assert.ok(written.includes('- [x] build'));
  assert.equal(h.json().summary.changed, true);
});

test('an unreadable --summary-file exits 2 before any gh call', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', runDir, '--phase', 'build', '--summary-file', path.join(main, 'nope.md')], h.deps), 2);
  assert.equal(h.ghCalls.length, 0);
});

test('malformed invocations exit 2', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  for (const argv of [
    ['--run', runDir],
    ['--run', runDir, '--phase', 'deploy'],
    ['--phase', 'build'],
    ['--phase', 'build', '--run'],
    ['--run', runDir, '--phase', 'build', '--fixes', '0'],
  ]) {
    const h = makeDeps(main, { prBody: earlyBody() });
    assert.equal(run(argv, h.deps), 2, argv.join(' '));
    assert.equal(h.ghCalls.length, 0);
  }
});

test('a run dir that does not exist exits 3', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', path.join(main, 'nope'), '--phase', 'build'], h.deps), 3);
  assert.match(h.err.join(''), /does not exist/);
});

test('unanchored run dir exits 3', () => {
  const { main } = fixture({ pr: { number: 7 } });
  // A linked worktree's .git is a file: a run dir under it is a worktree-local shadow.
  const wt = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-prchecklist-wt-'));
  created.push(wt);
  fs.writeFileSync(path.join(wt, '.git'), 'gitdir: /elsewhere\n');
  const shadow = path.join(wt, '.claude-tweaks', 'pipelines', RUN_ID);
  fs.mkdirSync(shadow, { recursive: true });
  fs.writeFileSync(path.join(shadow, 'run-state.json'), JSON.stringify({ pr: { number: 7 } }));
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--run', shadow, '--phase', 'build'], h.deps), 3);
  assert.match(h.err.join(''), /not anchored under the main checkout/);
  assert.equal(h.ghCalls.length, 0);
});

test('--help exits 0 without touching gh', () => {
  const { main } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody() });
  assert.equal(run(['--help'], h.deps), 0);
  const usage = h.out.join('');
  assert.match(usage, /usage: pr-checklist\.js --run <run-dir> --phase/);
  assert.match(usage, /4 run marker mismatch/);
  assert.equal(h.ghCalls.length, 0);
});

// Characterization (#4026): the exit-4 / exit-5 stderr lines and the empty stdout
// they leave, pinned before the CLI started logging these outcomes itself.
test('characterization: a mismatch exits 4 with one exact stderr line and no stdout', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody(FOREIGN_RUN_ID) });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 4);
  assert.equal(h.err.join(''), `pr-checklist.js: run marker mismatch on PR #7: body names run ${FOREIGN_RUN_ID}, expected ${RUN_ID} — nothing written\n`);
  assert.equal(h.out.join(''), '');
  assert.equal(h.ghCalls.length, 1);
});

test('characterization: each gh failure exits 5 with its own stderr line and no stdout', () => {
  const cases = [
    { name: 'view throws', gh: () => { throw new Error('HTTP 503'); }, err: 'pr-checklist.js: gh pr view failed on PR #7: HTTP 503\n' },
    { name: 'view unparseable', gh: () => 'not json', errRe: /^pr-checklist\.js: gh pr view failed on PR #7: .+\n$/ },
    { name: 'view non-string body', prBody: null, err: 'pr-checklist.js: gh pr view on PR #7 returned no string body field\n' },
    { name: 'edit throws', editThrows: true, err: 'pr-checklist.js: gh pr edit failed on PR #7: HTTP 502\n' },
  ];
  for (const c of cases) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, { prBody: 'prBody' in c ? c.prBody : earlyBody(), ...(c.gh ? { gh: c.gh } : {}) });
    if (c.editThrows) {
      const view = h.deps.gh;
      h.deps.gh = (args, input) => { if (args[1] === 'edit') throw new Error('HTTP 502'); return view(args, input); };
    }
    assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 5, c.name);
    const first = `${h.err.join('').split('\n')[0]}\n`;
    if (c.err) assert.equal(first, c.err, c.name);
    else assert.match(first, c.errRe, c.name);
    assert.equal(h.out.join(''), '', c.name);
  }
});

// #4026: the CLI writes its own exit-4 / exit-5 decisions.md lines.
const NOW = () => new Date(2026, 9, 25, 10, 0, 0);
const decisions = (runDir) => fs.readFileSync(path.join(runDir, 'decisions.md'), 'utf8');

test('AC3.1: a marker mismatch exits 4 and logs the refusal line', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody(FOREIGN_RUN_ID), now: NOW });
  assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 4);
  assert.equal(h.edits.length, 0);
  // The line _shared/pr-checklist-refresh.md's exit-4 bullet told the caller to write,
  // its {stderr} being the CLI's own mismatch detail.
  assert.ok(decisions(runDir).includes(`- AUTO 10:00:00 — PR checklist refresh: refused on PR #7 — run marker mismatch (body names run ${FOREIGN_RUN_ID}, expected ${RUN_ID}). Reversibility: n/a.\n`));
  assert.ok(h.err.join('').includes(`body names run ${FOREIGN_RUN_ID}, expected ${RUN_ID}`));
});

test('a gh pr edit failure exits 5 and logs the warning line', () => {
  const { main, runDir } = fixture({ pr: { number: 7 } });
  const h = makeDeps(main, { prBody: earlyBody(), now: NOW });
  const view = h.deps.gh;
  h.deps.gh = (args, input) => { if (args[1] === 'edit') throw new Error('HTTP 502'); return view(args, input); };
  assert.equal(run(['--run', runDir, '--phase', 'review'], h.deps), 5);
  assert.ok(decisions(runDir).includes('- AUTO 10:00:00 — PR checklist refresh: gh pr edit failed on PR #7 at review exit — row left for the pre-merge refresh. Reversibility: n/a.\n'));
});

test('a gh pr view failure exits 5 and logs the view warning', () => {
  for (const over of [{ gh: () => { throw new Error('HTTP 503'); } }, { gh: () => 'not json' }, { prBody: null }]) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, { prBody: earlyBody(), now: NOW, ...over });
    assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), 5);
    assert.equal(h.edits.length, 0);
    assert.ok(decisions(runDir).includes('- AUTO 10:00:00 — PR checklist refresh: gh pr view failed on PR #7 at build exit — row left for the pre-merge refresh. Reversibility: n/a.\n'));
  }
});

test('a failed exit-4 / exit-5 append keeps the exit code and adds one stderr line', () => {
  const failing = { now: NOW, appendDecision: () => { throw new Error('disk full'); } };
  for (const { prBody, code } of [{ prBody: earlyBody(FOREIGN_RUN_ID), code: 4 }, { prBody: null, code: 5 }]) {
    const { main, runDir } = fixture({ pr: { number: 7 } });
    const h = makeDeps(main, { prBody, ...failing });
    assert.equal(run(['--run', runDir, '--phase', 'build'], h.deps), code);
    const lines = h.err.join('').split('\n').filter(Boolean);
    assert.equal(lines.length, 2, lines.join('\n'));
    assert.match(lines[1], /^pr-checklist\.js: could not append the decisions\.md entry: disk full$/);
    assert.equal(h.out.join(''), '');
  }
});
