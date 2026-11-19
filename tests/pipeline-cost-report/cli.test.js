// tests/pipeline-cost-report/cli.test.js
//
// #5914: tools/pipeline-cost-report.js ties the spend, funnel and records collectors into one report, and
// tools/pipeline-cost-report/runs.js enumerates pipeline run directories. Fixtures are temp dirs with a fake `gh`
// and a fake `check`; nothing here spawns gh or drive.js.
'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { readText } = require('../helpers/read-skill');

const ROOT = path.join(__dirname, '..', '..');
const { run, parseArgs } = require(path.join(ROOT, 'tools', 'pipeline-cost-report.js'));
const { listRuns } = require(path.join(ROOT, 'tools', 'pipeline-cost-report', 'runs.js'));

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'pcr-'));
after(() => fs.rmSync(DIR, { recursive: true, force: true }));
let n = 0;
const fresh = (label) => {
  const d = path.join(DIR, `${label}${n++}`);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

// Three main sessions on 2026-11-18: flow $4.00 (opus), dispatch $2.00 and specify $1.00 (sonnet). Total $7.00,
// build (flow + dispatch) $6.00, flow alone $4.00, so a wrong build figure cannot equal the total or the flow share.
function session(id, model, skill, inputTokens) {
  return JSON.stringify({ type: 'assistant', timestamp: '2026-11-18T10:00:00Z', message: { id, model, content: [{ type: 'tool_use', name: 'Skill', input: { skill: `claude-tweaks:${skill}` } }], usage: { input_tokens: inputTokens, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }) + '\n';
}
function writeProjects(root, { corrupt = false } = {}) {
  const slugDir = path.join(root, 'slug-a');
  fs.mkdirSync(slugDir, { recursive: true });
  fs.writeFileSync(path.join(slugDir, 's1.jsonl'), session('m1', 'claude-opus-4-8', 'flow', 1000000));
  fs.writeFileSync(path.join(slugDir, 's2.jsonl'), session('m2', 'claude-sonnet-4-6', 'dispatch', 1000000));
  fs.writeFileSync(path.join(slugDir, 's3.jsonl'), session('m3', 'claude-sonnet-4-6', 'specify', 500000));
  if (corrupt) fs.writeFileSync(path.join(slugDir, 'bad.jsonl'), '{}\n');
  return root;
}

const FUNNEL_LIST = JSON.stringify([{ number: 1 }, { number: 2 }, { number: 3 }, { number: 4 }]);
const VERDICTS = {
  1: '{"admitted":true,"reasons":[]}',
  2: '{"admitted":true,"reasons":[]}',
  3: '{"admitted":false,"reasons":["protected path: a.js"]}',
  4: 'not json',
};
const ROWS = JSON.stringify([
  { number: 10, state: 'OPEN', body: 'Defer-reason: tangential' },
  { number: 11, state: 'CLOSED', body: 'Defer-reason: tangential' },
  { number: 12, state: 'CLOSED', body: 'no deferral' },
]);

function fakeGh({ fail = false } = {}) {
  return (args) => {
    if (fail) throw new Error('gh: HTTP 502\nsecond line');
    if (args[0] === 'repo') return 'o/r\n';
    if (args[0] === 'api') {
      const q = args[1];
      if (q.includes('is:pr+is:merged')) return '2\n';
      if (q.includes('created:')) return '3\n';
      if (q.includes('closed:')) return '5\n';
      return '7\n';
    }
    if (args.includes('auto:build')) return FUNNEL_LIST;
    return ROWS;
  };
}

// A transcript whose stream cannot be opened (a live session reaped mid-scan).
const unreadableFs = () => ({
  ...fs,
  createReadStream(file, ...rest) {
    if (path.basename(file) === 'bad.jsonl') throw Object.assign(new Error('EACCES: denied'), { code: 'EACCES' });
    return fs.createReadStream(file, ...rest);
  },
});

function harness(extra = {}) {
  const logs = [];
  const errs = [];
  const projects = writeProjects(fresh('proj'));
  const pipelines = fresh('pipes');
  const deps = {
    gh: fakeGh(),
    check: async (num) => VERDICTS[num],
    now: () => new Date('2026-11-19T12:00:00Z'),
    pluginVersion: () => '9.9.9',
    git: () => path.join(fresh('main'), '.git'),
    cwd: ROOT,
    home: fresh('home'),
    log: (s) => logs.push(s),
    err: (s) => errs.push(s),
    ...extra,
  };
  const base = ['--since', '2026-11-18', '--until', '2026-11-18', '--projects', projects, '--pipelines', pipelines];
  return { deps, logs, errs, base, projects, pipelines };
}

test('AC7.1: --json prints one object holding the same figures as the Markdown output for every section', async () => {
  const md = harness();
  assert.strictEqual(await run({ argv: md.base, deps: md.deps }), 0);
  const text = md.logs.join('\n');
  const js = harness();
  assert.strictEqual(await run({ argv: [...js.base, '--json'], deps: js.deps }), 0);
  assert.strictEqual(js.logs.length, 1);
  const json = JSON.parse(js.logs[0]);

  for (const key of ['window', 'spend', 'funnel', 'records', 'unreadable']) assert.ok(key in json, key);
  assert.strictEqual(json.spend.total, 7);
  assert.ok(text.includes('$7.00'), text);
  assert.strictEqual(json.funnel.admitted, 2);
  assert.match(text, /admitted:? 2\b/i);
  assert.strictEqual(json.funnel.checked, 4);
  assert.match(text, /checked:? 4\b/i);
  assert.strictEqual(json.records.deferred.total, 2);
  assert.match(text, /deferred:? 2\b/i);
  assert.strictEqual(json.spend.perMergedPr.mergedPrs, 2);
  assert.strictEqual(json.spend.perMergedPr.total, 3.5);
  assert.strictEqual(json.spend.perMergedPr.build, 3);
  assert.ok(text.includes('Per merged PR (2 merged): $3.50 total, $3.00 build'), text);
  assert.match(text, /2026-11-18 to 2026-11-18, UTC, inclusive/);
  assert.match(text, /Prices dated 2026-11-03/);
  assert.match(text, /Session type is the first claude-tweaks skill a session invoked; a session that did several things is counted once\./);
  assert.strictEqual(json.spend.sessions, 3);
});

test('sections are separated by a single blank line, a section ending in a table included', async () => {
  const h = harness();
  assert.strictEqual(await run({ argv: h.base, deps: h.deps }), 0);
  const text = h.logs.join('\n');
  assert.match(text, /\| tangential \| 1 \| 1 \|\n\nRuns: /);
  assert.ok(!text.includes('\n\n\n'), text);
});

test('--section limits the sections printed and collected', async () => {
  const h = harness();
  assert.strictEqual(await run({ argv: [...h.base, '--section', 'records', '--json'], deps: h.deps }), 0);
  const json = JSON.parse(h.logs[0]);
  assert.ok(json.records);
  assert.strictEqual(json.spend, undefined);
  assert.strictEqual(json.funnel, undefined);
});

test('--simulate values are comma-split and each --simulate is one set', async () => {
  const h = harness();
  assert.strictEqual(await run({ argv: [...h.base, '--section', 'funnel', '--simulate', 'protected path, other', '--json'], deps: h.deps }), 0);
  const json = JSON.parse(h.logs[0]);
  assert.deepStrictEqual(json.funnel.simulations, [{ set: ['protected path', 'other'], admitted: 3 }]);
});

test('a forge read that throws prints {section}: unavailable, and the run exits 1', async () => {
  const h = harness({ gh: fakeGh({ fail: true }) });
  assert.strictEqual(await run({ argv: [...h.base, '--section', 'records'], deps: h.deps }), 1);
  assert.ok(h.logs.join('\n').includes('records: unavailable — gh: HTTP 502'), h.logs.join('\n'));
  assert.ok(!h.logs.join('\n').includes('second line'));

  const j = harness({ gh: fakeGh({ fail: true }) });
  assert.strictEqual(await run({ argv: [...j.base, '--section', 'records', '--json'], deps: j.deps }), 1);
  assert.deepStrictEqual(JSON.parse(j.logs[0]).records, { error: 'gh: HTTP 502' });
});

test('AC8.2: an unreadable transcript is counted in the printed unreadable figure and the run exits 0', async () => {
  const h = harness({ fs: unreadableFs() });
  writeProjects(h.projects, { corrupt: true });
  assert.strictEqual(await run({ argv: [...h.base, '--section', 'spend', '--json'], deps: h.deps }), 0);
  const json = JSON.parse(h.logs[0]);
  assert.strictEqual(json.unreadable, 1);

  const m = harness({ fs: unreadableFs() });
  writeProjects(m.projects, { corrupt: true });
  assert.strictEqual(await run({ argv: [...m.base, '--section', 'spend'], deps: m.deps }), 0);
  assert.match(m.logs.join('\n'), /Unreadable:? 1\b/i);
});

test('--projects roots are deduplicated by real path', async () => {
  const h = harness();
  const link = path.join(fresh('link'), 'alias');
  fs.symlinkSync(h.projects, link, 'dir');
  const missing = path.join(DIR, 'does-not-exist');
  const argv = [...h.base, '--projects', link, '--projects', missing, '--section', 'spend', '--json'];
  assert.strictEqual(await run({ argv, deps: h.deps }), 0);
  const json = JSON.parse(h.logs[0]);
  assert.strictEqual(json.spend.total, 7);
  assert.strictEqual(json.spend.sessions, 3);
  assert.strictEqual(json.unreadable, 0);
});

test('listRuns keeps the top-level copy of a run that is also archived, counts undated names unparsed, and lists spec members', () => {
  const p = fresh('lr');
  const mk = (...parts) => fs.mkdirSync(path.join(p, ...parts), { recursive: true });
  mk('2026-11-15T070442-spec-1', 'spec-1');
  mk('2026-11-15T070442-spec-1', 'spec-2');
  mk('2026-11-15T070442-spec-1', 'context');
  mk('archive', '2026-11-15T070442-spec-1');
  mk('archive', '2026-11-10T000000-record-9');
  mk('scratch-notes');
  fs.writeFileSync(path.join(p, 'loose-file.txt'), 'x');
  const r = listRuns(p);
  assert.strictEqual(r.missing, false);
  assert.strictEqual(r.unparsed, 1);
  assert.strictEqual(r.unreadable, 0);
  assert.deepStrictEqual(r.runs.map((x) => [x.name, x.date, x.archived]).sort(), [
    ['2026-11-10T000000-record-9', '2026-11-10', true],
    ['2026-11-15T070442-spec-1', '2026-11-15', false],
  ]);
  const top = r.runs.find((x) => !x.archived);
  assert.deepStrictEqual(top.members.map((m) => m.id).sort(), [1, 2]);
  assert.strictEqual(top.dir, path.join(p, '2026-11-15T070442-spec-1'));
  assert.strictEqual(r.runs.some((x) => x.name === 'archive'), false);
});

test('listRuns on a missing pipelines directory returns missing with no runs', () => {
  const r = listRuns(path.join(DIR, 'nope-pipelines'));
  assert.deepStrictEqual(r, { runs: [], unparsed: 0, unreadable: 0, missing: true });
});

function vanishingFs(vanish) {
  return {
    ...fs,
    readdirSync(dir, opts) {
      if (dir === vanish) throw Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' });
      return fs.readdirSync(dir, opts);
    },
  };
}

test('AC8.2: a run directory that disappears during the scan is counted unreadable and the run exits 0', async () => {
  const h = harness();
  const gone = path.join(h.pipelines, '2026-11-18T010101-spec-5');
  fs.mkdirSync(gone);
  fs.mkdirSync(path.join(h.pipelines, '2026-11-18T020202-spec-6', 'spec-6'), { recursive: true });
  const r = listRuns(h.pipelines, vanishingFs(gone));
  assert.strictEqual(r.unreadable, 1);
  assert.strictEqual(r.runs.length, 1);
  assert.strictEqual(listRuns(h.pipelines).unreadable, 0, 'no archive/ dir adds nothing');

  h.deps.fs = vanishingFs(gone);
  assert.strictEqual(await run({ argv: [...h.base, '--section', 'spend', '--json'], deps: h.deps }), 0);
  const json = JSON.parse(h.logs[0]);
  assert.strictEqual(json.unreadable, 1);
  assert.deepStrictEqual(json.runs, { inWindow: 1, unparsed: 0, unreadable: 1 });
});

test('a missing pipelines directory prints not found and still exits 0', async () => {
  const h = harness();
  const dir = path.join(DIR, 'absent-pipes');
  const argv = h.base.map((a) => (a === h.pipelines ? dir : a));
  assert.strictEqual(await run({ argv: [...argv, '--section', 'records'], deps: h.deps }), 0);
  assert.ok(h.logs.join('\n').includes(`not found: ${dir}`), h.logs.join('\n'));
});

test('spend.perMergedPr has null dollars when no PR merged', async () => {
  const base = fakeGh();
  const h = harness({ gh: (args) => (args[0] === 'api' && args[1].includes('is:pr+is:merged') ? '0\n' : base(args)) });
  assert.strictEqual(await run({ argv: [...h.base, '--section', 'spend', '--json'], deps: h.deps }), 0);
  assert.deepStrictEqual(JSON.parse(h.logs[0]).spend.perMergedPr, { mergedPrs: 0, total: null, build: null });
});

test('malformed invocation exits 2', async () => {
  for (const argv of [['--section', 'bogus'], ['--since', '2026-13-01'], ['--nope'], ['--since', '2026-11-19', '--until', '2026-11-01'], ['--projects']]) {
    const h = harness();
    assert.strictEqual(await run({ argv, deps: h.deps }), 2, argv.join(' '));
    assert.match(h.errs.join('\n'), /usage:/);
  }
  assert.ok(parseArgs(['--simulate', 'a,b', '--simulate', 'c']).opts.simulate.length === 2);
});

// ---- AC9: nothing under plugin/ names this tool (tools/ does not ship, docs/decisions/0015-*) ----

const PLUGIN = path.join(ROOT, 'plugin');
const NEEDLE = 'tools/pipeline-cost-report';

const walk = (dir, out) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.isFile()) out.push(full);
  }
  return out;
};

// A plain substring over each file's text, comments included. A symlink is not followed; an unreadable file is an offender.
const scan = (dir) => {
  const files = walk(dir, []);
  const offenders = [];
  for (const file of files) {
    let text;
    try { text = readText(file); } catch (e) { offenders.push(`${file}: unreadable (${e.code || e.message})`); continue; }
    if (text.includes(NEEDLE)) offenders.push(file);
  }
  return { files: files.length, offenders };
};

test('AC9.1: no file under plugin/ names tools/pipeline-cost-report', () => {
  const { files, offenders } = scan(PLUGIN);
  assert.ok(files >= 500, `walked ${files} files under plugin/; fewer than 500 means the walk stopped covering the tree`);
  assert.deepStrictEqual(offenders, []);
});

test('AC9.1 go-red control: the scan reports a file that names the tool', () => {
  const dir = fresh('scan');
  const hit = path.join(dir, 'a.js');
  fs.writeFileSync(hit, `// see ${NEEDLE}.js\n`);
  fs.writeFileSync(path.join(dir, 'clean.md'), 'nothing here\n');
  assert.deepStrictEqual(scan(dir).offenders, [hit]);
});

// ---- fix round 1 ----

test('listRuns: a top-level copy that fails to read does not hide the archived copy', () => {
  const p = fresh('hide');
  const name = '2026-11-15T070442-spec-1';
  fs.mkdirSync(path.join(p, name), { recursive: true });
  fs.mkdirSync(path.join(p, 'archive', name, 'spec-1'), { recursive: true });
  const top = path.join(p, name);
  const r = listRuns(p, {
    ...fs,
    readdirSync(dir, opts) {
      if (dir === top) throw Object.assign(new Error('ENOENT: moved'), { code: 'ENOENT' });
      return fs.readdirSync(dir, opts);
    },
  });
  assert.strictEqual(r.unreadable, 1);
  assert.deepStrictEqual(r.runs.map((x) => [x.name, x.archived, x.members.length]), [[name, true, 1]]);
});

test('listRuns: a name is dated only when it starts with a real calendar date', () => {
  const p = fresh('dates');
  for (const name of ['2026-99-99-x', '2026-02-30-x', '2026-11-123-x', '2026-11-12', '2026-11-13T010101-spec-2']) fs.mkdirSync(path.join(p, name));
  const r = listRuns(p);
  assert.strictEqual(r.unparsed, 3);
  assert.deepStrictEqual(r.runs.map((x) => x.date).sort(), ['2026-11-12', '2026-11-13']);
});

test('listRuns follows a symlink to a directory, and counts a dangling one unreadable', () => {
  const p = fresh('sym');
  const real = fresh('symreal');
  fs.mkdirSync(path.join(real, 'spec-3'));
  fs.symlinkSync(real, path.join(p, '2026-11-12T000000-spec-3'), 'dir');
  fs.symlinkSync(path.join(DIR, 'no-such-target'), path.join(p, '2026-11-12T000001-spec-4'), 'dir');
  const r = listRuns(p);
  assert.deepStrictEqual(r.runs.map((x) => [x.name, x.members.map((m) => m.id)]), [['2026-11-12T000000-spec-3', [3]]]);
  assert.strictEqual(r.unreadable, 1);
});

test('a section receives the run listing in ctx.runs, collected before the sections run', async () => {
  const { SECTIONS } = require(path.join(ROOT, 'tools', 'pipeline-cost-report.js'));
  const h = harness();
  fs.mkdirSync(path.join(h.pipelines, '2026-11-18T010101-spec-5', 'spec-5'), { recursive: true });
  let seen = null;
  SECTIONS.push({ key: 'probe', collect: async (ctx) => { seen = ctx.runs; return {}; }, failed: () => false, unreadable: () => 0, render: () => ['probe'] });
  try {
    assert.strictEqual(await run({ argv: [...h.base, '--section', 'all'], deps: h.deps }), 0);
  } finally {
    SECTIONS.pop();
  }
  assert.deepStrictEqual(seen.runs.map((r) => [r.name, r.members.map((m) => m.id)]), [['2026-11-18T010101-spec-5', [5]]]);
});

test('usage names every section key', async () => {
  const h = harness();
  assert.strictEqual(await run({ argv: ['--section', 'bogus'], deps: h.deps }), 2);
  assert.ok(h.errs.join('\n').includes('--section spend|funnel|records|all]'), h.errs.join('\n'));
});

test('a failed default --pipelines lookup prints Runs: unavailable and leaves the exit code alone', async () => {
  const h = harness({ git: () => { throw new Error('fatal: not a git repository\nmore'); } });
  const argv = h.base.slice(0, -2);
  assert.strictEqual(await run({ argv: [...argv, '--section', 'records'], deps: h.deps }), 0);
  assert.match(h.logs.join('\n'), /Runs: unavailable — cannot resolve the pipelines directory \(fatal: not a git repository\)/);
  const j = harness({ git: () => { throw new Error('fatal'); } });
  assert.strictEqual(await run({ argv: [...j.base.slice(0, -2), '--section', 'records', '--json'], deps: j.deps }), 0);
  assert.match(JSON.parse(j.logs[0]).runs.error, /cannot resolve the pipelines directory/);
});

test('a value starting with a single dash is accepted; one starting with -- is not', () => {
  assert.strictEqual(parseArgs(['--match', '-foo']).opts.match, '-foo');
  assert.ok(parseArgs(['--match', '--json']).error);
});
