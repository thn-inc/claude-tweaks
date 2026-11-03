'use strict';
// tests/bin-lib/walkthrough/record.test.js — #4612: which screenshots become the packet's
// walkthrough GIF, why none do, and the two places that GIF can be read from.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  planRecording, scrubPaths, isLocalBaseUrl, recordingLocations, encodeSpec,
} = require('../../../plugin/bin/lib/walkthrough/record');

const report = (stories, base_url = 'http://localhost:3000') => ({ base_url, stories });
const happy = { id: 'sign-in', name: 'Sign in', status: 'PASS', screenshot_dir: '/q/sign-in' };
const neg = { id: 'neg-bad', name: 'Bad', status: 'PASS', screenshot_dir: '/q/neg-bad' };
const tagged = { id: 'tagged', name: 'T', status: 'PASS', screenshot_dir: '/q/tagged' };
const listFrames = (dir) => ({
  '/q/sign-in': ['00_open.png', '01_submit.png', '01_submit-raw.png', 'notes.txt'],
  '/q/neg-bad': ['00_err.png'],
  '/q/tagged': ['00_err.png'],
  '/q/empty': ['notes.txt'],
  '/q/second': ['00_later.png'],
})[dir];
const INDEX = [{ id: 'sign-in', negative: false }];
const plan = (over) => planRecording({
  report: report([happy]), qaExpected: false, storyIndexLost: false, storyIndex: INDEX, listFrames, ...over,
});
const notRun = (reason) => ({ status: 'not-run', reason });
const framesOf = (dir, ...names) => names.map((name) => path.join(dir, name));

test('AC2a.1: frames come from happy-path stories only', () => {
  assert.deepEqual(plan({ report: report([happy, neg]) }), {
    status: 'ready',
    text: 'Walkthrough of Sign in',
    frames: framesOf('/q/sign-in', '00_open.png', '01_submit.png'),
    captions: ['open', 'submit'],
  });
});

test('AC2a.2: a tag-only negative story is excluded', () => {
  const result = plan({ report: report([happy, tagged]), storyIndex: [...INDEX, { id: 'tagged', negative: true }] });
  assert.deepEqual(result.frames, framesOf('/q/sign-in', '00_open.png', '01_submit.png'));
});

test('frames keep the report order across stories, and the text names each story', () => {
  const second = { id: 'second', name: 'Second', status: 'PASS_WITH_CAVEATS', screenshot_dir: '/q/second' };
  const result = plan({ report: report([happy, second]), storyIndex: [...INDEX, { id: 'second', negative: false }] });
  assert.equal(result.text, 'Walkthrough of Sign in, Second');
  assert.deepEqual(result.captions, ['open', 'submit', 'later']);
  assert.equal(result.frames.at(-1), path.join('/q/second', '00_later.png'));
});

test('a story with no name is named by its id', () => {
  assert.equal(plan({ report: report([{ ...happy, name: null }]) }).text, 'Walkthrough of sign-in');
});

test('no report with no QA expected, or only negative stories, is no-story', () => {
  assert.deepEqual(plan({ report: null }), notRun('no-story'));
  assert.deepEqual(plan({ report: report([]) }), notRun('no-story'));
  assert.deepEqual(plan({ report: report([neg]) }), notRun('no-story'));
  assert.deepEqual(plan({ report: report([tagged]), storyIndex: [{ id: 'tagged', negative: true }] }), notRun('no-story'));
});

test('AC5: a report expected but not read is no-happy-path-screenshots', () => {
  assert.deepEqual(plan({ report: null, qaExpected: true }), notRun('no-happy-path-screenshots'));
});

test('a report with no stories list is a report not read', () => {
  assert.deepEqual(plan({ report: { base_url: 'http://localhost:3000' } }), notRun('no-happy-path-screenshots'));
});

test('a story missing from a readable index fails closed', () => {
  const unlisted = { id: 'unlisted', status: 'PASS', screenshot_dir: '/q/tagged' };
  assert.deepEqual(plan({ report: report([happy, unlisted]) }), notRun('no-happy-path-screenshots'));
});

test('a story with no usable id fails closed', () => {
  assert.deepEqual(plan({ report: report([happy, { status: 'PASS', screenshot_dir: '/q/tagged' }]) }), notRun('no-happy-path-screenshots'));
  assert.deepEqual(plan({ report: report([happy, null]) }), notRun('no-happy-path-screenshots'));
});

test('a neg- id needs no index entry', () => {
  assert.equal(plan({ report: report([happy, neg]) }).status, 'ready');
});

test('an index entry saying not negative does not bring a neg- id back', () => {
  const result = plan({ report: report([happy, neg]), storyIndex: [...INDEX, { id: 'neg-bad', negative: false }] });
  assert.deepEqual(result.captions, ['open', 'submit']);
});

test('scrubPaths keeps basenames only', () => {
  assert.equal(scrubPaths('failed at /Users/me/q/00_a.png'), 'failed at 00_a.png');
  assert.equal(scrubPaths("EACCES: open '/r/w.gif'"), "EACCES: open 'w.gif'");
  assert.equal(scrubPaths('C:\\Users\\me\\x.gif gone'), 'x.gif gone');
  assert.equal(scrubPaths('no path here'), 'no path here');
  const token = 'a'.repeat(200000);
  assert.ok(scrubPaths(token) === token, 'a long token is left alone');
});

test('scrubPaths reads the shapes a real failure prints', () => {
  assert.equal(scrubPaths("ENOENT: open '/Users/me/Code Workspaces/q/a.png'"), "ENOENT: open 'a.png'");
  assert.equal(scrubPaths('rename "/a b/c.tmp" -> "/a b/c"'), 'rename "c.tmp" -> "c"');
  assert.equal(scrubPaths('/a/b.png: not a PNG file'), 'b.png: not a PNG file');
  assert.equal(scrubPaths('mismatch: /a/b.png is 1x1, /a/c.png is 2x2'), 'mismatch: b.png is 1x1, c.png is 2x2');
  assert.equal(scrubPaths('(/a/b.png)'), '(b.png)');
  assert.equal(scrubPaths('dir=/a/b/'), 'dir=b');
  assert.equal(scrubPaths('C:/Users/me/x.gif'), 'x.gif');
  assert.equal(scrubPaths('\\\\server\\share\\x.gif'), 'x.gif');
});

test('scrubPaths leaves what is not an absolute path', () => {
  for (const text of ['see https://host/a/b', 'and/or', 'rel/a/b.png', 'a / b', 'ratio 1/2', "it's /"]) {
    assert.equal(scrubPaths(text), text);
  }
});

test('a failed or skipped happy story contributes no frames', () => {
  assert.deepEqual(plan({ report: report([{ ...happy, status: 'FAIL' }]) }), notRun('no-happy-path-screenshots'));
  assert.deepEqual(plan({ report: report([{ ...happy, status: 'SKIPPED' }]) }), notRun('no-happy-path-screenshots'));
  const failed = { id: 'failed', status: 'FAIL', screenshot_dir: '/q/tagged' };
  const result = plan({ report: report([happy, failed]), storyIndex: [...INDEX, { id: 'failed', negative: false }] });
  assert.deepEqual(result.captions, ['open', 'submit']);
});

test('AC2a: a passing story with no readable frames gives no partial GIF', () => {
  const second = { id: 'second', status: 'PASS' };
  const storyIndex = [...INDEX, { id: 'second', negative: false }];
  for (const screenshot_dir of [null, undefined, '', '/q/missing', '/q/empty']) {
    const stories = [happy, { ...second, screenshot_dir }];
    const lister = (dir) => {
      if (dir === '/q/missing') throw new Error('ENOENT');
      return listFrames(dir);
    };
    assert.deepEqual(plan({ report: report(stories), storyIndex, listFrames: lister }), notRun('no-happy-path-screenshots'), String(screenshot_dir));
  }
});

test('no-local-base-url', () => {
  for (const baseUrl of ['https://dev.example', undefined, 'not a url']) {
    assert.deepEqual(plan({ report: { base_url: baseUrl, stories: [happy] } }), notRun('no-local-base-url'), String(baseUrl));
  }
});

test('no-story outranks no-local-base-url, which outranks a lost index', () => {
  assert.deepEqual(plan({ report: { base_url: 'https://dev.example', stories: [neg] } }), notRun('no-story'));
  assert.deepEqual(plan({ report: { base_url: 'https://dev.example', stories: [happy] }, storyIndexLost: true }), notRun('no-local-base-url'));
});

test('local hosts', () => {
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:8080/app', 'http://[::1]:3000', 'https://localhost']) {
    assert.equal(isLocalBaseUrl(url), true, url);
  }
  for (const url of [
    'https://localhost.example', 'http://localhost@evil.example/', 'http://127.0.0.2', 'localhost:3000', '', null, undefined, 3000,
  ]) {
    assert.equal(isLocalBaseUrl(url), false, String(url));
  }
});

test('a lost story index records nothing', () => {
  assert.deepEqual(plan({ storyIndexLost: true }), notRun('no-happy-path-screenshots'));
});

test('a missing screenshot dir is no-happy-path-screenshots', () => {
  const missing = () => { throw new Error('ENOENT'); };
  assert.deepEqual(plan({ listFrames: missing }), notRun('no-happy-path-screenshots'));
});

test('recordingLocations gives the same pair from either location', () => {
  const pair = {
    live: '.claude-tweaks/pipelines/r/packet-inputs/w.gif',
    archived: '.claude-tweaks/pipelines/archive/r/packet-inputs/w.gif',
  };
  assert.deepEqual(recordingLocations(pair.live), pair);
  assert.deepEqual(recordingLocations(pair.archived), pair);
});

test('recordingLocations keeps a multi-spec segment', () => {
  assert.deepEqual(recordingLocations('.claude-tweaks/pipelines/r/spec-7/packet-inputs/w.gif'), {
    live: '.claude-tweaks/pipelines/r/spec-7/packet-inputs/w.gif',
    archived: '.claude-tweaks/pipelines/archive/r/spec-7/packet-inputs/w.gif',
  });
});

test('recordingLocations leaves a run id holding the word archive alone', () => {
  assert.deepEqual(recordingLocations('.claude-tweaks/pipelines/archive-run/packet-inputs/w.gif'), {
    live: '.claude-tweaks/pipelines/archive-run/packet-inputs/w.gif',
    archived: '.claude-tweaks/pipelines/archive/archive-run/packet-inputs/w.gif',
  });
});

test('recordingLocations leaves a path outside the pipelines directory as it is', () => {
  assert.deepEqual(recordingLocations('runs/r/w.gif'), { live: 'runs/r/w.gif', archived: 'runs/r/w.gif' });
});

test('encodeSpec gives one delay per frame, the width and the budget', () => {
  assert.deepEqual(encodeSpec(['a', 'b']), {
    framePaths: ['a', 'b'], delays: [200, 400], width: 960, budgetBytes: 8 * 1024 * 1024,
  });
});

test('the GIF path is gitignored live and archived', () => {
  const root = path.join(__dirname, '..', '..', '..');
  for (const gif of [
    '.claude-tweaks/pipelines/x/packet-inputs/walkthrough.gif',
    '.claude-tweaks/pipelines/archive/x/packet-inputs/walkthrough.gif',
  ]) {
    const result = spawnSync('git', ['-C', root, 'check-ignore', '--no-index', '-q', gif], { windowsHide: true });
    assert.equal(result.status, 0, gif);
  }
});
