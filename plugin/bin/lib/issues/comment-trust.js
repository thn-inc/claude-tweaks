'use strict';

// Pure: the one rule for "may this comment's text drive behavior?" (#3358).
// Several readers act on a marker inside a comment body — `<!-- run-comment:
// ... -->`, `<!-- grant-mode-audit: ... -->`, claim and verdict markers — and
// a comment is writable by anyone who can comment on the issue or PR, so a
// marker's presence alone proves nothing. Trust a comment only when GitHub
// itself attests its author's relationship to the repo (`authorAssociation`
// from `gh ... --json comments`, `author_association` from the REST API) —
// the same mitigation `materialize.js` applies to a record's `Premise-check:`
// line, now shared so every marker reader asks the same question.
//
// Fail closed: a comment with neither field is untrusted. An untrusted marker
// comment takes the same path as "no such comment" — never the trusted path.
// No viewer lookup (`viewerDidAuthor`) and no per-transport identity: the
// association alone decides.
//
// Skill prose that cannot `require` this module pastes `trustedJqSelect()` /
// `untrustedJqNote()` verbatim; both are built from the set below so the jq
// text and the code cannot drift. The pasted filters read either spelling
// (`authorAssociation` or `author_association`), so a gh-shaped and a
// REST/MCP-shaped comment are judged alike. The contract is
// `_shared/pr-run-comments.md`'s Trusted authors section.

// Order is part of the contract — the jq builders below emit it as listed.
const TRUSTED_AUTHOR_ASSOCIATIONS = new Set(['OWNER', 'MEMBER', 'COLLABORATOR']);

// comment: a `gh --json comments` element (camelCase `authorAssociation`) or a
// REST comment (snake_case `author_association`); null/undefined tolerated.
// Returns the association string, or null when neither field is a non-empty
// string.
function commentAssociation(comment) {
  if (!comment || typeof comment !== 'object') return null;
  for (const value of [comment.authorAssociation, comment.author_association]) {
    if (typeof value === 'string' && value !== '') return value;
  }
  return null;
}

// Exact, case-sensitive membership — GitHub emits the enum upper-case, so
// `'member'` is not a GitHub value and stays untrusted.
function isTrustedComment(comment) {
  const association = commentAssociation(comment);
  return association !== null && TRUSTED_AUTHOR_ASSOCIATIONS.has(association);
}

// The note a reader emits for each skipped comment. {ref} = `url` (gh) /
// `html_url` (REST) / `id` fallback / 'unknown'; {login} = `author.login` (gh) /
// `user.login` (REST) / 'unknown'; {association} = the value or
// 'no association'.
function untrustedSkipNote(comment) {
  const c = comment && typeof comment === 'object' ? comment : {};
  const ref = c.url || c.html_url || c.id || 'unknown';
  const login = (c.author && c.author.login) || (c.user && c.user.login) || 'unknown';
  const association = commentAssociation(c) || 'no association';
  return `skipped marker comment ${ref} by ${login} (${association}) — not an owner, member, or collaborator`;
}

// jq predicate over a `gh --json comments` element or a REST/MCP comment, built
// from the set in its order: `(.authorAssociation // .author_association) ==
// "OWNER" or ... or ...`. Both spellings are read; jq's `//` passes `""`
// through, so a comment carrying an empty camelCase field beside a snake_case
// one is untrusted in jq but trusted by isTrustedComment — no transport emits
// both fields, and the divergence fails closed.
function trustedJqPredicate() {
  return [...TRUSTED_AUTHOR_ASSOCIATIONS].map((a) => `(.authorAssociation // .author_association) == "${a}"`).join(' or ');
}

// jq filter keeping only trusted comments — paste verbatim into a pipeline.
function trustedJqSelect() {
  return `select(${trustedJqPredicate()})`;
}

// jq filter emitting the skip note for each untrusted comment (either shape;
// a missing association prints as "no association", a deleted author as
// "unknown"). Same text as untrustedSkipNote's output, including the REST
// fallbacks (`html_url`, `id`, `user.login`, `author_association`).
function untrustedJqNote() {
  return `select((${trustedJqPredicate()}) | not) | "skipped marker comment \\(.url // .html_url // .id // "unknown") by \\(.author.login // .user.login // "unknown") (\\(.authorAssociation // .author_association // "no association")) — not an owner, member, or collaborator"`;
}

module.exports = {
  TRUSTED_AUTHOR_ASSOCIATIONS,
  commentAssociation,
  isTrustedComment,
  untrustedSkipNote,
  trustedJqSelect,
  untrustedJqNote,
};
