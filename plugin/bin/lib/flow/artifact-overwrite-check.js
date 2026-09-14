'use strict';
// plugin/bin/lib/flow/artifact-overwrite-check.js — refs #2014
//
// Mechanizes the multi-spec artifact-overwrite completion check
// (plugin/skills/flow/multispec-artifact-namespacing.md, #786): a shared
// docs/journeys/ or stories/ file that a later spec's commit legitimately
// *extends* (appends its own step, tweaks the shared frontmatter file list,
// reflows a running "related specs" bookkeeping bullet) must not HARD-GATE
// the Consolidated Review Console the same way a real overwrite (a later
// spec deleting an earlier spec's own content) does.
//
// The walk: find every path under the watched globs that was Added (A) in
// one commit and later Modified (M) by a commit in the same range. For each
// such later commit, every hunk with deletions is judged safe (an extension)
// by either of two independent tests — either one is enough:
//
//   1. Same-spec self-edit: every deleted line traces, via `git blame` on the
//      parent revision, back to a commit carrying the *same* `refs #N`
//      trailer as the deleting commit itself — a spec editing its own prior
//      content (a typo fix, a follow-up correction within the same build).
//   2. List reflow: every deleted line in the hunk is itself a `- ` list
//      entry (a YAML frontmatter `files:` item, or a markdown bookkeeping
//      bullet such as a running "Related specs: ..." line), and the hunk
//      replaces it with at least as many list-entry lines as it removed.
//      This is the shared-collection case: a shared list every spec extends
//      is expected to shuffle its neighboring entries on every append (a new
//      bullet displaces the previous "last" one), and no single spec owns
//      any one entry the way it owns its own step body.
//
// A hunk that fails both tests — deletes non-list content, or shrinks a list
// — is a real overwrite and trips the gate. This is deliberately general
// rather than journeys-format-specific: neither test parses step headings or
// section names, so the same two rules apply unchanged to a stories/*.yaml
// file's own shared list. Fails closed: an unattributable deletion (no blame,
// no refs trailer, not a list reflow) is treated as an overwrite.

const { execFileSync } = require('child_process');

const GIT_TIMEOUT_MS = 10000;

// Thrown only for an actual git-command failure (unresolvable ref, git not
// on PATH, a real environment problem) -- never for a bug in this module's
// own parsing logic, which must propagate as a raw Error/TypeError and
// crash loud rather than being misreported as "the walk failed" (refs
// #2014 review). Same shape as bin/lib/merge-size-probe.js's
// MergeSizeProbeError.
class ArtifactOverwriteCheckError extends Error {
  constructor(...args) {
    super(...args);
    this.name = 'ArtifactOverwriteCheckError';
  }
}

function defaultGit(args, cwd) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    throw new ArtifactOverwriteCheckError(`git ${args.join(' ')} failed: ${err.message}`);
  }
}

// Every `#(\d+)` following the word `refs`, e.g. "refs #2014" on its own
// trailer line, or "... (refs #1991)" inline at the end of a subject line —
// both shapes occur in this repo's real history, so the match is not
// line-anchored. Returns a Set (possibly empty when no trailer, or the
// commit predates this convention).
function extractRefs(message) {
  const refs = new Set();
  const re = /refs\s+((?:#\d+(?:,\s*)?)+)/gi;
  let m;
  // eslint-disable-next-line no-cond-assign
  while ((m = re.exec(message))) {
    for (const n of m[1].matchAll(/#(\d+)/g)) refs.add(Number(n[1]));
  }
  return refs;
}

function setsIntersect(a, b) {
  for (const v of a) {
    if (b.has(v)) return true;
  }
  return false;
}

// Parses `git log --reverse --diff-filter=AM --name-status --format=%H
// {base}..{head} -- {paths}` output into an ordered (oldest-first) list of
// { commit, entries: [{ status, path }] }.
function parseNameStatusLog(output) {
  const commits = [];
  let current = null;
  for (const raw of output.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^[0-9a-f]{40}$/.test(line)) {
      current = { commit: line, entries: [] };
      commits.push(current);
      continue;
    }
    const m = line.match(/^([AM])\t(.+)$/);
    if (m && current) {
      current.entries.push({ status: m[1], path: m[2] });
    }
  }
  return commits;
}

// Builds path -> ordered [{ commit, status }] from the parsed commit list.
function groupByPath(commits) {
  const byPath = new Map();
  for (const { commit, entries } of commits) {
    for (const { status, path } of entries) {
      if (!byPath.has(path)) byPath.set(path, []);
      byPath.get(path).push({ commit, status });
    }
  }
  return byPath;
}

// Parses numstat output's first data line ("ins\tdel\tpath") for one commit
// on one path. Returns null when the line is missing or non-numeric
// (typically a binary file) — callers treat null conservatively.
function parseNumstatDeletions(output) {
  const line = output.split('\n').find((l) => l.trim().length > 0);
  if (!line) return null;
  const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
  if (!m) return null;
  if (m[2] === '-') return null;
  return Number(m[2]);
}

// Parses a `-U0` unified diff for a single path into per-hunk
// { oldStart, deletedLines: [{lineNo, content}], addedLines: [content...] }.
// oldStart/deletedLines line numbers are 1-indexed positions in the *parent*
// revision's copy of the file.
function parseHunks(diffOutput) {
  const hunks = [];
  let current = null;
  const headerRe = /^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/;
  for (const line of diffOutput.split('\n')) {
    const h = line.match(headerRe);
    if (h) {
      const oldStart = Number(h[1]);
      current = { oldStart, deletedLines: [], addedLines: [] };
      hunks.push(current);
      continue;
    }
    if (!current) continue;
    if (line.startsWith('---') || line.startsWith('+++')) continue; // file-level diff headers
    if (line.startsWith('-')) {
      const lineNo = current.oldStart + current.deletedLines.length;
      current.deletedLines.push({ lineNo, content: line.slice(1) });
    } else if (line.startsWith('+')) {
      current.addedLines.push(line.slice(1));
    }
  }
  return hunks;
}

const LIST_ENTRY_RE = /^\s*-\s/;

// Test 2 above: every deleted line in the hunk is a `- ` list entry, and the
// hunk doesn't shrink the list (at least as many list entries added back).
function isListReflow(hunk) {
  if (hunk.deletedLines.length === 0) return false;
  if (hunk.addedLines.length < hunk.deletedLines.length) return false;
  return hunk.deletedLines.every((d) => LIST_ENTRY_RE.test(d.content));
}

// Blames `rev`'s copy of `path`, returning a 1-indexed array (index 0 unused)
// mapping each line number to the commit sha that produced it.
function blameShas(git, cwd, rev, path) {
  const output = git(['blame', '--line-porcelain', rev, '--', path], cwd);
  const shas = [null];
  let currentSha = null;
  for (const line of output.split('\n')) {
    const headerMatch = line.match(/^([0-9a-f]{40}) \d+ \d+/);
    if (headerMatch) {
      currentSha = headerMatch[1];
      continue;
    }
    if (line.startsWith('\t')) {
      shas.push(currentSha);
    }
  }
  return shas;
}

/**
 * @param {object} opts
 * @param {string} opts.base - exclusive lower bound of the range (commit-ish)
 * @param {string} [opts.head] - inclusive upper bound (default 'HEAD')
 * @param {string[]} [opts.paths] - pathspecs to scope the walk (default docs/journeys/ stories/)
 * @param {string} [opts.cwd] - repo root (default process.cwd())
 * @param {function} [opts.git] - injectable runner: (argv, cwd) => stdout string, throws on failure
 * @returns {{ clean: boolean, overwrites: Array<{path: string, commit: string, reason: string}> }}
 */
function checkArtifactOverwrite(opts) {
  const {
    base,
    head = 'HEAD',
    paths: rawPaths,
    cwd = process.cwd(),
    git = defaultGit,
  } = opts;

  if (!base) {
    throw new Error('checkArtifactOverwrite: opts.base is required');
  }

  // An empty array is treated the same as `paths` unset (falls back to the
  // default scope) rather than as git's own "no pathspec after --" meaning
  // ("match everything") -- an empty array reads as "restrict to nothing"
  // to a caller of this module, and silently widening to the whole repo
  // instead would contradict this module's own fail-closed design intent
  // (refs #2014 review).
  const paths = (rawPaths && rawPaths.length > 0) ? rawPaths : ['docs/journeys/', 'stories/'];

  const nameStatusOut = git(
    ['log', '--reverse', '--diff-filter=AM', '--name-status', '--format=%H', '--end-of-options', `${base}..${head}`, '--', ...paths],
    cwd,
  );
  const commits = parseNameStatusLog(nameStatusOut);
  const byPath = groupByPath(commits);

  const overwrites = [];
  const messageCache = new Map();
  const getRefs = (sha) => {
    if (messageCache.has(sha)) return messageCache.get(sha);
    const msg = git(['log', '-1', '--format=%B', sha], cwd);
    const refs = extractRefs(msg);
    messageCache.set(sha, refs);
    return refs;
  };

  for (const [path, events] of byPath) {
    const firstAddIdx = events.findIndex((e) => e.status === 'A');
    if (firstAddIdx === -1) continue;

    for (let i = firstAddIdx + 1; i < events.length; i += 1) {
      const event = events[i];
      if (event.status !== 'M') continue;
      const { commit } = event;

      const numstatOut = git(['log', '--numstat', '-1', '--format=', commit, '--', path], cwd);
      const deletions = parseNumstatDeletions(numstatOut);
      if (deletions === null) {
        // Unreadable numstat (binary, or an unexpected shape) — fail closed.
        overwrites.push({ path, commit, reason: 'unreadable numstat — cannot confirm append-only, treated as overwrite' });
        continue;
      }
      if (deletions === 0) continue; // pure extension, no deletions at all

      const commitRefs = getRefs(commit);
      const diffOut = git(['diff', '--no-color', '-U0', `${commit}~1`, commit, '--', path], cwd);
      const hunks = parseHunks(diffOut);

      let blame = null; // lazily fetched — only needed when a hunk isn't a list reflow
      let overwrite = false;
      let culprit = null;

      for (const hunk of hunks) {
        if (hunk.deletedLines.length === 0) continue;
        if (isListReflow(hunk)) continue; // Test 2 — shared-collection reflow, always safe

        if (!blame) blame = blameShas(git, cwd, `${commit}~1`, path);
        for (const d of hunk.deletedLines) {
          const blamedSha = blame[d.lineNo];
          if (!blamedSha) {
            overwrite = true;
            culprit = { lineNo: d.lineNo, blamedSha: null };
            break;
          }
          const blamedRefs = getRefs(blamedSha);
          const selfEdit = commitRefs.size > 0 && setsIntersect(commitRefs, blamedRefs);
          if (!selfEdit) {
            overwrite = true;
            culprit = { lineNo: d.lineNo, blamedSha };
            break;
          }
        }
        if (overwrite) break;
      }

      if (overwrite) {
        const reason = culprit.blamedSha
          ? `deleted line ${culprit.lineNo} (as of parent ${commit}~1) traces to commit ${culprit.blamedSha}, `
            + `whose refs trailer does not match ${commit}'s own refs trailer, and the deletion is not a list reflow`
          : `deleted line ${culprit.lineNo} has no blame attribution — cannot confirm self-edit or list reflow`;
        overwrites.push({ path, commit, reason });
      }
    }
  }

  return { clean: overwrites.length === 0, overwrites };
}

module.exports = {
  checkArtifactOverwrite,
  extractRefs,
  parseNameStatusLog,
  parseNumstatDeletions,
  parseHunks,
  isListReflow,
  defaultGit,
  ArtifactOverwriteCheckError,
};
