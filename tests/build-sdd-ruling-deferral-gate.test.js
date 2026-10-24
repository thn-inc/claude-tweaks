'use strict';
// tests/build-sdd-ruling-deferral-gate.test.js — pins #3880: an SDD `Ruling:` whose decision defers
// work runs /build's fix-now gate (`_shared/deferral-gate.md`) against the spec's Acceptance Criteria
// literal text when written, stages a `Defers:` / `Defer-reason:` header the console can read, and
// the appendix states the console-auto rule with the same reason literals resolve.js emits.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { readText } = require('./helpers/read-skill');
const { SDD_RULING_REASONS } = require(path.join(__dirname, '..', 'plugin', 'bin', 'lib', 'console', 'resolve'));
const ROOT = path.join(__dirname, '..');
const read = (...p) => readText(path.join(ROOT, ...p));
const ws = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s+'));

const DISPATCH = read('plugin', 'skills', 'build', 'dispatch.md');
const APPENDIX = read('plugin', 'skills', 'wrap-up', 'review-console-appendix.md');

test('producer: a deferral ruling runs the fix-now gate against AC literal text when written', () => {
  assert.match(DISPATCH, /\*\*Deferral rulings go through the same gate \(#3880\)\.\*\*/);
  assert.match(DISPATCH, ws("runs `_shared/deferral-gate.md`'s fix-now criteria when it is written, checked against this spec's `## Acceptance Criteria` as literal text"));
  assert.match(DISPATCH, ws('is fixed in this build, so it never reaches the Review Console'));
});

test('producer: a fixed-now deferral names a real destination per ruling site, and the round-cap override', () => {
  assert.match(DISPATCH, ws("a pre-flight ruling folds it into the affected task's implementer brief"));
  assert.match(DISPATCH, ws("a ruling inside a task's fix loop sends it to that loop's next round"));
  assert.match(DISPATCH, ws("which `/build` authorizes here as an override of SDD's round cap and its single fix wave, for this case only"));
  assert.match(DISPATCH, ws('staged as a deferral with no reason (`Defers: yes`, no `Defer-reason:`)'));
});

test('producer: a failing deferral carries exactly one Defer-reason', () => {
  assert.match(DISPATCH, ws("written with exactly one `Defer-reason: {value}` from that file's vocabulary"));
});

test('producer: the staged header carries Defers and Defer-reason between Ruling and Staged-at', () => {
  assert.match(DISPATCH, /`Ruling:`.*?`Defers:`.*?always written.*?`Defer-reason:`.*?`Staged-at:`/s);
});

test('producer: the staged header clause says Defers is written on build-deviation too, and the reason is bare', () => {
  assert.match(DISPATCH, ws('always written; a `build-deviation-*` file carries it too, and the console ignores it there'));
  assert.match(DISPATCH, ws('the one value its line carries, written bare with no backticks'));
});

test('AC7.1: console prose: the appendix withholds a Defer-reason-bearing Defers: no, a duplicate Defers line, and names the reconciler path', () => {
  assert.match(APPENDIX, ws('`Defers: no` with no `Defer-reason:` header line'));
  assert.match(APPENDIX, ws('line, more than one, or a value other than `yes`/`no` resolves'));
  assert.match(APPENDIX, ws('a staged file that cannot be read at all resolves `pending — sdd-ruling-unreadable`'));
  assert.doesNotMatch(APPENDIX, /or an unreadable file resolves/);
  assert.match(APPENDIX, ws("the reconciler's `consoleAutoResolve` path withholds the same rows (`_shared/console-execution.md`)"));
});

test('console prose: the appendix sdd-ruling bullet states the console-auto rule with the code\'s reason literals', () => {
  assert.match(APPENDIX, ws('--policy console-auto'));
  assert.match(APPENDIX, ws('`Defers: no`'));
  // Every reason the code can emit, not two named fields: a reason added to
  // SDD_RULING_REASONS later must also be stated in the appendix bullet.
  const reasons = Object.values(SDD_RULING_REASONS);
  assert.ok(reasons.length >= 2, 'SDD_RULING_REASONS exposes its reasons');
  for (const reason of reasons) assert.match(APPENDIX, ws(`pending — ${reason}`));
});

test('reconciler prose: console-execution.md states the third exception and console-on-pr.md the stagedPath field', () => {
  const EXECUTION = read('plugin', 'skills', '_shared', 'console-execution.md');
  const ON_PR = read('plugin', 'skills', '_shared', 'console-on-pr.md');
  assert.match(EXECUTION, ws('**Third narrower exception (#3880):** an `isRulingRow: true` item named in the ready result\'s `rulingGateGaps`'));
  assert.match(EXECUTION, ws('withheld ratify of {item} on PR #{n} — {reason}. Reversibility: n/a (declined to act).'));
  assert.match(EXECUTION, ws('and a ruling row named in `rulingGateGaps`'));
  assert.match(EXECUTION, ws('`rulingGateGaps` (`[{ id, reason, detail? }]`'));
  assert.match(EXECUTION, ws('`{reason}` reads `sdd-ruling-unreadable ({detail})`'));
  assert.match(ON_PR, ws('also carries `"stagedPath"` (#3880)'));
});

test('control: a mutated appendix missing the reason literal fails the twin', () => {
  const needle = ws(`pending — ${SDD_RULING_REASONS.UNCLASSIFIED}`);
  assert.match(APPENDIX, needle, 'the twin must match the real appendix first');
  assert.doesNotMatch(APPENDIX.replaceAll(SDD_RULING_REASONS.UNCLASSIFIED, 'x'), needle);
});
