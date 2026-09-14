'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { composeSubject, ComposeSubjectError, TYPE_PREFIX, SUBJECT_BUDGET } = require('../../../plugin/bin/lib/release/subject.js');

test('type mapping: feature→feat, bug→fix, task→chore', () => {
  assert.equal(TYPE_PREFIX.feature, 'feat');
  assert.equal(TYPE_PREFIX.bug, 'fix');
  assert.equal(TYPE_PREFIX.task, 'chore');
  assert.equal(composeSubject({ type: 'feature', title: 'Add X', number: 42, summary: 'Adds X.' }).title, 'feat: Add X (#42)');
  assert.equal(composeSubject({ type: 'bug', title: 'Fix Y', number: 7, summary: 'Fixes Y.' }).title, 'fix: Fix Y (#7)');
  assert.equal(composeSubject({ type: 'task', title: 'Tidy Z', number: 9, summary: 'Tidies Z.' }).title, 'chore: Tidy Z (#9)');
});

test('body: summary, optional tag paragraph, then one Fixes line per record', () => {
  const { body } = composeSubject({ type: 'feature', title: 'Add X', number: 42, summary: 'Adds X.', tag: 'auto-merge', fixes: [42, 43] });
  assert.equal(body, 'Adds X.\n\n[auto-merge]\n\nFixes #42\nFixes #43');
  const noTag = composeSubject({ type: 'feature', title: 'Add X', number: 42, summary: 'Adds X.' });
  assert.equal(noTag.body, 'Adds X.\n\nFixes #42');
  const noSummary = composeSubject({ type: 'task', title: 'T', number: 1 });
  assert.equal(noSummary.body, 'Fixes #1');
});

test('breaking: ! suffix on the prefix and a trailing BREAKING CHANGE footer', () => {
  const out = composeSubject({ type: 'feature', title: 'Drop legacy flag', number: 5, breaking: true, summary: 'Removes it.', migrationNote: 'Pass --new instead of --legacy.' });
  assert.equal(out.title, 'feat!: Drop legacy flag (#5)');
  assert.ok(out.body.endsWith('\n\nBREAKING CHANGE: Pass --new instead of --legacy.'), out.body);
  assert.equal(out.body, 'Removes it.\n\nFixes #5\n\nBREAKING CHANGE: Pass --new instead of --legacy.');
});

test('throws on breaking without a migration note, and on an unresolvable type', () => {
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 5, breaking: true, migrationNote: '' }), /migrationNote/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 5, breaking: true, migrationNote: '   ' }), /migrationNote/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 5, breaking: true }), /migrationNote/);
  assert.throws(() => composeSubject({ type: 'type:feature', title: 'T', number: 5 }), /type must be one of/);
  assert.throws(() => composeSubject({ type: undefined, title: 'T', number: 5 }), /type must be one of/);
  assert.throws(() => composeSubject({ type: 'feature', title: 'T', number: 0 }), /number/);
  assert.throws(() => composeSubject({ type: 'feature', title: '', number: 5 }), /title/);
});

test('usage errors are a named ComposeSubjectError subclass of Error', () => {
  assert.ok(new ComposeSubjectError('x') instanceof Error);
  assert.equal(new ComposeSubjectError('x').name, 'ComposeSubjectError');
  assert.throws(() => composeSubject({ type: 'nope', title: 'T', number: 7 }), (err) => err instanceof ComposeSubjectError);
});

test('usage errors for an unresolvable type or empty title cite the record number', () => {
  assert.throws(() => composeSubject({ type: 'nope', title: 'T', number: 7 }), /type must be one of[^]*#7/);
  assert.throws(() => composeSubject({ type: 'feature', title: '', number: 9 }), /title must be a non-empty string[^]*#9/);
});

test('empty-migrationNote usage error cites breakingRecords when given, else the record number', () => {
  assert.throws(
    () => composeSubject({ type: 'feature', title: 'T', number: 2251, breaking: true, breakingRecords: [2264] }),
    /breaking is true for #2264 but/,
  );
  assert.throws(
    () => composeSubject({ type: 'feature', title: 'T', number: 2251, breaking: true, breakingRecords: [2264, 2265] }),
    /breaking is true for #2264, #2265 but/,
  );
  assert.throws(
    () => composeSubject({ type: 'feature', title: 'T', number: 5, breaking: true }),
    /breaking is true for #5 but/,
  );
});

test('truncation: word-boundary cut, … marker, (#N) suffix intact, total ≤ 72', () => {
  const title = 'word '.repeat(30).trim(); // 149 chars, all word boundaries
  const { title: subject } = composeSubject({ type: 'feature', title, number: 2251 });
  assert.ok(subject.length <= SUBJECT_BUDGET, `${subject.length} > 72: ${subject}`);
  assert.ok(subject.endsWith(' (#2251)'), subject);
  assert.match(subject, /^feat: (word )*word… \(#2251\)$/);
});

test('truncation: a title that fits is never touched, and 72 exactly is allowed', () => {
  const short = composeSubject({ type: 'bug', title: 'Short title', number: 1 }).title;
  assert.equal(short, 'fix: Short title (#1)');
  // "feat: " (6) + title (58) + " (#1)" (5) = 69 → untouched
  const t58 = 'a'.repeat(58);
  assert.equal(composeSubject({ type: 'feature', title: t58, number: 1 }).title, `feat: ${t58} (#1)`);
  // Exactly 72: "feat: " (6) + 61 + " (#1)" (5) = 72 → untouched
  const t61 = ('word '.repeat(13)).slice(0, 61);
  const exact = composeSubject({ type: 'feature', title: t61, number: 1 }).title;
  assert.equal(exact.length, 72);
  assert.ok(!exact.includes('…'));
});

test('truncation: the ! suffix is counted inside the budget before the cut', () => {
  // With "feat: " (6) + 61 + " (#1)" (5) = 72 it fits; "feat!: " (7) pushes it to 73 → truncated.
  const t61 = ('word '.repeat(13)).slice(0, 61);
  const plain = composeSubject({ type: 'feature', title: t61, number: 1 }).title;
  const brk = composeSubject({ type: 'feature', title: t61, number: 1, breaking: true, migrationNote: 'n' }).title;
  assert.ok(!plain.includes('…'));
  assert.ok(brk.includes('…'), brk);
  assert.ok(brk.startsWith('feat!: '));
  assert.ok(brk.length <= SUBJECT_BUDGET);
  assert.ok(brk.endsWith(' (#1)'));
});

test('truncation: a single over-long word is hard-cut rather than reduced to the bare prefix', () => {
  const { title } = composeSubject({ type: 'task', title: 'x'.repeat(100), number: 12 });
  assert.ok(title.length <= SUBJECT_BUDGET);
  assert.match(title, /^chore: x+… \(#12\)$/);
});

test('truncation: a hard cut through a surrogate pair never leaves a lone surrogate', () => {
  // A single over-long "word" of astral emoji, no spaces, so the word-boundary
  // branch cannot help — the hard cut is the only thing that can save this.
  const title = '🚀'.repeat(60);
  const { title: subject } = composeSubject({ type: 'task', title, number: 100 });
  const lonelySurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u;
  assert.ok(!lonelySurrogate.test(subject), subject);
  assert.ok(subject.endsWith(' (#100)'), subject);
  assert.ok(subject.length <= SUBJECT_BUDGET, `${subject.length} > 72: ${subject}`);
});

test('truncation: trailing punctuation is trimmed when the word-boundary cut lands right after it', () => {
  // The word before the dropped tail ends in a comma ("bug,"), so the untrimmed cut would end
  // "...bug,… (#1)" — a bare .replace trim proves it strips the comma before the ellipsis.
  const title = 'word '.repeat(5) + 'bug,' + ' ' + 'y'.repeat(50);
  const { title: subject } = composeSubject({ type: 'bug', title, number: 1 });
  assert.ok(!subject.includes(',…'), subject);
  assert.ok(subject.length <= SUBJECT_BUDGET, `${subject.length} > 72: ${subject}`);
  assert.ok(subject.endsWith(' (#1)'), subject);
});
