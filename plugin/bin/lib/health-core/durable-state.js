'use strict';
const { execFileSync } = require('child_process');

// Durable cross-firing state for the health skills, backed by a dedicated
// git branch (never merged into main) instead of local gitignored disk —
// local disk doesn't survive a scheduled cloud-routine (CCR) container
// recycling between firings. Contract: skills/_shared/health-state.md.
//
// Impure (execFileSync git calls), matching bin/lib/code-health/scope.js's
// existing precedent — not bin/lib/issues/claims.js's emit-only pattern,
// since reading/writing this branch is mechanical plumbing nobody inspects
// mid-flight, unlike issue claim/release which is a decision-laden,
// audit-visible action meant to be legible in the skill's own bash trail.
// The command runner is injectable so tests substitute a fake one instead
// of touching real network (git fetch/push can't run for real in a
// sandboxed unit test the way scope.js's local git log calls can).
//
// Writes are plain git plumbing (hash-object/mktree/commit-tree/push), not
// the GitHub Data API — proven to work identically local or in a Claude Code
// cloud Routine sandbox (no gh CLI, no MCP dependency either). Was
// docs/superpowers/specs/2026-07-30-durable-state-git-native-write-design.md
// — deleted (70849915) — for why: these are plain Git Data API primitives
// with no GitHub-specific semantics, unlike an actual GitHub write (issue
// create/comment/etc).
//
// createNamespacedState (below) is the extracted, generic namespace-scoped
// read/write primitive — git plumbing + the CAS retry loop, parameterized
// over an explicit { key, file, default, serialize? } list instead of the
// four health skills' fixed cursors/retryQueue/runs(/remembered)(/declined)
// shape. createDurableState is now a thin wrapper over it: same public
// signature, same returned shape, byte-identical behavior for every
// existing caller (see this file's own test suite). #311's
// bin/lib/issues/merge-lane-breaker.js is the second consumer — its
// breaker.json/watched.json pair does not fit the health skills' fixed
// schema, so it calls createNamespacedState directly rather than going
// through createDurableState.
//
// NOT extended to also absorb `bin/lib/issues/claims-git-cas.js`'s
// claims-registry CAS engine (#1466), despite the surface-level resemblance
// (both are git-plumbing-based CAS primitives). That module reads/writes a
// single raw string blob (this primitive always JSON-parses/stringifies),
// needs a four-way failure classification passthrough
// (`contested`/`secondary-rate-limit`/`missing-path`/`transport-failure` —
// this primitive collapses writes to `{ok, error}`), targets a different
// hardcoded branch, and leaves retry ownership to its caller instead of
// looping internally the way `writeState` below does. Absorbing it would mean
// adding a raw-file mode, a branch parameter, and a classification
// passthrough to this primitive without breaking `createDurableState`'s
// byte-identical-behavior guarantee or `merge-lane-breaker.js`'s existing
// contract — judged not worth that risk. See that module's own header
// comment for the reciprocal note; if this primitive's contract changes,
// check that module too.

const HEALTH_STATE_BRANCH = 'health-state';
const MAX_RUN_HISTORY = 90;
const ESCALATE_AFTER_ATTEMPTS = 3;
const MAX_CAS_ATTEMPTS = 3;
const EMPTY_TREE_SHA = '4b825dc642cb6eb9a060e54bf8d69288fbee4904'; // git's well-known empty-tree sha

// Randomized, increasing backoff between CAS retry attempts — up to 4
// engines (code-health, harness-health, docs-health, journey-health) write to
// this SAME branch ref (only the file paths underneath it are namespaced),
// so a collision on retry is exactly as likely as the first one without some
// jitter to de-synchronize concurrent writers. attempt is 1-based; each
// attempt's window (attempt*CAS_BACKOFF_BASE_MS to (attempt+1)*BASE) never
// overlaps the next, so later attempts always wait at least as long.
const CAS_BACKOFF_BASE_MS = 100;
const CAS_BACKOFF_JITTER_MS = 100;

function casBackoffMs(attempt) {
  return attempt * CAS_BACKOFF_BASE_MS + Math.random() * CAS_BACKOFF_JITTER_MS;
}

// Synchronous sleep, consistent with this module's execFileSync-based style
// (no async/await anywhere else in it). Injectable so tests substitute a fake
// that records calls instead of actually blocking.
function defaultSleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function statePath(namespace, file) {
  return `${namespace}/${file}`;
}

// Keep the newest maxCount records by runAt, dropping the oldest.
function pruneRuns(runs, maxCount = MAX_RUN_HISTORY) {
  const sorted = [...runs].sort((a, b) => (a.runAt < b.runAt ? -1 : a.runAt > b.runAt ? 1 : 0));
  return sorted.slice(Math.max(0, sorted.length - maxCount));
}

// Upsert by fingerprint: a repeat failure increments attempts and updates
// lastError without disturbing firstFailedAt; a brand-new fingerprint starts
// at attempts:1.
function enqueueRetry(queue, entry, { now = Date.now() } = {}) {
  const idx = queue.findIndex((e) => e.fingerprint === entry.fingerprint);
  if (idx === -1) {
    return [
      ...queue,
      {
        fingerprint: entry.fingerprint,
        payload: entry.payload,
        firstFailedAt: new Date(now).toISOString(),
        attempts: 1,
        lastError: entry.lastError || null,
      },
    ];
  }
  const next = [...queue];
  next[idx] = { ...next[idx], attempts: next[idx].attempts + 1, lastError: entry.lastError || next[idx].lastError };
  return next;
}

function dequeueRetry(queue, fingerprint) {
  return queue.filter((e) => e.fingerprint !== fingerprint);
}

function shouldEscalate(entry) {
  return !!entry && entry.attempts >= ESCALATE_AFTER_ATTEMPTS;
}

// 30s — a hung git call fails fast instead of blocking the CLI invocation
// (and, transitively, the calling skill's Bash tool call) indefinitely.
// Callers can still override via opts, spread after this default.
const DEFAULT_RUN_TIMEOUT_MS = 30000;

function defaultRun(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', timeout: DEFAULT_RUN_TIMEOUT_MS, ...opts });
}

// namespace: the top-level path segment under the health-state branch's root
// tree (a skill name for the four health skills; a feature namespace like
// 'merge-lane' for any other caller).
// fileSpecs: [{ key, file, default, serialize? }] — key is the property name
// on the read/write value object; file is the bare filename under
// `{namespace}/`; default is what a missing/unreadable file resolves to;
// serialize is an optional (value) -> string override (defaults to
// `JSON.stringify(value, null, 2)`) for a field like the health skills'
// `runs` that needs pruning applied at write time.
//
// Returns { readState, writeState, readStateWithMeta }. readState/writeState
// match createDurableState's own shape (a flat value object keyed by each
// spec's `key`) so createDurableState can wrap this directly.
// readStateWithMeta additionally exposes fetchOk/missingRef/error so a
// caller needing fail-closed semantics on a genuine (non-missing-ref) fetch
// failure — merge-lane-breaker.js's Fail-closed read requirement — can react
// to that distinction; readState itself always degrades to defaults, same as
// before this extraction.
function createNamespacedState(namespace, fileSpecs, { run = defaultRun, sleep = defaultSleep } = {}) {
  const specs = Array.isArray(fileSpecs) ? fileSpecs : [];

  // `git show <ref>:<path>` works identically whether <ref> is a branch ref
  // (origin/<branch>) or a bare commit sha (LOCAL_REF's tip), so the
  // origin-tip read and the local-only write path share this one reader.
  function showFileAt(root, ref, relPath, fallback) {
    try {
      const out = run('git', ['-C', root, 'show', `${ref}:${relPath}`]);
      return JSON.parse(out);
    } catch {
      return fallback;
    }
  }

  // namespace-local branch ref used ONLY to stage writeStateLocal's
  // accumulated-but-unpushed commits — never fetched from or pushed to by
  // anything outside this namespace's own writeStateLocal/pushState pair.
  // Namespaced (not a single shared `health-state` local branch) so a
  // future second caller of writeStateLocal/pushState on the same root never
  // collides with this one, the same isolation the remote branch's
  // per-namespace subtree already gives every caller today.
  const LOCAL_REF = `refs/heads/${HEALTH_STATE_BRANCH}-local-${namespace}`;

  function localRefSha(root) {
    try {
      return run('git', ['-C', root, 'rev-parse', '--verify', '-q', LOCAL_REF]).trim();
    } catch {
      return null;
    }
  }

  function currentCommitSha(root) {
    try {
      return run('git', ['-C', root, 'rev-parse', `origin/${HEALTH_STATE_BRANCH}`]).trim();
    } catch {
      return null;
    }
  }

  // Combined commit+tree sha lookup for writeState's hot path — one process
  // spawn instead of two separate `git rev-parse` calls against the exact
  // same already-fetched ref, on every CAS attempt.
  function currentRefShas(root) {
    try {
      const out = run('git', ['-C', root, 'rev-parse', `origin/${HEALTH_STATE_BRANCH}`, `origin/${HEALTH_STATE_BRANCH}^{tree}`]);
      const lines = out.trim().split('\n');
      return { commitSha: lines[0] ? lines[0].trim() : null, treeSha: lines[1] ? lines[1].trim() : null };
    } catch {
      return { commitSha: null, treeSha: null };
    }
  }

  // Read every fileSpec at whatever branch tip the caller already fetched,
  // WITHOUT triggering another network fetch. Shared by readStateWithMeta
  // below (which fetches first, for standalone callers) and by writeState's
  // own CAS loop (which already fetched once per attempt). The loop must
  // never call the fetch-then-read path a second time: a redundant fetch
  // transiently failing would make that path silently degrade to empty
  // defaults and hand the mutator bogus near-empty state, durably
  // overwriting the branch's real content even though the push's
  // fast-forward check has no way to catch a bad-but-valid write like that.
  function readFilesAtFetchedTip(root) {
    return readFilesAt(root, `origin/${HEALTH_STATE_BRANCH}`);
  }

  // Same read at an arbitrary ref/sha (or falsy for "nothing to read yet" —
  // the brand-new-namespace case, where every spec resolves straight to its
  // default with no git call at all). writeStateLocal/pushState use it to
  // read this namespace's state at the LOCAL branch's own tip.
  function readFilesAt(root, ref) {
    const values = {};
    for (const spec of specs) {
      values[spec.key] = ref ? showFileAt(root, ref, statePath(namespace, spec.file), spec.default) : spec.default;
    }
    return values;
  }

  // { values, fetchOk, missingRef, error } — the meta-carrying read. `values`
  // always resolves to something usable (defaults on any fetch failure);
  // `fetchOk`/`missingRef`/`error` let a caller distinguish "branch/file
  // genuinely never written" (fetchOk:false, missingRef:true) from any other
  // read failure (fetchOk:false, missingRef:false, error set) — network/auth/
  // timeout — which a fail-closed caller treats differently from a first run.
  function readStateWithMeta(root) {
    try {
      run('git', ['-C', root, 'fetch', 'origin', HEALTH_STATE_BRANCH]);
    } catch (err) {
      const missingRef = /couldn't find remote ref/i.test(String(err.message));
      const values = {};
      for (const spec of specs) values[spec.key] = spec.default;
      return { values, fetchOk: false, missingRef, error: err };
    }
    return { values: readFilesAtFetchedTip(root), fetchOk: true, missingRef: false, error: null };
  }

  // Reads never throw: a missing branch/file degrades to the empty default,
  // matching cache.js's existing "corrupt/missing JSON -> {}" convention.
  function readState(root) {
    const meta = readStateWithMeta(root);
    if (!meta.fetchOk && !meta.missingRef) {
      // Distinguish a genuine first run (the branch simply doesn't exist yet)
      // from a real fetch failure (network/auth/timeout) — both degrade to
      // the same defaults, but only the latter is worth a trace.
      process.stderr.write(`health-state: fetch failed, treating as empty state: ${meta.error.message}\n`);
    }
    return meta.values;
  }

  // ─── git-native tree/commit primitives ───────────────────────────────────
  // Replace the old GitHub Data API calls (gh api .../git/blobs|trees|
  // commits|refs) one-for-one with plain git plumbing that writes to the
  // LOCAL object database and publishes with a single `git push` at the end
  // — no `gh` CLI, no MCP dependency, works identically local or in a cloud
  // Routine sandbox (see this file's header comment).

  // Parses `git ls-tree <treeSha>` output (one entry per line: "<mode> SP
  // <type> SP <sha> TAB <name>") into a Map keyed by name, so callers can
  // splice in new entries without disturbing ones they don't touch. Returns
  // an empty Map for a falsy/EMPTY_TREE_SHA treeSha or any sha git can't
  // resolve (a not-yet-existing subtree on this namespace's very first write).
  function readTreeEntries(root, treeSha) {
    const entries = new Map();
    if (!treeSha || treeSha === EMPTY_TREE_SHA) return entries;
    let out;
    try {
      out = run('git', ['-C', root, 'ls-tree', treeSha]);
    } catch {
      return entries;
    }
    for (const line of out.split('\n')) {
      if (!line) continue;
      const tabIdx = line.indexOf('\t');
      const [mode, type, sha] = line.slice(0, tabIdx).split(' ');
      const name = line.slice(tabIdx + 1);
      entries.set(name, { mode, type, sha });
    }
    return entries;
  }

  // Writes `content` as a git blob object and returns its sha. Never touches
  // the network — `hash-object -w` writes to the LOCAL object database only;
  // publishing happens later, in one shot, via pushRef.
  function writeBlob(root, content) {
    return run('git', ['-C', root, 'hash-object', '-w', '--stdin'], { input: content }).trim();
  }

  // entries: Map<name, {mode, type, sha}> (see readTreeEntries). Serializes
  // to `git mktree`'s expected stdin format and returns the new tree sha.
  // Sort order: plain lexicographic-by-name is sufficient here because this
  // branch's actual layout never mixes blob and tree entries at the same
  // tree level (root = one tree entry per namespace; each namespace's own
  // subtree = only blob entries, no nesting) — git's tree-sort
  // trailing-slash-for-directories nuance never applies to this data shape.
  function writeTree(root, entries) {
    const names = [...entries.keys()].sort();
    const input = names
      .map((name) => {
        const { mode, type, sha } = entries.get(name);
        return `${mode} ${type} ${sha}\t${name}`;
      })
      .join('\n') + (names.length ? '\n' : '');
    return run('git', ['-C', root, 'mktree'], { input }).trim();
  }

  // parentSha: null for the very first commit on this branch (omits -p).
  function writeCommit(root, treeSha, parentSha, message) {
    const args = ['-C', root, 'commit-tree', treeSha];
    if (parentSha) args.push('-p', parentSha);
    args.push('-m', message);
    return run('git', args).trim();
  }

  // The compare-and-swap: a plain (non-force) push creates the ref if it
  // doesn't exist yet, fast-forward-updates it if it does, and is rejected
  // (throws) if commitSha is not a fast-forward of whatever the remote
  // actually has right now — no separate create-vs-update distinction
  // needed, unlike the GitHub Data API's POST-vs-PATCH split this replaces.
  function pushRef(root, commitSha) {
    run('git', ['-C', root, 'push', 'origin', `${commitSha}:refs/heads/${HEALTH_STATE_BRANCH}`]);
  }

  function buildFiles(next) {
    return specs.map((spec) => {
      const value = next[spec.key] !== undefined ? next[spec.key] : spec.default;
      const serialize = spec.serialize || ((v) => JSON.stringify(v, null, 2));
      return { path: statePath(namespace, spec.file), content: serialize(value) };
    });
  }

  // Merges buildFiles' output into this namespace's existing subtree
  // (preserving any file this write doesn't touch — e.g. a stale file left
  // over from a prior opt-in period), then splices the result into the
  // branch's root tree (adding this namespace's entry if it's the
  // namespace's first-ever write, replacing it otherwise). Returns the new
  // root tree sha.
  function buildRootTree(root, baseTreeSha, files) {
    const rootEntries = readTreeEntries(root, baseTreeSha);
    const existingNamespaceEntry = rootEntries.get(namespace);
    const namespaceEntries = readTreeEntries(root, existingNamespaceEntry ? existingNamespaceEntry.sha : null);
    for (const file of files) {
      // file.path is "{namespace}/{name}" (see statePath) — strip the
      // namespace prefix to get the bare filename this subtree uses as its
      // own entry key.
      const name = file.path.slice(namespace.length + 1);
      namespaceEntries.set(name, { mode: '100644', type: 'blob', sha: writeBlob(root, file.content) });
    }
    const newNamespaceTreeSha = writeTree(root, namespaceEntries);
    rootEntries.set(namespace, { mode: '040000', type: 'tree', sha: newNamespaceTreeSha });
    return writeTree(root, rootEntries);
  }

  function writeState(root, mutatorFn) {
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
      let commitSha = null;
      try {
        try {
          run('git', ['-C', root, 'fetch', 'origin', HEALTH_STATE_BRANCH]);
        } catch {
          // Branch doesn't exist yet (this namespace's first-ever write) or a
          // transient fetch failure — either way, fall through and attempt
          // the write below. A genuinely first-ever branch legitimately has
          // nothing to fetch; a transient failure self-corrects on retry (a
          // push against stale/absent tracking data is rejected as
          // non-fast-forward if the branch actually has unrelated remote
          // history, and the next attempt re-fetches from scratch).
        }
        const { commitSha: parentSha, treeSha: baseTreeSha } = currentRefShas(root);
        const current = readFilesAtFetchedTip(root);
        const next = mutatorFn(current);
        const files = buildFiles(next);
        const rootTreeSha = buildRootTree(root, baseTreeSha, files);
        commitSha = writeCommit(root, rootTreeSha, parentSha, `health-state: ${namespace} update`);
        pushRef(root, commitSha);
        return { ok: true };
      } catch (err) {
        lastError = err;
        // The commit we attempted to point the ref at was successfully built
        // (writeCommit succeeded) and pushRef then failed — but "failed" here
        // is ambiguous: it could be a genuine rejection (branch moved to a
        // DIFFERENT commit, fast-forward check failed — safe to retry) or the
        // push actually landed server-side and only the local process saw an
        // error (a network drop after the remote processed it). Blindly
        // retrying in the ambiguous case would re-run mutatorFn a SECOND time
        // against its own already-applied result — silently double-counting
        // a non-idempotent mutator like enqueueRetry's attempts++ for a
        // single real failure. Re-fetching and re-checking the ref here tells
        // the two apart: if it now points at the commit we just tried to set,
        // our push DID land and this attempt must be treated as a success,
        // not retried.
        if (commitSha) {
          try { run('git', ['-C', root, 'fetch', 'origin', HEALTH_STATE_BRANCH]); } catch { /* see tolerant-fetch comment above */ }
          if (currentCommitSha(root) === commitSha) return { ok: true };
        }
        if (attempt < MAX_CAS_ATTEMPTS) sleep(casBackoffMs(attempt));
      }
    }
    return { ok: false, error: lastError && lastError.message };
  }

  // Local-only counterpart to writeState: commits the mutation onto this
  // namespace's own LOCAL_REF (never origin) and never calls pushRef, so a
  // caller invoking this repeatedly (e.g. once per analysed skill in a
  // single wrap-up row) accumulates every write on LOCAL_REF with zero
  // remote pushes. Each call's base is LOCAL_REF's own current tip when one
  // already exists (so it builds on this session's own prior local writes),
  // falling back to origin/<branch>'s tip to seed the very first local write
  // of a session. No CAS retry loop: unlike writeState, this never contends
  // with a remote push, so a failure here (not a git repo, I/O error) is
  // deterministic and retrying would just fail identically every time.
  function writeStateLocal(root, mutatorFn) {
    try {
      try { run('git', ['-C', root, 'fetch', 'origin', HEALTH_STATE_BRANCH]); } catch { /* tolerant — see writeState's own comment */ }
      const localSha = localRefSha(root);
      const baseSha = localSha || currentCommitSha(root);
      const current = readFilesAt(root, baseSha);
      const next = mutatorFn(current);
      const files = buildFiles(next);
      const rootTreeSha = buildRootTree(root, baseSha, files);
      const commitSha = writeCommit(root, rootTreeSha, baseSha, `health-state: ${namespace} update (local)`);
      // Atomic local compare-and-swap — guards only against a concurrent
      // same-checkout writer racing this same namespace between the read
      // above and this update; there is no remote race to guard against,
      // since this never touches origin.
      const updateRefArgs = ['-C', root, 'update-ref', LOCAL_REF, commitSha];
      if (localSha) updateRefArgs.push(localSha);
      run('git', updateRefArgs);
      return { ok: true, local: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  // Ships everything writeStateLocal has accumulated on LOCAL_REF to origin
  // in exactly one `git push` (one ref-advance event), the counterpart half
  // of the local/push split. A no-op, successful return when nothing has
  // been locally recorded since the last push — either LOCAL_REF was never
  // set (nothing ever recorded), or it already equals origin's current tip
  // (a prior pushState call already shipped it and nothing new has been
  // recorded since). Re-anchors this namespace's locally-accumulated FINAL
  // state onto origin's current tip at push time — never the local ref's own
  // (possibly stale) base — so a different namespace's write that landed on
  // origin while this one was accumulating locally is preserved rather than
  // clobbered by a stale local snapshot of it (the same per-namespace-subtree
  // isolation buildRootTree already gives writeState's own CAS loop).
  function pushState(root) {
    const localSha = localRefSha(root);
    if (!localSha) return { ok: true, pushed: false };
    let lastError = null;
    for (let attempt = 1; attempt <= MAX_CAS_ATTEMPTS; attempt++) {
      let commitSha = null;
      try {
        try { run('git', ['-C', root, 'fetch', 'origin', HEALTH_STATE_BRANCH]); } catch { /* tolerant — see writeState's own comment */ }
        const origin = currentRefShas(root);
        if (localSha === origin.commitSha) return { ok: true, pushed: false };
        const files = buildFiles(readFilesAt(root, localSha));
        const rootTreeSha = buildRootTree(root, origin.treeSha, files);
        commitSha = writeCommit(root, rootTreeSha, origin.commitSha, `health-state: ${namespace} update`);
        pushRef(root, commitSha);
        run('git', ['-C', root, 'update-ref', LOCAL_REF, commitSha]);
        return { ok: true, pushed: true };
      } catch (err) {
        lastError = err;
        // Same ambiguous-failure handling as writeState's own retry loop —
        // see its comment for why this re-check is necessary before retrying.
        if (commitSha) {
          try { run('git', ['-C', root, 'fetch', 'origin', HEALTH_STATE_BRANCH]); } catch { /* see tolerant-fetch comment above */ }
          if (currentCommitSha(root) === commitSha) {
            run('git', ['-C', root, 'update-ref', LOCAL_REF, commitSha]);
            return { ok: true, pushed: true };
          }
        }
        if (attempt < MAX_CAS_ATTEMPTS) sleep(casBackoffMs(attempt));
      }
    }
    return { ok: false, error: lastError && lastError.message };
  }

  return {
    readState, writeState, readStateWithMeta, writeStateLocal, pushState,
  };
}

// Thin wrapper over createNamespacedState, fixing the four health skills'
// cursors/retryQueue/runs(/remembered)(/declined) shape — see the header
// comment above for why the generic primitive lives separately.
function createDurableState(skillName, {
  run = defaultRun, sleep = defaultSleep, includeRemembered = false, includeDeclined = false,
} = {}) {
  const fileSpecs = [
    { key: 'cursors', file: 'cursors.json', default: {} },
    { key: 'retryQueue', file: 'retry-queue.json', default: [] },
    // Pruning happens at write time (mirrors the pre-extraction behavior:
    // `JSON.stringify(pruneRuns(next.runs), null, 2)`), not at read time —
    // a read returns exactly what's on the branch tip.
    { key: 'runs', file: 'runs.json', default: [], serialize: (v) => JSON.stringify(pruneRuns(Array.isArray(v) ? v : []), null, 2) },
  ];
  // Gated on the skill-level includeRemembered/includeDeclined flags, NOT on
  // runtime truthiness of a mutator's returned value — an empty {} is truthy,
  // so inferring from data shape would write a spurious remembered.json/
  // declined.json for a skill that never opted in the first time any mutator
  // merely spreads ...current without deleting the key. Deciding this once,
  // at createDurableState call time, rules that out — and, symmetrically, a
  // skill that never opts in must never see the key in a read result at all
  // (readState above only ever populates keys present in fileSpecs).
  if (includeRemembered) fileSpecs.push({ key: 'remembered', file: 'remembered.json', default: {} });
  if (includeDeclined) fileSpecs.push({ key: 'declined', file: 'declined.json', default: {} });

  const {
    readState, writeState, writeStateLocal, pushState,
  } = createNamespacedState(skillName, fileSpecs, { run, sleep });
  return {
    readState, writeState, writeStateLocal, pushState,
  };
}

module.exports = {
  HEALTH_STATE_BRANCH,
  MAX_RUN_HISTORY,
  ESCALATE_AFTER_ATTEMPTS,
  MAX_CAS_ATTEMPTS,
  statePath,
  pruneRuns,
  enqueueRetry,
  dequeueRetry,
  shouldEscalate,
  casBackoffMs,
  createDurableState,
  createNamespacedState,
  defaultSleep,
};
