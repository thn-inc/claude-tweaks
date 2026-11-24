'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const { MARKER_SIZE, resolveDiff3 } = require('../../../plugin/bin/lib/learned-skills/rebuild.js');

const run = (ch) => ch.repeat(MARKER_SIZE);
function block(ours, base, theirs) {
  const lines = [`${run('<')} ours`, ...ours, `${run('|')} base`, ...base, run('='), ...theirs, `${run('>')} theirs`];
  return lines.join('\n') + '\n';
}
const ok = (text) => ({ ok: true, text });
const REFUSED = { ok: false };

test('double append keeps both, integration first', () => {
  const input = '- one\n' + block(['- a'], [], ['- b']) + '\nend\n';
  assert.deepStrictEqual(resolveDiff3(input), ok('- one\n- a\n- b\n\nend\n'));
});

test('a PR line already among the integration lines is dropped', () => {
  assert.deepStrictEqual(resolveDiff3(block(['- a', '- b'], [], ['- b', '- c'])), ok('- a\n- b\n- c\n'));
});

test('AC2.1: both append 7. to a list ends 7. and 8.', () => {
  assert.deepStrictEqual(resolveDiff3('6. f\n' + block(['7. x'], [], ['7. y'])), ok('6. f\n7. x\n8. y\n'));
});

test('numbering that stops increasing by one is renumbered', () => {
  const input = '1. a\n' + block(['2. b'], [], ['5. c']) + '\ntext\n';
  assert.deepStrictEqual(resolveDiff3(input), ok('1. a\n2. b\n3. c\n\ntext\n'));
});

test('a mid-list collision refuses', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['2. b'], [], ['2. c']) + '3. d\n'), REFUSED);
});

test('a mid-list hunk refuses even without a collision', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['- x', '2. b'], [], ['- y']) + '3. c\n'), REFUSED);
  assert.deepStrictEqual(
    resolveDiff3('1. a\n' + block(['- x'], [], ['- y']) + '2. b\n'),
    ok('1. a\n- x\n- y\n2. b\n'),
  );
});

test('a consecutive list is left as it is', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['2. b'], [], ['- c'])), ok('1. a\n2. b\n- c\n'));
});

test('a non-empty base refuses (a changed line)', () => {
  assert.deepStrictEqual(resolveDiff3(block(['x2'], ['x'], ['x3'])), REFUSED);
});

test('an empty side refuses', () => {
  assert.deepStrictEqual(resolveDiff3(block([], [], ['y'])), REFUSED);
  assert.deepStrictEqual(resolveDiff3(block(['y'], [], [])), REFUSED);
});

test('an unterminated block refuses', () => {
  assert.deepStrictEqual(resolveDiff3(`${run('<')} ours\na\n${run('|')} base\n${run('=')}\nb\n`), REFUSED);
});

test('CRLF lines resolve like LF', () => {
  const lf = '- one\n' + block(['- a'], [], ['- b']) + '\nend\n';
  assert.deepStrictEqual(resolveDiff3(lf.replace(/\n/g, '\r\n')), ok('- one\n- a\n- b\n\nend\n'.replace(/\n/g, '\r\n')));
});

test('CRLF renumber and dedupe resolve like LF', () => {
  const crlf = (s) => s.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(
    resolveDiff3(crlf('6. f\n' + block(['7. x'], [], ['7. y']))),
    ok(crlf('6. f\n7. x\n8. y\n')),
  );
  assert.deepStrictEqual(
    resolveDiff3(crlf(block(['- a', '- b'], [], ['- b', '- c']))),
    ok(crlf('- a\n- b\n- c\n')),
  );
});

test('a two-digit renumber and an indented list renumber', () => {
  assert.deepStrictEqual(resolveDiff3('9. a\n' + block(['10. x'], [], ['10. y'])), ok('9. a\n10. x\n11. y\n'));
  assert.deepStrictEqual(
    resolveDiff3('  1. a\n' + block(['  2. b'], [], ['  2. c'])),
    ok('  1. a\n  2. b\n  3. c\n'),
  );
});

test('a blank line the PR adds is kept even when the integration side also added one', () => {
  assert.deepStrictEqual(resolveDiff3(block(['- a', ''], [], ['', '- c'])), ok('- a\n\n\n- c\n'));
});

test('two different fenced blocks keep both complete fences', () => {
  const ours = ['```bash', 'echo a', '```'];
  const theirs = ['```js', 'let a', '```'];
  assert.deepStrictEqual(
    resolveDiff3(block(ours, [], theirs)),
    ok([...ours, ...theirs].join('\n') + '\n'),
  );
});

test('a PR item keeps its continuation line when ours has the same continuation text', () => {
  assert.deepStrictEqual(
    resolveDiff3(block(['- b', '  detail ours'], [], ['- c', '  detail ours'])),
    ok('- b\n  detail ours\n- c\n  detail ours\n'),
  );
});

test('an identical item with an identical continuation is dropped once', () => {
  assert.deepStrictEqual(
    resolveDiff3(block(['- b', '  detail'], [], ['- b', '  detail', '- c', '  more'])),
    ok('- b\n  detail\n- c\n  more\n'),
  );
});

test('an item whose continuation differs is kept', () => {
  assert.deepStrictEqual(
    resolveDiff3(block(['- b', '  one'], [], ['- b', '  two'])),
    ok('- b\n  one\n- b\n  two\n'),
  );
});

test('identical whole blocks yield ours only', () => {
  assert.deepStrictEqual(
    resolveDiff3(block(['', '- a', '```', 'x', '```'], [], ['', '- a', '```', 'x', '```'])),
    ok('\n- a\n```\nx\n```\n'),
  );
});

test('CRLF: continuation and fence cases resolve like LF', () => {
  const crlf = (t) => t.replace(/\n/g, '\r\n');
  assert.deepStrictEqual(
    resolveDiff3(crlf(block(['- b', '  detail ours'], [], ['- c', '  detail ours']))),
    ok(crlf('- b\n  detail ours\n- c\n  detail ours\n')),
  );
  assert.deepStrictEqual(
    resolveDiff3(crlf(block(['- b', '  detail'], [], ['- b', '  detail', '- c']))),
    ok(crlf('- b\n  detail\n- c\n')),
  );
});

test('a new list the PR adds after a paragraph is not merged into the integration list', () => {
  assert.deepStrictEqual(
    resolveDiff3('1. p\n2. q\n' + block(['3. r'], [], ['', 'New list:', '', '1. x', '2. y'])),
    ok('1. p\n2. q\n3. r\n\nNew list:\n\n1. x\n2. y\n'),
  );
});

test('a mid-list hunk refuses when a continuation line sits between it and the next item', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['2. b'], [], ['2. c']) + '   cont\n3. z\n'), REFUSED);
});

test('a run that closed inside the hunk does not make a later new list mid-list', () => {
  assert.deepStrictEqual(
    resolveDiff3('1. a\n' + block(['2. b'], [], ['2. c', '', 'Paragraph.']) + '\n1. z\n'),
    ok('1. a\n2. b\n3. c\n\nParagraph.\n\n1. z\n'),
  );
  assert.deepStrictEqual(
    resolveDiff3('1. a\n' + block(['2. b'], [], ['', '## Next', '']) + '1. z\n'),
    ok('1. a\n2. b\n\n## Next\n\n1. z\n'),
  );
});

test('prose right under an item does not close the list: a later item still makes the hunk mid-list', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['2. b'], [], ['2. c', 'lazy text']) + '3. z\n'), REFUSED);
});

test('after a closed run, an item that continues the numbering still refuses', () => {
  assert.deepStrictEqual(resolveDiff3('1. a\n' + block(['2. b'], [], ['2. c', '', 'Para.']) + '\n3. z\n'), REFUSED);
});

test('a body line shaped like a short marker passes through', () => {
  assert.deepStrictEqual(resolveDiff3('<<<<<<< x\n' + block(['a'], [], ['b'])), ok('<<<<<<< x\na\nb\n'));
});

test('no conflict block returns the text unchanged', () => {
  assert.deepStrictEqual(resolveDiff3('a\n1. b\n'), ok('a\n1. b\n'));
});

// ---------------------------------------------------------------------------------------------
// rebuild(): real git against a bare origin

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { rebuild, MIN_GIT } = require('../../../plugin/bin/lib/learned-skills/rebuild.js');
const { realDeps } = require('../../../plugin/bin/lib/learned-skills/learned-skills.js');
const { rebuildFixture, FILE } = require('../../helpers/learned-skills-rebuild.js');

const append = (after, line) => (repo) => {
  const p = path.join(repo, FILE);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(after, `${after}${line}`));
};
const replaceLine = (from, to) => (repo) => {
  const p = path.join(repo, FILE);
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(from, to));
};

// deps.git wraps realDeps.git and records each call; `before(args)` runs ahead of forwarding, and
// `answer(args)` returns a canned stdout (undefined forwards).
function recorder(extra = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      git: (args, opts) => {
        calls.push({ args, opts });
        if (extra.before) extra.before(args);
        if (extra.answer) {
          const a = extra.answer(args);
          if (a !== undefined) return a;
        }
        return realDeps.git(args, opts);
      },
      ...(extra.deps || {}),
    },
    pushes: () => calls.filter((c) => c.args[0] === 'push'),
  };
}
const request = (fx, name, extra = {}) => ({
  pr: 2, headRef: `learned-skills/${name}`, oldHead: fx.originRef(`learned-skills/${name}`), integrationBranch: 'main', cwd: fx.clone, ...extra,
});
const show = (fx, ref, file = FILE) => fx.sh(fx.clone, ['show', `${ref}:${file}`]);

function twoAppends(t, { body } = {}) {
  const fx = rebuildFixture(t, body === undefined ? {} : { body });
  const A = fx.lsBranch('A', append('- two\n', '- a\n'));
  const B = fx.lsBranch('B', append('- two\n', '- b\n'));
  fx.advanceMain(A);
  return { fx, A, B };
}

test('rebuilds a double append onto the tip', (t) => {
  const { fx, A, B } = twoAppends(t);
  const res = rebuild(request(fx, 'B'), recorder().deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.equal(res.tip, A);
  assert.equal(fx.originRef('learned-skills/B'), res.commit);
  assert.equal(fx.sh(fx.origin, ['rev-parse', `${res.commit}^`]).trim(), fx.originRef('main'));
  assert.equal(show(fx, res.commit), '# x\n\n- one\n- two\n- a\n- b\n\nend\n');
  fx.sh(fx.clone, ['fetch', '-q', 'origin']);
  const diff = fx.sh(fx.clone, ['diff', A, res.commit]);
  assert.deepStrictEqual(diff.split('\n').filter((l) => /^[+-]/.test(l) && !/^(\+\+\+|---) /.test(l)), ['+- b']);
  const msg = fx.sh(fx.clone, ['log', '-1', '--format=%B', res.commit]);
  assert.match(msg, /Learned-Skills-Run: B\nLearned-Skills-Entry: 1\n/);
  assert.notEqual(B, res.commit);
});

test('AC2.1 end to end: both append 7. ends 7. and 8.', (t) => {
  const fx = rebuildFixture(t, { body: '# x\n\n1. a1\n2. b2\n3. c3\n4. d4\n5. e5\n6. f\n' });
  const A = fx.lsBranch('A', append('6. f\n', '7. from A\n'));
  fx.lsBranch('B', append('6. f\n', '7. from B\n'));
  fx.advanceMain(A);
  const res = rebuild(request(fx, 'B'), recorder().deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.ok(show(fx, res.commit).endsWith('7. from A\n8. from B\n'), show(fx, res.commit));
});

test('AC3.1: a changed line refuses, pushes nothing, names the file', (t) => {
  const fx = rebuildFixture(t);
  const A = fx.lsBranch('A', replaceLine('- two', '- two (A)'));
  const B = fx.lsBranch('B', replaceLine('- two', '- two (B)'));
  fx.advanceMain(A);
  const rec = recorder();
  assert.deepStrictEqual(rebuild(request(fx, 'B'), rec.deps), { ok: false, reason: `conflict needs a human: ${FILE}` });
  assert.equal(fx.originRef('learned-skills/B'), B);
  assert.deepStrictEqual(rec.pushes(), []);
});

test('one resolvable and one unresolvable file refuses naming both', (t) => {
  const F2 = '.claude/skills/y/SKILL.md';
  const fx = rebuildFixture(t, { extra: { [F2]: '# y\n\n- one\n- two\n\nend\n' } });
  const edit = (tag, line) => (repo) => {
    append('- two\n', line)(repo);
    fs.writeFileSync(path.join(repo, F2), `# y\n\n- one\n- two (${tag})\n\nend\n`);
  };
  const A = fx.lsBranch('A', edit('A', '- a\n'));
  const B = fx.lsBranch('B', edit('B', '- b\n'));
  fx.advanceMain(A);
  const rec = recorder();
  assert.deepStrictEqual(rebuild(request(fx, 'B'), rec.deps), { ok: false, reason: `conflict needs a human: ${FILE}, ${F2}` });
  assert.equal(fx.originRef('learned-skills/B'), B);
  assert.deepStrictEqual(rec.pushes(), []);
});

test('modify/delete refuses', (t) => {
  const fx = rebuildFixture(t);
  const A = fx.lsBranch('A', append('- two\n', '- a\n'));
  fx.lsBranch('B', (repo) => fs.rmSync(path.join(repo, FILE)));
  fx.advanceMain(A);
  const rec = recorder();
  const res = rebuild(request(fx, 'B'), rec.deps);
  assert.equal(res.ok, false);
  assert.ok(res.reason.startsWith('conflict needs a human: '), res.reason);
  assert.ok(res.reason.includes(FILE), res.reason);
  assert.deepStrictEqual(rec.pushes(), []);
});

test('AC4.1: the push leases the old head and targets only the PR branch', (t) => {
  const { fx, B } = twoAppends(t);
  const rec = recorder();
  const res = rebuild(request(fx, 'B'), rec.deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  assert.deepStrictEqual(rec.pushes().map((c) => c.args), [
    ['push', '--no-verify', `--force-with-lease=refs/heads/learned-skills/B:${B}`, '--end-of-options', 'origin', `${res.commit}:refs/heads/learned-skills/B`],
  ]);
});

test('a head ref outside learned-skills/* is never touched', (t) => {
  const fx = rebuildFixture(t);
  for (const headRef of ['main', 'feature/x']) {
    const rec = recorder();
    const res = rebuild({ pr: 2, headRef, oldHead: fx.baseSha, integrationBranch: 'main', cwd: fx.clone }, rec.deps);
    assert.deepStrictEqual(res, { ok: false, reason: 'not-learned-skills-branch' });
    assert.equal(rec.calls.length, 0);
  }
});

test('a rejected lease is lease-rejected, no retry', (t) => {
  const { fx } = twoAppends(t);
  const rec = recorder({
    before: (args) => {
      if (args[0] !== 'push') return;
      fx.sh(fx.clone, ['checkout', '-q', '-B', 'other', fx.baseSha]);
      fx.write(fx.clone, 'other.txt', 'x\n');
      fx.sh(fx.clone, ['add', '-A']);
      fx.sh(fx.clone, ['commit', '-q', '-m', 'concurrent']);
      fx.sh(fx.clone, ['push', '-q', '--force', 'origin', 'other:refs/heads/learned-skills/B']);
      fx.sh(fx.clone, ['checkout', '-q', 'main']);
    },
  });
  assert.deepStrictEqual(rebuild(request(fx, 'B'), rec.deps), { ok: false, reason: 'lease-rejected' });
  assert.equal(rec.pushes().length, 1);
});

test('a head that moved before the fetch is head-changed', (t) => {
  const { fx, A } = twoAppends(t);
  const rec = recorder();
  assert.deepStrictEqual(rebuild(request(fx, 'B', { oldHead: A }), rec.deps), { ok: false, reason: 'head-changed' });
  assert.deepStrictEqual(rec.pushes(), []);
});

test('git older than 2.38 refuses', (t) => {
  assert.deepStrictEqual(MIN_GIT, [2, 38]);
  const { fx } = twoAppends(t);
  const old = recorder({ answer: (args) => (args[0] === 'version' ? 'git version 2.37.9\n' : undefined) });
  assert.deepStrictEqual(rebuild(request(fx, 'B'), old.deps), { ok: false, reason: 'git-too-old' });
  assert.deepStrictEqual(old.calls.map((c) => c.args[0]), ['version']);
  const win = recorder({ answer: (args) => (args[0] === 'version' ? 'git version 2.47.1.windows.1\n' : undefined) });
  assert.equal(rebuild(request(fx, 'B'), win.deps).ok, true);
});

test('a rebuilt PR rebuilt again keeps every trailer pair once, in order', (t) => {
  const fx = rebuildFixture(t);
  const A = fx.lsBranch('A', append('- two\n', '- a\n'));
  fx.lsBranch('B', (repo, n) => append('- two\n', `- b${n}\n`)(repo), [[['B', 1], ['B', 2]], [['B', 2]]]);
  fx.advanceMain(A);
  const res = rebuild(request(fx, 'B'), recorder().deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  const msg = fx.sh(fx.clone, ['log', '-1', '--format=%B', res.commit]);
  assert.deepStrictEqual(msg.split('\n').filter((l) => l.startsWith('Learned-Skills-')),
    ['Learned-Skills-Run: B', 'Learned-Skills-Entry: 1', 'Learned-Skills-Run: B', 'Learned-Skills-Entry: 2']);
});

test('scratch refs and the temp dir are removed', (t) => {
  const { fx } = twoAppends(t);
  const dirs = [];
  const mkdtemp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-rebuild-')); dirs.push(d); return d; };
  assert.equal(rebuild(request(fx, 'B'), { mkdtemp }).ok, true);
  assert.equal(rebuild(request(fx, 'B', { oldHead: fx.baseSha }), { mkdtemp }).reason, 'head-changed');
  assert.equal(dirs.length, 1);

  // A conflict refusal and a rebuild-failed after the temp dir exists clean up too.
  const fx2 = rebuildFixture(t);
  const A = fx2.lsBranch('A', replaceLine('- two', '- two (A)'));
  fx2.lsBranch('B', replaceLine('- two', '- two (B)'));
  fx2.advanceMain(A);
  assert.ok(rebuild(request(fx2, 'B'), { mkdtemp }).reason.startsWith('conflict needs a human'));
  assert.equal(dirs.length, 2);
  const failing = recorder({ before: (args) => { if (args[0] === 'write-tree') throw new Error('boom'); } });
  const { fx: fx3 } = twoAppends(t);
  const res = rebuild(request(fx3, 'B'), { ...failing.deps, mkdtemp });
  assert.equal(res.reason, 'rebuild-failed');
  assert.equal(dirs.length, 3);

  for (const f of [fx, fx2, fx3]) assert.equal(f.sh(f.clone, ['for-each-ref', 'refs/claude-tweaks/rebuild']), '');
  for (const d of dirs) assert.throws(() => fs.statSync(d), { code: 'ENOENT' });
});

test('a throwing nonce is rebuild-failed, never a throw', (t) => {
  const { fx } = twoAppends(t);
  const rec = recorder({ deps: { nonce: () => { throw new Error('no entropy'); } } });
  const res = rebuild(request(fx, 'B'), rec.deps);
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'rebuild-failed');
  assert.deepStrictEqual(rec.pushes(), []);
  assert.equal(fx.sh(fx.clone, ['for-each-ref', 'refs/claude-tweaks/rebuild']), '');
});

test('a non-UTF-8 conflicted file refuses and pushes nothing', (t) => {
  const fx = rebuildFixture(t);
  const edit = (tag) => (repo) => {
    const p = path.join(repo, FILE);
    fs.writeFileSync(p, Buffer.concat([fs.readFileSync(p), Buffer.from(`- ${tag} `), Buffer.from([0xff]), Buffer.from('\n')]));
  };
  const A = fx.lsBranch('A', edit('a'));
  const B = fx.lsBranch('B', edit('b'));
  fx.advanceMain(A);
  const rec = recorder();
  assert.deepStrictEqual(rebuild(request(fx, 'B'), rec.deps), { ok: false, reason: `conflict needs a human: ${FILE}` });
  assert.equal(fx.originRef('learned-skills/B'), B);
  assert.deepStrictEqual(rec.pushes(), []);
});

test('a binary conflict refuses naming the file and pushes nothing', (t) => {
  const BIN = '.claude/skills/x/blob.bin';
  const fx = rebuildFixture(t, { extra: { [BIN]: 'base\0data\n' } });
  const A = fx.lsBranch('A', (repo) => fs.writeFileSync(path.join(repo, BIN), 'A\0data\n'));
  const B = fx.lsBranch('B', (repo) => fs.writeFileSync(path.join(repo, BIN), 'B\0data\n'));
  fx.advanceMain(A);
  const rec = recorder();
  const res = rebuild(request(fx, 'B'), rec.deps);
  assert.equal(res.ok, false);
  assert.ok(res.reason.startsWith('conflict needs a human: '), JSON.stringify(res));
  assert.ok(res.reason.includes(BIN), res.reason);
  assert.equal(fx.originRef('learned-skills/B'), B);
  assert.deepStrictEqual(rec.pushes(), []);
});

test('an add/add of the same new file refuses and pushes nothing', (t) => {
  const NEW = '.claude/skills/y/SKILL.md';
  const fx = rebuildFixture(t);
  const A = fx.lsBranch('A', (repo) => fx.write(repo, NEW, '# y\n\n- a\n'));
  const B = fx.lsBranch('B', (repo) => fx.write(repo, NEW, '# y\n\n- b\n'));
  fx.advanceMain(A);
  const rec = recorder();
  const res = rebuild(request(fx, 'B'), rec.deps);
  assert.deepStrictEqual(res, { ok: false, reason: `conflict needs a human: ${NEW}` });
  assert.equal(fx.originRef('learned-skills/B'), B);
  assert.deepStrictEqual(rec.pushes(), []);
});

test('a successful rebuild leaves the clone HEAD, status and index untouched', (t) => {
  const { fx } = twoAppends(t);
  fx.write(fx.clone, 'scratch.txt', 'untracked\n');
  const snap = () => ['rev-parse HEAD', 'symbolic-ref HEAD', 'status --porcelain', 'ls-files -s'].map((c) => fx.sh(fx.clone, c.split(' '))).join('\0');
  const before = snap();
  assert.equal(rebuild(request(fx, 'B'), recorder().deps).ok, true);
  assert.equal(snap(), before);
});

test('scratch refs are per call', (t) => {
  const { fx } = twoAppends(t);
  fx.sh(fx.clone, ['update-ref', 'refs/claude-tweaks/rebuild/2-other/head', fx.baseSha]);
  const r1 = recorder();
  rebuild(request(fx, 'B', { oldHead: fx.baseSha }), { ...r1.deps, nonce: 'n1' });
  const r2 = recorder();
  rebuild(request(fx, 'B', { oldHead: fx.baseSha }), { ...r2.deps, nonce: 'n2' });
  const fetchArgs = (r) => r.calls.find((c) => c.args[0] === 'fetch').args.join(' ');
  assert.match(fetchArgs(r1), /refs\/claude-tweaks\/rebuild\/2-n1\/base/);
  assert.match(fetchArgs(r1), /refs\/claude-tweaks\/rebuild\/2-n1\/head/);
  assert.match(fetchArgs(r2), /refs\/claude-tweaks\/rebuild\/2-n2\/base/);
  assert.match(fetchArgs(r2), /refs\/claude-tweaks\/rebuild\/2-n2\/head/);
  assert.equal(fx.sh(fx.clone, ['for-each-ref', '--format=%(refname)', 'refs/claude-tweaks/rebuild']).trim(), 'refs/claude-tweaks/rebuild/2-other/head');
});

test('the push drops GITHUB_TOKEN only', (t) => {
  const { fx } = twoAppends(t);
  const rec = recorder({ deps: { env: { ...process.env, GITHUB_TOKEN: 'x', GH_TOKEN: 'y' } } });
  const res = rebuild(request(fx, 'B'), rec.deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  const env = rec.pushes()[0].opts.env;
  assert.equal('GITHUB_TOKEN' in env, false);
  assert.equal(env.GH_TOKEN, 'y');
});

test('the push env carries no repo-pinning variable', (t) => {
  const { fx } = twoAppends(t);
  const rec = recorder({ deps: { env: { ...process.env, GIT_DIR: '/elsewhere/.git', GIT_INDEX_FILE: '/elsewhere/index' } } });
  const res = rebuild(request(fx, 'B'), rec.deps);
  assert.equal(res.ok, true, JSON.stringify(res));
  const env = rec.pushes()[0].opts.env;
  for (const k of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) assert.equal(k in env, false, k);
  assert.equal(env.GIT_LITERAL_PATHSPECS, '1');
});
