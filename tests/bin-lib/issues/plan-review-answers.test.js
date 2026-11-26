'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  QUESTION_MARKER, findQuestion, findAnswerReplies, answerText, answeredState, appendAnswers, questionExcerpt, decisionHeaderUrls,
} = require('../../../plugin/bin/lib/issues/plan-review-answers');
const { originalRequestOffset, shapeGate } = require('../../../plugin/bin/lib/issues/materialize-format');

const QUESTION_BODY = `${QUESTION_MARKER}
**Plan review needs a decision before the build can continue.**

**Question 1. What happens when the reply is empty?**

Reading A: ignore. Reading B: stop.`;

let seq = 0;
function comment(opts = {}) {
  const { body, createdAt, login = 'maintainer', url } = opts;
  const association = 'association' in opts ? opts.association : 'OWNER';
  seq += 1;
  const c = {
    body,
    createdAt,
    url: url || `https://github.com/o/r/issues/1#issuecomment-${seq}`,
    author: { login },
  };
  if (association !== undefined) c.authorAssociation = association;
  if ('isMinimized' in opts) c.isMinimized = opts.isMinimized;
  return c;
}
const question = (over = {}) => comment({ body: QUESTION_BODY, createdAt: '2026-11-26T10:00:00Z', ...over });
const reply = (text, over = {}) => comment({ body: text, createdAt: '2026-11-26T11:00:00Z', ...over });

const RECORD = `## Current State

Something.

## Acceptance Criteria

- one

## Original request

Original text.
`;

test('AC1.1: a trusted question plus a trusted /answer comment after it reads answered', () => {
  const q = question();
  const r = reply('/answer Reading B');
  const s = answeredState({ comments: [q, r], body: RECORD });
  assert.equal(s.state, 'answered');
  assert.equal(s.replies.length, 1);
  assert.equal(s.pending.length, 1);
  assert.equal(s.question, q);
});

test('AC1.2: no trusted question reads no-question', () => {
  assert.equal(answeredState({ comments: [], body: RECORD }).state, 'no-question');
  assert.equal(answeredState({ comments: [reply('/answer x')], body: RECORD }).state, 'no-question');
  assert.equal(answeredState({ comments: [question({ association: 'CONTRIBUTOR' })], body: RECORD }).state, 'no-question');
});

test('AC1.3: an /answer created before the newest question (after an older one) reads unanswered', () => {
  const old = question({ createdAt: '2026-11-25T10:00:00Z' });
  const between = reply('/answer old', { createdAt: '2026-11-25T12:00:00Z' });
  const newest = question({ createdAt: '2026-11-26T10:00:00Z' });
  const s = answeredState({ comments: [old, between, newest], body: RECORD });
  assert.equal(s.state, 'unanswered');
  assert.equal(s.question, newest);
});

test('AC1.4: untrusted authors read unanswered', () => {
  const q = question();
  for (const association of ['CONTRIBUTOR', 'NONE', undefined]) {
    const s = answeredState({ comments: [q, reply('/answer x', { association })], body: RECORD });
    assert.equal(s.state, 'unanswered', String(association));
  }
});

test('AC1.5: first non-blank line must start with /answer plus text', () => {
  const q = question();
  for (const text of ['/answers x', 'see /answer x', '/answer:', '/answer', '/answer   ']) {
    assert.equal(answeredState({ comments: [q, reply(text)], body: RECORD }).state, 'unanswered', text);
  }
  const upper = answeredState({ comments: [q, reply('/ANSWER Reading A')], body: RECORD });
  assert.equal(upper.state, 'answered');
  assert.equal(answerText(upper.replies[0]), 'Reading A');
  const lead = answeredState({ comments: [q, reply('\n\n/answer Reading B')], body: RECORD });
  assert.equal(lead.state, 'answered');
  assert.equal(answerText(lead.replies[0]), 'Reading B');
});

test('answerText keeps later lines and findAnswerReplies orders oldest first', () => {
  const q = question();
  const late = reply('/answer second', { createdAt: '2026-11-26T13:00:00Z' });
  const early = reply('/answer first\nmore detail', { createdAt: '2026-11-26T12:00:00Z' });
  const out = findAnswerReplies([q, late, early], q);
  assert.deepEqual(out, [early, late]);
  assert.equal(answerText(early), 'first\nmore detail');
  assert.equal(findAnswerReplies([q, reply('/answer x', { createdAt: q.createdAt })], q).length, 0);
});

test('AC1.6: an untrusted question comment reads no-question', () => {
  assert.equal(findQuestion([question({ association: 'NONE' })]), null);
});

test('AC2.1: the section goes immediately before ## Original request', () => {
  const q = question();
  const out = appendAnswers(RECORD, q, [reply('/answer Reading B')]);
  const at = out.indexOf('## Plan-review answers (2026-11-26)');
  assert.ok(at >= 0);
  const orig = originalRequestOffset(out);
  assert.ok(at < orig);
  assert.match(out.slice(at, orig), /\n\n$/);
  assert.doesNotMatch(out.slice(at, orig), /\n\n\n$/);
  assert.match(out, /Question: https:\/\/github\.com\/o\/r\/issues\/1#issuecomment-\d+/);
  assert.match(out, /\*\*Decision\*\* \(answer by @maintainer, /);
});

test('AC2.2: with no Original request it is appended at the end', () => {
  const body = '## Current State\n\nSomething.\n';
  const out = appendAnswers(body, question(), [reply('/answer B')]);
  assert.ok(out.startsWith(body));
  assert.ok(out.indexOf('## Plan-review answers') > body.length - 1);
  assert.ok(out.endsWith('B\n```\n'));
  assert.equal(originalRequestOffset(out), -1);
});

test('AC2.3: a reply with backticks, an Original request line and TODO is fenced', () => {
  const q = question();
  const r = reply('/answer ```js\nx\n```\n## Original request\nTODO later');
  const out = appendAnswers(RECORD, q, [r]);
  assert.equal(originalRequestOffset(out), originalRequestOffset(RECORD) + (out.length - RECORD.length));
  assert.ok(!shapeGate(RECORD).missing.includes('unresolved-placeholder'));
  assert.ok(!shapeGate(out).missing.includes('unresolved-placeholder'));
  assert.ok(out.includes('````text\n'));
});

test('AC2.4: a second call with the same replies is byte-identical', () => {
  const q = question();
  const rs = [reply('/answer B')];
  const once = appendAnswers(RECORD, q, rs);
  assert.equal(appendAnswers(once, q, rs), once);
  assert.equal(appendAnswers(RECORD, q, []), RECORD);
});

test('a later reply to the same question adds a second Decision block to the same section', () => {
  const q = question();
  const r1 = reply('/answer first');
  const r2 = reply('/answer second', { createdAt: '2026-11-26T12:00:00Z' });
  const once = appendAnswers(RECORD, q, [r1]);
  const twice = appendAnswers(once, q, [r1, r2]);
  assert.equal(twice.match(/^## Plan-review answers/gm).length, 1);
  assert.equal(twice.match(/^\*\*Decision\*\*/gm).length, 2);
  assert.ok(originalRequestOffset(twice) > twice.indexOf('second'));
  assert.ok(twice.indexOf('first') < twice.indexOf('second'));
  // both in one call produce the same text
  assert.equal(appendAnswers(RECORD, q, [r1, r2]), twice);
});

test('a CRLF body keeps the section before ## Original request', () => {
  const crlf = RECORD.replace(/\n/g, '\r\n');
  const out = appendAnswers(crlf, question(), [reply('/answer B')]);
  assert.ok(out.indexOf('## Plan-review answers') < originalRequestOffset(out));
  assert.ok(originalRequestOffset(out) > 0);
  assert.ok(!/(^|[^\r])\n/.test(out), 'no bare LF in a CRLF body');
});

test('a CRLF reply is normalized into both an LF and a CRLF body', () => {
  const r = reply('/answer Reading B\r\n\r\nBecause reasons.');
  assert.equal(answerText(r), 'Reading B\n\nBecause reasons.');
  const lf = appendAnswers(RECORD, question(), [r]);
  assert.ok(!lf.includes('\r'));
  const crlf = appendAnswers(RECORD.replace(/\n/g, '\r\n'), question(), [r]);
  assert.ok(!crlf.includes('\r\r'));
  assert.ok(!/(^|[^\r])\n/.test(crlf));
  assert.ok(crlf.includes('Reading B\r\n\r\nBecause reasons.'));
});

test('a Decision header for #issuecomment-123 does not count as ingesting #issuecomment-12', () => {
  const q = question();
  const r12 = reply('/answer short', { url: 'https://github.com/o/r/issues/1#issuecomment-12' });
  const r123 = reply('/answer long', { url: 'https://github.com/o/r/issues/1#issuecomment-123' });
  const body = appendAnswers(RECORD, q, [r123]);
  assert.equal(answeredState({ comments: [q, r12], body }).pending.length, 1);
  assert.notEqual(appendAnswers(body, q, [r12]), body);
  const ingested = appendAnswers(RECORD, q, [r12]);
  assert.equal(answeredState({ comments: [q, r12], body: ingested }).pending.length, 0);
  assert.equal(appendAnswers(ingested, q, [r12]), ingested);
});

test('I1: two replies that cross-quote each other\'s URLs are both ingested', () => {
  const q = question();
  const a = reply('/answer A, superseding https://github.com/o/r/issues/1#issuecomment-301', { url: 'https://github.com/o/r/issues/1#issuecomment-300' });
  const b = reply('/answer B, as https://github.com/o/r/issues/1#issuecomment-300 said', { url: 'https://github.com/o/r/issues/1#issuecomment-301', createdAt: '2026-11-26T12:00:00Z' });
  const out = appendAnswers(RECORD, q, [a, b]);
  assert.deepEqual(decisionHeaderUrls(out), [a.url, b.url]);
  assert.equal(answeredState({ comments: [q, a, b], body: out }).pending.length, 0);
  // the reverse order of ingest (b already in, a pending) still ingests a
  const bOnly = appendAnswers(RECORD, q, [b]);
  assert.deepEqual(answeredState({ comments: [q, a, b], body: bOnly }).pending, [a]);
  assert.deepEqual(decisionHeaderUrls(appendAnswers(bOnly, q, [a, b])), [b.url, a.url]);
});

test('I1: a body citing a reply URL outside a Decision header does not count as ingested', () => {
  const q = question();
  const r = reply('/answer B');
  const body = `${RECORD}\nSee ${r.url} here.\n`;
  assert.deepEqual(answeredState({ comments: [q, r], body }).pending, [r]);
  assert.notEqual(appendAnswers(body, q, [r]), body);
});

test('I1: a Decision header line inside a fence does not count as ingested', () => {
  const q = question();
  const r = reply('/answer B');
  const body = `${RECORD}\n\`\`\`\n**Decision** (answer by @maintainer, ${r.url}):\n\`\`\`\n`;
  assert.deepEqual(decisionHeaderUrls(body), []);
  assert.deepEqual(answeredState({ comments: [q, r], body }).pending, [r]);
  const unfenced = `${RECORD}\n**Decision** (answer by @maintainer, ${r.url}):\n`;
  assert.deepEqual(decisionHeaderUrls(unfenced), [r.url]);
  assert.deepEqual(decisionHeaderUrls(unfenced.replace(/\n/g, '\r\n')), [r.url]);
});

test('R1: a stray unclosed fence before an existing Decision header still reads that reply as ingested', () => {
  const q = question();
  const r = reply('/answer B');
  const body = `${RECORD}\n\`\`\`\nstray opener\n\n**Decision** (answer by @maintainer, ${r.url}):\n`;
  assert.deepEqual(decisionHeaderUrls(body), [r.url]);
  assert.deepEqual(answeredState({ comments: [q, r], body }).pending, []);
  assert.equal(appendAnswers(body, q, [r]), body);
});

test('R2: two reply entries with the same URL in one call write exactly one Decision header', () => {
  const q = question();
  const r = reply('/answer B');
  const out = appendAnswers(RECORD, q, [r, { ...r }]);
  assert.deepEqual(decisionHeaderUrls(out), [r.url]);
  assert.equal(out, appendAnswers(RECORD, q, [r]));
});

test('T1: appendAnswers skips a reply with no url', () => {
  const noUrlReply = reply('/answer B');
  delete noUrlReply.url;
  assert.equal(appendAnswers(RECORD, question(), [noUrlReply]), RECORD);
});

test('M1: a minimized reply or question is not counted', () => {
  const q = question();
  const hidden = reply('/answer B', { isMinimized: true });
  assert.equal(answeredState({ comments: [q, hidden], body: RECORD }).state, 'unanswered');
  const shown = reply('/answer C', { isMinimized: false });
  assert.deepEqual(answeredState({ comments: [q, hidden, shown], body: RECORD }).replies, [shown]);
  const older = question({ createdAt: '2026-11-25T10:00:00Z' });
  const newestHidden = question({ isMinimized: true });
  assert.equal(findQuestion([older, newestHidden]), older);
});

test('a bare-CR first line is read as a line break', () => {
  const q = question();
  assert.equal(answeredState({ comments: [q, reply('\r/answer B')], body: RECORD }).state, 'answered');
  assert.equal(answeredState({ comments: [q, reply('see\r/answer B')], body: RECORD }).state, 'unanswered');
});

test('a reply with no url is excluded from replies, so a second call stays byte-identical', () => {
  const q = question();
  const noUrl = reply('/answer B');
  delete noUrl.url;
  const s = answeredState({ comments: [q, noUrl], body: RECORD });
  assert.equal(s.state, 'unanswered');
  const once = appendAnswers(RECORD, q, s.replies);
  assert.equal(once, RECORD);
  assert.equal(appendAnswers(once, q, s.replies), once);
});

test('a question with no createdAt is not usable and writes no section', () => {
  const q = comment({ body: QUESTION_BODY, createdAt: undefined });
  assert.equal(findQuestion([q]), null);
  assert.equal(appendAnswers(RECORD, q, [reply('/answer B')]), RECORD);
});

test('questionExcerpt reads Question 1 from the real comment shape', () => {
  assert.equal(questionExcerpt(question()), 'Question 1. What happens when the reply is empty?');
  const bare = comment({ body: `${QUESTION_MARKER}\n\nFirst line here\nsecond`, createdAt: '2026-11-26T10:00:00Z' });
  assert.equal(questionExcerpt(bare), 'First line here');
});
