// plugin/bin/lib/git-z.js — parsers for git's `-z` (NUL-delimited) output,
// shared by the readers that turn a git path list into file paths. Without
// `-z`, git C-quotes any path containing a non-ASCII byte (`core.quotepath`,
// on by default: `docs/café.md` prints as "docs/caf\303\251.md"), a tab, or a
// newline, so a line-split reader sees a quoted string no file matches. With
// `-z` the paths are printed raw, delimited only by NUL — which cannot occur
// in a path. These helpers split such a stream; the reader contract (which
// commands, which flags, how a caller opts in) is in
// skills/_shared/git-path-read.md.
'use strict';

// splitNul(raw): every non-empty NUL-delimited token, in order. null, undefined
// and '' yield []. Tokens are returned verbatim — no trimming, so a path with
// leading or trailing spaces survives.
function splitNul(raw) {
  if (raw == null || raw === '') return [];
  return String(raw).split('\0').filter((t) => t !== '');
}

// parseNameStatusZ(raw): `git diff --name-status -z` / `diff-tree -r -z`
// — "STATUS\0path\0" per record, "STATUS\0old\0new\0" for a rename or copy
// (status starts with R or C, e.g. "R100"). `status` is returned verbatim.
function parseNameStatusZ(raw) {
  const tokens = splitNul(raw);
  const records = [];
  let i = 0;
  while (i < tokens.length) {
    const status = tokens[i];
    const width = status[0] === 'R' || status[0] === 'C' ? 2 : 1;
    records.push({ status, paths: tokens.slice(i + 1, i + 1 + width) });
    i += 1 + width;
  }
  return records;
}

// splitLogZ(raw, isHeader): `git log -z --format=<header> --name-only` (or
// --name-status) — a flat NUL stream in which each commit contributes one
// header token followed by its path (or status/path) tokens. isHeader(token)
// recognizes a header; tokens before the first header are dropped. git
// separates the header from the commit's files with one '\n', which lands on
// the first token after the header, so that single leading '\n' is removed
// BEFORE the header test — an empty commit's trailing '\n' therefore rides
// onto the next header without hiding it.
function splitLogZ(raw, isHeader) {
  const records = [];
  let current = null;
  let first = false;
  for (let token of splitNul(raw)) {
    if (first) {
      if (token[0] === '\n') token = token.slice(1);
      first = false;
    }
    if (token === '') continue;
    if (isHeader(token)) {
      current = { header: token, tokens: [] };
      records.push(current);
      first = true;
    } else if (current) {
      current.tokens.push(token);
    }
  }
  return records;
}

module.exports = { splitNul, parseNameStatusZ, splitLogZ };
