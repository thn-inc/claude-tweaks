// tests/hooks-gh-pr-lifecycle-parser.test.js
//
// #6143: ghPrLifecycleCalls reads every `gh pr ready|merge` call in a Bash command, through the same
// forEachShellSegment / commandWord walk as the other guard parsers. The in-flight-run merge gate
// consumes it.
'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { ghPrLifecycleCalls, GH_PR_LIFECYCLE } = require('../plugin/bin/lib/hooks/git-command');

const CWD = path.resolve('/work/tree');
const pick = (calls) => calls.map(({ verb, selector, repo, undo }) => ({ verb, selector, repo, undo }));

test('#6143: GH_PR_LIFECYCLE names the program, group and verbs', () => {
  assert.deepStrictEqual({ ...GH_PR_LIFECYCLE, verbs: [...GH_PR_LIFECYCLE.verbs] }, { program: 'gh', group: 'pr', verbs: ['merge', 'ready'] });
  assert.ok(Object.isFrozen(GH_PR_LIFECYCLE) && Object.isFrozen(GH_PR_LIFECYCLE.verbs));
});

test('#6143: gh pr merge 123 --squash', () => {
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr merge 123 --squash', CWD)), [{ verb: 'merge', selector: '123', repo: null, undo: false }]);
});

test('#6143: a value flag before the selector is skipped', () => {
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge --squash -b "x y" 123', CWD)[0].selector, '123');
});

test('#6143: every merge value flag, spaced and =-glued, is skipped', () => {
  for (const flag of ['-A', '--author-email', '-b', '--body', '-F', '--body-file', '--match-head-commit', '-t', '--subject']) {
    assert.strictEqual(ghPrLifecycleCalls(`gh pr merge ${flag} val 42`, CWD)[0].selector, '42', flag);
    if (flag.startsWith('--')) assert.strictEqual(ghPrLifecycleCalls(`gh pr merge ${flag}=val 42`, CWD)[0].selector, '42', `${flag}=`);
  }
});

test('#6143: -R o/r with a URL selector', () => {
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr merge -R o/r https://github.com/o/r/pull/9 --auto', CWD)),
    [{ verb: 'merge', selector: 'https://github.com/o/r/pull/9', repo: 'o/r', undo: false }]);
});

test('#6143: --repo=o/r alone gives a null selector', () => {
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr merge --repo=o/r', CWD)), [{ verb: 'merge', selector: null, repo: 'o/r', undo: false }]);
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr ready --repo o/r 7', CWD)), [{ verb: 'ready', selector: '7', repo: 'o/r', undo: false }]);
});

test('#6143: gh pr ready, with and without --undo', () => {
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr ready 7', CWD)), [{ verb: 'ready', selector: '7', repo: null, undo: false }]);
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr ready --undo 7', CWD)), [{ verb: 'ready', selector: '7', repo: null, undo: true }]);
});

test('#6143: a cd earlier in the list sets the call cwd', () => {
  const [call] = ghPrLifecycleCalls('cd /x && gh pr merge 5', CWD);
  assert.strictEqual(call.cwd, path.resolve('/x'));
  assert.strictEqual(call.lost, false);
});

test('#6143: no cd keeps the given cwd', () => {
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge 5', CWD)[0].cwd, CWD);
});

test('#6143: a path-qualified gh later in a list, and gh.exe, are found', () => {
  assert.strictEqual(ghPrLifecycleCalls('echo ok; /usr/local/bin/gh pr merge 5', CWD).length, 1);
  assert.strictEqual(ghPrLifecycleCalls('"/opt/gh.exe" pr merge 5', CWD).length, 1);
});

test('#6143: sudo, env and assignment prefixes are read past', () => {
  for (const c of ['sudo gh pr merge 5', 'env gh pr merge 5', 'FOO=1 gh pr merge 5', 'env FOO=1 gh pr merge 5']) {
    assert.strictEqual(ghPrLifecycleCalls(c, CWD).length, 1, c);
  }
});

test('#6143: several calls in one command are each reported', () => {
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr ready 1 && gh pr merge 2', CWD)).map((c) => c.verb), ['ready', 'merge']);
});

test('#6143: other gh calls and a quoted word are not matched', () => {
  for (const c of ['gh pr view 5', 'gh issue view 3', 'echo gh pr merge 5', 'gh pr list', 'gh pr', 'gh', 'git pr merge 5', '']) {
    assert.deepStrictEqual(ghPrLifecycleCalls(c, CWD), [], c);
  }
});
