// bin/lib/issues/record-comments.js
// The batched record-comment read behind /dispatch's `driver-lane` queue-pull
// exclusion (#6119): ONE aliased GraphQL call returns the last 100 comments of
// each record the exclusion would drop, so the pass can spare one carrying the
// driver's trusted escalation marker (driver/settle.js's
// hasDriverEscalationMarker, which reads `authorAssociation` and `body`).
// Same shape as linked-prs.js — injectable runner, -f for the already-resolved
// owner/repo String! variables (never -F, gh-api-module-pattern's flag table),
// --hostname for a non-github.com host — with one deliberate difference in
// failure posture: a missing `i{n}` alias leaves that number out of the Map
// instead of throwing, because the caller reads an absent entry as "comments
// unread" and leaves the record selectable (fails toward the session
// drain). A missing `repository` still throws, naming the numbers: nothing
// was read at all. Not pure (network via the injected runner).
'use strict';

// numbers -> the aliased query string, or null for an empty list. Comment
// nodes keep `body`, `authorAssociation`, `url` and `author{login}` exactly as
// GitHub returns them; `totalCount` lets the caller tell a truncated read
// (more than the last 100 comments) from a complete one.
function buildRecordCommentsQuery(numbers) {
  if (!Array.isArray(numbers) || numbers.length === 0) return null;
  const issues = numbers
    .map((n) => `i${n}: issue(number: ${n}) { comments(last: 100) { totalCount nodes { body authorAssociation url author { login } } } }`)
    .join(' ');
  return `query($owner:String!,$repo:String!){ repository(owner:$owner,name:$repo){ ${issues} } }`;
}

// { numbers, owner, repo, host, runner } -> Map<number, { comments: object[],
// complete: boolean }>. `complete` is `totalCount === nodes.length`.
function fetchRecordComments({
  numbers, owner, repo, host, runner,
} = {}) {
  const result = new Map();
  const query = buildRecordCommentsQuery(numbers);
  if (!query) return result;
  const args = ['api', 'graphql', '-f', `query=${query}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`];
  if (host && host !== 'github.com') args.push('--hostname', host);
  const parsed = JSON.parse(runner(args));
  const repository = parsed && parsed.data && parsed.data.repository;
  if (!repository) {
    const errs = Array.isArray(parsed && parsed.errors) ? parsed.errors.map((e) => e && e.message).filter(Boolean) : [];
    const suffix = errs.length ? ` (GraphQL: ${errs.join('; ')})` : '';
    throw new Error(`missing repository — no record-comment data for ${numbers.map((n) => `#${n}`).join(', ')}${suffix}`);
  }
  for (const n of numbers) {
    const issue = repository[`i${n}`];
    const connection = issue && issue.comments;
    if (!connection || !Array.isArray(connection.nodes)) continue;
    result.set(n, { comments: connection.nodes, complete: connection.totalCount === connection.nodes.length });
  }
  return result;
}

module.exports = { buildRecordCommentsQuery, fetchRecordComments };
