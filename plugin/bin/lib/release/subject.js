// bin/lib/release/subject.js — the ONE merge-subject/body composer every merge
// site calls (#2251): pr-first `gh pr merge --squash -t/-b` and the four
// local-merge `git merge --no-ff -m` sites (settle-and-merge.md,
// auto-merge-short-circuit.md, local-merge-auto-finish.md, worktree-merge.md)
// all reach it through bin/compose-subject.js. Conventional Commits grammar
// (https://www.conventionalcommits.org/): `{type}[!]: {title} (#{n})` subject,
// optional summary paragraph, optional `[{tag}]` paragraph (kept because
// _shared/github-pr-scan.md's auto-merged-this-week metric matches the tag
// anywhere in the message), `Fixes #n` footer lines, and a trailing
// `BREAKING CHANGE: {note}` footer when `breaking` is set. release-please and
// the local release engine both parse exactly this shape back out, which is
// why there is one writer and no per-site variation. Pure function, zero deps.
'use strict';

const TYPE_PREFIX = { feature: 'feat', bug: 'fix', task: 'chore' };
const SUBJECT_BUDGET = 72;
const ELLIPSIS = '…';

class ComposeSubjectError extends Error {
  constructor(message) {
    super(`composeSubject: ${message}`);
    this.name = 'ComposeSubjectError';
  }
}

function usage(message) {
  return new ComposeSubjectError(message);
}

// Truncate `{prefix}: {title}` so that head + suffix fits SUBJECT_BUDGET —
// last word boundary inside the budget, trailing punctuation trimmed, `…`
// appended. The suffix is appended by the caller after this and is never cut.
function truncateHead(head, prefix, suffixLength) {
  if (head.length + suffixLength <= SUBJECT_BUDGET) return head;
  const budget = SUBJECT_BUDGET - suffixLength - ELLIPSIS.length;
  // A hard cut at `budget` can land between a surrogate pair's high and low
  // units, leaving a lone high surrogate at the end. Back the cut off by one
  // unit in that case so it never splits a code point.
  let hardCut = budget;
  if (hardCut > 0 && head.charCodeAt(hardCut - 1) >= 0xD800 && head.charCodeAt(hardCut - 1) <= 0xDBFF) {
    hardCut -= 1;
  }
  let cut = head.slice(0, hardCut);
  const lastSpace = cut.lastIndexOf(' ');
  // `${prefix}: ` puts the first space at index prefix.length + 1; only cut
  // at a space *after* that, so a single over-long first word is hard-cut
  // rather than collapsing the subject to the bare prefix.
  if (lastSpace > prefix.length + 1) cut = cut.slice(0, lastSpace);
  return cut.replace(/[\s.,;:—-]+$/u, '') + ELLIPSIS;
}

// { type, title, number, breaking?, summary?, migrationNote?, fixes?, tag?, breakingRecords? } -> { title, body }
function composeSubject({ type, title, number, breaking = false, summary, migrationNote, fixes, tag, breakingRecords } = {}) {
  // number is validated first so the type/title usage errors below can cite "for #{number}".
  if (!Number.isInteger(number) || number <= 0) throw usage(`number must be a positive integer, got ${JSON.stringify(number)}`);
  const prefixBase = TYPE_PREFIX[type];
  if (!prefixBase) throw usage(`type must be one of ${Object.keys(TYPE_PREFIX).join('|')}, got ${JSON.stringify(type)} for #${number}`);
  const cleanTitle = typeof title === 'string' ? title.trim() : '';
  if (!cleanTitle) throw usage(`title must be a non-empty string for #${number}`);
  const note = typeof migrationNote === 'string' ? migrationNote.trim() : '';
  if (breaking && !note) {
    const who = Array.isArray(breakingRecords) && breakingRecords.length
      ? breakingRecords.map((n) => `#${n}`).join(', ')
      : `#${number}`;
    throw usage(`breaking is true for ${who} but migrationNote is empty — the record needs a non-empty "## Breaking Change" section`);
  }

  const prefix = breaking ? `${prefixBase}!` : prefixBase;
  const suffix = ` (#${number})`;
  const head = truncateHead(`${prefix}: ${cleanTitle}`, prefix, suffix.length);

  const fixList = Array.isArray(fixes) && fixes.length ? fixes : [number];
  for (const n of fixList) {
    if (!Number.isInteger(n) || n <= 0) throw usage(`fixes entries must be positive integers, got ${JSON.stringify(n)}`);
  }
  const paragraphs = [];
  const cleanSummary = typeof summary === 'string' ? summary.trim() : '';
  if (cleanSummary) paragraphs.push(cleanSummary);
  if (typeof tag === 'string' && tag.trim()) paragraphs.push(`[${tag.trim()}]`);
  paragraphs.push(fixList.map((n) => `Fixes #${n}`).join('\n'));
  if (breaking) paragraphs.push(`BREAKING CHANGE: ${note}`);

  return { title: head + suffix, body: paragraphs.join('\n\n') };
}

module.exports = { composeSubject, ComposeSubjectError, TYPE_PREFIX, SUBJECT_BUDGET };
