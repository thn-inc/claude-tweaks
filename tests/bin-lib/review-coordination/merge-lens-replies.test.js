const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { scratchDir } = require('../../helpers/tmp-dir');
const { runCliSync } = require('../../helpers/run-cli');

const CLI = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'review-coordination.js');
const cli = (args, opts = {}) => runCliSync(CLI, args, opts);

const TABLE = (note) => `<!-- ${note} -->\nNo findings.\n\nSTATUS: DONE\n`;
const ok = (lens, side, text = TABLE(`${lens}${side} clean`)) => ({ lens, side, text, failed: false });

function launcherReply(dir) {
  const reply = {
    started: true,
    lenses: [{ lens: '3a', reviewers: 2 }, { lens: '3b', reviewers: 2 }],
    reviewers: [ok('3a', 'A'), ok('3a', 'B'), { lens: '3b', side: 'A', text: null, failed: true }, ok('3b', 'B')],
  };
  const file = path.join(dir, 'reply.json');
  fs.writeFileSync(file, JSON.stringify(reply));
  return { reply, file };
}
const textFile = (dir, name, text) => {
  const f = path.join(dir, name);
  fs.writeFileSync(f, text);
  return f;
};
const merge3b = (dir, file, out) => {
  const a = textFile(dir, 'a.txt', TABLE('new A'));
  const b = textFile(dir, 'b.txt', TABLE('new B'));
  return cli(['merge-lens-replies', '--into', file, '--out', out, '--lens', '3b', '--reviewers', '2', '--side-a', a, '--side-b', b]);
};
const settle = (dir, out) => cli(['settle-lens-replies', out, '--ctx-id', 't'], { env: { ...process.env, TMPDIR: dir } });

test('AC3.1: a failed lens is replaced whole and the others keep their worker texts', () => {
  const dir = scratchDir('merge-lens-');
  const { reply, file } = launcherReply(dir);
  const out = path.join(dir, 'merged.json');
  const r = merge3b(dir, file, out);
  assert.strictEqual(r.code, 0, r.stderr);
  const merged = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepStrictEqual(merged.reviewers.filter((e) => e.lens === '3a'), reply.reviewers.filter((e) => e.lens === '3a'));
  const b = merged.reviewers.filter((e) => e.lens === '3b');
  assert.deepStrictEqual(b.map((e) => [e.side, e.text, e.failed]), [['A', TABLE('new A'), false], ['B', TABLE('new B'), false]]);
  assert.deepStrictEqual(merged.lenses.filter((l) => l.lens === '3b'), [{ lens: '3b', reviewers: 2 }]);
  assert.deepStrictEqual(JSON.parse(r.stdout), { out, lenses: ['3a', '3b'], replaced: true });
});

test('AC3.2: one settle-lens-replies call settles the merged set', () => {
  const dir = scratchDir('merge-lens-');
  const { file } = launcherReply(dir);
  const out = path.join(dir, 'merged.json');
  assert.strictEqual(merge3b(dir, file, out).code, 0);
  const s = settle(dir, out);
  assert.strictEqual(s.code, 0, s.stderr);
  assert.deepStrictEqual(JSON.parse(s.stdout).settled.map((x) => x.lens).sort(), ['3a', '3b']);
});

test('AC7.1: a mixed review settles 3f from the Task path beside worker lenses in one call', () => {
  const dir = scratchDir('merge-lens-');
  const file = path.join(dir, 'reply.json');
  fs.writeFileSync(file, JSON.stringify({ started: true, lenses: [{ lens: '3a', reviewers: 2 }], reviewers: [ok('3a', 'A'), ok('3a', 'B')] }));
  const out = path.join(dir, 'merged.json');
  const a = textFile(dir, 'a.txt', TABLE('f A'));
  const b = textFile(dir, 'b.txt', TABLE('f B'));
  const r = cli(['merge-lens-replies', '--into', file, '--out', out, '--lens', '3f', '--reviewers', '2', '--side-a', a, '--side-b', b]);
  assert.strictEqual(r.code, 0, r.stderr);
  assert.strictEqual(JSON.parse(r.stdout).replaced, false);
  const s = settle(dir, out);
  assert.strictEqual(s.code, 0, s.stderr);
  assert.deepStrictEqual(JSON.parse(s.stdout).settled.map((x) => x.lens).sort(), ['3a', '3f']);
});

test('merge keeps the reply text byte-exact', () => {
  const dir = scratchDir('merge-lens-');
  const text = 'say "hi" \\ back\tslash\r\nline two\r\n';
  const a = textFile(dir, 'a.txt', text);
  const out = path.join(dir, 'merged.json');
  const r = cli(['merge-lens-replies', '--out', out, '--lens', '3c', '--reviewers', '1', '--side-a', a]);
  assert.strictEqual(r.code, 0, r.stderr);
  const merged = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.strictEqual(merged.reviewers[0].text, text);
  assert.deepStrictEqual(merged.lenses, [{ lens: '3c', reviewers: 1 }]);
});

test('merge in place', () => {
  const dir = scratchDir('merge-lens-');
  const { file } = launcherReply(dir);
  const r = merge3b(dir, file, file);
  assert.strictEqual(r.code, 0, r.stderr);
  const merged = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepStrictEqual(merged.lenses.map((l) => l.lens).sort(), ['3a', '3b']);
  assert.strictEqual(merged.reviewers.length, 4);
  assert.ok(merged.reviewers.every((e) => !e.failed));
});

test('- marks a failed side', () => {
  const dir = scratchDir('merge-lens-');
  const a = textFile(dir, 'a.txt', TABLE('x'));
  const out = path.join(dir, 'merged.json');
  const r = cli(['merge-lens-replies', '--out', out, '--lens', '3c', '--reviewers', '2', '--side-a', a, '--side-b', '-']);
  assert.strictEqual(r.code, 0, r.stderr);
  const merged = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepStrictEqual(merged.reviewers[1], { lens: '3c', side: 'B', text: null, failed: true });
});

test('exit 2 and no --out file on every refusal', () => {
  const dir = scratchDir('merge-lens-');
  const a = textFile(dir, 'a.txt', TABLE('x'));
  const empty = textFile(dir, 'empty.json', '');
  const bad = textFile(dir, 'bad.json', '{"reviewers":[]}');
  const cases = {
    'mismatched sides': ['--lens', '3c', '--reviewers', '2', '--side-a', a],
    'extra side-b': ['--lens', '3c', '--reviewers', '1', '--side-a', a, '--side-b', a],
    'bad reviewers': ['--lens', '3c', '--reviewers', '3', '--side-a', a],
    'missing lens': ['--reviewers', '1', '--side-a', a],
    'bad lens token': ['--lens', 'a/b', '--reviewers', '1', '--side-a', a],
    'empty into': ['--lens', '3c', '--reviewers', '1', '--side-a', a, '--into', empty],
    'refused into': ['--lens', '3c', '--reviewers', '1', '--side-a', a, '--into', bad],
    'unreadable text': ['--lens', '3c', '--reviewers', '1', '--side-a', path.join(dir, 'nope.txt')],
  };
  for (const [name, args] of Object.entries(cases)) {
    const out = path.join(dir, `out-${name.replace(/ /g, '-')}.json`);
    const r = cli(['merge-lens-replies', '--out', out, ...args]);
    assert.strictEqual(r.code, 2, `${name}: ${r.stderr}`);
    assert.strictEqual(fs.existsSync(out), false, name);
  }
  const noOut = cli(['merge-lens-replies', '--lens', '3c', '--reviewers', '1', '--side-a', a]);
  assert.strictEqual(noOut.code, 2);
});
