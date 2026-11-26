'use strict';
// #4746: every /specify shaping temp file is keyed by the record id, and the body's first-line
// composed-for marker lets compose-record.js --check --record refuse another record's body.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { readText } = require('./helpers/read-skill');
const { scratchDir } = require('./helpers/tmp-dir');
const composeRecord = require('../plugin/bin/compose-record');
const sessionTmpResolve = require('../plugin/bin/session-tmp-resolve');
const riskFlags = require('../plugin/bin/risk-flags');
const { specHash } = require('../plugin/bin/lib/issues/plan-line');

const ROOT = path.join(__dirname, '..');
const SKILL = path.join(ROOT, 'plugin', 'skills', 'specify');
const stamping = readText(path.join(SKILL, 'shaping-mode-stamping.md'));
const shapingMode = readText(path.join(SKILL, 'shaping-mode.md'));
const planning = readText(path.join(SKILL, 'planning.md'));

const FIXED_NAMES = ['specify-shaped-body.md', 'specify-prior-body.md', 'specify-risk-answers.json'];

function assertNoFixedName(text) {
  for (const name of FIXED_NAMES) assert.ok(!text.includes(name), `still names the session-wide ${name}`);
}

function fenceOf(text, anchor) {
  const at = text.indexOf(anchor);
  assert.ok(at >= 0, `anchor ${anchor} not found`);
  const start = text.lastIndexOf('```', at);
  const end = text.indexOf('```', at);
  assert.ok(start >= 0 && end > at, 'fenced block not found');
  return text.slice(start, end);
}

const fence = fenceOf(stamping, 'SPECIFY_SHAPED_BODY=$(node -e "');

const SHAPED = '## Current State\n\n{who}\n\n## Deliverables\n\n- [ ] thing\n\n## Acceptance Criteria\n\n1. done\n\n## Release Note\n\nDid the thing.';
const bodyFor = (who) => SHAPED.replace('{who}', who);
const marker = (n) => `<!-- composed-for: #${n} -->\n`;

function collect() {
  const out = [];
  return { out, deps: { stdout: (s) => out.push(['out', s]), stderr: (s) => out.push(['err', s]) } };
}
const stream = (out, kind) => out.filter((o) => o[0] === kind).map((o) => o[1]).join('');

test('AC1.1: every shaping resolve site names the record id', () => {
  assert.equal(fence.split("'specify-shaped-body-{n}.md'").length - 1, 2);
  assert.ok(stamping.includes('session-tmp-resolve.js" BODY=specify-shaped-body-{n}.md PRIOR=specify-prior-body-{n}.md ANSWERS=specify-risk-answers-{n}.json'));
  assert.ok(shapingMode.includes('specify-shaped-body-{n}.md'));
});

test('AC1.2: no site keeps a fixed session-wide filename', () => {
  assertNoFixedName(stamping);
  assertNoFixedName(shapingMode);
  assertNoFixedName(planning);
  // go-red control: the matcher refuses a fixed name
  assert.throws(() => assertNoFixedName("... 'specify-shaped-body.md' ..."));
});

test('every pre-write check passes --record {n}', () => {
  assert.match(fence, /--check "\$SPECIFY_SHAPED_BODY" --record \{n\} \|\| exit\s*$/m);
  assert.ok(planning.includes('--check "{body}" --record {n}'));
});

test('AC2.1: shaping two records back to back in one session writes each its own body', () => {
  const m = /sessionTmpPath\(process\.env\.CLAUDE_CODE_SESSION_ID, '([^']+)'\)/.exec(fence);
  assert.ok(m, 'filename literal not found in the fence');
  const tmp = scratchDir('shaped-body-per-record-');
  const env = { CLAUDE_CODE_SESSION_ID: 'same-session', TMPDIR: tmp };
  const resolve = (n) => {
    const c = collect();
    assert.equal(sessionTmpResolve.run(['--value', m[1].replace('{n}', n)], { env, ...c.deps }), 0);
    return stream(c.out, 'out').trim();
  };
  const p4549 = resolve('4549');
  const p4550 = resolve('4550');
  assert.notEqual(p4549, p4550);
  fs.mkdirSync(path.dirname(p4549), { recursive: true });
  fs.writeFileSync(p4549, marker(4549) + bodyFor('body A'));
  fs.mkdirSync(path.dirname(p4550), { recursive: true });
  fs.writeFileSync(p4550, marker(4550) + bodyFor('body B'));
  assert.equal(composeRecord.run(['--check', p4549, '--record', '4549'], collect().deps), 0);
  assert.equal(composeRecord.run(['--check', p4550, '--record', '4550'], collect().deps), 0);
  assert.equal(fs.readFileSync(p4549, 'utf8'), bodyFor('body A'));
  assert.equal(fs.readFileSync(p4550, 'utf8'), bodyFor('body B'));
});

test('AC3.1: a cross-wired body is refused before the write', () => {
  const dir = scratchDir('shaped-body-crosswired-');
  const f = path.join(dir, 'body.md');
  const original = marker(4549) + bodyFor('body A');
  fs.writeFileSync(f, original);
  const c = collect();
  assert.equal(composeRecord.run(['--check', f, '--record', '4550'], c.deps), 6);
  const err = stream(c.out, 'err');
  assert.ok(err.includes('#4549') && err.includes('#4550'), err);
  assert.equal(fs.readFileSync(f, 'utf8'), original);
});

test('the marker does not change the plan spec hash', () => {
  const body = '## Overview\n\nSomething.\n\n## Deliverables\n\n- [ ] x\n';
  assert.equal(specHash(body), specHash(marker(9) + body));
});

test('the marker survives risk-flags settle', () => {
  const dir = scratchDir('shaped-body-settle-');
  const f = path.join(dir, 'body.md');
  const p = path.join(dir, 'prior.md');
  const shaped = bodyFor('settle me');
  fs.writeFileSync(f, marker(9) + shaped);
  fs.writeFileSync(p, shaped);
  const c = collect();
  const code = riskFlags.run(['settle', '--body-file', f, '--prior-body-file', p, '--headless', '--repo-root', ROOT], c.deps);
  assert.equal(code, 0, stream(c.out, 'err'));
  assert.equal(fs.readFileSync(f, 'utf8').split('\n')[0], '<!-- composed-for: #9 -->');
  assert.equal(composeRecord.run(['--check', f, '--record', '9'], collect().deps), 0);
});
