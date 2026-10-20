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
  if (raw == null) return [];
  return String(raw).split('\0').filter((t) => t !== '');
}

// parseNameStatusTokens(tokens): status/path tokens of a `--name-status -z`
// stream -> [{ status, paths }]. A rename or copy (status starts with R or C,
// e.g. "R100") carries two paths, every other status one. `status` is returned
// verbatim; a truncated tail yields fewer paths.
function parseNameStatusTokens(tokens) {
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

// parseNameStatusZ(raw): `git diff --name-status -z` / `diff-tree -r -z`
// — "STATUS\0path\0" per record, "STATUS\0old\0new\0" for a rename or copy.
function parseNameStatusZ(raw) {
  return parseNameStatusTokens(splitNul(raw));
}

// splitLogZ(raw, isHeader): `git log -z --format=<header> --name-only` (or
// --name-status) — a flat NUL stream in which each commit contributes one
// header token followed by its path (or status/path) tokens. isHeader(token)
// recognizes a header; tokens before the first header are dropped. For a commit
// that lists files, git separates the header from them with one '\n', which
// lands on the first path/status token after the header; that single leading
// '\n' is removed. An empty commit's header is followed directly by the next
// header (no '\n'); stripping before the header test is only defensive, so a
// stray leading '\n' cannot hide a header.
function splitLogZ(raw, isHeader) {
  const records = [];
  let current = null;
  let afterHeader = false;
  for (let token of splitNul(raw)) {
    if (afterHeader) {
      if (token[0] === '\n') token = token.slice(1);
      afterHeader = false;
    }
    if (token === '') continue;
    if (isHeader(token)) {
      current = { header: token, tokens: [] };
      records.push(current);
      afterHeader = true;
    } else if (current) {
      current.tokens.push(token);
    }
  }
  return records;
}

// A numstat count field: "-" (binary file) and anything non-numeric become 0.
function parseNumstatCount(field) {
  return field === '-' ? 0 : Number.parseInt(field, 10) || 0;
}

// parseNumstatZ(raw): `git diff --numstat -z` — "ADD\tDEL\tpath\0" per record,
// "ADD\tDEL\t\0old\0new\0" for a rename or copy (the empty third field marks it
// and the two paths follow as their own tokens). The path is everything after
// the second tab, so a tab inside a path survives. A binary file prints "-" for
// both counts; they become 0. Returns [{ path, oldPath?, additions, deletions }]
// — oldPath is omitted unless the record is a rename or copy.
function parseNumstatZ(raw) {
  const tokens = splitNul(raw);
  const records = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    const firstTab = token.indexOf('\t');
    const secondTab = firstTab < 0 ? -1 : token.indexOf('\t', firstTab + 1);
    if (secondTab < 0) { i += 1; continue; }
    const additions = parseNumstatCount(token.slice(0, firstTab));
    const deletions = parseNumstatCount(token.slice(firstTab + 1, secondTab));
    const rest = token.slice(secondTab + 1);
    if (rest === '') {
      if (i + 2 >= tokens.length) break; // truncated rename tail
      records.push({ path: tokens[i + 2], oldPath: tokens[i + 1], additions, deletions });
      i += 3;
    } else {
      records.push({ path: rest, additions, deletions });
      i += 1;
    }
  }
  return records;
}

// parseStatusPorcelainZ(raw): `git status --porcelain -z` — "XY path\0" per
// record. A rename or copy (R or C in either status column) is followed by the
// original path as its own token, new path first: "R  new\0old\0". `xy` is the
// two status characters verbatim. Returns [{ xy, path, origPath? }] — origPath
// is omitted unless the record is a rename or copy.
function parseStatusPorcelainZ(raw) {
  const tokens = splitNul(raw);
  const records = [];
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    i += 1;
    if (token.length < 4) continue;
    const xy = token.slice(0, 2);
    const record = { xy, path: token.slice(3) };
    if (/[RC]/.test(xy) && i < tokens.length) {
      record.origPath = tokens[i];
      i += 1;
    }
    records.push(record);
  }
  return records;
}

// parseLsTreeZ(raw): `git ls-tree -z` (full format, no --name-only) —
// "<mode> SP <type> SP <sha> TAB <path>\0" per record. The path is everything
// after the first TAB; a record with no TAB is skipped. Returns
// [{ mode, type, sha, path }].
function parseLsTreeZ(raw) {
  const records = [];
  for (const token of splitNul(raw)) {
    const tab = token.indexOf('\t');
    if (tab < 0) continue;
    const [mode, type, sha] = token.slice(0, tab).split(' ');
    records.push({ mode, type, sha, path: token.slice(tab + 1) });
  }
  return records;
}

// unquoteCPath(s): decodes a path that git C-quoted (what a command prints
// without `-z`, or what a patch header carries): a string wrapped in double
// quotes whose body uses \\ \" \a \b \t \n \v \f \r and \NNN octal bytes. The
// escapes are collected as bytes and UTF-8-decoded, so "caf\303\251" is "café".
// A string not wrapped in double quotes is returned unchanged.
const C_ESCAPES = { a: 7, b: 8, t: 9, n: 10, v: 11, f: 12, r: 13, '\\': 92, '"': 34 };
function unquoteCPath(s) {
  if (typeof s !== 'string' || s.length < 2 || s[0] !== '"' || s[s.length - 1] !== '"') return s;
  const body = s.slice(1, -1);
  const bytes = [];
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== '\\') {
      const cp = body.codePointAt(i);
      bytes.push(...Buffer.from(String.fromCodePoint(cp)));
      if (cp > 0xffff) i += 1;
      continue;
    }
    const octal = /^[0-7]{1,3}/.exec(body.slice(i + 1, i + 4));
    if (octal) {
      bytes.push(Number.parseInt(octal[0], 8) & 0xff);
      i += octal[0].length;
    } else if (Object.hasOwn(C_ESCAPES, body[i + 1])) {
      bytes.push(C_ESCAPES[body[i + 1]]);
      i += 1;
    } else {
      bytes.push(92); // lone or unknown backslash: keep it literally
    }
  }
  return Buffer.from(bytes).toString('utf8');
}

module.exports = {
  splitNul, parseNameStatusTokens, parseNameStatusZ, splitLogZ,
  parseNumstatZ, parseStatusPorcelainZ, parseLsTreeZ, unquoteCPath,
};
