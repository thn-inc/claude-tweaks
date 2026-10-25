// bin/lib/hooks/git-command.js
'use strict';
const path = require('path');

// Quote-aware top-level split: a single pass tracks single/double-quote state
// and only cuts at separators (&&, ||, ;, |, newline) that are outside any
// quote span. Newline is a segment boundary because gitTargets only ever
// inspects t[0] of each segment to detect a `cd`/`git` command — a bare
// newline (not `&&`/`;`) between two statements otherwise merges them into
// one segment, silently hiding a `cd` that isn't the segment's first token
// (e.g. `VAR="x"\ncd "$VAR" && git commit` — the `cd` never gets seen, so
// the effective cwd used for the commit target stays whatever it was before
// this segment, not where the command will actually run).
// This protects the safety invariant — ambiguity resolves to allow — by
// preventing quoted text (e.g. a commit message containing "&& git -C /x push")
// from being misparsed as additional shell segments that fabricate a target.
function splitSegments(command) {
  const str = String(command || '');
  const segments = [];
  let current = '';
  let quote = null; // null | '"' | "'"
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote === "'") {
      // Inside single quotes, backslash has no special meaning in bash.
      current += ch;
      if (ch === "'") quote = null;
      continue;
    }
    // Not inside single quotes (unquoted or inside double quotes): a
    // backslash escapes the next character, so `\"` never toggles quote
    // state and `\\` is a literal backslash — matching bash semantics.
    if (ch === '\\' && i + 1 < str.length) {
      current += ch + str[i + 1];
      i += 1;
      continue;
    }
    if (quote === '"') {
      current += ch;
      if (ch === '"') quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === '&' && str[i + 1] === '&') { segments.push(current); current = ''; i += 1; continue; }
    if (ch === '|' && str[i + 1] === '|') { segments.push(current); current = ''; i += 1; continue; }
    // `>|` is bash's noclobber-override redirect operator, not a pipe — a
    // glued `|` immediately after `>` (#3080) must not fabricate a segment
    // break here, or the operator token never reaches the tokenizer whole.
    if (ch === '|' && current.endsWith('>')) { current += ch; continue; }
    if (ch === ';' || ch === '|' || ch === '\n') { segments.push(current); current = ''; continue; }
    // Unquoted `#` at the start of a word begins a bash comment that runs to
    // the end of the line — real bash never executes anything after it, so
    // any &&/;/| inside it must not fabricate a segment boundary. Only
    // recognized at a word boundary (start of string, or immediately after
    // whitespace/a separator) to match bash's own rule: `#` glued to
    // preceding non-whitespace text (e.g. `foo#bar`) is NOT a comment.
    if (ch === '#' && (i === 0 || /[\s;&|]/.test(str[i - 1]))) {
      let j = i + 1;
      while (j < str.length && str[j] !== '\n') j++;
      i = j - 1; // for-loop's i++ lands exactly on the newline (or end of string)
      continue;
    }
    current += ch;
  }
  segments.push(current);
  return segments;
}

function stripQuotes(s) {
  return s.replace(/^['"]|['"]$/g, '');
}

// Tokenizer that keeps quoted spans (with spaces) as one token. Also merges a
// quoted span into an immediately-adjacent (no whitespace between) match —
// matching real shell word-splitting, where `"/tmp/safe/"$SUFFIX` is ONE word
// (`/tmp/safe/<value-of-$SUFFIX>`), not two. Without this, resolveCd/isUnresolvable
// only ever see the quoted portion in isolation, judge it fully resolvable, and
// silently drop the unresolvable suffix that would otherwise poison the target.
//
// Returns `{ tokens, singleQuoted, doubleQuoted, spanKinds }` — `singleQuoted[i]` is true
// when any part of `tokens[i]` was assembled from a single-quoted span, and
// `doubleQuoted[i]` likewise for a double-quoted span (#4015: the redirect scan
// treats a `>` in either as literal text). Real bash never performs
// `$`-expansion inside single quotes (unlike double quotes or bare words), so
// this flag is what lets substituteVars() below refuse to treat a
// single-quoted `'$NAME'` as a variable reference — without it, a token like
// `'$WT/a.js'` and `"$WT/a.js"` are indistinguishable post-tokenize, and the
// substitution step would wrongly expand the single-quoted (never-expanded)
// form, fabricating a target real bash would never produce for that command.
//
// `spanKinds[i]` (#4210) is a string exactly as long as `tokens[i]`, one character
// per character of the token: `b` bare, `e` backslash-escaped (the `\` and the
// character it escapes, in a bare span), `s` single-quoted, `d` double-quoted, `x`
// stray (an unterminated quote character or a lone trailing backslash). Quote
// delimiters are not part of the token, so they carry no mask character. The
// per-token flags above say only THAT a span was quoted; the mask says WHERE, which
// is what lets the glued-redirect scan accept `echo "hi">x` yet refuse `echo "a>b"`.
// Two changes to the token regex make the mask truthful: a bare run now stops at a quote
// (so `foo"bar"` is a bare span plus a double-quoted span, merged into one token as
// bash does), and a double-quoted span is backslash-aware (`\"` does not close it,
// and its value keeps the backslashes as typed).
function tokenize(seg) {
  const out = [];
  const singleQuoted = [];
  const doubleQuoted = [];
  const spanKinds = [];
  const re = /"((?:[^"\\]|\\[\s\S])*)"|'([^']*)'|((?:\\[\s\S]|[^\s"'\\])+)|(\S)/g;
  let m;
  let prevEnd = -1;
  while ((m = re.exec(seg)) !== null) {
    const val = m[1] ?? m[2] ?? m[3] ?? m[4];
    const isSQ = m[2] !== undefined;
    const isDQ = m[1] !== undefined;
    const isBare = m[3] !== undefined;
    let kinds;
    if (isDQ) kinds = 'd'.repeat(val.length);
    else if (isSQ) kinds = 's'.repeat(val.length);
    else if (isBare) kinds = val.replace(/\\[\s\S]|[\s\S]/g, (u) => (u.length === 2 ? 'ee' : 'b'));
    else kinds = 'x';
    if (out.length && m.index === prevEnd) {
      out[out.length - 1] += val;
      spanKinds[spanKinds.length - 1] += kinds;
      if (isSQ) singleQuoted[singleQuoted.length - 1] = true;
      if (isDQ) doubleQuoted[doubleQuoted.length - 1] = true;
    } else {
      out.push(val);
      spanKinds.push(kinds);
      singleQuoted.push(isSQ);
      doubleQuoted.push(isDQ);
    }
    prevEnd = re.lastIndex;
  }
  return { tokens: out, singleQuoted, doubleQuoted, spanKinds };
}

// Global git flags that consume the NEXT token as a value.
const VALUE_FLAGS = new Set(['-C', '-c', '--exec-path', '--namespace']);
// Flags that make the target unprovable from the command text alone.
const UNPROVABLE_FLAGS = ['--git-dir', '--work-tree'];

// A raw (unquote-stripped) cd/-C argument that is unresolvable to a concrete,
// literal path: no argument, "-", starts with "~", contains "$"/backtick, or
// contains a backslash/double-quote. The last two guard against token-level
// ambiguity: the tokenizer above is escape-aware, but it keeps backslashes in
// the token text as typed, so a value that still carries a backslash or stray
// quote (from an escaped-quote sequence) cannot be trusted as a literal path —
// never claim an unprovable target. Also unresolvable: anything else that looks
// like a FLAG (starts with "-", length > 1) — cd's own flags (-L, -P, -e, -@,
// --) are not path arguments; without this, `cd -P /other-repo` would resolve
// "-P" itself as a literal (almost certainly nonexistent) child directory of
// the current cwd instead of recognizing the real target is unprovable from here.
function isUnresolvable(raw) {
  return (
    raw === undefined ||
    raw === '-' ||
    (raw.length > 1 && raw.startsWith('-')) ||
    raw.startsWith('~') ||
    raw.includes('$') ||
    raw.includes('`') ||
    raw.includes('\\') ||
    raw.includes('"')
  );
}

function isAbsolutePlain(raw) {
  return !isUnresolvable(raw) && path.isAbsolute(raw);
}

// Shared cd-token resolution used by both gitTargets and fileWriteTargets: given
// the current effective cwd (string, or null meaning UNKNOWN) and a `cd`
// command's raw (unquote-stripped) argument, returns the new effective cwd (or
// null when the argument leaves it unprovable). Kept as one function so a
// future fix to cd-resolution edge cases (a new isUnresolvable pattern,
// pushd/popd support, etc.) can never land in one caller and not the other.
function resolveCd(effCwd, raw) {
  if (isUnresolvable(raw)) return null;
  if (effCwd === null) {
    // Unknown cwd: only a plain absolute path restores provability.
    return isAbsolutePlain(raw) ? path.resolve(raw) : null;
  }
  return path.resolve(effCwd, stripQuotes(raw));
}

// Matches a segment that is exactly one token shaped like a simple literal
// variable assignment: NAME=value / NAME="value" / NAME='value' (bash
// permits no space around `=`). A quoted value may hold a space —
// `NAME="a b"` is one token and is tracked — but an unquoted, unescaped space
// (`NAME=a b`) tokenizes into more than one token, which the length check in
// updateAssignment below excludes; that's an accepted narrowing, not a bug,
// since bash reads it as an assignment prefix on command `b`. No `export`, no arrays:
// `export SP=/x` tokenizes to two tokens (`export`, `SP=/x`) and fails the
// length check before this regex ever runs, so `export` needs no separate
// rejection.
const SIMPLE_ASSIGNMENT_RE = /^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/;

// Classifies raw (pre-substitution) token array `t` as a simple same-command
// assignment and updates `vars` in place; returns whether it was one (the
// caller `continue`s past handler/cd on true, the same way an existing `cd`
// segment already does). A later assignment of the same name overwrites the
// earlier one; an assignment whose OWN value is unresolvable DELETES any
// earlier mapping for that name rather than leaving it in place — the
// variable's value genuinely changed, so continuing to substitute the stale
// earlier value would itself be a fabricated-target risk, the exact thing
// this module's fail-open posture exists to avoid. Deliberately reads the
// RAW (pre-substitution) token, never the substituted one — this is what
// keeps a chained reference (`B=$A/y`) from ever resolving through a second
// hop: `$A/y`'s raw value still contains `$`, so isUnresolvable rejects it
// here, before substitution would otherwise have had a chance to touch it.
function updateAssignment(vars, t) {
  if (t.length !== 1) return false;
  const m = SIMPLE_ASSIGNMENT_RE.exec(t[0]);
  if (!m) return false;
  const [, name, rawValue] = m;
  const value = stripQuotes(rawValue);
  if (isUnresolvable(value)) vars.delete(name);
  else vars.set(name, value);
  return true;
}

// Matches a token's $NAME / ${NAME} reference.
const VAR_REF_RE = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

// Substitutes a same-command literal assignment into a token, deliberately
// narrow: only a token whose $/backtick content is EXACTLY one $NAME or
// ${NAME} reference to an already-tracked name is rewritten; anything else
// (an unassigned name, a second $ or a backtick elsewhere in the token) is
// returned unchanged and falls through to the existing
// isUnresolvable()/null-target behavior unmodified. Never recursive — the
// substituted value is a literal already proven not to contain `$` (by
// updateAssignment's own isUnresolvable check at assignment time), so there
// is nothing left to re-scan.
function substituteVars(tokens, vars, singleQuoted, spanKinds) {
  if (!vars.size) return tokens;
  return tokens.map((tok, i) => {
    // Real bash never expands `$NAME` inside single quotes — a token built
    // from a single-quoted span is never a variable reference, regardless of
    // its text. Skip it untouched; it falls through to the existing
    // isUnresolvable()/null-target behavior unmodified (see tokenize()'s
    // singleQuoted comment for why this guard exists). With the per-character
    // span mask (#4210) the test is on the `$` itself, below, so `'hi'>$WT/x`
    // still expands its bare `$WT`; without a mask, any single-quoted span skips.
    const kinds = spanKinds && spanKinds[i];
    if (!kinds && singleQuoted && singleQuoted[i]) return tok;
    if (!tok.includes('$') || tok.includes('`')) return tok;
    const matches = [...tok.matchAll(VAR_REF_RE)];
    if (matches.length !== 1) return tok;
    if ((tok.match(/\$/g) || []).length !== 1) return tok;
    const m = matches[0];
    // A `$` inside single quotes, or backslash-escaped, is literal text.
    if (kinds && (kinds[m.index] === 's' || kinds[m.index] === 'e')) return tok;
    const name = m[1] || m[2];
    if (!vars.has(name)) return tok;
    return tok.slice(0, m.index) + vars.get(name) + tok.slice(m.index + m[0].length);
  });
}

// Shared segment/token walk used by both gitTargets and fileWriteTargets:
// splits the command into shell segments, tokenizes each, and tracks `cd` to
// keep the effective cwd in sync. `handler(t, effCwd, quoting)` is invoked for
// every non-cd, non-empty segment with the cwd value in effect for it (string,
// or null meaning UNKNOWN); `quoting` is `{ raw, singleQuoted, doubleQuoted, spanKinds, nestAt }`,
// the pre-substitution tokens, their per-token quote flags (#4015), their
// per-character span kinds (#4210, see tokenize), and the nesting state at each
// token's start (#4210, see advanceNesting). The nesting state carries across
// segments, every segment included (cd and assignment ones too): splitSegments cuts
// at a `|`/`;`/newline inside an inner quote of `"$( … )"`, and the nested context
// must survive that cut. Also
// tracks same-command literal `NAME=value` assignments (see
// updateAssignment/substituteVars above) and substitutes them into every other
// segment's tokens before `handler`/the `cd` branch sees them — one shared
// point so a future fix to either cd-resolution or assignment-substitution can
// never land in one caller's copy of this preamble and not the other's.
function forEachCommandSegment(command, cwd, handler) {
  let effCwd = cwd || '.'; // string, or null meaning UNKNOWN
  const vars = new Map(); // name -> literal value, same-command only, no chaining
  let nest = NOT_NESTED;
  for (const seg of splitSegments(command)) {
    const { tokens: rawT, singleQuoted, doubleQuoted, spanKinds } = tokenize(seg.trim());
    const nestAt = rawT.map((tok, i) => {
      const at = nest;
      nest = advanceNesting(nest, tok, spanKinds[i], tok.length);
      return at;
    });
    if (!rawT.length) continue;
    if (updateAssignment(vars, rawT)) continue;
    const t = substituteVars(rawT, vars, singleQuoted, spanKinds);
    // `FOO=1 cd /path` really does change the shell's cwd — a preceding
    // assignment on a regular (non-special) builtin like `cd` is scoped only
    // to that command's own execution environment, but `cd` has no
    // subprocess to scope the env change to, so it still runs and changes
    // the CURRENT shell's cwd (verified empirically; #590). `env cd /path`
    // is the opposite case and deliberately NOT normalized here: `env` execs
    // an external `cd` binary that does not exist on a normal system, so it
    // errors and never changes cwd — normalizing it would fabricate a target
    // for a shape that has no real effect.
    let cdLead = 0;
    while (cdLead < t.length && SIMPLE_ASSIGNMENT_RE.test(t[cdLead])) cdLead += 1;
    if (t[cdLead] === 'cd') {
      effCwd = resolveCd(effCwd, t[cdLead + 1]);
      continue;
    }
    handler(t, effCwd, { raw: rawT, singleQuoted, doubleQuoted, spanKinds, nestAt });
  }
}

// Consumes every leading global git flag (-C <dir>, -c <k>=<v>, --exec-path,
// --namespace, --git-dir, --work-tree, and any other unrecognized `-...`
// flag) starting at token index `i`, resolving -C against `dir` the same way
// gitTargets always has. Returns the index of the first non-flag token (the
// subcommand), the resolved dir (or null if UNKNOWN), and whether the
// target became unprovable. Shared by gitTargets and teardownTargets so a
// future global-flag fix lands once for both instead of drifting between two
// hand-kept copies — teardownTargets used to check only a literal `-C`
// immediately after `git`, so any other global flag (`-c ...`, `--no-pager`,
// etc.) ahead of `worktree remove` defeated its parser entirely and silently
// allowed tearing down a worktree still assigned to a non-terminal run.
function skipGlobalFlags(t, i, dir, pathImpl = path) {
  let unprovable = false;
  while (i < t.length && t[i].startsWith('-')) {
    const flag = t[i];
    if (UNPROVABLE_FLAGS.some((u) => flag === u || flag.startsWith(u + '='))) { unprovable = true; i += flag.includes('=') ? 1 : 2; continue; }
    // Use an explicit index-bound check (i + 1 < t.length), not a truthy
    // check on t[i + 1] — a truthy check treats a genuinely-present but
    // EMPTY value (`-C ""`, which real git treats as equivalent to
    // omitting -C entirely) as "no value follows", mis-consuming only the
    // flag token and leaving the leftover '' to be misread as the git
    // subcommand two lines below.
    if (flag === '-C' && i + 1 < t.length) {
      const raw = t[i + 1];
      if (raw === '') {
        // git leaves cwd unchanged for an empty -C, so `dir` stays verbatim.
        // Resolving it would normalize the string and hand the worktree gate
        // a different target than an omitted -C (e.g. `C:\repo` vs `/repo` on
        // Windows) — #3314.
      } else if (isUnresolvable(raw)) {
        unprovable = true;
      } else if (pathImpl.isAbsolute(raw)) {
        dir = pathImpl.resolve(raw);
      } else if (dir === null) {
        // Relative -C while cwd is UNKNOWN — cannot prove the target.
        unprovable = true;
      } else {
        dir = pathImpl.resolve(dir, raw);
      }
      i += 2;
      continue;
    }
    if (VALUE_FLAGS.has(flag) && i + 1 < t.length) { i += 2; continue; }
    i += 1;
  }
  return { index: i, dir, unprovable };
}

// Finds the real `git` command word in a segment's raw token array, looking
// past three equivalent shapes a real shell treats identically to a bare
// `git` invocation (#590):
//   - leading `NAME=value` assignment tokens: `FOO=1 git commit -m x`
//   - the `env` builtin, plus ITS OWN leading flags/assignments, ahead of the
//     real command: `env git commit -m x`, `env -i git commit -m x`,
//     `env FOO=1 git commit -m x`
//   - a directory-qualified executable ending in `/git`: `/usr/bin/git commit`
// (any combination of the three also resolves, e.g. `FOO=1 /usr/bin/git …`
// or `env FOO=1 /usr/bin/git …`.)
//
// Returns `{ index, dir, unprovable }` — `index` is -1 when, after
// normalization, the leading token still isn't `git` (ambiguity resolves to
// "not git", the same never-fabricate-a-target posture as the rest of this
// module). `dir` starts at the caller's effective cwd and moves when env's
// own `-C <dir>` / `--chdir[=]<dir>` flag changes where the command runs —
// skipping those flags without consuming their value made
// `env -C <main-checkout> git commit` read as not-git at all (the dir token
// became the presumed lead) and `env --chdir=/x git commit` resolve its
// target against the wrong directory. `-u`/`--unset <name>` likewise
// consumes its value so the name is never mistaken for the command word.
// Still not full env(1) parsing (see #590's Gotchas): `-S`/`--split-string`
// re-splits an opaque program string, which is statically unknowable — the
// same deliberately-uncovered class as `sh -c`/`python -c` (see
// fileWriteTargets' header) — so it falls through to the not-git default.
function findGitLead(t, dir) {
  let unprovable = false;
  let i = 0;
  while (i < t.length && SIMPLE_ASSIGNMENT_RE.test(t[i])) i += 1;
  if (t[i] === 'env') {
    i += 1;
    while (i < t.length) {
      const tok = t[i];
      if (SIMPLE_ASSIGNMENT_RE.test(tok)) { i += 1; continue; }
      if (tok === '-' || !tok.startsWith('-')) break;
      // Both spellings env accepts: separate value (`-C <dir>`, `--chdir <dir>`)
      // and attached value (`-C<dir>`, `--chdir=<dir>`). Skipping the attached
      // short form as a generic flag left the resolved dir at the caller's cwd
      // while git was still detected as lead — the same silent-allow bypass as
      // the separate form, one spelling over.
      if (tok === '-C' || tok === '--chdir' || tok.startsWith('--chdir=') || (tok.startsWith('-C') && tok.length > 2)) {
        const attached = tok.startsWith('--chdir=') ? tok.slice('--chdir='.length)
          : tok.startsWith('-C') && tok.length > 2 ? tok.slice(2)
          : null;
        const raw = attached !== null ? attached : t[i + 1];
        const resolved = resolveCd(dir, raw);
        if (resolved === null) unprovable = true;
        else dir = resolved;
        i += attached !== null ? 1 : 2;
        continue;
      }
      if (tok === '-u' || tok === '--unset') { i += 2; continue; }
      i += 1;
    }
  }
  if (i >= t.length) return { index: -1, dir, unprovable };
  const lead = t[i];
  if (lead === 'git' || lead.endsWith('/git')) return { index: i, dir, unprovable };
  return { index: -1, dir, unprovable };
}

// Shared findGitLead -> skipGlobalFlags preamble: resolves one command
// segment's real git lead and the subcommand position/dir past any global
// flags, in the one index/unprovable/dir-null check sequence both gitTargets
// and teardownTargets (pre-tool-use.js) need. Returns `{ index, dir }` (index
// is the resolved SUBCOMMAND token position) or null when the segment isn't
// git, or the target is unprovable / cwd-unknown-with-no-provable--C. A
// single shared point so a future fix to this preamble lands once for both
// callers instead of drifting between two hand-kept copies — the exact gap
// #1308 closed for teardownTargets, which used to skip this preamble
// entirely and check a bare `toks[0] !== 'git'` instead.
function resolveGitCommand(t, effCwd) {
  const lead = findGitLead(t, effCwd);
  if (lead.index === -1) return null;
  const { index, dir, unprovable } = skipGlobalFlags(t, lead.index + 1, lead.dir);
  if (lead.unprovable || unprovable || dir === null) return null;
  return { index, dir };
}

// #976 (IL-141): git-plumbing subcommands that mutate tracked state or refs
// OUTSIDE the commit/push pair gitTargets already classified — every one of
// these previously bypassed E1/worktree-always/pipeline-shadow enforcement
// entirely, since an unrecognized `sub` never became a target at all.
// Evidence-driven, deliberately narrow (see the Gotchas this closes): each
// entry is a subcommand that is UNAMBIGUOUSLY a write in every ordinary
// invocation, not merely capable of one under some flag combination.
//   - `mv`         — renames/moves a tracked file (index + working tree).
//   - `rm`          — removes a tracked file from the index (working tree
//                     too, unless `--cached`) — always a mutation, with or
//                     without `--cached`.
//   - `update-ref`  — directly rewrites a ref (a branch pointer) — pure
//                     plumbing, no read-only form.
//   - `apply`       — applies a patch to the working tree/index.
// Deliberately NOT included in this pass: `stash`, `reset`, `checkout`,
// `switch`, `restore`, `merge`, `rebase`, `cherry-pick`. Each has a common,
// genuinely read-only or non-mutating invocation shape (`stash list`/`show`,
// `reset` with no path args just moves HEAD's *reflog* pointer inside the
// SAME worktree it's run in and is routinely run from a script for its exit
// code alone, `checkout <branch>` with no path args, etc.) that a one-level
// subcommand check cannot distinguish from the mutating form without
// resolving a second token — the exact "pattern-matching every git
// subcommand indiscriminately" this record's own Gotchas warns against.
// Extend evidence-driven, on a real incident, not speculatively.
const PLUMBING_WRITE_SUBCOMMANDS = new Set(['mv', 'rm', 'update-ref', 'apply']);

// #2065: one shared traversal for every consumer that needs "every git
// invocation in this command, resolved" — checkGitStashWarn and gitTargets
// used to each run their own forEachCommandSegment + resolveGitCommand walk
// over the identical command/cwd, a second full quote-aware parse on the hot
// path (every Bash tool call, every session). This is the one walk; classification
// over its result (gitTargetsFrom below) is what tells "commit"/"push"/plumbing
// apart from "stash" apart from everything else — the traversal itself stays
// ignorant of which subcommand pre-tool-use.js's callers each care about.
function resolvedGitSegments(command, cwd) {
  const segments = [];
  forEachCommandSegment(command, cwd, (t, effCwd) => {
    const resolved = resolveGitCommand(t, effCwd);
    if (!resolved) return;
    segments.push({ tokens: t, index: resolved.index, dir: resolved.dir });
  });
  return segments;
}

// Pure classification over an already-resolved segment list — no traversal of
// its own. `gitTargets` below is the convenience wrapper kept for every
// existing caller (post-tool-use.js, tests) that still wants "parse and
// classify" in one call.
function gitTargetsFrom(segments) {
  const targets = [];
  for (const { tokens: t, index, dir } of segments) {
    const sub = t[index];
    if (sub === 'commit' || sub === 'push' || PLUMBING_WRITE_SUBCOMMANDS.has(sub)) {
      targets.push({ action: sub, dir });
    }
  }
  return targets;
}

function gitTargets(command, cwd) {
  return gitTargetsFrom(resolvedGitSegments(command, cwd));
}

// #3061: does this command invoke `powershell`/`pwsh` with `-Command` or
// `-EncodedCommand`? Both hand the interpreter literal (or base64) script
// text this module cannot read — the exact class `sh -c`/`python -c` already
// are, deliberately left unparsed (see fileWriteTargets' header just below).
// Unlike that class, this is the one PowerShell shape pre-tool-use.js's
// checkPowershellOpaqueCommand gate treats as a content-agnostic DENY rather
// than falling through to this module's usual "ambiguity resolves to allow"
// — so this function only has to answer "is the shape present", never try to
// read what the text contains. `-File <path>` alone (no -Command, no
// -EncodedCommand) is a plain script-path invocation — the same
// not-opaque-text category `bash script.sh` already falls into by never
// matching any guarded word at all — and this function does not flag it.
// Case-insensitive (Windows exe lookups and PowerShell's own flag matching
// both are); abbreviated flag forms (-Com, -EncodedCom, …) are deliberately
// NOT matched, the same narrow-miss posture every best-effort parser in this
// module already accepts in exchange for never fabricating a false deny.
const POWERSHELL_LEADS = new Set(['powershell', 'pwsh']);
const POWERSHELL_OPAQUE_FLAGS = new Set(['-command', '-encodedcommand']);
function powershellOpaqueCommand(command, cwd) {
  let found = false;
  forEachCommandSegment(command, cwd, (t) => {
    if (found || !t.length) return;
    let i = 0;
    while (i < t.length && SIMPLE_ASSIGNMENT_RE.test(t[i])) i += 1;
    if (i >= t.length) return;
    const lead = t[i].toLowerCase().replace(/\.exe$/, '');
    const cut = Math.max(lead.lastIndexOf('/'), lead.lastIndexOf('\\'));
    const base = cut >= 0 ? lead.slice(cut + 1) : lead;
    if (!POWERSHELL_LEADS.has(base)) return;
    for (let j = i + 1; j < t.length; j++) {
      if (POWERSHELL_OPAQUE_FLAGS.has(t[j].toLowerCase())) { found = true; return; }
    }
  });
  return found;
}

// Best-effort detection of non-git, non-Edit/Write direct file-write shapes in
// a Bash command. Every shape here is a word in GUARDED_PROGRAM_WORDS.write (below),
// from which bash-prefilter.js derives PRE_TOOL_USE_WORDS — so a shape added there
// is covered by construction. The pairing is the design constraint: a branch
// here whose command word the prefilter skips is dead code, because bin/hooks.js
// exits before the full handler loads; that asymmetry is exactly what let
// `sed -i` bypass the gate silently for months (#70). The differential corpus in
// tests/hooks-bash-prefilter.test.js pins the pairing against this parser (#3092).
//
// Still NOT covered, and deliberately (see the coverage block in
// skills/_shared/policy-schema-coverage.md for the measured rationale):
//   - `python -c`, `sh -c`, `awk` program strings — the write target lives
//     inside an opaque program and is not statically knowable at any cost.
//
// Bare shell redirection (`>`, `>>`, `>|`, `&>`, `&>>`, fd-prefixed `N>`/`N>>`)
// IS covered (#3080): redirectWriteTargets below scans every segment's token
// list regardless of t[0], since a redirection isn't gated by a command word
// the way the shapes above are. bash-prefilter.js's hasFileRedirection keeps
// the common `2>&1`/`> /dev/null` shapes on the skip path (#70's dead-code
// trap applies here too — a parser branch the prefilter never reaches for
// real traffic is dead).
//
// Ambiguity resolves to "no target" (allow), matching gitTargets' own safety
// posture: never fabricate a target from a path this can't prove.
const DEVNULL_LIKE = new Set(['/dev/null', '/dev/stdout', '/dev/stderr']);

function resolveWriteTarget(effCwd, raw) {
  if (isUnresolvable(raw)) return null;
  const stripped = stripQuotes(raw);
  // An explicitly-empty token is never a file. It reaches here as BSD sed's
  // separate backup suffix (`sed -i '' ...`); without this it would resolve to
  // effCwd itself and flag the whole directory as a write target.
  if (stripped === '') return null;
  if (DEVNULL_LIKE.has(stripped)) return null;
  if (path.isAbsolute(stripped)) return path.resolve(stripped);
  if (effCwd === null) return null; // cwd UNKNOWN and a relative path — not provable
  return path.resolve(effCwd, stripped);
}

// A redirection's RHS that is a file-descriptor duplication (`>&2`, `2>&1`),
// or an fd close/move (`>&-`, `>&3-`), never a file target — distinct from
// resolveWriteTarget's unresolvable set because the shape (a bare `&` followed
// by digits or `-`) is specific to redirection syntax and would otherwise read
// as a plausible-looking relative path.
function isFdDupTarget(raw) {
  return /^&(\d+-?|-)$/.test(raw);
}

// Matches a write-redirection operator at the START of a token, optionally
// fd-prefixed (`2>`, `1>>`) or in `&>`/`&>>` combined-stream form, capturing
// whatever follows the operator in the SAME token (a glued target, or '' for
// a standalone operator whose target is the next token). `<` (input
// redirection) and `>&N`/`N>&M` (fd duplication, handled by the caller once it
// has the full candidate target) are not matched as write operators here.
const REDIRECT_OP_RE = /^\d*(>>|>\||>)(.*)$/;
const AMP_REDIRECT_OP_RE = /^&(>>|>)(.*)$/;

function matchRedirectOperator(tok) {
  const m = REDIRECT_OP_RE.exec(tok) || AMP_REDIRECT_OP_RE.exec(tok);
  return m ? m[2] : null;
}

// One group: `(ls)`, `$(date)`, `<(b)` — no nesting, and no `$`, backtick, backslash, `<`, `>` or quote inside.
// Fd digits may follow the `)` (`(ls)2>x` is a subshell with a `2>` redirect).
const BALANCED_GROUP_RE = /^[$<]?\([^()\\$`<>"']*\)\d*$/;

// #4015/#4210: bash ends a word at an unquoted `>`, so `echo foo>x` redirects exactly
// like `echo foo > x`, and the word before it may hold quoted spans (`echo "hi">x`).
// `kinds` is the token's per-character span mask (tokenize): only a BARE `>` is an
// operator, so a `>` inside any quote or escaped stays literal. Returns the index just
// past the glued operator in `raw`, or null when the token holds none.
//
// The prefix before the operator is accepted only when every character is quoted
// (`s`/`d`), escaped (`e`: `foo\ bar>x` is the word `foo bar`), or bare and not `$`,
// backtick or `(` — each of those can put the `>` inside an expansion, and an unquoted
// `(` inside a bare word is only arithmetic (`((i>0))`, where `>` is a comparison),
// `$(`, `<(` or extglob syntax. A stray character in the prefix rejects it; ambiguity
// resolves to no target. A leading `>` (k === 0) is leadingRedirectOpEnd's case.
//
// The one exception is a prefix that is exactly one all-bare, un-nested group: it ends
// at its `)`, so the `>` after it is a redirect (BALANCED_GROUP_RE).
//
// `nest` is the nesting state at the token's start (advanceNesting); a `>` reached
// inside a nested context is quoted in bash, so it yields null.
function gluedRedirectOpEnd(raw, kinds, nest) {
  let k = 0;
  while (k < raw.length && !(raw[k] === '>' && kinds[k] === 'b')) k += 1;
  if (k === 0 || k === raw.length || isNested(advanceNesting(nest, raw, kinds, k))) return null;
  let plain = true;
  for (let j = 0; j < k; j += 1) {
    const kind = kinds[j];
    if (kind === 's' || kind === 'd' || kind === 'e') continue;
    if (kind === 'b' && !'$`('.includes(raw[j])) continue;
    plain = false;
    break;
  }
  if (!plain && !(kinds.slice(0, k) === 'b'.repeat(k) && BALANCED_GROUP_RE.test(raw.slice(0, k)))) return null;
  const second = raw[k + 1];
  const twoChar = (second === '>' || second === '|') && kinds[k + 1] === 'b';
  return k + (twoChar ? 2 : 1);
}

// #4210 F3: the start-anchored operator (`>`, `>>`, `>|`, `N>`, `&>`, `&>>`) read on the
// token as typed. Every operator character, fd digits and `&` included, must be bare: a
// quoted leading `>` (`echo ">x"`, `--body "> reply"`) is a word, and so is a `>` that a
// `$VAR` expands to. Returns the index just past the operator, or null.
function leadingRedirectOpEnd(raw, kinds, nest) {
  if (isNested(nest)) return null;
  let k = 0;
  const amp = raw[0] === '&' && kinds[0] === 'b';
  if (amp) k = 1;
  else while (k < raw.length && raw[k] >= '0' && raw[k] <= '9' && kinds[k] === 'b') k += 1;
  if (raw[k] !== '>' || kinds[k] !== 'b') return null;
  const second = raw[k + 1];
  const twoChar = (second === '>' || (second === '|' && !amp)) && kinds[k + 1] === 'b';
  return k + (twoChar ? 2 : 1);
}

// #4210 F1: a `$(`, `${` or backtick inside double quotes opens a nested context, and a
// `"` inside it starts a NEW quote that the tokenizer reads as closing the outer one —
// so a `>` bash keeps quoted (`echo "$(jq ".a>1" f)"`) gets kind `b`. Only the `d`
// characters are real shell syntax at that level, so the walk reads only them: `$(`/`${`
// open, a backtick toggles, and once nested a `(`/`{` opens, a `)`/`}` closes and a `'`
// starts a span whose parens are literal. A `\` skips the next `d` character.
// `stack` holds one character per open level: `c` for `$(` or `(`, `g` for a bare `{`,
// `p` for `${`. Inside a `${ … }` the `(`, `)`, `{` and `'` are literal word text
// (`"${x:-(}"`, `"${x:-it's}"`), so only a `}` closes it.
// Over-counting only leaves the state nested, which resolves no target.
function advanceNesting(nest, raw, kinds, end) {
  let { stack, tick, sq } = nest;
  for (let j = 0; j < end; j += 1) {
    if (kinds[j] !== 'd') continue;
    const c = raw[j];
    if (sq) { if (c === "'") sq = false; continue; }
    if (c === '\\') { if (kinds[j + 1] === 'd') j += 1; continue; }
    if (c === '`') tick = !tick;
    else if (c === '$' && (raw[j + 1] === '(' || raw[j + 1] === '{') && kinds[j + 1] === 'd') {
      stack += raw[j + 1] === '(' ? 'c' : 'p';
      j += 1;
    } else if (stack !== '' || tick) {
      const inParam = stack.endsWith('p');
      if (inParam) { if (c === '}') stack = stack.slice(0, -1); }
      else if (c === "'") sq = true;
      else if (stack !== '' && (c === '(' || c === '{')) stack += c === '(' ? 'c' : 'g';
      else if (stack !== '' && (c === ')' || c === '}')) stack = stack.slice(0, -1);
    }
  }
  return { stack, tick, sq };
}

function isNested(nest) {
  return nest.stack !== '' || nest.tick || nest.sq;
}

const NOT_NESTED = Object.freeze({ stack: '', tick: false, sq: false });

// #3989 heredoc-body stripping (see stripHeredocBodies below). Program words
// that run their input as shell text:
const SHELL_INTERPRETER_WORDS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'mksh', 'ash', 'fish', 'busybox', 'eval', 'source', '.', 'su', 'csh', 'tcsh', 'rbash', 'pwsh', 'powershell']);
// A versioned shell (`bash5`, `zsh5.9`, `sh4`) runs the same interpreter.
const VERSIONED_SHELL_RE = /^(ba|z|k|da|mk|a|c|tc|rba)?sh\d[\d.]*$/;
// Commands that run their own argument as a program: what follows one must resolve.
const WRAPPER_WORDS = new Set(['sudo', 'doas', 'env', 'exec', 'command', 'nohup', 'time', 'nice', 'xargs']);

// The program names one raw token may stand for, lowercased, with quotes and
// backslashes removed: `bas\h`, `'/bin/bash'`, `C:\bin\sh.exe` each yield a name.
// A leading group or process-substitution opener (`(`, `{`, `>(`, `<(`) is
// dropped, then a glued redirection (`sh<<EOF`), then a trailing group closer
// (`bash)`, `bash;`, `}`), before the basename lookup.
function programNames(tok) {
  const s = tok.replace(/["']/g, '').replace(/^(?:[({]|[<>]\()+/, '').replace(/[<>].*$/, '').replace(/[);}]+$/, '');
  const bySlash = s.split('/').pop().replace(/\\/g, '');
  const byBackslash = s.split(/[\\/]/).pop();
  return [bySlash, byBackslash].map((n) => n.replace(/\.exe$/i, '').toLowerCase());
}

function isShellName(name) {
  return SHELL_INTERPRETER_WORDS.has(name) || VERSIONED_SHELL_RE.test(name);
}

// A wrapper runs what follows it: that must resolve, and `sudo` given a shell flag
// (-s, -i, --shell, --login) is itself a shell.
function wrapperRunsShell(tokens, k, names) {
  const rest = tokens.slice(k + 1);
  if (rest.some((t) => /[$`]/.test(t))) return true;
  return names.includes('sudo') && rest.some((t) => /^(--shell|--login|-[A-Za-z]*[si][A-Za-z]*)$/.test(t));
}

// The opener's logical line feeds its body to a shell when a token on it names a
// shell (a versioned one included), a segment's program word (the first token after
// NAME=value assignments) is unresolvable ($NAME, $(...), a backtick), or a wrapper
// (sudo, env, ...) runs an unresolvable word or a shell. Fails closed, so the body
// stays visible to the scan.
function bodyRunsAsShell(lineText) {
  for (const seg of splitSegments(lineText)) {
    const { tokens } = tokenize(seg.trim());
    let p = 0;
    while (p < tokens.length && SIMPLE_ASSIGNMENT_RE.test(tokens[p])) p += 1;
    if (p < tokens.length && /[$`]/.test(tokens[p])) return true;
    for (let k = 0; k < tokens.length; k += 1) {
      const names = programNames(tokens[k]);
      if (names.some(isShellName)) return true;
      if (names.some((n) => WRAPPER_WORDS.has(n)) && wrapperRunsShell(tokens, k, names)) return true;
    }
  }
  return false;
}

// Reads a heredoc operand starting just after `<<`: an optional `-`, blanks, then
// the delimiter word. The word ends at unquoted whitespace or a shell metachar.
// Returns { delim, quoted, stripTabs, end }, { unprovable: true, end } for a
// `$'...'`/`$"..."` delimiter, or null when the operand is empty or its quoting
// is unterminated (not an opener).
function readHeredocOpener(str, j) {
  let stripTabs = false;
  if (str[j] === '-') { stripTabs = true; j += 1; }
  while (str[j] === ' ' || str[j] === '\t') j += 1;
  const start = j;
  let quote = null;
  while (j < str.length) {
    const c = str[j];
    if (quote === "'") { if (c === "'") quote = null; j += 1; continue; }
    if (c === '\\' && j + 1 < str.length) { j += 2; continue; }
    if (quote === '"') { if (c === '"') quote = null; j += 1; continue; }
    if (c === '"' || c === "'") { quote = c; j += 1; continue; }
    if (/[\s;&|<>()]/.test(c)) break;
    j += 1;
  }
  if (quote !== null) return null;
  const raw = str.slice(start, j);
  // Bash decodes `$'...'` / `$"..."` in the delimiter word, which this parser
  // does not, so the terminator cannot be known: the opener is unprovable.
  if (/\$['"]/.test(raw)) return { unprovable: true, end: j };
  const delim = decodeHeredocWord(raw);
  if (!delim) return null;
  return { delim, quoted: /["'\\]/.test(raw), stripTabs, end: j };
}

// The delimiter word as bash reads it: quotes removed, single-quoted text literal,
// a backslash escaping the next character outside single quotes (inside double
// quotes only before $ ` " \ or a newline). Null when a quote is unterminated.
function decodeHeredocWord(raw) {
  let out = '';
  for (let k = 0; k < raw.length; k += 1) {
    const c = raw[k];
    if (c === "'") {
      const close = raw.indexOf("'", k + 1);
      if (close === -1) return null;
      out += raw.slice(k + 1, close);
      k = close;
    } else if (c === '"') {
      let m = k + 1;
      while (m < raw.length && raw[m] !== '"') {
        if (raw[m] === '\\' && m + 1 < raw.length && '$`"\\\n'.includes(raw[m + 1])) {
          out += raw[m + 1];
          m += 2;
        } else {
          out += raw[m];
          m += 1;
        }
      }
      if (m >= raw.length) return null;
      k = m;
    } else if (c === '\\' && k + 1 < raw.length) {
      out += raw[k + 1];
      k += 1;
    } else {
      out += c;
    }
  }
  return out;
}

// Scans one heredoc body starting at index p, through the line equal to the
// delimiter (leading tabs ignored for `<<-`, one trailing `\r` ignored). `text` is
// the body without that closing line. With no closing line the body runs to end of
// string and `terminated` is false.
function scanHeredocBody(str, p, h) {
  const bodyStart = p;
  while (p < str.length) {
    let end = str.indexOf('\n', p);
    if (end === -1) end = str.length;
    let line = str.slice(p, end);
    if (line.endsWith('\r')) line = line.slice(0, -1);
    if (h.stripTabs) line = line.replace(/^\t+/, '');
    if (line === h.delim) return { end: Math.min(end + 1, str.length), terminated: true, text: str.slice(bodyStart, p) };
    p = end + 1;
  }
  return { end: str.length, terminated: false, text: str.slice(bodyStart) };
}

// A line ending in `|`, `&&` or `||` (optionally followed by a comment) continues
// onto the next line, so a later command receives its bodies.
const CONTINUATION_RE = /(?:\|\||&&|\|)\s*(?:#.*)?$/;

// Plans one logical line's heredoc bodies, which start at index `start`:
//   rest  - a body is unterminated: the text from `start` on is kept as written;
//   keep  - the bodies stay in the text, because the line runs them as shell, the
//           line continues, or an unquoted body expands `$(` or a backtick;
//   strip - every body is data; `end` is the index after the last one.
function planHeredocBodies(str, start, pending, lineText) {
  const bodies = [];
  let p = start;
  for (const h of pending) {
    const body = scanHeredocBody(str, p, h);
    if (!body.terminated) return { kind: 'rest' };
    bodies.push({ h, text: body.text });
    p = body.end;
  }
  const runsAsShell = CONTINUATION_RE.test(lineText) || bodyRunsAsShell(lineText);
  const expands = bodies.some(({ h, text }) => !h.quoted && /\$\(|`/.test(text));
  return runsAsShell || expands ? { kind: 'keep' } : { kind: 'strip', end: p };
}

// The single char-level pass behind stripHeredocBodies. Quote, escape, and comment
// handling mirror splitSegments, so a `<<` inside quotes or after a word-boundary
// `#` is never an opener.
function scanHeredocs(str) {
  const out = [];
  let quote = null;
  const subs = []; // paren depth of each open `"$( … )"` substitution (#4210)
  let parenDepth = 0; // unclosed `((` on the current logical line
  let pending = []; // heredocs opened on the current logical line, in order
  let lineStart = 0;
  let i = 0;
  while (i < str.length) {
    const ch = str[i];
    if (quote === "'") {
      out.push(ch);
      if (ch === "'") quote = null;
      i += 1;
    } else if (ch === '\\' && i + 1 < str.length) {
      out.push(ch, str[i + 1]);
      i += 2;
    } else if (quote === '"' && ch === '$' && str[i + 1] === '(' && str[i + 2] !== '(') {
      // #4210: `"$( … )"` is a command-substitution context whose text is shell again, so
      // a heredoc opened inside it (`"$(cat <<'EOF' … EOF\n)"`, the commit-message idiom)
      // is found, and its body no longer reads as quotes. `subs` holds one paren depth per
      // open substitution; the `)` that closes the last one returns to the double quote.
      out.push('$(');
      subs.push(1);
      quote = null;
      i += 2;
    } else if (quote === '"') {
      out.push(ch);
      if (ch === '"') quote = null;
      i += 1;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      out.push(ch);
      i += 1;
    } else if (ch === '#' && (i === 0 || /[\s;&|]/.test(str[i - 1]))) {
      let j = str.indexOf('\n', i);
      if (j === -1) j = str.length;
      out.push(str.slice(i, j));
      i = j;
    } else if (ch === '\n') {
      i += 1;
      out.push(ch);
      if (pending.length) {
        const plan = planHeredocBodies(str, i, pending, str.slice(lineStart, i - 1));
        if (plan.kind === 'rest') {
          out.push(str.slice(i));
          break;
        }
        if (plan.kind === 'strip') i = plan.end;
      }
      pending = [];
      parenDepth = 0;
      lineStart = i;
    } else if (ch === '(' && str[i + 1] === '(') {
      parenDepth += 1;
      out.push('((');
      i += 2;
    } else if (ch === ')' && str[i + 1] === ')' && parenDepth > 0) {
      parenDepth -= 1;
      out.push('))');
      i += 2;
    } else if (subs.length > 0 && (ch === '(' || ch === ')')) {
      subs[subs.length - 1] += ch === '(' ? 1 : -1;
      if (subs[subs.length - 1] === 0) {
        subs.pop();
        quote = '"';
      }
      out.push(ch);
      i += 1;
    } else if (ch === '<' && str[i + 1] === '<' && str[i + 2] === '<') {
      out.push('<<<'); // a here-string is never a heredoc
      i += 3;
    } else if (ch === '<' && str[i + 1] === '<') {
      // A `<<` inside an open `((...))` is an arithmetic shift, not an opener.
      const h = parenDepth === 0 ? readHeredocOpener(str, i + 2) : null;
      if (h && h.unprovable) {
        out.push(str.slice(i));
        break;
      }
      if (h) {
        out.push(str.slice(i, h.end));
        pending.push(h);
        i = h.end;
      } else {
        out.push('<<');
        i += 2;
      }
    } else {
      out.push(ch);
      i += 1;
    }
  }
  return out.join('');
}

// A heredoc body is data for the program it is fed to, not shell text, so a `>`
// inside it is not a redirection and its newlines are not command boundaries.
// Returns the command with each body and its closing-delimiter line removed. The
// opener line keeps its newline, so whatever follows the closing delimiter starts
// its own segment. Whatever the scan cannot prove is data stays visible (a body
// fed to a shell, an unquoted body that expands, an unterminated body, a
// continuation line): see planHeredocBodies. Any internal failure returns the
// input unchanged (the pre-#3989 scan).
function stripHeredocBodies(command) {
  if (typeof command !== 'string') return command;
  try {
    return scanHeredocs(command);
  } catch {
    return command;
  }
}

// Where a `[[ … ]]` or `(( … ))` segment's body ends: the `>` inside one is a
// comparison (`[[ a>b ]]`, `(( x>y ))`), never a redirection, so the redirect scan
// starts at the token after the closing word. 0 for any other segment; an
// unterminated body (a glued closer such as `y))`) is skipped whole, which fails
// open (#4015). A compound command may follow a control keyword on the same
// segment (`if (( x>y ))`, `while [[ a>b ]]`), so the keywords are skipped first.
const COMPOUND_LEAD_WORDS = new Set(['if', 'elif', 'while', 'until', 'then', 'do', 'else', '!']);

function compoundBodyEnd(t) {
  let lead = 0;
  while (lead < t.length && COMPOUND_LEAD_WORDS.has(t[lead])) lead += 1;
  const closer = t[lead] === '[[' ? ']]' : t[lead] === '((' ? '))' : null;
  if (closer === null) return 0;
  const end = t.indexOf(closer, lead);
  return end === -1 ? t.length : end + 1;
}

// Redirection-target scan (#3080): unlike fileWriteTargets' other shapes, a
// redirection carries no command word — `echo`, `printf`, `cat`, or nothing
// at all can precede it — so this runs over the WHOLE token list regardless
// of t[0], not gated by WRITE_SHAPES. Same fail-closed posture as the rest of
// this module: an unresolvable target ($VAR, backtick, `$(...)` process
// substitution — all caught by resolveWriteTarget's isUnresolvable check)
// resolves to no target, never a guess. `>(...)` process substitution and fd
// duplications (`>&2`, `2>&1`) are not file targets either.
//
// Heredoc bodies (#3989): fileWriteTargets scans stripHeredocBodies' output, so
// a `>` inside a body fed to a non-shell program is not a redirection. A body
// fed to a shell keeps its redirects visible, because that text runs as shell
// (see stripHeredocBodies for the carve-out).
//
// Span-aware scan (#4015, #4210): given `quoting.spanKinds` (forEachCommandSegment's
// third handler argument), the operator is found on the PRE-substitution token and its
// per-character span mask, so a quoted, escaped or `$`-expanded `>` never counts — at
// the token's start (leadingRedirectOpEnd: `echo ">x"` is a word) or glued to a word
// (gluedRedirectOpEnd: `foo>x`, `"hi">x`). The target is read from the
// post-substitution token, so `>$WT/x` still resolves. A prefix that is one balanced
// one-word group (`(ls)>out`, `$(date)>x`, `<(b)>out`) also qualifies; `((i>0))` does
// not. `quoting.nestAt[i]` is the nesting state (advanceNesting) at token i's start,
// carried across tokens and segments by forEachCommandSegment, so a `>` inside
// `"$( … )"` stays quoted even after a token or segment break. Without
// `quoting.spanKinds` the scan is start-anchored on the substituted token only.
//
// A `[[ … ]]` or `(( … ))` segment holds a comparison, not a redirection
// (compoundBodyEnd), so the scan starts after its closing word.
function redirectWriteTargets(t, effCwd, quoting) {
  const out = [];
  const kindsOf = quoting && quoting.spanKinds;
  for (let i = compoundBodyEnd(t); i < t.length; i += 1) {
    let rawTarget = null;
    if (!kindsOf) rawTarget = matchRedirectOperator(t[i]);
    else {
      const raw = quoting.raw[i];
      const nest = quoting.nestAt ? quoting.nestAt[i] : NOT_NESTED;
      let opEnd = leadingRedirectOpEnd(raw, kindsOf[i], nest);
      if (opEnd === null) opEnd = gluedRedirectOpEnd(raw, kindsOf[i], nest);
      if (opEnd !== null) {
        // substituteVars rewrites at most one `$` reference per token, so exactly one
        // side of the operator changed: read the target from whichever side survived.
        const head = raw.slice(0, opEnd);
        const tail = raw.slice(opEnd);
        if (t[i] === raw) rawTarget = tail;
        else if (t[i].startsWith(head)) rawTarget = t[i].slice(head.length);
        else if (t[i].endsWith(tail)) rawTarget = tail;
      }
    }
    if (rawTarget === null) continue;
    if (rawTarget === '') {
      i += 1; // consume the target token too — never re-scan it as its own operator
      rawTarget = t[i];
    }
    if (rawTarget === undefined || isFdDupTarget(rawTarget) || rawTarget.startsWith('(')) continue;
    const file = resolveWriteTarget(effCwd, rawTarget);
    if (file) out.push(file);
  }
  return out;
}

// Split a shape's argument list into positionals and the flags seen, given the
// flags that consume the FOLLOWING token as their value. Long `--flag=value`
// forms are self-contained and never consume the next token. `--` ends option
// parsing, as it does for every one of these commands.
function partitionArgs(rest, valueFlags) {
  const positionals = [];
  const flags = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === '--') { positionals.push(...rest.slice(i + 1)); break; }
    if (a.startsWith('-') && a !== '-') {
      flags.push(a);
      if (valueFlags.has(a) && i + 1 < rest.length) i += 1;
      continue;
    }
    positionals.push(a);
  }
  return { positionals, flags };
}

// Does this flag list request an in-place edit? Without one, sed and perl only
// read, and a read of the main checkout must stay allowed — so this gate is
// what keeps the shape from denying ordinary inspection commands.
//
// Detection can't just look for a literal `-i`: GNU attaches the backup suffix
// (`-i.bak`), and short flags bundle (`perl -pi -e`, `sed -ni`).
function hasInPlaceFlag(flags) {
  return flags.some((f) => {
    if (f === '--in-place' || f.startsWith('--in-place=')) return true;
    if (f.startsWith('--') || !f.startsWith('-')) return false;
    if (f.startsWith('-I')) return false; // perl's include path — not in-place
    if (f.startsWith('-i')) return true; // -i, -i.bak
    return /^-[A-Za-z]+$/.test(f) && f.includes('i'); // bundled: -pi, -ni
  });
}

// The Bash write shapes this function recognizes. Load-bearing, not
// descriptive: the guard below drops any segment whose command word is absent
// here, so adding a branch without adding its name makes that branch dead
// code. pre-tool-use.js's GATE_COVERAGE re-exports this list, GUARDED_PROGRAM_WORDS.write
// (below) carries it into bash-prefilter.js's PRE_TOOL_USE_WORDS, and
// tests/hooks-gate-coverage.test.js pins it to the prose in
// skills/_shared/policy-schema-coverage.md — so widening this array is what forces the
// documentation to be updated (#138).
const WRITE_SHAPES = Object.freeze(['cp', 'mv', 'tee', 'sed', 'perl', 'install', 'ln', 'truncate', 'dd']);

// Every program word a guard parser in this module keys on, by parser family —
// bash-prefilter.js derives BOTH of its word sets from this, so a parser keyed on
// a new word is reached by adding it here, never by editing a second list (#3092).
//   git:   findGitLead's lead (`git`, or a path ending `/git`, which the prefilter
//          reaches by basename) and the `env` wrapper it walks past —
//          gitTargets, resolvedGitSegments, and teardownTargets (pre-tool-use.js).
//          `env` is superset hygiene, kept for parity with the retired
//          `Bash(env -*)` predicate: every env-wrapped command these parsers
//          resolve also carries `git`, so no test can witness it alone.
//   mkdir: mkdirTargets' command word
//   write: fileWriteTargets' shapes
//   powershell: powershellOpaqueCommand's lead (`powershell`, `pwsh`) — pre-tool-use
//          only (#3061); post-tool-use's POST_TOOL_USE_WORDS stays scoped to the
//          git family, since this gate has nothing to check after the fact.
// tests/hooks-bash-prefilter.test.js's differential corpus runs the real parsers
// and fails when a targeted command's word is missing here — for the commands it
// lists, so a parser keyed on a new word also needs a corpus line there.
const GUARDED_PROGRAM_WORDS = Object.freeze({
  git: Object.freeze(['git', 'env']),
  mkdir: Object.freeze(['mkdir']),
  write: WRITE_SHAPES,
  powershell: Object.freeze([...POWERSHELL_LEADS]),
});

// Per-shape value-consuming flags. Wrong entries here shift which token is read
// as a positional, so each is taken from the command's own documented options
// rather than guessed.
const SED_VALUE_FLAGS = new Set(['-e', '-f', '--expression', '--file', '-l', '--line-length']);
const PERL_VALUE_FLAGS = new Set(['-e', '-E', '-I', '-m', '-M', '-F', '-x']);
const INSTALL_VALUE_FLAGS = new Set(['-m', '--mode', '-o', '--owner', '-g', '--group', '-t', '--target-directory', '-S', '--suffix']);
const LN_VALUE_FLAGS = new Set(['-t', '--target-directory', '-S', '--suffix']);
const TRUNCATE_VALUE_FLAGS = new Set(['-s', '--size', '-r', '--reference', '-o', '--io-blocks']);

// `-t DIR` / `--target-directory[=]DIR` names the destination explicitly, which
// makes EVERY positional a source rather than the last one being the target.
// Shared by cp/mv/install/ln, all of which accept it.
function explicitTargetDir(rest) {
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if ((a === '-t' || a === '--target-directory') && i + 1 < rest.length) return rest[i + 1];
    if (a.startsWith('--target-directory=')) return a.slice('--target-directory='.length);
  }
  return null;
}

// sed and perl share a program/file split: with -e/-f supplying the program,
// EVERY positional is a file; without one, the FIRST positional IS the program
// and only the rest are files.
function inPlaceEditTargets(rest, valueFlags, scriptFlags) {
  const { positionals, flags } = partitionArgs(rest, valueFlags);
  if (!hasInPlaceFlag(flags)) return []; // read-only invocation — nothing written
  const programSupplied = flags.some((f) => scriptFlags.some((s) => f === s || f.startsWith(`${s}=`)));
  return programSupplied ? positionals : positionals.slice(1);
}

function fileWriteTargets(command, cwd) {
  const targets = [];
  forEachCommandSegment(stripHeredocBodies(command), cwd, (t, effCwd, quoting) => {
    // Redirection has no command word, so it runs for every segment
    // regardless of t[0] — never gated by the WRITE_SHAPES check below (#3080).
    for (const file of redirectWriteTargets(t, effCwd, quoting)) targets.push({ action: 'write', file });
    if (!WRITE_SHAPES.includes(t[0])) return;
    if (t[0] === 'tee') {
      // tee genuinely writes to EVERY non-flag argument, not just the
      // first — `tee a.txt b.txt` writes both files. .find() silently
      // dropped every destination after the first.
      for (const arg of t.slice(1).filter((a) => !a.startsWith('-'))) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'write', file });
      }
      return;
    }

    if (t[0] === 'cp' || t[0] === 'mv') {
      // `-t DIR` / `--target-directory[=]DIR` names the real destination
      // directory explicitly; every remaining positional argument is a
      // SOURCE, not the destination — the plain "last positional arg is
      // the destination" rule below only applies when neither form is
      // present.
      const rest = t.slice(1);
      const targetDirRaw = explicitTargetDir(rest);
      const nonFlags = [];
      for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '-t' || a === '--target-directory') { i += 1; continue; }
        if (a.startsWith('-')) continue; // other flags — never a positional
        nonFlags.push(a);
      }
      const action = t[0] === 'cp' ? 'copy' : 'move';
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action, file });
      } else if (nonFlags.length >= 2) {
        const file = resolveWriteTarget(effCwd, nonFlags[nonFlags.length - 1]);
        if (file) targets.push({ action, file });
      }
      return;
    }

    if (t[0] === 'sed' || t[0] === 'perl') {
      // Only an in-place edit writes; a plain `sed -n .. file` is a read and
      // must stay allowed even in the main checkout.
      const isSed = t[0] === 'sed';
      const raw = inPlaceEditTargets(
        t.slice(1),
        isSed ? SED_VALUE_FLAGS : PERL_VALUE_FLAGS,
        isSed ? ['-e', '-f', '--expression', '--file'] : ['-e', '-E'],
      );
      for (const arg of raw) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'edit', file });
      }
      return;
    }

    if (t[0] === 'install') {
      // Same source→dest shape as cp, plus `-d`, under which EVERY positional
      // is a directory being created rather than a source.
      const rest = t.slice(1);
      const { positionals, flags } = partitionArgs(rest, INSTALL_VALUE_FLAGS);
      const targetDirRaw = explicitTargetDir(rest);
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action: 'install', file });
        return;
      }
      const creatingDirs = flags.some((f) => (
        f === '-d' || f === '--directory' || (/^-[A-Za-z]+$/.test(f) && f.includes('d'))
      ));
      // `-d`: every positional is a directory being created. Otherwise the
      // last positional is the destination and needs a source before it.
      let written = [];
      if (creatingDirs) written = positionals;
      else if (positionals.length >= 2) written = positionals.slice(-1);
      for (const arg of written) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'install', file });
      }
      return;
    }

    if (t[0] === 'ln') {
      // The LINK name is what gets created — the last positional. With a single
      // positional the link lands in the cwd under the source's basename.
      const rest = t.slice(1);
      const targetDirRaw = explicitTargetDir(rest);
      const { positionals } = partitionArgs(rest, LN_VALUE_FLAGS);
      if (targetDirRaw !== null) {
        const file = resolveWriteTarget(effCwd, targetDirRaw);
        if (file) targets.push({ action: 'link', file });
        return;
      }
      if (positionals.length >= 2) {
        const file = resolveWriteTarget(effCwd, positionals[positionals.length - 1]);
        if (file) targets.push({ action: 'link', file });
      } else if (positionals.length === 1) {
        const file = resolveWriteTarget(effCwd, path.basename(stripQuotes(positionals[0])));
        if (file) targets.push({ action: 'link', file });
      }
      return;
    }

    if (t[0] === 'truncate') {
      // Every positional is truncated — and truncation CREATES the file when it
      // does not exist, so this writes regardless of `-c`.
      const { positionals } = partitionArgs(t.slice(1), TRUNCATE_VALUE_FLAGS);
      for (const arg of positionals) {
        const file = resolveWriteTarget(effCwd, arg);
        if (file) targets.push({ action: 'truncate', file });
      }
      return;
    }

    if (t[0] === 'dd') {
      // dd takes keyword arguments, not flags: the destination is `of=`.
      for (const arg of t.slice(1)) {
        const bare = stripQuotes(arg);
        if (!bare.startsWith('of=')) continue;
        const file = resolveWriteTarget(effCwd, bare.slice('of='.length));
        if (file) targets.push({ action: 'write', file });
      }
      return;
    }
  });
  return targets;
}

// mkdir target parser — deliberately separate from WRITE_SHAPES/fileWriteTargets
// (#692): WRITE_SHAPES feeds the worktree-always Bash-write gate's coverage,
// which tests/hooks-gate-coverage.test.js pins to skills/_shared/policy-schema-coverage.md's
// prose; folding mkdir in there would widen that unrelated gate as a side effect.
// The pipeline-shadow guard (pre-tool-use.js) is this function's only consumer.
// mkdir takes no flag that both consumes a value AND could plausibly be confused
// with a positional except -m/--mode; every other positional is a target — mkdir
// can create several directories in one invocation.
const MKDIR_VALUE_FLAGS = new Set(['-m', '--mode']);
function mkdirTargets(command, cwd) {
  const targets = [];
  forEachCommandSegment(command, cwd, (t, effCwd) => {
    if (t[0] !== 'mkdir') return;
    const { positionals } = partitionArgs(t.slice(1), MKDIR_VALUE_FLAGS);
    for (const arg of positionals) {
      const file = resolveWriteTarget(effCwd, arg);
      if (file) targets.push({ action: 'mkdir', file });
    }
  });
  return targets;
}

module.exports = {
  gitTargets, gitTargetsFrom, resolvedGitSegments, fileWriteTargets, mkdirTargets, splitSegments, tokenize, forEachCommandSegment, skipGlobalFlags, findGitLead, resolveGitCommand, powershellOpaqueCommand, WRITE_SHAPES, GUARDED_PROGRAM_WORDS, redirectWriteTargets, stripHeredocBodies,
};
