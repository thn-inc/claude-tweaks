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

test('#6143: a lost cwd reports lost: true and a stand-in derived from the cwd argument, never process.cwd()', () => {
  for (const c of ['cd $X && gh pr merge 5', 'cd - && gh pr merge 5', 'env -C $X gh pr merge 5']) {
    const [call] = ghPrLifecycleCalls(c, CWD);
    assert.strictEqual(call.lost, true, c);
    assert.strictEqual(call.cwd, CWD, c);
  }
});

test('#6143: a glued short value drops one leading =, as pflag does', () => {
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge -R=o/r 5', CWD)[0].repo, 'o/r');
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge -Ro/r 5', CWD)[0].repo, 'o/r');
});

test('#6143: a short cluster ends at its value flag, which takes the next word', () => {
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge -sb x 5', CWD)[0].selector, '5');
  const [call] = ghPrLifecycleCalls('gh pr merge -sR o/r 5', CWD);
  assert.strictEqual(call.repo, 'o/r');
  assert.strictEqual(call.selector, '5');
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge -sd 5', CWD)[0].selector, '5');
  assert.strictEqual(ghPrLifecycleCalls('gh pr ready -R o/r 5', CWD)[0].selector, '5');
});

test('#6143: the program name matches case-insensitively', () => {
  assert.strictEqual(ghPrLifecycleCalls('GH pr merge 5', CWD).length, 1);
  assert.strictEqual(ghPrLifecycleCalls('GH.EXE pr ready 5', CWD).length, 1);
});

test('#6143: other gh calls and a quoted word are not matched', () => {
  for (const c of ['gh pr view 5', 'gh issue view 3', 'echo gh pr merge 5', 'gh pr list', 'gh pr', 'gh', 'git pr merge 5', '']) {
    assert.deepStrictEqual(ghPrLifecycleCalls(c, CWD), [], c);
  }
});

// ---- #6143 review: GH_REPO/GH_HOST assignment prefixes, and --disable-auto ----

test('#6143: a literal GH_REPO/GH_HOST assignment prefix is carried into the call env', () => {
  const cases = [
    ['GH_REPO=o/r gh pr merge 5', { GH_REPO: 'o/r' }],
    ['GH_HOST=ghe.example.com GH_REPO=o/r gh pr ready 5', { GH_HOST: 'ghe.example.com', GH_REPO: 'o/r' }],
    ["GH_REPO='o/r' FOO=1 gh pr merge 5", { GH_REPO: 'o/r' }],
    ['>log GH_REPO="o/r" gh pr merge 5', { GH_REPO: 'o/r' }],
  ];
  for (const [c, env] of cases) {
    const [call] = ghPrLifecycleCalls(c, CWD);
    assert.deepStrictEqual(call.env, env, c);
    assert.strictEqual(call.envUnprovable, false, c);
    assert.strictEqual(call.selector, '5', c);
  }
});

test('#6143: no GH_REPO/GH_HOST anywhere gives an empty, provable env', () => {
  for (const c of ['gh pr merge 5', 'FOO=1 gh pr merge 5', 'sudo gh pr merge 5', 'env FOO=1 gh pr merge 5']) {
    const [call] = ghPrLifecycleCalls(c, CWD);
    assert.deepStrictEqual(call.env, {}, c);
    assert.strictEqual(call.envUnprovable, false, c);
  }
});

test('#6143: a prefix on one call does not reach a later call in the list', () => {
  const calls = ghPrLifecycleCalls('GH_REPO=a/b gh pr ready 1 && gh pr merge 2', CWD);
  assert.deepStrictEqual(calls.map((c) => [c.selector, c.env, c.envUnprovable]), [['1', { GH_REPO: 'a/b' }, false], ['2', {}, false]]);
});

test('#6143: a GH_REPO/GH_HOST the parser cannot carry marks the call envUnprovable', () => {
  for (const c of [
    'GH_REPO=$R gh pr merge 5', 'GH_REPO=$(cat f) gh pr merge 5', 'GH_REPO=`cat f` gh pr merge 5', 'GH_REPO+=x gh pr merge 5',
    'export GH_REPO=o/r; gh pr merge 5', 'GH_REPO=o/r; gh pr merge 5', 'env GH_REPO=o/r gh pr merge 5',
    'env -u GH_HOST gh pr merge 5', 'sudo GH_HOST=h gh pr merge 5', 'gh_repo=o/r gh pr merge 5', 'GH_REPO[0]=o/r gh pr merge 5',
  ]) {
    const calls = ghPrLifecycleCalls(c, CWD);
    assert.strictEqual(calls.length, 1, c);
    assert.strictEqual(calls[0].envUnprovable, true, c);
  }
});

test('#6143: gh pr merge --disable-auto is a cancel, like gh pr ready --undo', () => {
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr merge --disable-auto 5', CWD)), [{ verb: 'merge', selector: '5', repo: null, undo: true }]);
  assert.deepStrictEqual(pick(ghPrLifecycleCalls('gh pr merge 5 --disable-auto -R o/r', CWD)), [{ verb: 'merge', selector: '5', repo: 'o/r', undo: true }]);
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge 5 --auto', CWD)[0].undo, false);
  // Not a ready flag: gh refuses it there, so it cancels nothing.
  assert.strictEqual(ghPrLifecycleCalls('gh pr ready --disable-auto 5', CWD)[0].undo, false);
});

// docs/hooks.md's in-flight PR gate entry names the shapes the parser does not reach ("Known gaps"), with
// reconcile's hollow-merge hold as the backstop. Pinned both ways: a walker that starts reaching one of
// these shapes fails here until the doc is updated, and the doc must keep naming the gaps.
test('#6143: the Known gaps shapes are unparsed, and docs/hooks.md names them with the reconcile backstop', () => {
  for (const c of [
    'if true; then gh pr merge 5; fi', 'for pr in 1 2; do gh pr merge "$pr"; done', 'while read p; do gh pr merge 5; done',
    'x=$(gh pr merge 5)', 'x=`gh pr merge 5`', 'bash -c "gh pr merge 5"', "sh -c 'gh pr merge 5'",
  ]) assert.deepStrictEqual(ghPrLifecycleCalls(c, CWD), [], c);
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge $pr', CWD)[0].selector, '$pr', 'a variable selector is read literally');
  const doc = require('node:fs').readFileSync(path.join(__dirname, '..', 'docs', 'hooks.md'), 'utf8');
  const entry = doc.split('\n').find((l) => l.startsWith('- **In-flight PR gate (block tier, #6143):**'));
  assert.ok(entry, 'gate entry present');
  assert.ok(entry.includes('**Known gaps:**'), 'Known gaps clause present');
  const gaps = entry.slice(entry.indexOf('**Known gaps:**'));
  for (const phrase of ['`if`/`for`/`while`', '`$(…)`', 'backtick', '`bash -c`', '`gh pr merge $pr`', '#6061', '`detectHollowMerges`', 'Defer-reason: genuinely-larger']) {
    assert.ok(gaps.includes(phrase), phrase);
  }
});

// ---- #6143 residual: pflag boolean values on the cancel flags, and env-clearing prefixes ----

test('#6143: --undo/--disable-auto with a pflag true value cancel; a false value does not; the last one wins', () => {
  for (const v of ['true', '1', 't', 'T', 'TRUE', 'True']) {
    assert.strictEqual(ghPrLifecycleCalls(`gh pr ready --undo=${v} 7`, CWD)[0].undo, true, `--undo=${v}`);
    assert.strictEqual(ghPrLifecycleCalls(`gh pr merge --disable-auto=${v} 7`, CWD)[0].undo, true, `--disable-auto=${v}`);
  }
  for (const v of ['false', '0', 'f', 'F', 'FALSE', 'False']) {
    assert.strictEqual(ghPrLifecycleCalls(`gh pr ready --undo=${v} 7`, CWD)[0].undo, false, `--undo=${v}`);
    assert.strictEqual(ghPrLifecycleCalls(`gh pr merge --disable-auto=${v} 7`, CWD)[0].undo, false, `--disable-auto=${v}`);
  }
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge --disable-auto --disable-auto=false 7', CWD)[0].undo, false);
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge --disable-auto=false --disable-auto 7', CWD)[0].undo, true);
  // Not a ParseBool value: gh refuses the flag, so it is not counted as a cancel.
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge --disable-auto=yes 7', CWD)[0].undo, false);
  assert.strictEqual(ghPrLifecycleCalls('gh pr ready --disable-auto=true 7', CWD)[0].undo, false);
  assert.strictEqual(ghPrLifecycleCalls('gh pr merge --disable-auto=true 7', CWD)[0].selector, '7');
});

test('#6143: an env-clearing prefix marks the call envCleared', () => {
  for (const c of [
    'env -i gh pr merge 5', 'env --ignore-environment gh pr merge 5', 'env - gh pr merge 5', 'env -u GH_TOKEN gh pr merge 5',
    'env --unset=X gh pr merge 5', 'env -vi gh pr merge 5', '/usr/bin/env -i gh pr merge 5', 'sudo gh pr merge 5', 'doas gh pr merge 5',
    'exec -c gh pr merge 5', 'nice env -i gh pr merge 5',
  ]) {
    const calls = ghPrLifecycleCalls(c, CWD);
    assert.strictEqual(calls.length, 1, c);
    assert.strictEqual(calls[0].envCleared, true, c);
  }
  for (const c of ['gh pr merge 5', 'env gh pr merge 5', 'env FOO=1 gh pr merge 5', 'env -C /x gh pr merge 5', 'nice -n 5 gh pr merge 5', 'exec gh pr merge 5']) {
    assert.strictEqual(ghPrLifecycleCalls(c, CWD)[0].envCleared, false, c);
  }
});
