'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { shellFences, malformedFences, walkMarkdown } = require('../../tools/guard-refusals/fences');

// #4028: the fence extractor feeds the guard-shape scan over plugin/skills/**.
// An extractor that misses a fence shape reports zero offenders for it, so each
// shape the first prose extractors missed (blockquoted, indented, tilde, CRLF)
// is pinned here with its exact opening line.

const DOC = [
  '# Title', //                1
  '',
  '```bash', //                3
  'echo one',
  '```',
  '',
  '~~~sh', //                  7
  'echo two',
  '~~~',
  '',
  '> ```zsh', //               11
  '> echo three',
  '> ```',
  '',
  '1. Step',
  '   ```shell title="x"', // 16
  '   echo four',
  '   ```',
  '',
  '````console', //            20
  '$ echo five',
  '```',
  '````',
].join('\n');

const EXPECTED = [
  { line: 3, lang: 'bash', body: 'echo one' },
  { line: 7, lang: 'sh', body: 'echo two' },
  { line: 11, lang: 'zsh', body: 'echo three' },
  { line: 16, lang: 'shell', body: 'echo four' },
  { line: 20, lang: 'console', body: '$ echo five\n```' },
];

test('shellFences finds backtick, tilde, blockquoted, indented and CRLF fences', () => {
  assert.deepStrictEqual(shellFences(DOC), EXPECTED);
  assert.deepStrictEqual(shellFences(DOC.replace(/\n/g, '\r\n')), EXPECTED);
  assert.deepStrictEqual(malformedFences(DOC), []);
});

test('shellFences skips non-shell info strings (markdown, yaml, js, unlabelled)', () => {
  const doc = [
    '```markdown',
    '```bash',
    'echo nested',
    '```',
    '```yaml',
    'a: 1',
    '```',
    '```js',
    'x()',
    '```',
    '```',
    'echo unlabelled',
    '```',
  ].join('\n');
  // The ```bash line sits inside the markdown fence (whose closer is the
  // following ```), so it is content, not a fence.
  assert.deepStrictEqual(shellFences(doc), []);
});

test('malformedFences reports an unterminated fence', () => {
  const doc = ['intro', '```bash', 'echo never closed', ''].join('\n');
  assert.deepStrictEqual(malformedFences(doc), [2]);
  assert.deepStrictEqual(shellFences(doc), [{ line: 2, lang: 'bash', body: 'echo never closed\n' }]);
  // A blockquoted fence whose quote ends before the closer is unterminated too.
  const quoted = ['> ```bash', '> echo a', 'outside', '```'].join('\n');
  assert.deepStrictEqual(malformedFences(quoted), [1, 4]);
});

test('walkMarkdown skips an entry that vanishes (ENOENT) and throws on ENOTDIR', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ct-guard-fences-'));
  try {
    fs.mkdirSync(path.join(root, 'b', 'c'), { recursive: true });
    fs.writeFileSync(path.join(root, 'b', 'c', 'deep.md'), 'x');
    fs.writeFileSync(path.join(root, 'a.md'), 'x');
    fs.writeFileSync(path.join(root, 'gone.md'), 'x');
    fs.writeFileSync(path.join(root, 'note.txt'), 'x');
    assert.deepStrictEqual(walkMarkdown(root), [
      path.join(root, 'a.md'),
      path.join(root, 'b', 'c', 'deep.md'),
      path.join(root, 'gone.md'),
    ]);
    // gone.md vanishes between the directory listing and its stat.
    const statSync = (p) => {
      if (path.basename(p) === 'gone.md') throw Object.assign(new Error('ENOENT: gone'), { code: 'ENOENT' });
      return fs.statSync(p);
    };
    assert.deepStrictEqual(walkMarkdown(root, { statSync }), [path.join(root, 'a.md'), path.join(root, 'b', 'c', 'deep.md')]);
    // Any other error is loud, never a silently empty walk.
    assert.throws(() => walkMarkdown(path.join(root, 'a.md')), { code: 'ENOTDIR' });
    const eacces = () => { throw Object.assign(new Error('EACCES'), { code: 'EACCES' }); };
    assert.throws(() => walkMarkdown(root, { statSync: eacces }), { code: 'EACCES' });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
