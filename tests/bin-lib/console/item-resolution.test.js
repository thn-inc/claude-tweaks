'use strict';
const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MOD = path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'item-resolution');
const { CONSOLE_LOCK, REWRITE_FROM, REWRITE_ONLY_IN, rewriteItemResolution } = require(MOD);
const { SECTIONS } = require(path.join(__dirname, '..', '..', '..', 'plugin', 'bin', 'lib', 'console', 'resolve'));

const AT = '2026-10-25T12:00:00.000Z';
const REASON = 'record create failed (exit 1)';

const made = [];
after(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

function consoleFile(content) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'item-resolution-'));
  made.push(dir);
  const consolePath = path.join(dir, 'console.json');
  if (content !== null) fs.writeFileSync(consolePath, typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`);
  return consolePath;
}

const STORED = () => ({
  resolved: true,
  mode: 'auto-resolve',
  at: '2026-10-25T11:00:00.000Z',
  ceiling: 'unattended',
  items: [
    { id: 'leftover-1.md', section: 'Queue writes', resolution: 'apply', reason: 'pre-checked Apply default' },
    { id: 'wrap-up-memory-1.md', section: 'Memory updates', resolution: 'apply', reason: 'pre-checked Apply default' },
  ],
  merge: { resolution: 'leave-open', reason: 'lacks auto:merge' },
  filings: [{ item: 'tiebreak:a', fingerprint: 'consolefinding-00000000', title: 't' }],
});

const call = (consolePath, over = {}) => rewriteItemResolution({ consolePath, id: 'leftover-1.md', resolution: 'keep-staged', reason: REASON, at: AT, ...over });

test('exports the lock name and the rewrite table', () => {
  assert.strictEqual(CONSOLE_LOCK, '.console.lock');
  assert.deepStrictEqual(REWRITE_FROM, { 'keep-staged': ['apply'], pending: ['approve'] });
  assert.ok(Object.isFrozen(REWRITE_FROM) && Object.isFrozen(REWRITE_FROM['keep-staged']) && Object.isFrozen(REWRITE_FROM.pending));
});

test('rewrites an apply item to keep-staged, recording rewrittenFrom/rewrittenAt and keeping every other field', () => {
  const before = STORED();
  const consolePath = consoleFile(before);
  const r = call(consolePath);
  assert.strictEqual(r.status, 'rewrote');
  assert.strictEqual(r.from, 'apply');
  const after = JSON.parse(fs.readFileSync(consolePath, 'utf8'));
  assert.deepStrictEqual(after.items[0], { id: 'leftover-1.md', section: 'Queue writes', resolution: 'keep-staged', reason: REASON, rewrittenFrom: 'apply', rewrittenAt: AT });
  assert.deepStrictEqual(r.item, after.items[0]);
  assert.deepStrictEqual(after.items[1], before.items[1]);
  assert.deepStrictEqual(after.merge, before.merge);
  assert.deepStrictEqual(after.filings, before.filings);
  assert.ok(!fs.existsSync(path.join(path.dirname(consolePath), CONSOLE_LOCK)), 'lock released');
});

test('drops a residueAcknowledgedAt the new residue postdates', () => {
  const consolePath = consoleFile({ ...STORED(), residueAcknowledgedAt: '2026-10-25T11:30:00.000Z' });
  assert.strictEqual(call(consolePath).status, 'rewrote');
  assert.ok(!('residueAcknowledgedAt' in JSON.parse(fs.readFileSync(consolePath, 'utf8'))));
});

test('an item already keep-staged is unchanged and the file is byte-identical', () => {
  const stored = STORED();
  stored.items[0] = { ...stored.items[0], resolution: 'keep-staged' };
  const consolePath = consoleFile(stored);
  const bytes = fs.readFileSync(consolePath, 'utf8');
  const r = call(consolePath);
  assert.strictEqual(r.status, 'unchanged');
  assert.strictEqual(r.item.resolution, 'keep-staged');
  assert.strictEqual(fs.readFileSync(consolePath, 'utf8'), bytes);
});

test('refuses without writing', () => {
  const dup = STORED();
  dup.items.push({ ...dup.items[0] });
  const filed = STORED();
  filed.items[0] = { ...filed.items[0], resolution: 'filed' };
  const cases = [
    ['absent file', null, 'no console.json'],
    ['unparseable', '{not json', /does not parse/],
    ['a JSON array', '[]', /not a JSON object/],
    ['a PR console', { prNumber: 42, commentIds: ['IC_1'], items: [{ id: 'leftover-1.md', resolution: 'apply' }] }, /auto-resolved console/],
    ['unknown id', STORED(), /no item nope\.md/, { id: 'nope.md' }],
    ['two items sharing the id', dup, /2 items with id leftover-1\.md/],
    ['a filed item', filed, /filed.*not rewritable to keep-staged/],
    ['a target outside REWRITE_FROM', STORED(), /not rewritable to filed/, { resolution: 'filed' }],
    ['an apply item to pending', STORED(), /apply, not rewritable to pending/, { resolution: 'pending' }],
  ];
  for (const [name, content, why, over] of cases) {
    const consolePath = consoleFile(content);
    const bytes = fs.existsSync(consolePath) ? fs.readFileSync(consolePath, 'utf8') : null;
    const r = call(consolePath, over);
    assert.strictEqual(r.status, 'refused', name);
    if (typeof why === 'string') assert.strictEqual(r.why, why, name); else assert.match(r.why, why, name);
    assert.strictEqual(fs.existsSync(consolePath) ? fs.readFileSync(consolePath, 'utf8') : null, bytes, `${name}: bytes unchanged`);
  }
});

// Its own test, so the loop above cannot stop on an earlier case first. The Queue writes item above is
// fails both the from-check and the section guard, but the from-check refuses it first, so the section
// guard never runs for it; this one sits in the right section, so only the from-check can refuse it.
test('#4636: a Reference repairs apply item is refused for pending by the from-check alone, file unchanged', () => {
  const stored = STORED();
  stored.items[0] = { ...stored.items[0], section: 'Reference repairs' };
  const consolePath = consoleFile(stored);
  const bytes = fs.readFileSync(consolePath, 'utf8');
  const r = call(consolePath, { resolution: 'pending' });
  assert.strictEqual(r.status, 'refused');
  assert.match(r.why, /item leftover-1\.md is apply, not rewritable to pending \(only approve → pending\)/);
  assert.strictEqual(fs.readFileSync(consolePath, 'utf8'), bytes);
});

test('a write failure throws and releases the lock', () => {
  const consolePath = consoleFile(STORED());
  const real = fs.renameSync;
  fs.renameSync = () => { throw new Error('EACCES: simulated'); };
  try {
    assert.throws(() => call(consolePath), /EACCES/);
  } finally { fs.renameSync = real; }
  assert.ok(!fs.existsSync(path.join(path.dirname(consolePath), CONSOLE_LOCK)), 'lock released');
  assert.strictEqual(JSON.parse(fs.readFileSync(consolePath, 'utf8')).items[0].resolution, 'apply');
});

test('#4636: rewrites an approve item to pending, recording what it replaced', () => {
  const before = STORED();
  before.items[0] = { id: 'wrap-up-reference-1.md', section: 'Reference repairs', resolution: 'approve', reason: 'stance' };
  const consolePath = consoleFile(before);
  const r = call(consolePath, { id: 'wrap-up-reference-1.md', resolution: 'pending', reason: 'reference-repair-stale' });
  assert.strictEqual(r.status, 'rewrote');
  assert.strictEqual(r.from, 'approve');
  const after = JSON.parse(fs.readFileSync(consolePath, 'utf8')).items[0];
  assert.strictEqual(after.resolution, 'pending');
  assert.strictEqual(after.reason, 'reference-repair-stale');
  assert.strictEqual(after.rewrittenFrom, 'approve');
});

test('#4636: an approve item outside Reference repairs is refused for pending and the file is unchanged', () => {
  // item-resolution.js holds the section name as a literal (it must not load resolve.js); the resolver owns it.
  assert.deepStrictEqual(REWRITE_ONLY_IN, { pending: SECTIONS.REF });
  const stored = STORED();
  stored.items[0] = { id: 'wrap-up-skill-1.md', section: 'Skill updates', resolution: 'approve', reason: 'stance' };
  const consolePath = consoleFile(stored);
  const bytes = fs.readFileSync(consolePath, 'utf8');
  const r = call(consolePath, { id: 'wrap-up-skill-1.md', resolution: 'pending', reason: 'reference-repair-stale' });
  assert.strictEqual(r.status, 'refused');
  assert.match(r.why, /section Skill updates, not rewritable to pending \(only a Reference repairs item\)/);
  assert.strictEqual(fs.readFileSync(consolePath, 'utf8'), bytes);
});
