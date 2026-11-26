'use strict';
// #5053 Deliverable 3 / AC8.1: `needs:answer` is the plan-review waiting label. It lives in
// label-bootstrap's LABELS_JSON (version 12), work-record's label table (Definition (3)),
// its grant-revocation bullet and Worklist rule, and the permission matrix. `bot:blocked`
// keeps its retry-ceiling-only meaning (expand-contract, D10). Every pin is proven by
// mutating the live passage in memory and matching the throw to the pin's own message.

const { test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { readText } = require('./helpers/read-skill');
const { ensureLabelPayload } = require('../plugin/bin/lib/issues/labels.js');

const ROOT = path.join(__dirname, '..');
const read = (rel) => readText(path.join(ROOT, rel));

const ANSWER_DESCRIPTION = 'a plan-review question awaits a human answer — reply /answer on the question comment';
const BLOCKED_DESCRIPTION = 'Bot state: retry ceiling hit — needs re-authorization';

const BOOTSTRAP = 'plugin/skills/_shared/label-bootstrap.md';
const WORK_RECORD = 'plugin/skills/_shared/work-record.md';
const MATRIX = 'plugin/skills/_shared/work-record-permission-matrix.md';

function lineStarting(text, head) {
  const found = text.split('\n').filter((l) => l.startsWith(head));
  assert.strictEqual(found.length, 1, `expected exactly one line starting ${head}`);
  return found[0];
}

function between(text, startMarker, endMarker) {
  const s = text.indexOf(startMarker);
  assert.ok(s >= 0, `start marker not found: ${startMarker}`);
  const e = text.indexOf(endMarker, s + startMarker.length);
  assert.ok(e > s, `end marker not found after: ${startMarker}`);
  return text.slice(s, e);
}

// Each check returns the facts it finds missing so a mutation proof can match its own fact.
function labelRowFacts(bootstrap) {
  const out = [];
  const row = bootstrap.match(/\["needs:answer",\s*"([^"]*)",\s*"([^"]*)"\]/);
  if (!row) return ['needs:answer LABELS_JSON row'];
  if (row[1] !== ANSWER_DESCRIPTION) out.push('needs:answer description');
  if (row[2] !== '7057FF') out.push('needs:answer colour');
  return out;
}

function blockedRowFacts(bootstrap) {
  const row = bootstrap.match(/\["bot:blocked",\s*"([^"]*)",\s*"([^"]*)"\]/);
  if (!row) return ['bot:blocked LABELS_JSON row'];
  return row[1] === BLOCKED_DESCRIPTION ? [] : ['bot:blocked retry-ceiling-only description'];
}

function versionFacts(bootstrap) {
  const m = bootstrap.match(/current value: `(\d+)`/);
  if (!m) return ['version literal'];
  return Number(m[1]) >= 12 ? [] : ['LABEL_BOOTSTRAP_VERSION >= 12'];
}

function definitionRowFacts(workRecord) {
  const row = lineStarting(workRecord, '| Definition (3) |');
  const flat = row.replace(/\s+/g, ' ');
  const out = [];
  if (!row.includes('`needs:answer`')) out.push('Definition (3) names needs:answer');
  if (!flat.includes('stamped by `/build` plan review')) out.push('Definition (3) stamper');
  if (!flat.includes('`plan-review-answer.js`')) out.push('Definition (3) ingest remover');
  if (!flat.includes('`dispatch resume`')) out.push('Definition (3) resume remover');
  return out;
}

function botStateFacts(workRecord) {
  const flat = lineStarting(workRecord, '| **Bot state** |').replace(/\s+/g, ' ');
  const out = [];
  if (!flat.includes('`needs:answer`')) out.push('Bot state row points a plan-review question at needs:answer');
  if (flat.includes('plan-review question awaits')) out.push('Bot state row still names plan review as a cause');
  return out;
}

function grantBulletFacts(workRecord) {
  const flat = between(workRecord, 'At the retry ceiling (`dispatch-retry-ceiling`)', '- `auto:*` labels are only ever originated')
    .replace(/\s+/g, ' ');
  const out = [];
  if (!flat.includes('`needs:answer`')) out.push('grant bullet names needs:answer');
  if (!flat.includes('`/claude-tweaks:dispatch resume #N`')) out.push('grant bullet names dispatch resume');
  if (flat.includes('does the same in a headless dispatch')) out.push('grant bullet still says plan review revokes grants');
  return out;
}

function worklistFacts(workRecord) {
  const flat = between(workRecord, 'The worklist rule:', '\n\n').replace(/\s+/g, ' ');
  const out = [];
  if (!flat.includes('`needs:answer`')) out.push('Worklist rule names needs:answer');
  if (!flat.includes('`dispatch/answered-resumes.md`')) out.push('Worklist rule names the sweep');
  if (!flat.includes('only from a trusted human reply')) out.push('Worklist rule trusted-reply clause');
  return out;
}

function matrixFacts(matrix) {
  const out = [];
  const exec = lineStarting(matrix, '| **Executors**').replace(/\s+/g, ' ');
  if (!exec.includes('`needs:answer`')) out.push('Executors row adds needs:answer');
  if (!exec.includes('`build/plan-review.md`')) out.push('Executors row names plan-review.md');
  if (exec.includes('`bot:blocked` — `/build` only')) out.push('Executors row still lists bot:blocked as a plan-review write');
  const disp = lineStarting(matrix, '| **`/dispatch`**').replace(/\s+/g, ' ');
  if (!disp.includes('`needs:answer`')) out.push('/dispatch row removes needs:answer');
  if (!disp.includes('`plan-review-answer.js`')) out.push('/dispatch row names the ingest');
  if (!disp.includes('`dispatch resume`')) out.push('/dispatch row names dispatch resume');
  return out;
}

test('AC8.1: needs:answer is in label-bootstrap, the work-record label table and the permission matrix', () => {
  const bootstrap = read(BOOTSTRAP);
  const workRecord = read(WORK_RECORD);
  const matrix = read(MATRIX);
  assert.deepStrictEqual(labelRowFacts(bootstrap), []);
  assert.deepStrictEqual(blockedRowFacts(bootstrap), []);
  assert.deepStrictEqual(versionFacts(bootstrap), []);
  assert.deepStrictEqual(definitionRowFacts(workRecord), []);
  assert.deepStrictEqual(botStateFacts(workRecord), []);
  assert.deepStrictEqual(grantBulletFacts(workRecord), []);
  assert.deepStrictEqual(worklistFacts(workRecord), []);
  assert.deepStrictEqual(matrixFacts(matrix), []);
});

test('AC8.1: the family renumbering is complete — no Definition (2) row remains', () => {
  assert.ok(!read(WORK_RECORD).includes('Definition (2)'), 'Definition (2) still present');
});

test('AC8.1: both label payloads pass ensureLabelPayload (100-char cap)', () => {
  assert.ok(ANSWER_DESCRIPTION.length <= 100, `needs:answer description is ${ANSWER_DESCRIPTION.length} chars`);
  assert.doesNotThrow(() => ensureLabelPayload('needs:answer', ANSWER_DESCRIPTION, '7057FF'));
  assert.doesNotThrow(() => ensureLabelPayload('bot:blocked', BLOCKED_DESCRIPTION, '6A737D'));
});

// Go-red: each fact returns exactly itself when only its text is mutated.
function mutate(text, from, to) {
  const out = text.replace(from, to);
  assert.notStrictEqual(out, text, `mutation matched nothing: ${from}`);
  return out;
}

// Rewrites one whole line (every copy of `token` in it) so a token that appears twice in the
// row cannot survive the mutation.
function mutateLine(text, head, token, to) {
  const lines = text.split('\n');
  const i = lines.findIndex((l) => l.startsWith(head));
  assert.ok(i >= 0, `no line starts ${head}`);
  const rewritten = lines[i].split(token).join(to);
  assert.notStrictEqual(rewritten, lines[i], `${token} not in line ${head}`);
  lines[i] = rewritten;
  return lines.join('\n');
}

test('go-red: label-bootstrap pins each return exactly their own fact', () => {
  const bootstrap = read(BOOTSTRAP);
  assert.deepStrictEqual(labelRowFacts(mutate(bootstrap, '["needs:answer",', '["needs:other",')), ['needs:answer LABELS_JSON row']);
  assert.deepStrictEqual(labelRowFacts(mutate(bootstrap, ANSWER_DESCRIPTION, 'x')), ['needs:answer description']);
  assert.deepStrictEqual(labelRowFacts(mutate(bootstrap, /\["needs:answer",(\s*"[^"]*",\s*)"7057FF"/, '["needs:answer",$1"000000"')), ['needs:answer colour']);
  assert.deepStrictEqual(blockedRowFacts(mutate(bootstrap, BLOCKED_DESCRIPTION, 'Bot state: retry ceiling hit, or a plan-review question awaits an answer')), ['bot:blocked retry-ceiling-only description']);
  assert.deepStrictEqual(versionFacts(mutate(bootstrap, /current value: `\d+`/, 'current value: `11`')), ['LABEL_BOOTSTRAP_VERSION >= 12']);
});

test('go-red: work-record pins each return exactly their own fact', () => {
  const wr = read(WORK_RECORD);
  assert.deepStrictEqual(definitionRowFacts(mutateLine(wr, '| Definition (3) |', '`needs:answer`', '`needs:x`')), ['Definition (3) names needs:answer']);
  assert.deepStrictEqual(definitionRowFacts(mutate(wr, 'stamped by `/build` plan review', 'stamped by /build')), ['Definition (3) stamper']);
  assert.deepStrictEqual(definitionRowFacts(mutateLine(wr, '| Definition (3) |', '`plan-review-answer.js`', '`x.js`')), ['Definition (3) ingest remover']);
  assert.deepStrictEqual(botStateFacts(mutateLine(wr, '| **Bot state** |', '`needs:answer`', '`needs:x`')), ['Bot state row points a plan-review question at needs:answer']);
  assert.deepStrictEqual(botStateFacts(mutate(wr, '| **Bot state** |', '| **Bot state** | a plan-review question awaits |')), ['Bot state row still names plan review as a cause']);
  assert.deepStrictEqual(grantBulletFacts(mutate(wr, '`/claude-tweaks:dispatch resume #N`', '`dispatch`')), ['grant bullet names dispatch resume']);
  assert.deepStrictEqual(grantBulletFacts(mutate(wr, 'revokes nothing on a needs-human stop', 'does the same in a headless dispatch on a needs-human stop')), ['grant bullet still says plan review revokes grants']);
  assert.deepStrictEqual(worklistFacts(mutate(wr, 'only from a trusted human reply', 'from any reply')), ['Worklist rule trusted-reply clause']);
  assert.deepStrictEqual(worklistFacts(mutate(wr, '`dispatch/answered-resumes.md`', '`x.md`')), ['Worklist rule names the sweep']);
});

test('go-red: permission-matrix pins each return exactly their own fact', () => {
  const m = read(MATRIX);
  assert.deepStrictEqual(matrixFacts(mutateLine(m, '| **Executors**', '`needs:answer`', '`needs:x`')), ['Executors row adds needs:answer']);
  assert.deepStrictEqual(matrixFacts(mutateLine(m, '| **`/dispatch`**', '`needs:answer`', '`needs:x`')), ['/dispatch row removes needs:answer']);
  assert.deepStrictEqual(matrixFacts(mutateLine(m, '| **`/dispatch`**', '`plan-review-answer.js`', '`x.js`')), ['/dispatch row names the ingest']);
  assert.deepStrictEqual(matrixFacts(mutate(m, '| **Executors** (`/flow`, `/build`) |', '| **Executors** (`/flow`, `/build`) | `bot:blocked` — `/build` only |')), ['Executors row still lists bot:blocked as a plan-review write']);
});
