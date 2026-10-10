'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function stripQuotes(s) {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}

function coerceScalar(raw) {
  const v = stripQuotes(raw);
  return /^-?\d+$/.test(v) ? Number(v) : v;
}

function parseInlineArray(s) {
  const inner = s.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (inner.trim() === '') return [];
  return inner.split(',').map((item) => stripQuotes(item.trim()));
}

function indentOf(line) {
  return line.match(/^(\s*)/)[1].length;
}

// Strips a trailing ` # comment` from a YAML scalar/value string, honoring
// simple single/double quoting (a `#` inside a matched '...'/"..." span is
// literal text, not a comment start). Per the YAML spec, a `#` only starts a
// comment when preceded by whitespace or at the start of the string.
function stripTrailingComment(s) {
  let inSingle = false;
  let inDouble = false;
  for (let idx = 0; idx < s.length; idx++) {
    const ch = s[idx];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (idx === 0 || /\s/.test(s[idx - 1]))) {
      return s.slice(0, idx).trimEnd();
    }
  }
  return s;
}

// Collects the indented continuation block belonging to a top-level `key:`
// line, starting at `startIndex`. Returns each line verbatim (blank lines
// represented as `null` markers so callers can tell a paragraph/entry break
// apart from real content) plus the index of the first line past the block
// (either EOF or the next indentOf === 0 line). Shared by the nested-map
// branch and the folded block-scalar branch below, which otherwise hand-
// implement the identical "skip blank lines, stop at the next top-level
// line" loop as two separately-maintained copies.
function collectIndentedContinuation(lines, startIndex) {
  const collected = [];
  let j = startIndex;
  while (j < lines.length) {
    const nl = lines[j];
    if (nl.trim() === '') {
      collected.push(null);
      j++;
      continue;
    }
    if (indentOf(nl) === 0) break;
    collected.push(nl);
    j++;
  }
  return { collected, next: j };
}

// Parses the narrow YAML subset every routine-template.yml uses: top-level
// scalars, inline flow arrays, one level of nested map, and a single folded
// block scalar (`>`). Not a general-purpose YAML parser by design — was
// docs/superpowers/plans/2026-07-05-routine-improvements.md's Global
// Constraints — deleted (652a97c4).
function parseRoutineTemplate(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const result = {};
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === '') {
      i++;
      continue;
    }
    if (indentOf(line) !== 0) {
      i++;
      continue;
    }

    const m = line.match(/^([A-Za-z_][A-Za-z0-9_.]*):\s*(.*)$/);
    if (!m) {
      i++;
      continue;
    }
    const key = m[1];
    const rest = stripTrailingComment(m[2].trim());

    if (rest === '') {
      const nested = {};
      let sawNested = false;
      const { collected, next } = collectIndentedContinuation(lines, i + 1);
      for (const nl of collected) {
        if (nl === null) continue;
        const nm = nl.match(/^\s*([A-Za-z_][A-Za-z0-9_.]*):\s*(.*)$/);
        if (nm) {
          sawNested = true;
          nested[nm[1]] = coerceScalar(stripTrailingComment(nm[2]));
        } else if (/^\s*-\s/.test(nl)) {
          // A YAML block-style list ('- item') under a top-level key is not
          // part of the narrow subset this parser supports (see the function
          // docstring) — fail loudly instead of silently dropping every list
          // entry and resolving the key to an empty object.
          throw new Error(
            `parseRoutineTemplate: "${key}:" has a YAML block-style list (- item), which this narrow parser does not support — use an inline [a, b] array instead`
          );
        }
      }
      result[key] = sawNested ? nested : '';
      i = next;
    } else if (rest === '>') {
      const { collected, next } = collectIndentedContinuation(lines, i + 1);
      // Fold each run of consecutive content lines into one space-joined
      // line (real YAML folding); a blank line inside the block is a
      // paragraph break, preserved as `\n\n` between paragraphs rather than
      // silently discarded (which would run every paragraph together with
      // only a single space between them).
      const paragraphs = [];
      let current = [];
      for (const nl of collected) {
        if (nl === null) {
          if (current.length > 0) {
            paragraphs.push(current.join(' '));
            current = [];
          }
          continue;
        }
        current.push(nl.trim());
      }
      if (current.length > 0) paragraphs.push(current.join(' '));
      result[key] = paragraphs.join('\n\n');
      i = next;
    } else if (rest.startsWith('[')) {
      result[key] = parseInlineArray(rest);
      i++;
    } else {
      result[key] = coerceScalar(rest);
      i++;
    }
  }

  return result;
}

function listRoutineRecords(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir);
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
  return entries
    .filter((name) => name.endsWith('.yml'))
    .sort()
    .map((filename) => {
      const text = fs.readFileSync(path.join(dir, filename), 'utf8');
      return { ...parseRoutineTemplate(text), filename };
    });
}

// --- Record freshness (#190) -------------------------------------------------
//
// `listRoutineRecords` above reads the *working checkout*. A checkout behind the
// branch where records are actually committed therefore reports drift that does
// not exist — and, worse, an upstream-only record is invisible to CREATE's
// idempotency check, which then mints a duplicate live routine that
// `RemoteTrigger` has no delete action to undo. Everything below exists to let a
// caller compare the working copy against the branch of record before acting.
//
// The whole surface is fail-open by construction: no network, no remote, no such
// ref, or a fetch that times out all return `verified: false` with a `reason`,
// never an exception. Callers must gate any stop on `verified === true` so an
// offline session degrades to today's behavior instead of becoming unusable.

const DEFAULT_RECORD_DIR = '.claude-tweaks/routines';
const DEFAULT_TIMEOUT_MS = 20000;

// Fields whose divergence changes what UPDATE would write or what STATUS would
// report. `created_at` is deliberately excluded: UPDATE Step 7 rewrites it on
// every run ("last written at"), so comparing it would make every record differ
// from upstream the moment anyone re-syncs, and the stop would fire on nothing.
const SIGNIFICANT_FIELDS = ['routine_id', 'template', 'template_version', 'schedule', 'cadence', 'run_once_at', 'branch', 'model', 'kernel_version'];

// Absent and empty compare equal here. The record schema distinguishes them (an
// omitted `branch` means "unresolved", `branch: ""` would mean "pinned to
// nothing"), but CREATE Step 9 forbids ever writing the empty form, so treating
// them alike cannot mask a real divergence — while `String(undefined)` would
// produce the literal "undefined" and report one that isn't there.
function normalizeField(v) {
  return v === undefined || v === null ? '' : String(v);
}

// execFile, never exec: arguments reach git as argv with no shell in between, so
// a ref like `origin/main:path` is passed literally. Under zsh a shelled-out
// equivalent would hit `[IL-91]` (`:s` read as a parameter-expansion modifier)
// and silently return empty rather than erroring.
function tryGit(args, cwd, timeoutMs) {
  try {
    const out = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: timeoutMs,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    return { ok: true, out };
  } catch (err) {
    return { ok: false, err };
  }
}

// Extracts the basenames of every path `git status --porcelain` reported as
// changed. Rename entries (`R  old -> new`) name two paths; the destination is
// the one that exists in the working tree, so it is the one that counts.
function parsePorcelainNames(out) {
  const names = new Set();
  for (const line of (out || '').split('\n')) {
    if (line.trim() === '') continue;
    let p = line.slice(3);
    const arrow = p.indexOf(' -> ');
    if (arrow !== -1) p = p.slice(arrow + 4);
    p = p.trim().replace(/^"(.*)"$/, '$1');
    if (p.endsWith('.yml')) names.add(path.posix.basename(p));
  }
  return names;
}

// Reads the instantiated records as they exist at `ref`, without touching the
// working tree. Returns `null` when the ref itself does not resolve (never an
// empty array — a caller must be able to tell "no such branch" apart from "that
// branch has no records", since only the first means the comparison is
// unavailable).
function readRoutineRecordsAtRef({ cwd = process.cwd(), ref, dir = DEFAULT_RECORD_DIR, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (!ref) return null;
  if (!tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], cwd, timeoutMs).ok) return null;
  const ls = tryGit(['ls-tree', '-r', '--name-only', '-z', ref, '--', dir], cwd, timeoutMs);
  if (!ls.ok) return null;
  const records = [];
  for (const p of ls.out.split('\0')) {
    if (!p.endsWith('.yml')) continue;
    const show = tryGit(['show', `${ref}:${p}`], cwd, timeoutMs);
    if (!show.ok) continue;
    let parsed;
    try {
      parsed = parseRoutineTemplate(show.out);
    } catch (err) {
      // A record upstream that this narrow parser rejects is reported as
      // malformed by the caller, exactly as a malformed local one already is —
      // it must not abort the whole comparison.
      parsed = { _parseError: err.message };
    }
    records.push({ ...parsed, filename: path.posix.basename(p) });
  }
  return records.sort((a, b) => (a.filename < b.filename ? -1 : a.filename > b.filename ? 1 : 0));
}

// Compares the working checkout's records against `{remote}/{branch}` and
// returns a verdict per record over the *union* of both sides. The union is the
// point: a record that exists only upstream is precisely the one a
// working-tree-only read cannot see, and the one whose absence mints a duplicate.
function compareRoutineRecords({
  cwd = process.cwd(),
  dir = DEFAULT_RECORD_DIR,
  remote = 'origin',
  branch,
  fetch = true,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const result = {
    verified: false,
    reason: null,
    ref: null,
    behind: 0,
    local: [],
    upstream: [],
    records: [],
    onlyLocal: [],
    onlyUpstream: [],
    differing: [],
  };

  // The local read happens on every path, verified or not — an unverified run
  // must still behave exactly as it did before this function existed.
  try {
    result.local = listRoutineRecords(path.join(cwd, dir));
  } catch (err) {
    result.local = [];
  }

  if (!branch) {
    result.reason = 'branch-unresolved';
  } else if (!tryGit(['remote', 'get-url', remote], cwd, timeoutMs).ok) {
    result.reason = 'no-remote';
  } else if (fetch && !tryGit(['fetch', '--quiet', remote, branch], cwd, timeoutMs).ok) {
    // Offline, unreachable host, no such branch upstream, or a fetch that ran
    // past `timeoutMs` (a captive portal, a hung SSH handshake) — transient and
    // permanent causes both land here, and the caller must not tell them apart
    // by treating this branch as permanent `[IL-92]`.
    result.reason = 'fetch-failed';
  }

  if (result.reason) return finalizeUnverified(result, remote, branch);

  result.ref = `${remote}/${branch}`;
  const upstream = readRoutineRecordsAtRef({ cwd, ref: result.ref, dir, timeoutMs });
  if (upstream === null) {
    result.reason = 'no-ref';
    return finalizeUnverified(result, remote, branch);
  }

  result.upstream = upstream;
  result.verified = true;

  const behind = tryGit(['rev-list', '--count', `HEAD..${result.ref}`], cwd, timeoutMs);
  result.behind = behind.ok ? Number(behind.out.trim()) || 0 : 0;

  const localByName = new Map(result.local.map((r) => [r.filename, r]));
  const upstreamByName = new Map(upstream.map((r) => [r.filename, r]));
  const names = [...new Set([...localByName.keys(), ...upstreamByName.keys()])].sort();

  // One status call for the whole directory, not one per record: git process
  // startup dominates this comparison's cost, and the per-record form made it
  // scale with the number of routines a project has.
  const dirtyLocally = parsePorcelainNames(tryGit(['status', '--porcelain', '--', dir], cwd, timeoutMs).out);

  for (const filename of names) {
    const local = localByName.get(filename) || null;
    const up = upstreamByName.get(filename) || null;
    const presence = local && up ? 'both' : local ? 'local-only' : 'upstream-only';
    // An uncommitted edit is a deliberate in-progress change, so the working
    // copy wins even on a behind checkout — otherwise this check would discard
    // the user's own unsaved intent in the name of freshness.
    const uncommitted = local ? dirtyLocally.has(filename) : false;
    let authority;
    if (uncommitted || presence === 'local-only') authority = 'local';
    else if (presence === 'upstream-only') authority = 'upstream';
    else authority = result.behind > 0 ? 'upstream' : 'local';
    const fields =
      presence === 'both'
        ? SIGNIFICANT_FIELDS.filter((f) => normalizeField(local[f]) !== normalizeField(up[f]))
        : [];
    result.records.push({ filename, presence, uncommitted, authority, fields, local, upstream: up });
  }

  result.onlyLocal = result.records.filter((r) => r.presence === 'local-only').map((r) => r.filename);
  result.onlyUpstream = result.records.filter((r) => r.presence === 'upstream-only').map((r) => r.filename);
  result.differing = result.records.filter((r) => r.presence === 'both' && r.fields.length > 0);

  return result;
}

// An unverified comparison still reports the union it *can* see (the working
// tree alone), so a caller's record loop is shape-identical either way and only
// its stop conditions are gated on `verified`.
function finalizeUnverified(result, remote, branch) {
  if (branch) result.ref = `${remote}/${branch}`;
  result.records = result.local.map((r) => ({
    filename: r.filename,
    presence: 'local-only',
    uncommitted: false,
    authority: 'local',
    fields: [],
    local: r,
    upstream: null,
  }));
  return result;
}

// One human-readable line naming why a comparison could not be made. Callers
// print this verbatim: silence is what let the original phantom-drift report
// read as authoritative with nothing indicating otherwise.
function freshnessNote(result) {
  if (result.verified) return null;
  const where = result.ref ? ` (${result.ref})` : '';
  const why = {
    'branch-unresolved': 'no integration branch resolved',
    'no-remote': 'this repo has no `origin` remote',
    'fetch-failed': 'the fetch did not succeed — offline, unreachable, or no such branch upstream',
    'no-ref': `${result.ref} does not resolve in this repo`,
  }[result.reason] || 'reason unknown';
  return `Record freshness unverified${where}: ${why}. Comparing this checkout's copy only — a record committed upstream but not present here cannot be seen.`;
}

// Kernel staleness verdict for STATUS Step 3's dual-drift check (#529): a record
// with no recorded kernel_version predates the kernel split and always reads stale.
// Ahead-of-schema reads 'fresh' deliberately: a stale checkout can under-read a
// record that is actually current. Same rationale covers the cross-machine case:
// a record written by a newer plugin elsewhere may legitimately be ahead of this
// checkout's own schema — telling an older plugin to "update" it would regress it.
function kernelFreshness(recordKernelVersion, currentKernelVersion) {
  if (recordKernelVersion == null) return 'kernel-stale';
  const recorded = Number(recordKernelVersion);
  if (!Number.isFinite(recorded)) return 'kernel-stale';
  return recorded >= Number(currentKernelVersion) ? 'fresh' : 'kernel-stale';
}

module.exports = {
  parseRoutineTemplate,
  listRoutineRecords,
  readRoutineRecordsAtRef,
  compareRoutineRecords,
  freshnessNote,
  kernelFreshness,
  SIGNIFICANT_FIELDS,
};
