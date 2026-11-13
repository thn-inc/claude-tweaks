'use strict';
// tests/helpers/stale-claim-host-pins.js — #4794: the pinned `{host}` wording and the whitespace-flattened
// prose probes tests/issue-claims-stale-open-pr-conformance.test.js and
// tests/tidy-stale-claim-open-pr-conformance.test.js share. A wording change to the `{host}` definition
// in plugin/skills/_shared/issue-claims.md is made once, in HOST_DEFINITION here; the tidy suite's
// citationProblems check passes without checking anything if its copy of the sentence drifts, so the two
// suites must never carry their own.
const assert = require('node:assert/strict');

const HOST_DEFINITION = '`{host}` is the GitHub host the record lives on: `github.com` on the GitHub MCP path; on the `gh` path an exported non-empty `GH_HOST`, else the origin\'s host when it is `github.com` or a known GitHub Enterprise host (a `*.ghe.com` host, or a host key in `gh`\'s `hosts.yml`), else `github.com`.';
const MCP_LISTING_REPO = '`--listing "{that path}"` and `--repo "github.com/{owner}/{repo}"`';
const EXIT3_REPO = '--repo "{host}/{owner}/{repo}"';

// The first inline span that runs bin/stale-claim-pr.js, whitespace-flattened. `where` names the prose
// under test in the failure message ("step 4", "the section").
function firstInvocation(flat, where) {
  const at = flat.indexOf('bin/stale-claim-pr.js');
  assert.notEqual(at, -1, `${where} names the CLI`);
  const open = flat.lastIndexOf('`', at);
  const close = flat.indexOf('`', at);
  assert.ok(open !== -1 && close !== -1, 'the invocation is an inline code span');
  return flat.slice(open + 1, close);
}

// The sentence (text from the previous ". " to the pin) that carries the exit-3 re-run's --repo.
function exit3Sentence(flat) {
  const at = flat.indexOf(EXIT3_REPO);
  assert.notEqual(at, -1, 'the exit-3 re-run adds a host-qualified --repo');
  return flat.slice(flat.lastIndexOf('. ', at) + 2, at);
}

// The MCP listing leg's problems on whitespace-flattened prose. `checkReason` adds the one check only the
// issue-claims suite owns: the sentence explaining why the listing leg carries the MCP's host.
function listingLegProblems(flat, { checkReason = false } = {}) {
  const problems = [];
  const at = flat.indexOf(MCP_LISTING_REPO);
  if (at === -1) problems.push('missing');
  else {
    if (flat.indexOf(MCP_LISTING_REPO, at + 1) !== -1) problems.push('twice');
    if (at < flat.indexOf('mcp__github__list_pull_requests')) problems.push('before the MCP listing');
  }
  if (flat.split('"github.com/{owner}/{repo}"').length - 1 !== 1) problems.push('host carried by a call other than the listing leg');
  if (checkReason && !/the MCP's host, so listing and match share one host/.test(flat)) problems.push('reason');
  return problems;
}

module.exports = { HOST_DEFINITION, MCP_LISTING_REPO, EXIT3_REPO, firstInvocation, exit3Sentence, listingLegProblems };
