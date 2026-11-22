'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { run } = require('../../tools/review-replay');
const { disciplineLines } = require('../../tools/review-replay/prompt');
const schema = require('../../tools/review-replay/schema');
const { PROFILES } = require('../../plugin/bin/lib/model-profiles/profiles');
const { ARCHIVE, HEAD_A, BASE_A, HEAD_C, makeDeps } = require('./helpers');
const { readText } = require('../helpers/read-skill.js');

const ARMS = ['--arm', 'name=pair,chunk=2,profile=fast,repeat=2', '--arm', 'name=single,chunk=1,profile=standard'];

// Runs extract into a fresh out dir (not yet created) and hands back the result and a reader for the written files.
async function extractInto(extra = [], { deps = makeDeps(), arms = ARMS } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-extract-'));
  const out = path.join(root, 'out');
  const code = await run({ argv: ['extract', '--runs', ARCHIVE, '--out', out, ...arms, ...extra], deps });
  const json = (name) => JSON.parse(fs.readFileSync(path.join(out, name), 'utf8'));
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { code, deps, out, json, cleanup };
}

const allPrompts = (manifest) => manifest.arms.flatMap((a) => a.prompts);
const read = (file) => fs.readFileSync(file, 'utf8');

test('AC1.4: extract over the fixture archive writes trees, prompts per arm, manifest, fixture and verdicts; unreadable and review-less runs are excluded with reasons', async () => {
  const x = await extractInto();
  try {
    assert.equal(x.code, 0, x.deps.errs.join('\n'));
    const manifest = x.json(schema.MANIFEST_FILE);
    assert.deepEqual(schema.validateManifest(manifest), []);
    assert.equal(manifest.template.path, path.resolve(path.join(__dirname, '..', '..', 'plugin', 'skills', 'review', 'step3-tiebreak.md')));
    assert.match(manifest.template.sha1, /^[0-9a-f]{40}$/);
    assert.deepEqual(manifest.arms.map((a) => [a.name, a.chunk, a.profile, a.model, a.effort, a.repeat]), [
      ['pair', 2, 'fast', PROFILES.fast.model, PROFILES.fast.effort, 2],
      ['single', 1, 'standard', PROFILES.standard.model, PROFILES.standard.effort, 1],
    ]);
    const [pair, single] = manifest.arms;
    assert.deepEqual(pair.prompts.map((p) => [p.name, p.run, p.findingIds]), [
      ['run-a--0', 'run-a', ['aaaaaaaaaaa1', 'aaaaaaaaaaa2']],
      ['run-b--0', 'run-b', ['bbbbbbbbbbb1', 'bbbbbbbbbbb2']],
    ]);
    assert.deepEqual(single.prompts.map((p) => p.name), ['run-a--0', 'run-a--1', 'run-b--0', 'run-b--1']);
    for (const p of allPrompts(manifest)) {
      assert.ok(path.isAbsolute(p.file));
      assert.ok(fs.existsSync(p.file), p.file);
    }
    assert.equal(single.prompts[0].file, path.join(x.out, 'prompts', 'single', 'run-a--0.md'));
    assert.ok(fs.existsSync(path.join(x.out, 'trees', 'run-a', 'src', 'alpha.js')));
    assert.ok(fs.existsSync(path.join(x.out, 'trees', 'run-b', 'lib', 'one.js')));

    const fixture = x.json(schema.FIXTURE_FILE);
    assert.equal(fixture.schemaVersion, schema.SCHEMA_VERSION);
    assert.deepEqual(fixture.totals, { runs: 2, findings: 4, bySeverity: { medium: 1, low: 1, high: 1, unknown: 1 } });
    assert.deepEqual(fixture.requested, {});
    assert.deepEqual(fixture.excluded, [
      { run: 'run-a', finding: 'aaaaaaaaaaa3', reason: 'file-absent-at-head' },
      { run: 'run-bad', reason: 'decisions-unreadable' },
      { run: 'run-none', reason: 'no-review' },
    ]);
    const [a, b] = fixture.runs;
    assert.deepEqual([a.run, a.tree, a.head, a.base], ['run-a', path.join(x.out, 'trees', 'run-a'), HEAD_A, BASE_A]);
    assert.deepEqual([b.run, b.head, b.base], ['run-b', HEAD_C, 'c'.repeat(40)]);
    assert.deepEqual(a.findings[0], { id: 'aaaaaaaaaaa1', lens: '3a', path: 'src/alpha.js', line: 10, claim: 'alpha claim', severity: 'medium', kind: 'unconfirmed' });
    assert.deepEqual(a.baselineTiebreak, { agents: 3, out: 36, cc: 3006, cr: 306, seconds: 5 });
    assert.deepEqual(fixture.counts.verdictsWithoutFinding, 1);
    assert.equal(fixture.counts.fallbackMatched, 2);

    const verdicts = x.json(schema.VERDICTS_FILE);
    assert.deepEqual(verdicts, {
      schemaVersion: schema.SCHEMA_VERSION,
      verdicts: { 'run-a/aaaaaaaaaaa1': 'confirmed', 'run-a/aaaaaaaaaaa2': 'refuted', 'run-b/bbbbbbbbbbb1': 'confirmed', 'run-b/bbbbbbbbbbb2': 'refuted' },
    });
    const summary = JSON.parse(x.deps.logs.join('\n'));
    assert.deepEqual(summary.arms, [{ name: 'pair', prompts: 2 }, { name: 'single', prompts: 4 }]);
    assert.equal(summary.totals.findings, 4);
  } finally {
    x.cleanup();
  }
});

test('AC2.1/AC2.2: no prompt contains an archived verdict, an archived rationale, or the verdicts file name', async () => {
  const x = await extractInto();
  try {
    const prompts = allPrompts(x.json(schema.MANIFEST_FILE));
    assert.ok(prompts.length > 0);
    for (const p of prompts) {
      const text = read(p.file);
      assert.ok(!text.includes(schema.VERDICTS_FILE), `${p.name}: names the verdicts file`);
      for (const leak of ['dropped: refuted by tiebreak', 'confirmed by tiebreak', 'digested:']) {
        assert.ok(!text.includes(leak), `${p.name}: contains "${leak}"`);
      }
      assert.ok(!text.includes('secret-rationale-quote'), `${p.name}: contains an archived Evidence quote`);
      assert.ok(!text.includes('applied low-severity fix'), `${p.name}: contains the Step 3 Routing rationale`);
    }
  } finally {
    x.cleanup();
  }
});

test('AC5.2: extract builds every prompt from the template file it is given, and records that file in the manifest', async () => {
  const sentence = 'Extra sentence the replay must carry.';
  const live = readText(path.join(__dirname, '..', '..', 'plugin', 'skills', 'review', 'step3-tiebreak.md'));
  const edited = live.replaceAll(
    'Recommendation file means the finding is worth a fix or a work record;',
    `${sentence} Recommendation file means the finding is worth a fix or a work record;`);
  assert.notEqual(edited, live);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-template-'));
  const template = path.join(dir, 'step3-tiebreak.md');
  fs.writeFileSync(template, edited);
  const edit = await extractInto(['--template', template]);
  const plain = await extractInto();
  try {
    assert.equal(edit.code, 0, edit.deps.errs.join('\n'));
    const prompts = allPrompts(edit.json(schema.MANIFEST_FILE));
    assert.ok(prompts.length > 0);
    for (const p of prompts) assert.ok(read(p.file).includes(sentence), `${p.name}: lacks the edited sentence`);
    assert.equal(edit.json(schema.MANIFEST_FILE).template.path, template);
    for (const p of allPrompts(plain.json(schema.MANIFEST_FILE))) assert.ok(!read(p.file).includes(sentence), `${p.name}: carries the sentence without the edited template`);
  } finally {
    edit.cleanup();
    plain.cleanup();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('AC10.1: a --min-findings above the eligible count reports the shortfall, exits 3 and writes no arm', async () => {
  const x = await extractInto(['--min-findings', '5']);
  try {
    assert.equal(x.code, 3);
    assert.equal(x.deps.logs.length, 0);
    assert.equal(fs.existsSync(x.out) ? fs.readdirSync(x.out).length : 0, 0, 'nothing is written');
    assert.equal(x.deps.errs.length, 1);
    assert.deepEqual(JSON.parse(x.deps.errs[0]), {
      shortfall: { requested: { minFindings: 5 }, available: { runs: 2, findings: 4, bySeverity: { medium: 1, low: 1, high: 1, unknown: 1 } } },
      excluded: [
        { run: 'run-a', finding: 'aaaaaaaaaaa3', reason: 'file-absent-at-head' },
        { run: 'run-bad', reason: 'decisions-unreadable' },
        { run: 'run-none', reason: 'no-review' },
      ],
    });
  } finally {
    x.cleanup();
  }
});

test('AC10.2: an unmet --quota info=<n> reports the shortfall and exits 3', async () => {
  const x = await extractInto(['--quota', 'info=1']);
  try {
    assert.equal(x.code, 3);
    const shortfall = JSON.parse(x.deps.errs[0]).shortfall;
    assert.deepEqual(shortfall.requested, { quota: { info: 1 } });
    assert.equal(shortfall.available.bySeverity.info, undefined);
    assert.equal(fs.existsSync(x.out), false);
  } finally {
    x.cleanup();
  }
});

test('--min-runs and --quota stop adding runs once met, and a met quota writes only the runs needed', async () => {
  const x = await extractInto(['--min-runs', '1', '--quota', 'medium=1']);
  try {
    assert.equal(x.code, 0, x.deps.errs.join('\n'));
    assert.deepEqual(x.json(schema.FIXTURE_FILE).runs.map((r) => r.run), ['run-a']);
    assert.equal(fs.existsSync(path.join(x.out, 'trees', 'run-b')), false);
  } finally {
    x.cleanup();
  }
  const both = await extractInto(['--quota', 'high=1']);
  try {
    assert.equal(both.code, 0);
    assert.deepEqual(both.json(schema.FIXTURE_FILE).runs.map((r) => r.run), ['run-a', 'run-b']);
  } finally {
    both.cleanup();
  }
});

test('--select picks the runs in the given order', async () => {
  const x = await extractInto(['--select', 'run-b,run-a']);
  try {
    assert.equal(x.code, 0);
    assert.deepEqual(x.json(schema.FIXTURE_FILE).runs.map((r) => r.run), ['run-b', 'run-a']);
  } finally {
    x.cleanup();
  }
});

test('a finding whose file is absent at head is excluded with file-absent-at-head', async () => {
  const x = await extractInto();
  try {
    const fixture = x.json(schema.FIXTURE_FILE);
    assert.ok(fixture.excluded.some((e) => e.run === 'run-a' && e.finding === 'aaaaaaaaaaa3' && e.reason === 'file-absent-at-head'));
    assert.ok(!fixture.runs[0].findings.some((f) => f.id === 'aaaaaaaaaaa3'));
    assert.ok(!allPrompts(x.json(schema.MANIFEST_FILE)).some((p) => p.findingIds.includes('aaaaaaaaaaa3')));
    assert.ok(!('run-a/aaaaaaaaaaa3' in x.json(schema.VERDICTS_FILE).verdicts));
  } finally {
    x.cleanup();
  }
});

test('the run\'s spec file is in the tree at .claude-tweaks/pipelines/{run}/work/', async () => {
  const x = await extractInto();
  try {
    const spec = path.join(x.out, 'trees', 'run-a', '.claude-tweaks', 'pipelines', 'run-a', 'work', '101-spec.md');
    assert.equal(read(spec), read(path.join(ARCHIVE, 'run-a', 'work', '101-spec.md')));
    assert.ok(!fs.existsSync(path.join(x.out, 'trees', 'run-a', '.claude-tweaks', 'pipelines', 'run-a', 'decisions.md')));
  } finally {
    x.cleanup();
  }
});

test('prompts take the discipline lines from the run\'s own review-dispatch.md, and a run without one uses dispatch-core\'s lines and is counted', async () => {
  const x = await extractInto();
  try {
    const core = disciplineLines(read(path.join(makeDeps().pluginRoot, 'skills', '_shared', 'subagent-dispatch-core.md')));
    const own = disciplineLines(read(path.join(ARCHIVE, 'run-a', 'context', 'review-dispatch.md')));
    assert.notEqual(own.readOnly, core.readOnly);
    const prompts = allPrompts(x.json(schema.MANIFEST_FILE));
    const forA = prompts.filter((p) => p.run === 'run-a');
    const forB = prompts.filter((p) => p.run === 'run-b');
    assert.equal(forA.length + forB.length, 6);
    for (const p of forA) {
      const text = read(p.file);
      assert.ok(text.includes(own.readOnly) && text.includes(own.shell), p.name);
      assert.ok(!text.includes(core.readOnly) && !text.includes(core.shell), p.name);
    }
    for (const p of forB) {
      const text = read(p.file);
      assert.ok(text.includes(core.readOnly) && text.includes(core.shell), p.name);
      assert.ok(!text.includes(own.readOnly), p.name);
    }
    const fixture = x.json(schema.FIXTURE_FILE);
    assert.equal(fixture.counts.disciplineFallbackPrompts, forB.length);
    assert.ok(fixture.runs.some((r) => r.run === 'run-b'), 'run-b is not excluded for lacking a bundle');
  } finally {
    x.cleanup();
  }
});

test('a failed-judge finding is written to no prompt and counted under its reason', async () => {
  const x = await extractInto();
  try {
    const manifest = x.json(schema.MANIFEST_FILE);
    assert.ok(!allPrompts(manifest).some((p) => p.findingIds.includes('aaaaaaaaaaa4')));
    assert.ok(fs.existsSync(path.join(x.out, 'trees', 'run-a', 'src', 'delta.js')), 'its file is at head, so only the missing verdict excludes it');
    assert.deepEqual(x.json(schema.FIXTURE_FILE).counts.failedJudgeByReason, { 'status:DONE': 1 });
    assert.ok(!('run-a/aaaaaaaaaaa4' in x.json(schema.VERDICTS_FILE).verdicts));
  } finally {
    x.cleanup();
  }
});

test('run exclusions: a missing findings artifact, a head not in the clone and a missing base each name their reason', async () => {
  const noFindings = {
    ...fs,
    readFileSync: (p, enc) => {
      if (String(p).endsWith(path.join('run-b', 'review-findings.json'))) {
        const e = new Error('gone');
        e.code = 'ENOENT';
        throw e;
      }
      return fs.readFileSync(p, enc);
    },
  };
  // Every run excluded leaves nothing to replay: a shortfall (exit 3) that carries the reasons, never a clean empty set.
  const shortfallOf = async (extra, deps) => {
    const x = await extractInto(extra, { deps });
    try {
      assert.equal(x.code, 3);
      assert.equal(fs.existsSync(x.out), false, 'nothing is written');
      assert.equal(x.deps.errs.length, 1);
      const line = JSON.parse(x.deps.errs[0]);
      assert.deepEqual(line.shortfall.available, { runs: 0, findings: 0, bySeverity: {} });
      return line.excluded;
    } finally {
      x.cleanup();
    }
  };
  assert.deepEqual(await shortfallOf(['--select', 'run-b'], makeDeps({ fs: noFindings })), [{ run: 'run-b', reason: 'no-findings-artifact' }]);
  assert.deepEqual(await shortfallOf(['--select', 'run-b', '--min-runs', '1'], makeDeps({ fs: noFindings })), [{ run: 'run-b', reason: 'no-findings-artifact' }]);
  const noClone = makeDeps({ git: (args) => { if (args[0] === 'cat-file') throw new Error('unknown'); return makeDeps().git(args); } });
  assert.deepEqual(await shortfallOf(['--select', 'run-b'], noClone), [{ run: 'run-b', reason: 'head-not-in-clone' }]);
  const noBase = makeDeps({ fs: { ...fs, readFileSync: (p, enc) => { if (String(p).endsWith('manifest.json')) { const e = new Error('gone'); e.code = 'ENOENT'; throw e; } return fs.readFileSync(p, enc); } } });
  assert.deepEqual(await shortfallOf(['--select', 'run-a'], noBase), [{ run: 'run-a', reason: 'no-recorded-base' }]);
  assert.deepEqual(await shortfallOf(['--select', 'run-a'], makeDeps({ git: () => { throw new Error('unknown'); } })), [{ run: 'run-a', reason: 'fix-commit-not-in-clone' }]);
});

test('a run whose findings all lack a file is excluded with no-eligible-findings and the replay set is a shortfall', async () => {
  const noFiles = makeDeps({ gitTable: { [`ls-tree -r --name-only ${HEAD_C}`]: 'unrelated.js\n' } });
  const x = await extractInto(['--select', 'run-b'], { deps: noFiles });
  try {
    assert.equal(x.code, 3);
    assert.deepEqual(JSON.parse(x.deps.errs[0]).excluded, [
      { run: 'run-b', finding: 'bbbbbbbbbbb1', reason: 'file-absent-at-head' },
      { run: 'run-b', finding: 'bbbbbbbbbbb2', reason: 'file-absent-at-head' },
      { run: 'run-b', reason: 'no-eligible-findings' },
    ]);
    assert.equal(fs.existsSync(x.out), false);
  } finally {
    x.cleanup();
  }
});

test('a failed write leaves --out partial: exit 1, stderr names the path and says to remove it, and a re-run says why it refuses', async () => {
  const deps = makeDeps({ writeTree: (head, destDir) => { fs.mkdirSync(destDir, { recursive: true }); throw new Error('disk full'); } });
  const x = await extractInto([], { deps });
  try {
    assert.equal(x.code, 1);
    const text = x.deps.errs.join('\n');
    assert.ok(text.includes('disk full'));
    assert.ok(text.includes(x.out), 'names the --out path');
    assert.match(text, /partial; remove it before re-running/);
    assert.equal(x.deps.logs.length, 0);
    const again = makeDeps();
    assert.equal(await run({ argv: ['extract', '--runs', ARCHIVE, '--out', x.out, ...ARMS], deps: again }), 2);
    assert.match(again.errs.join('\n'), /must not exist or must be empty/);
  } finally {
    x.cleanup();
  }
});

test('--select with a repeated run name exits 2 naming it', async () => {
  const x = await extractInto(['--select', 'run-a,run-a']);
  try {
    assert.equal(x.code, 2);
    assert.match(x.deps.errs.join('\n'), /"run-a" more than once/);
    assert.equal(fs.existsSync(x.out), false);
  } finally {
    x.cleanup();
  }
});

test('--quota rejects an unknown or repeated severity with exit 2 and accepts the known ones', async () => {
  const typo = await extractInto(['--quota', 'hgih=1']);
  try {
    assert.equal(typo.code, 2);
    assert.match(typo.deps.errs.join('\n'), /severity must be one of critical\|high\|medium\|low\|info\|unknown: "hgih"/);
  } finally {
    typo.cleanup();
  }
  const repeat = await extractInto(['--quota', 'high=1,high=2']);
  try {
    assert.equal(repeat.code, 2);
    assert.match(repeat.deps.errs.join('\n'), /"high" more than once/);
  } finally {
    repeat.cleanup();
  }
  const ok = await extractInto(['--quota', 'unknown=1,low=1']);
  try {
    assert.equal(ok.code, 0, ok.deps.errs.join('\n'));
  } finally {
    ok.cleanup();
  }
});

test('an unknown --arm profile exits 2', async () => {
  const x = await extractInto([], { arms: ['--arm', 'name=bad,profile=turbo'] });
  try {
    assert.equal(x.code, 2);
    assert.match(x.deps.errs.join('\n'), /profile must be one of fast\|standard\|capable\|frontier/);
    assert.equal(fs.existsSync(x.out), false);
  } finally {
    x.cleanup();
  }
});

test('malformed extract invocations exit 2: no arm, no --out, a bad number or quota, a duplicate arm, a non-empty --out', async () => {
  const bad = async (argv) => {
    const deps = makeDeps();
    return { code: await run({ argv: ['extract', '--runs', ARCHIVE, ...argv], deps }), deps };
  };
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-bad-'));
  try {
    const arm = ['--arm', 'name=one,profile=fast'];
    assert.equal((await bad(['--out', path.join(tmp, 'o')])).code, 2, 'no arm');
    assert.equal((await bad(arm)).code, 2, 'no --out');
    assert.equal((await bad(['--out', path.join(tmp, 'o'), ...arm, '--min-runs', '0'])).code, 2);
    assert.equal((await bad(['--out', path.join(tmp, 'o'), ...arm, '--quota', 'info'])).code, 2);
    assert.equal((await bad(['--out', path.join(tmp, 'o'), ...arm, '--arm', 'name=one,profile=capable'])).code, 2, 'duplicate arm name');
    assert.equal((await bad(['--out', path.join(tmp, 'o'), '--arm', 'name=a|b,profile=fast'])).code, 2, 'a "|" would break the arm label');
    assert.equal((await bad(['--out', path.join(tmp, 'o'), ...arm, '--select', 'run-nope'])).code, 2);
    fs.writeFileSync(path.join(tmp, 'occupied'), 'x');
    const full = await bad(['--out', tmp, ...arm]);
    assert.equal(full.code, 2);
    assert.match(full.deps.errs.join('\n'), /must not exist or must be empty/);
    assert.equal(fs.existsSync(path.join(tmp, 'trees')), false);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('findings under .claude-tweaks: policy.yml and a spec under an earlier pipeline dir name are eligible, the spec is in the tree at the cited path, and any other pipelines path is file-absent-at-head', async () => {
  const HEAD_D = 'd'.repeat(40);
  const committed = [
    '.claude-tweaks/policy.yml',
    '.claude-tweaks/pipelines/earlier-name/work/900-spec.md',
    '.claude-tweaks/pipelines/earlier-name/work/other-spec.md',
    '.claude-tweaks/pipelines/earlier-name/decisions.md',
  ];
  const deps = makeDeps({
    gitTable: {
      'log -1 --format=%ct 3333333': '300\n',
      'rev-parse 3333333^': `${HEAD_D}\n`,
      [`cat-file -e ${HEAD_D}^{commit}`]: '',
      [`ls-tree -r --name-only ${HEAD_D}`]: `src/alpha.js\n${committed.join('\n')}\n`,
    },
  });
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-ct-'));
  const out = path.join(root, 'out');
  try {
    const code = await run({ argv: ['extract', '--runs', path.join(path.dirname(ARCHIVE), 'archive-claude-tweaks'), '--out', out, '--arm', 'name=one,profile=fast'], deps });
    assert.equal(code, 0, deps.errs.join('\n'));
    const fixture = JSON.parse(fs.readFileSync(path.join(out, schema.FIXTURE_FILE), 'utf8'));
    assert.deepEqual(fixture.runs[0].findings.map((f) => f.id), ['ccccccccccc1', 'ccccccccccc2']);
    assert.equal(fixture.runs[0].baselineTiebreak, null, 'run-ct has no timing.json, so its baseline cost is unknown, not zero');
    assert.deepEqual(fixture.excluded, [
      { run: 'run-ct', finding: 'ccccccccccc3', reason: 'file-absent-at-head' },
      { run: 'run-ct', finding: 'ccccccccccc4', reason: 'file-absent-at-head' },
    ]);
    const tree = path.join(out, 'trees', 'run-ct');
    const spec = read(path.join(ARCHIVE, '..', 'archive-claude-tweaks', 'run-ct', 'work', '900-spec.md'));
    assert.equal(read(path.join(tree, '.claude-tweaks', 'pipelines', 'earlier-name', 'work', '900-spec.md')), spec, 'the spec is at the path the finding cites');
    assert.equal(read(path.join(tree, '.claude-tweaks', 'pipelines', 'run-ct', 'work', '900-spec.md')), spec, 'and at the run\'s own archive-dir path');
    assert.ok(!fs.existsSync(path.join(tree, '.claude-tweaks', 'pipelines', 'earlier-name', 'work', 'other-spec.md')));
    assert.ok(!fs.existsSync(path.join(tree, '.claude-tweaks', 'pipelines', 'earlier-name', 'decisions.md')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('a --dispatch-core without discipline lines is a runtime failure that names the file and writes nothing', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-core-'));
  try {
    const core = path.join(tmp, 'core.md');
    fs.writeFileSync(core, '# no discipline lines here\n');
    const x = await extractInto(['--dispatch-core', core]);
    try {
      assert.equal(x.code, 1);
      assert.ok(x.deps.errs.join('\n').includes(core));
      assert.equal(fs.existsSync(x.out), false);
    } finally {
      x.cleanup();
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('#5990 AC1.1: an arm with effort=low writes model opus and effort low', async () => {
  const x = await extractInto([], { arms: ['--arm', 'name=lo,chunk=1,profile=capable,repeat=1,effort=low'] });
  try {
    assert.equal(x.code, 0, x.deps.errs.join('\n'));
    const arm = x.json(schema.MANIFEST_FILE).arms.find((a) => a.name === 'lo');
    assert.equal(arm.model, PROFILES.capable.model);
    assert.equal(arm.model, 'opus');
    assert.equal(arm.effort, 'low');
  } finally {
    x.cleanup();
  }
});

test('#5990 AC2.1: effort=fast exits 2 and stderr names fast; every real effort is accepted', async () => {
  const bad = await extractInto([], { arms: ['--arm', 'name=x,profile=capable,effort=fast'] });
  try {
    assert.equal(bad.code, 2);
    assert.match(bad.deps.errs.join('\n'), /effort must be one of [^:]*: "fast"/);
  } finally {
    bad.cleanup();
  }
  for (const effort of ['low', 'medium', 'high', 'xhigh', 'max']) {
    const ok = await extractInto([], { arms: ['--arm', `name=x,profile=capable,effort=${effort}`] });
    try {
      assert.equal(ok.code, 0, `${effort}: ${ok.deps.errs.join('\n')}`);
    } finally {
      ok.cleanup();
    }
  }
});

test('#5990 AC3.1: an arm without effort= writes the same manifest arm as before', async () => {
  const x = await extractInto([], { arms: ['--arm', 'name=s,chunk=1,profile=standard,repeat=1'] });
  try {
    assert.equal(x.code, 0, x.deps.errs.join('\n'));
    const { prompts, ...rest } = x.json(schema.MANIFEST_FILE).arms[0];
    assert.equal(JSON.stringify(rest), JSON.stringify({ name: 's', chunk: 1, profile: 'standard', model: PROFILES.standard.model, effort: PROFILES.standard.effort, repeat: 1 }));
  } finally {
    x.cleanup();
  }
});

test('an empty effort= exits 2 and stderr shows the empty value', async () => {
  const x = await extractInto([], { arms: ['--arm', 'name=x,profile=capable,effort='] });
  try {
    assert.equal(x.code, 2);
    assert.match(x.deps.errs.join('\n'), /: ""/);
  } finally {
    x.cleanup();
  }
});

test('effort= on a fast arm overrides its null effort', async () => {
  const x = await extractInto([], { arms: ['--arm', 'name=f,profile=fast,effort=medium'] });
  try {
    assert.equal(x.code, 0, x.deps.errs.join('\n'));
    assert.equal(x.json(schema.MANIFEST_FILE).arms[0].effort, 'medium');
  } finally {
    x.cleanup();
  }
});
