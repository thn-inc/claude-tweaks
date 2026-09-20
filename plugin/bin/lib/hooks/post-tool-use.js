// bin/lib/hooks/post-tool-use.js — E2: commit breadcrumbs (log tier) + closing-keyword check (warn tier) + design-doc capture nudge (warn tier) + plugin-version-bump release-follow-up nudge (warn tier) + EnterWorktree staleness backstop (warn tier) + post-teardown re-anchor backstop (warn tier, see checkPostTeardownReanchor below) + ad-hoc-session run-dir stamping (log tier, see stampAdHocRunDir below) + skill-invocation ledger (log tier, see ./skill-invocation.js) + AskUserQuestion ledger (log tier, see logAskUserQuestion below).
'use strict';
const fs = require('fs');
const path = require('path');
const { gitTargets } = require('./git-command');
const ctxLib = require('./context');
const runDirResolve = require('./run-dir-resolve');
const skillInvocation = require('./skill-invocation');
const wtDetect = require('./worktree-detect');
// Reused, not reimplemented (#703): the same teardown-target resolution
// pre-tool-use.js's own checkTeardownGate relies on. Safe to require here —
// pre-tool-use.js never requires this file back.
const preToolUse = require('./pre-tool-use');
// These three call sites are informational (commit breadcrumbs, plugin-version
// detection), not policy decisions — every failure kind resolves to "skip this
// check" identically, so they read `.stdout` and ignore `.failure`. The
// indeterminate/definitive distinction runGit now draws matters only where a
// gate acts on the answer (worktree-detect -> pre-tool-use's worktree gate).
const { runGit, isIndeterminate } = require('./git-exec');
const { ISSUE_REF_SOURCE } = require('../issue-branch-tracking');
// Reused rather than reimplemented a third time (CLAUDE.md's don't-duplicate
// rule) — `resolveIntegrationBranch`'s fallback profile (no explicit arg,
// policy.yml then origin/HEAD) fits this file's EnterWorktree handler as-is.
// `parseWorktreeList` is reused for the same reason, for the tool-result
// fallback path below.
const { resolveIntegrationBranch, parseWorktreeList, bareIntegrationName } = require('./worktree-reap');
// Session-scoped marker path for the non-EnterWorktree ad-hoc-run-dir rate-limit (#1333) — see
// stampAdHocRunDir below.
const { sessionTmpPath } = require('../session-tmp');

// Field/record separators for recentCommits' combined --format string below.
// ASCII 0x1f/0x1e (unit/record separator) — practically never appear in a
// real commit message, and even if one somehow did, the worst case is a
// misparsed WARN-tier message, not an enforcement gap.
const FIELD_SEP = '\x1f';
const REC_SEP = '\x1e';

// Reads back a dir's `count` most recent commits at HEAD — hash, committer
// timestamp, and full message — in ONE git spawn instead of one spawn per
// field per target. A single Bash invocation can chain multiple `git
// commit` statements against the SAME dir (e.g. `git commit -m a && git
// commit --allow-empty -m b`); querying "the commit at dir X" once per
// commit-action TARGET previously always read back the same current-HEAD
// commit for every one of them, so only the last of several real commits
// was ever actually evaluated. Returns newest-first (git log's own order),
// each entry `{ hash, ts, message }` (ts null if unparseable).
function recentCommits(dir, count) {
  if (count <= 0) return [];
  const { stdout: out } = runGit(['log', '-n', String(count), `--format=%h${FIELD_SEP}%ct${FIELD_SEP}%B${REC_SEP}`], dir);
  if (out === null) return [];
  return out
    .split(REC_SEP)
    // git inserts a newline after each formatted record; that newline lands
    // as a LEADING '\n' on every record after the first once split on
    // REC_SEP (the record's own content comes before its trailing '\n').
    .map((rec, i) => (i === 0 ? rec : rec.replace(/^\n/, '')))
    .filter((rec) => rec.length > 0)
    .map((rec) => {
      const firstSep = rec.indexOf(FIELD_SEP);
      const secondSep = rec.indexOf(FIELD_SEP, firstSep + 1);
      if (firstSep === -1 || secondSep === -1) return { hash: null, ts: null, message: rec };
      const hash = rec.slice(0, firstSep);
      const ts = Number(rec.slice(firstSep + 1, secondSep));
      const message = rec.slice(secondSep + 1);
      return { hash, ts: Number.isFinite(ts) ? ts : null, message };
    });
}

// How recent HEAD's commit timestamp must be for checkClosingKeyword to trust it
// as the outcome of the just-attempted commit, rather than a stale prior commit.
// Generous enough to absorb hook-dispatch latency and clock skew without letting a
// genuinely unrelated older commit through.
const COMMIT_FRESHNESS_WINDOW_SECONDS = 30;

// A recognized GitHub closing keyword immediately preceding a bare "#123" auto-closes
// that issue when the commit reaches the repository's default branch. Case-insensitive;
// covers every form GitHub recognizes (fix/fixes/fixed, close/closes/closed,
// resolve/resolves/resolved) — the same vocabulary bin/lib/issue-branch-tracking.js
// already exports as ISSUE_REF_SOURCE for the generated GitHub Actions workflow, reused
// here (composed with a trailing `$`) rather than hand-rolled a second time, so the two
// can never silently disagree about which keywords GitHub recognizes. The trailing `$`
// anchors this to the END of whatever substring it's tested against (see hasUnclosedRef
// below, which always tests a slice ending exactly at the current ref) — without it,
// "Fixes #100, #200" would wrongly read as closing #200 too, since "Fixes #100" sits
// inside the lookback window before #200 even though the keyword only ever applied to
// #100. GitHub requires the keyword immediately before EACH ref it closes ("Fixes #100,
// fixes #200"); a bare trailing ref after a comma is exactly the gotcha this check
// exists to catch. Deliberately no 'g' flag — this is reused across a `.test()` call per
// match below, and a global flag's stateful lastIndex would silently skip matches.
const CLOSING_KEYWORD_RE = new RegExp(ISSUE_REF_SOURCE + '$', 'i');
const BARE_ISSUE_REF_RE = /#\d+/g;

// Deliberately NOT gated on ctx.runDir, unlike the breadcrumb logic below — the
// motivating case is exactly a commit made outside any pipeline run (ad hoc fix
// work that references an issue number without going through /specify -> /build
// -> /wrap-up, where the closing-keyword carrier-commit mechanism already exists).
// Harness-wide, not code-health-specific: fires for any bare issue reference,
// including harness-health-labelled or human-filed issues.
//
// Takes `recentByDir` (dir -> that dir's own recentCommits() results, built
// once in run() and shared with the breadcrumb loop) rather than the raw
// target list, so each of possibly several commit-action targets sharing one
// dir is checked against its OWN commit instead of every target re-reading
// back the same current-HEAD commit.
function checkClosingKeyword(recentByDir) {
  for (const commits of recentByDir.values()) {
    for (const commit of commits) {
      // Guard against a `git commit` that never actually landed — see
      // recentCommits()'s comment. If this commit isn't fresh, skip it
      // entirely rather than judging an unrelated prior commit.
      if (commit.ts === null || Math.abs(Date.now() / 1000 - commit.ts) > COMMIT_FRESHNESS_WINDOW_SECONDS) continue;
      const message = commit.message;
      if (!message) continue;
      // Group occurrences by issue number rather than testing each occurrence in
      // isolation: the same issue can legitimately appear twice in one message
      // (once bare for context, once with a proper closing keyword), and it only
      // takes ONE closing occurrence to auto-close it. Each match's own `.index`
      // (not `message.indexOf(ref)`, which always resolves to the FIRST
      // occurrence of a repeated ref) keeps repeated identical refs from all
      // being tested against the same "before" slice.
      const matches = [...message.matchAll(BARE_ISSUE_REF_RE)];
      if (matches.length === 0) continue;
      const closedRefs = new Set();
      const seenRefs = new Set();
      for (const match of matches) {
        const ref = match[0];
        seenRefs.add(ref);
        const idx = match.index;
        // Slice from the START of the message, not a fixed lookback window —
        // a fixed window (previously 20 chars) can slice off part of a longer
        // word immediately before the ref (e.g. the "un" in "unresolved"), and
        // JS regex's \b treats the truncated slice's own start as a boundary
        // even though none exists in the real message. CLOSING_KEYWORD_RE's
        // trailing `$` anchors the match to the ref at the end of this slice
        // regardless of how much leading text precedes it, so slicing from 0
        // costs nothing in correctness and removes the truncation risk
        // entirely.
        const before = message.slice(0, idx + ref.length);
        if (CLOSING_KEYWORD_RE.test(before)) closedRefs.add(ref);
      }
      const hasUnclosedRef = [...seenRefs].some((ref) => !closedRefs.has(ref));
      if (hasUnclosedRef) {
        return {
          json: {
            systemMessage:
              'claude-tweaks: this commit references an issue number without a recognized GitHub ' +
              'closing keyword (Fixes/Closes/Resolves) immediately before it — it will not auto-close ' +
              'that issue when merged. If this commit fully resolves the issue, consider rewording ' +
              '(e.g. "Fixes #123").',
          },
        };
      }
    }
  }
  return null;
}

// Deferred-subproject capture nudge (warn tier). superpowers:brainstorming
// identifies oversized requests and defers all but the first sub-project to
// "later" with no durable tracking — they live only in conversation memory
// and are lost on /clear. This fires whenever a brainstorming design doc is
// written, unconditionally: it does not try to parse whether decomposition
// actually happened (unreliable prose classification), same "cheap false
// positive, no smart detection" precedent checkClosingKeyword sets above.
// Matching on the Write call itself (not "new file only") also means this
// re-fires if Step 7's self-review later revises the same design doc.
const DESIGN_DOC_PATH_RE = /(^|\/)docs\/superpowers\/specs\/[^/]+-design\.md$/;

function checkDesignDocWrite(ctx) {
  if (ctx.input.tool_name !== 'Write') return null;
  const filePath = ctx.input.tool_input && ctx.input.tool_input.file_path;
  if (typeof filePath !== 'string' || !DESIGN_DOC_PATH_RE.test(filePath)) return null;
  return {
    json: {
      systemMessage:
        'claude-tweaks: a design doc was just written under docs/superpowers/specs/. If ' +
        'brainstorming identified other independent sub-projects and deferred them to focus ' +
        'on this one, capture each deferred sub-project now via /claude-tweaks:capture — they ' +
        "aren't tracked anywhere else, and will be lost once this conversation clears.",
    },
  };
}

// Release-follow-up nudge (warn tier). This repo's release convention
// (CLAUDE.md's "Releasing (two repos)") hangs two steps off a plugin.json
// version bump: a CHANGELOG.md entry, and mirroring the version into the
// separate claude-tweaks-marketplace repo's marketplace.json. The mirror was
// missed twice in practice before this check existed; the changelog was missed
// 103 times out of 145 releases, because until the coverage gate in
// tests/changelog-coverage.test.js nothing checked and the convention never
// actually named the step.
//
// This nudge is the cheap half. It fires after the fact and can be ignored, so
// it complements rather than replaces the gate — the gate is what makes an
// omission fail. Fires unconditionally whenever a
// commit touches the plugin manifest at all, without trying to
// parse whether the change was actually a version bump (same "cheap false
// positive, no smart detection" precedent checkClosingKeyword and
// checkDesignDocWrite set above) — plugin.json changes for any other reason
// are rare enough that a false-positive reminder costs nothing.
//
// Scoped to this specific project via the committed file's own `name` field
// rather than the path alone: a `.claude-plugin/plugin.json` is the standard
// manifest for ANY Claude Code plugin repo, so an unscoped check would
// misfire with an irrelevant release-follow-up reminder in a completely
// unrelated plugin repo that happens to have this plugin active.
//
// Both manifest spellings are in play: #418 moved this payload under `plugin/`,
// and the parent-commit comparison below reaches back across that boundary.
const { MANIFEST_PATHS, readManifestAtRef } = require('../manifest-path');
const { RECORD_PATH: SHIPPED_RECORD_PATH } = require('../shipped-record');

// Release-bypass check (#307). `bin/lib/release/compose.js` is the only
// writer of the manifest's `version` field in code, reached only through
// `bin/lib/release/run.js`'s own precheck/ancestry-check chain — a hand-edit
// via Edit/Write bypasses both entirely, with no signal today. A commit that
// actually went through `bin/release.js` always carries this exact shape
// (CLAUDE.md's "Commit message style", applied to the release commit
// specifically). Anything touching the version field without it skipped the
// script.
const RELEASE_COMMIT_MESSAGE_RE = /^Release v[\d.]+ — /;

function checkPluginVersionBump(recentByDir) {
  for (const [dir, commits] of recentByDir) {
    for (const commit of commits) {
      // Same freshness guard as checkClosingKeyword — don't judge a stale
      // HEAD left over from a `git commit` that never actually landed.
      if (commit.ts === null || Math.abs(Date.now() / 1000 - commit.ts) > COMMIT_FRESHNESS_WINDOW_SECONDS) continue;
      if (!commit.hash) continue;
      const { stdout: changedFiles } = runGit(['diff-tree', '--no-commit-id', '--name-only', '-r', commit.hash], dir);
      if (changedFiles === null) continue;
      const changedPaths = changedFiles.split('\n');
      const touchedPath = MANIFEST_PATHS.find((p) => changedPaths.includes(p));
      if (!touchedPath) continue;
      const { stdout: manifestAtCommit } = runGit(['show', `${commit.hash}:${touchedPath}`], dir);
      if (manifestAtCommit === null) continue;
      let manifest;
      try {
        manifest = JSON.parse(manifestAtCommit);
      } catch {
        continue;
      }
      if (manifest.name !== 'claude-tweaks') continue;

      // Name only what is actually outstanding. A blanket reminder that repeats
      // three steps every time is the kind a reader learns to skim — and the
      // changelog step was skimmed for 103 of 145 releases while a hook fired on
      // this exact trigger (`[IL-94]`). Both same-commit obligations are
      // readable from the commit itself, so check them instead of listing them.
      const version = typeof manifest.version === 'string' ? manifest.version : null;
      const outstanding = [];

      const { stdout: changelogAtCommit } = runGit(['show', `${commit.hash}:CHANGELOG.md`], dir);
      if (version && (changelogAtCommit === null || !changelogAtCommit.includes(`## v${version} — `))) {
        outstanding.push(`CHANGELOG.md needs a "## v${version} — {summary}" entry directly under the "# Changelog" header`);
      }

      const { stdout: recordAtCommit } = runGit(['show', `${commit.hash}:${SHIPPED_RECORD_PATH}`], dir);
      if (version && (recordAtCommit === null || !new RegExp(`^${version.replace(/\./g, '\\.')}\t`, 'm').test(recordAtCommit))) {
        outstanding.push(`${SHIPPED_RECORD_PATH} needs a "${version}\t{YYYY-MM-DD}\trelease" line`);
      }

      // Release-bypass check (#307): compare against the PARENT commit's
      // manifest, JSON-parsed the same way as the current commit — not a
      // textual/staged-hunk heuristic, and not index/staged state (this
      // handler runs PostToolUse, after the commit already landed). Skip
      // merge commits: a legitimate merge carrying a concurrent release's
      // version bump must not read as a bypass. `commit.hash^` resolves to
      // the first parent; for a root commit (no parent) `git show` fails,
      // `parentManifestRaw` stays null, and no comparison is made — fails
      // open rather than misreading "no prior version" as a bypass.
      if (version) {
        const { stdout: parentsRaw } = runGit(['show', '-s', '--format=%P', commit.hash], dir);
        const parentHashes = parentsRaw === null ? [] : parentsRaw.trim().split(/\s+/).filter(Boolean);
        if (parentHashes.length <= 1) {
          // Both spellings: on the cutover commit itself the parent still carries
          // the manifest at the old path, and reading only the new one there would
          // fail open on exactly the commit most likely to be hand-edited.
          const { text: parentManifestRaw } = readManifestAtRef(
            (p) => runGit(['show', `${commit.hash}^:${p}`], dir).stdout,
          );
          let parentVersion = null;
          if (parentManifestRaw !== null) {
            try {
              const parentManifest = JSON.parse(parentManifestRaw);
              parentVersion = typeof parentManifest.version === 'string' ? parentManifest.version : null;
            } catch { /* unparseable parent manifest -> no comparison, fail open */ }
          }
          if (parentVersion !== null && parentVersion !== version && !RELEASE_COMMIT_MESSAGE_RE.test(commit.message)) {
            outstanding.push('`plugin/bin/release.js` appears to have been bypassed for this version change');
          }
        }
      }

      // Unverifiable from here — it lives in a separate repository. Since #418 the
      // catalog entry is a git-subdir source pinned by commit sha and carries no
      // `version` field at all, so the step is a re-pin, not a version copy.
      outstanding.push(
        "re-pin claude-tweaks-marketplace's marketplace.json at this release commit " +
        '(plugins[].source.sha — the entry carries no version field)',
      );

      return {
        json: {
          systemMessage:
            `claude-tweaks: this commit touched ${touchedPath}${version ? ` (now ${version})` : ''}. ` +
            `Outstanding from CLAUDE.md's "Releasing (two repos)": ${outstanding.join('; ')}. ` +
            'The first two belong in this commit — amend rather than following up, or the suite goes red.',
        },
      };
    }
  }
  return null;
}

// EnterWorktree staleness backstop (#307, warn tier). `skills/_shared/
// worktree-setup.md`'s "Post-creation catch-up" section is the canonical
// fetch+merge procedure every worktree-creation call site is supposed to
// cite. This is the mechanical backstop for a future call site that forgets
// to: if a freshly-created worktree is already behind the resolved
// integration branch's `origin/{branch}`, warn — the catch-up itself stays
// agent/skill-driven (this hook only warns, per #307's Non-Goals; it never
// fetches+merges on the caller's behalf).
const WORKTREE_FETCH_TIMEOUT_MS = 20000; // network-bound; longer than git-exec's local-op default budget

// The EnterWorktree tool result's shape, observed directly from real
// transcripts (this plugin does not own or version-pin it — see this file's
// header contract and #307's Gotchas):
//   "Created worktree at <path> on branch <branch>. ..."   (new worktree)
//   "Entered worktree at <path> on branch <branch>. ..."   (existing worktree)
// A frozen-fixture concern, not a live-output one — tests below exercise this
// against literal strings, never a real invocation of the tool itself.
const ENTER_WORKTREE_PATH_RE = /(?:Created|Entered) worktree at (.+?) on branch\b/;

// `tool_response` shapes seen across this plugin's hook consumers vary (a
// bare string, `{content: string}`, or an Anthropic-style content-block
// array) — none of them are a contract this file owns, so all three are
// handled rather than assuming one.
function extractToolResponseText(toolResponse) {
  if (typeof toolResponse === 'string') return toolResponse;
  if (!toolResponse || typeof toolResponse !== 'object') return null;
  if (typeof toolResponse.content === 'string') return toolResponse.content;
  if (Array.isArray(toolResponse.content)) {
    const block = toolResponse.content.find((b) => b && typeof b.text === 'string');
    if (block) return block.text;
  }
  return null;
}

// Resolves the worktree path EnterWorktree just created/entered. Primary
// path: parse it straight out of the tool result (see ENTER_WORKTREE_PATH_RE
// above). Fallback, per #307's Deliverables — the tool result did not expose
// it in a recognized shape: `git worktree list --porcelain` (parsed via
// worktree-reap.js's own parser, not a second copy) and take the entry
// matching the session's own tracked cwd. This is deliberately a single
// snapshot, not a genuine before/after diff — no PreToolUse companion for
// EnterWorktree exists to capture a "before" list — but it is equivalent for
// this purpose: the entry matching the caller's OWN cwd is definitionally the
// one EnterWorktree just switched this session into.
// The porcelain-based lookup half of resolveCreatedWorktreePath below, split out (#1333) so a
// non-EnterWorktree caller (stampAdHocRunDir's widened trigger) can reuse this exact lookup
// without going through the EnterWorktree-tool-response-text fast path first — there is no
// tool_response shaped like an EnterWorktree result to parse for any other tool name, so that
// fast path would only ever waste a regex test for those callers, never actually match.
// Returns `{ path, isMain }` — `isMain` is true for the entry `git worktree list` always lists
// first (the primary/main checkout, per git's own porcelain output convention) — or null when
// `ctx.cwd` doesn't resolve to a listed worktree at all (not a git repo, or the `git worktree
// list` call itself failed).
function resolveWorktreePathViaPorcelain(ctx) {
  const cwd = ctx.cwd;
  if (typeof cwd !== 'string' || !cwd) return null;
  const { stdout, failure } = runGit(['worktree', 'list', '--porcelain'], cwd);
  if (failure || stdout === null) return null;
  const entries = parseWorktreeList(stdout);
  const idx = entries.findIndex((e) => e.path === cwd);
  if (idx === -1) return null;
  return { path: entries[idx].path, isMain: idx === 0 };
}

function resolveCreatedWorktreePath(ctx) {
  const text = extractToolResponseText(ctx.input.tool_response);
  if (text) {
    const m = ENTER_WORKTREE_PATH_RE.exec(text);
    if (m) return m[1];
  }
  const viaPorcelain = resolveWorktreePathViaPorcelain(ctx);
  return viaPorcelain ? viaPorcelain.path : null;
}

// Ad-hoc-session run-dir stamping (#500, log-tier bookkeeping only — never
// surfaces a message to the operator). An ad-hoc worktree dev session (one
// that implements a change directly at the user's request, outside any
// /claude-tweaks:build or /claude-tweaks:flow pipeline) has no run dir until
// /claude-tweaks:wrap-up eventually creates one for its own reflect pass —
// so any wd-deny/gate-denial/contract-violation/ask-user-question incurred
// BEFORE that point has nowhere to log to (appendEvent no-ops without a
// runDir: bin/lib/hooks/context.js's `path.join(runDir, ...)` throws on a
// null runDir, caught by its own best-effort try/catch). Stamping a
// lightweight run dir here, at EnterWorktree time, closes that gap:
// appendEvent starts working from the very next hook call in this session.
// skills/reflect/full-mode.md's Friction Lens documents the read side.
//
// Fires only when this session owns NO run dir yet (`ctx.ownedRun.dir` is
// null) — a formal pipeline invocation that already resolved or minted its
// own run dir before creating the worktree (`PIPELINE_RUN_DIR` set, or an
// earlier `record-worktree` call in this same session) is left alone; this
// never creates a second, competing run dir for a session that already has
// one. Collision avoidance relies entirely on `resolveRun`'s own
// newest-first, session-scoped selection (context.js) — no explicit
// hand-off code is needed here: once a LATER formal run dir is stamped for
// this same session (`record-worktree`, run by a formal skill that starts
// after this ad-hoc mint), it sorts newer and wins every subsequent
// resolution for the rest of the session, exactly as if this ad-hoc stamp
// had never happened. The ad-hoc dir itself is left behind, unowned by
// nobody currently active — the Friction Lens's fallback read (`worktree`
// field match, not session-id match) is what finds it again later.
//
// Trigger (#1333): fires either on an `EnterWorktree` call (the original path, unchanged) OR
// the first time this session's `ctx.cwd` is observed resolving to a worktree entry that isn't
// the main checkout, per `resolveWorktreePathViaPorcelain` above — covering a worktree created
// by a tool other than claude-tweaks' own `EnterWorktree` (another plugin's worktree-management
// skill, or a raw `git worktree add` run directly), which never fires `EnterWorktree` and so
// never reached this function at all before. The non-EnterWorktree path is rate-limited to at
// most once per session via a session-scoped marker file (`ADHOC_WORKTREE_CHECKED_MARKER`
// below) — this hook fires on every `PostToolUse` event across every session in the harness, so
// running `git worktree list` unconditionally on every call would be a real perf cost.
const ADHOC_WORKTREE_CHECKED_MARKER = 'adhoc-worktree-checked';

function stampAdHocRunDir(ctx) {
  if (ctx.ownedRun && ctx.ownedRun.dir) return; // this session already owns a run dir — nothing to stamp
  const sessionId = ctx.input.session_id;
  if (typeof sessionId !== 'string' || !sessionId) return; // no identity to stamp ownership against
  const isEnterWorktree = ctx.input.tool_name === 'EnterWorktree';
  try {
    let worktreePath;
    if (isEnterWorktree) {
      worktreePath = resolveCreatedWorktreePath(ctx);
    } else {
      const markerPath = sessionTmpPath(sessionId, ADHOC_WORKTREE_CHECKED_MARKER);
      if (markerPath && fs.existsSync(markerPath)) return; // already checked (or ruled out) this session — skip the git call entirely
      // #1864: the porcelain lookup shells out `git -C ctx.cwd worktree list --porcelain`,
      // which is guaranteed to fail when ctx.cwd no longer exists on disk — the shape produced
      // by an ExitWorktree(remove) event, whose PostToolUse fires against the just-deleted
      // worktree directory. That failure means the lookup itself never ran, not that it ran and
      // definitively found nothing — so it must NOT be treated the same as a real "checked,
      // found nothing" outcome. Skip the lookup and the marker write in that case: a later
      // worktree (e.g. a raw `git worktree add` in the same session, bypassing EnterWorktree)
      // still gets a fresh, real check instead of being silently skipped forever by a marker
      // written against a check that never actually ran.
      if (typeof ctx.cwd === 'string' && ctx.cwd && !fs.existsSync(ctx.cwd)) return;
      const viaPorcelain = resolveWorktreePathViaPorcelain(ctx);
      // Record "checked" regardless of outcome — best-effort: a write failure here just costs
      // this session the rate-limit next call, never a correctness issue (the ctx.ownedRun.dir
      // guard above still prevents a double-stamp once this path succeeds once).
      if (markerPath) { try { fs.writeFileSync(markerPath, ''); } catch { /* best-effort */ } }
      worktreePath = (viaPorcelain && !viaPorcelain.isMain) ? viaPorcelain.path : null;
    }
    if (!worktreePath) return;
    // Deliberately NOT process.env — a stray PIPELINE_RUN_DIR left over from
    // an unrelated earlier command in this shell must never redirect this
    // stamp onto someone else's run dir.
    const result = runDirResolve.resolve({ cwd: ctx.cwd, env: {}, create: true, standalone: 'adhoc' });
    if (!result.ok) return;
    // Review finding (#500): a same-second sibling session minting against the
    // same worktree collides on this dir name (second-granularity timestamp).
    // Never let this stamp clobber a DIFFERENT session's already-written
    // ownership — writeRunState's patch-wins-on-conflict merge would otherwise
    // silently reassign the dir mid-session.
    const existing = ctxLib.readRunState(result.path);
    if (existing && typeof existing.sessionId === 'string' && existing.sessionId && existing.sessionId !== sessionId) return;
    const written = ctxLib.writeRunState(result.path, { worktree: path.resolve(worktreePath), status: 'active', sessionId });
    if (!written) {
      // writeRunState failed (I/O error). The mint above already touched
      // decisions.md, which isUnadoptedMint (context.js) treats as evidence
      // this dir was "adopted" — so leaving it behind with no run-state.json
      // would sit as a mis-attributable "unowned" fallback candidate for a
      // totally different session (the #721 cross-contamination shape).
      // Best-effort: remove the mint rather than leave that trap behind.
      ctxLib.rollbackMint(result.path);
    }
  } catch { /* never break a session over bookkeeping */ }
}

// Log-tier breadcrumb, gated on ctx.ownedRun.dir exactly like the commit
// breadcrumbs in run() below — never a durable trace when no run dir
// resolves. `result` distinguishes "checked, clean" from "checked, stale"
// from "check didn't run" (fetch/rev-list failure) — the acceptance
// criterion this exists for is a reader of events.jsonl being able to tell
// those three apart, not just "clean" from "everything else".
function logWorktreeStalenessEvent(ctx, data) {
  const ownedRun = ctx.ownedRun || {};
  if (!ownedRun.dir) return;
  ctxLib.appendEvent(ownedRun.dir, 'worktree-staleness', data, ownedRun.attribution);
}

// Windows `core.longpaths` proactive nudge (#1782, warn tier). `_shared/
// worktree-setup.md`'s Post-creation catch-up documents the `Filename too
// long` failure mode and its `core.longpaths` fix reactively, i.e. only
// after a fetch/merge has already failed that way. This hook nudges
// proactively, right after worktree creation — win32 only, since neither the
// setting nor the failure mode exists on any other platform, and this hook
// fires on every PostToolUse event across every session in the harness, so a
// `git config` spawn on a non-Windows platform would be pure waste for a
// check that is meaningless there. Warn only, matching the sibling
// staleness check's own #307 Non-Goals: this hook never sets the config
// itself, only reads it and reports.
function logWindowsLongpathsEvent(ctx, data) {
  const ownedRun = ctx.ownedRun || {};
  if (!ownedRun.dir) return;
  ctxLib.appendEvent(ownedRun.dir, 'windows-longpaths', data, ownedRun.attribution);
}

function checkWindowsLongpaths(ctx) {
  if (ctx.input.tool_name !== 'EnterWorktree') return null;
  const platform = ctx.platform || process.platform;
  if (platform !== 'win32') return null;
  try {
    const worktreePath = resolveCreatedWorktreePath(ctx);
    if (!worktreePath) return null; // couldn't resolve where we landed — nothing to check, fail open

    // Read-only: `--get` never writes. A non-zero exit (key unset) and an
    // explicit `false` are both treated as "not enabled" — only a literal
    // `true` skips the nudge.
    const result = runGit(['config', '--get', 'core.longpaths'], worktreePath);
    // An unset key is a definitive answer from git itself (`config --get`
    // exits 1 with no output) — classified 'git-error', not indeterminate.
    // Only a real check failure (timeout/spawn/no-git — the question was
    // never actually answered) skips the "not enabled" assertion; a
    // definitive non-'true' answer still falls through to the 'unset'
    // branch below, unchanged.
    if (isIndeterminate(result.failure)) {
      logWindowsLongpathsEvent(ctx, { worktree: worktreePath, result: 'check-failed', reason: result.failure });
      return null;
    }
    if (result.stdout === 'true') {
      logWindowsLongpathsEvent(ctx, { worktree: worktreePath, result: 'enabled' });
      return null;
    }

    logWindowsLongpathsEvent(ctx, { worktree: worktreePath, result: 'unset', value: result.stdout });
    return {
      json: {
        systemMessage:
          'claude-tweaks: core.longpaths is not enabled on this Windows checkout. A fetch/merge ' +
          'against a deeply nested pipeline path (.claude-tweaks/pipelines/**/spec-*/work/*.md) can ' +
          'fail with "Filename too long" — see skills/_shared/worktree-setup.md\'s Post-creation ' +
          'catch-up ("Windows: `Filename too long`") for the fix (`git config core.longpaths true`) ' +
          'and the recovery steps if a merge already failed this way.',
      },
    };
  } catch {
    return null; // never break a session over a nudge
  }
}

function checkWorktreeStaleness(ctx) {
  if (ctx.input.tool_name !== 'EnterWorktree') return null;
  try {
    const worktreePath = resolveCreatedWorktreePath(ctx);
    if (!worktreePath) return null; // couldn't resolve where we landed — nothing to check, fail open
    // #1688: resolveIntegrationBranch's policy-configured path can now return
    // an `origin/{name}` remote-tracking ref instead of a bare branch name
    // (preferRemoteTrackingRef, worktree-reap.js). This check needs a bare
    // name — `branch` is both the remote-side fetch target below (a remote
    // has no `origin/`-prefixed branches of its own) and re-prefixed with
    // `origin/` again for the rev-list comparison — so normalize immediately.
    const branch = bareIntegrationName(resolveIntegrationBranch(worktreePath));
    if (!branch) return null; // no integration branch resolved — nothing to compare against

    // `--` guards against argument injection: `branch` traces back to
    // policy.yml's hand-editable `integration-branch:` value (parsed by a
    // permissive regex that doesn't reject a leading `-`), and a bare
    // positional git arg starting with `-` is parsed as a flag rather than a
    // refspec — e.g. `--upload-pack=<cmd>` runs `<cmd>` as a subprocess over
    // ssh/file transports (verified: inert over this repo's https origin,
    // which warns and ignores it, but not every consumer of this plugin uses
    // https remotes). `--` forces everything after it to be read as a
    // positional refspec regardless of leading characters.
    const fetch = runGit(['fetch', 'origin', '--', branch], worktreePath, { timeoutMs: WORKTREE_FETCH_TIMEOUT_MS });
    if (fetch.failure) {
      logWorktreeStalenessEvent(ctx, { worktree: worktreePath, branch, result: 'check-failed', reason: fetch.failure });
      return null;
    }

    const revList = runGit(['rev-list', '--count', `HEAD..origin/${branch}`], worktreePath);
    if (revList.failure || revList.stdout === null) {
      logWorktreeStalenessEvent(ctx, {
        worktree: worktreePath, branch, result: 'check-failed', reason: revList.failure || 'unparseable-count',
      });
      return null;
    }
    const behind = Number(revList.stdout.trim());
    if (!Number.isFinite(behind)) {
      // rev-list exited 0 but produced non-numeric stdout — a check that
      // didn't run, not a clean result. Logged distinctly per this section's
      // own "checked, clean" vs "check didn't run" acceptance criterion.
      logWorktreeStalenessEvent(ctx, { worktree: worktreePath, branch, result: 'check-failed', reason: 'unparseable-count' });
      return null;
    }
    if (behind <= 0) {
      logWorktreeStalenessEvent(ctx, { worktree: worktreePath, branch, result: 'clean', behind: 0 });
      return null;
    }

    logWorktreeStalenessEvent(ctx, { worktree: worktreePath, branch, result: 'stale', behind });
    return {
      json: {
        systemMessage:
          `claude-tweaks: this worktree is already ${behind} commit${behind === 1 ? '' : 's'} behind ` +
          `origin/${branch}. Run skills/_shared/worktree-setup.md's Post-creation catch-up ` +
          '(git fetch + merge) before building on stale ground.',
      },
    };
  } catch {
    return null; // never break a session over a nudge
  }
}

// Post-teardown re-anchor backstop (#703, warn tier). This repo's hooks own
// no code that sets or clears the harness's native worktree-isolation pin
// (confirmed by grep — see #703's own body) — PreToolUse can only allow/deny/
// warn a call before it runs, and PostToolUse can only log or warn after one
// completes. The realistic remediation is therefore instructional, mirroring
// the EnterWorktree staleness backstop immediately above (same warn-tier
// `systemMessage` shape, same "react to a completed harness-native tool call"
// posture) rather than SessionStart's `additionalContext` inform tier, which
// is reserved for session bootstrap (docs/hooks.md's tiered-posture line).
//
// Fires once a teardown this repo's own PreToolUse gate did NOT deny has
// actually happened: `ExitWorktree` (`action: 'remove'`), or the sanctioned
// Bash `git worktree remove` shape (`checkTeardownGate`'s own-cwd deny in
// pre-tool-use.js already blocks the dangerous same-cwd case at PreToolUse —
// a denied call never reaches PostToolUse, so any target resolved here
// already ran).
//
// `teardownTargets`'s Bash-parsing branch is reused as-is for the Bash case
// (pure command-string parsing — never needs the *removed* directory itself
// to exist, only the calling shell's still-live cwd). The `ExitWorktree`
// branch is NOT reused: `teardownTargets` resolves that case via
// `toplevel(ctx.cwd)`, a `git rev-parse` subprocess spawned FROM the target
// directory — correct at PreToolUse time (checkTeardownGate's own use),
// where the removal hasn't happened yet, but by PostToolUse time it already
// has, so that spawn fails against a now-deleted cwd and `teardownTargets`
// silently resolves no target. Reusing it verbatim here would make this
// backstop never fire for the exact tool call it exists to react to, so the
// `ExitWorktree` case uses `ctx.cwd` directly instead (the removed worktree,
// or a path under it, at call time) rather than re-resolving its toplevel.
function checkPostTeardownReanchor(ctx) {
  const toolName = ctx.input && ctx.input.tool_name;
  if (toolName !== 'ExitWorktree' && toolName !== 'Bash') return null;
  try {
    let targetPath;
    if (toolName === 'ExitWorktree') {
      const toolInput = ctx.input && ctx.input.tool_input;
      if (!toolInput || toolInput.action !== 'remove') return null;
      targetPath = ctx.cwd || null;
      if (!targetPath) return null;
    } else {
      const targets = preToolUse.teardownTargets(ctx);
      if (!targets.length) return null;
      targetPath = targets[0].path;
    }
    // mainCheckoutRoot walks up from the nearest still-EXISTING ancestor
    // directory looking for `.git` — it never re-derives the answer via a
    // `git` subprocess run FROM the just-removed path, so (unlike
    // `toplevel()` above) it still resolves correctly even though that exact
    // directory is now gone. Fails closed to null (skip silently) rather
    // than guessing when the walk-up can't find a `.git` at all.
    const runRoot = wtDetect.mainCheckoutRoot(ctx.cwd || process.cwd());
    const reanchor = runRoot
      ? `Re-anchor there (\`cd ${runRoot}\`) before issuing any further git-dependent command.`
      : 'Re-anchor to this project\'s main checkout before issuing any further git-dependent command ' +
        '— its path could not be auto-resolved from here.';
    return {
      json: {
        systemMessage:
          `claude-tweaks: the worktree at ${targetPath} was just torn down. This plugin's hooks ` +
          'cannot clear the harness\'s own worktree-isolation pin, so if this session was standing in ' +
          'that worktree, further git-dependent commands may still be refused as "isolated in the ' +
          `worktree ..." even though it no longer exists. ${reanchor}`,
      },
    };
  } catch {
    return null; // never break a session over a nudge
  }
}

// Log-tier breadcrumb, gated on ctx.ownedRun.dir exactly like
// logWorktreeStalenessEvent above — the AskUserQuestion analogue. One event
// per tool call (not per question): AskUserQuestionInput allows 1-4
// questions per call.
//
// What's logged as `questions` (header/question/options) comes straight from
// `tool_input` — reliable, SDK-typed. What's logged as `response` does NOT
// come from the SDK's structured `AskUserQuestionOutput` shape
// (`{questions, answers}`) an earlier version of this function assumed —
// real captured transcripts (see evals/NOTES.md's "AskUserQuestion
// input/output shapes" section's Correction) show `tool_response` for
// this tool is always a plain natural-language string (e.g. `Your questions
// have been answered: "..."="...". You can now continue with these answers
// in mind.`) with a varying prefix/suffix, and the embedded question text can
// contain unescaped nested double quotes — not safely regex-parseable into a
// structured per-question answer map. So there is no per-question `answer`
// field; instead ONE raw `response` string for the whole event, extracted via
// this file's own `extractToolResponseText` (reused, not reimplemented — see
// that function's header comment, which already documents this exact class
// of `tool_response`-shape problem for other tools). Never throws — a
// malformed tool_input/tool_response degrades to an empty questions array
// and/or a null response rather than breaking the session, per CLAUDE.md's
// Hooks section ("Never break a session").
function logAskUserQuestion(ctx) {
  const ownedRun = ctx.ownedRun || {};
  if (!ownedRun.dir) return {};
  try {
    const posed = (ctx.input.tool_input && Array.isArray(ctx.input.tool_input.questions))
      ? ctx.input.tool_input.questions
      : [];
    const questions = posed.map((q) => ({
      header: (q && typeof q.header === 'string') ? q.header : null,
      question: (q && typeof q.question === 'string') ? q.question : null,
      options: (q && Array.isArray(q.options))
        ? q.options.map((o) => (o && typeof o.label === 'string') ? o.label : null)
        : [],
    }));
    const response = extractToolResponseText(ctx.input.tool_response);
    ctxLib.appendEvent(ownedRun.dir, 'ask-user-question', { questions, response }, ownedRun.attribution);
  } catch {
    /* best-effort — never break the session over a log-tier event */
  }
  return {};
}

function run(ctx) {
  if (ctx.input.tool_name === 'Skill') return skillInvocation.run(ctx);
  if (ctx.input.tool_name === 'AskUserQuestion') return logAskUserQuestion(ctx);

  const command = ctx.input.tool_name === 'Bash' ? (ctx.input.tool_input && ctx.input.tool_input.command) : null;
  const hasCommand = typeof command === 'string' && !!command;
  // Computed once and shared below — the breadcrumb loop and the
  // closing-keyword check both need the same command/cwd's git targets.
  const targets = hasCommand ? gitTargets(command, ctx.cwd) : [];

  // Fetch each dir's own N most recent commits ONCE per dir (a single git
  // spawn returns hash + timestamp + message together), shared by both the
  // breadcrumb loop and the closing-keyword check below. N = how many
  // commit-action targets this command has for that dir, so a compound
  // command chaining multiple `git commit` statements against the same dir
  // gets each of its own real commits back, not the same current-HEAD
  // commit read N times. Oldest-first, to line up with `targets`' own
  // left-to-right command order (git log itself returns newest-first).
  const commitCountByDir = new Map();
  for (const t of targets) {
    if (t.action !== 'commit') continue;
    commitCountByDir.set(t.dir, (commitCountByDir.get(t.dir) || 0) + 1);
  }
  const recentByDir = new Map();
  for (const [dir, count] of commitCountByDir) recentByDir.set(dir, recentCommits(dir, count).reverse());
  const dirCursor = new Map();
  function nextCommitFor(dir) {
    const list = recentByDir.get(dir) || [];
    const idx = dirCursor.get(dir) || 0;
    dirCursor.set(dir, idx + 1);
    return idx < list.length ? list[idx] : null;
  }

  // E2: commit breadcrumbs (log tier) — scoped to a run this session may write
  // to, NOT ctx.runDir (#62). This is the breadcrumb that was reported
  // cross-contaminating: a run's events.jsonl accumulating commits from
  // completely unrelated worktrees, three of them in one reported case. Under a
  // guessed attribution the line is tagged so it stays filterable rather than
  // reading as this run's own work.
  const ownedRun = ctx.ownedRun || {};
  if (ownedRun.dir && hasCommand) {
    for (const target of targets) {
      const commit = target.action === 'commit' ? nextCommitFor(target.dir) : null;
      ctxLib.appendEvent(ownedRun.dir, 'commit', {
        action: target.action,
        dir: target.dir,
        hash: commit ? commit.hash : undefined,
      }, ownedRun.attribution);
    }
  }

  // Closing-keyword check (warn tier) — deliberately NOT gated on ctx.runDir.
  if (hasCommand) {
    const warning = checkClosingKeyword(recentByDir);
    if (warning) return warning;
  }

  // Deferred-subproject capture nudge (warn tier) — deliberately NOT gated on ctx.runDir.
  const designDocNudge = checkDesignDocWrite(ctx);
  if (designDocNudge) return designDocNudge;

  // Plugin-version-bump release-follow-up nudge (warn tier) — deliberately NOT gated on ctx.runDir.
  if (hasCommand) {
    const versionBumpNudge = checkPluginVersionBump(recentByDir);
    if (versionBumpNudge) return versionBumpNudge;
  }

  // Ad-hoc-session run-dir stamping (log tier, side effect only — no
  // message). Runs before the staleness check below so a formal pipeline's
  // own record-worktree call (should one race this same EnterWorktree
  // event some other way) is never shadowed; in practice the two never
  // compete, since stampAdHocRunDir no-ops the instant ctx.ownedRun.dir is
  // already set.
  stampAdHocRunDir(ctx);

  // Windows core.longpaths proactive nudge (#1782, warn tier) — before the
  // staleness fetch below, win32 only; non-Windows sessions pay nothing.
  const longpathsNudge = checkWindowsLongpaths(ctx);
  if (longpathsNudge) return longpathsNudge;

  // EnterWorktree staleness backstop (warn tier) — deliberately NOT gated on
  // ctx.runDir (matches this file's other nudges); its own log-tier
  // breadcrumb (inside checkWorktreeStaleness) IS gated on ctx.ownedRun.dir.
  const worktreeStalenessNudge = checkWorktreeStaleness(ctx);
  if (worktreeStalenessNudge) return worktreeStalenessNudge;

  // Post-teardown re-anchor backstop (#703, warn tier) — deliberately NOT
  // gated on ctx.runDir, matching every other nudge in this file.
  const postTeardownNudge = checkPostTeardownReanchor(ctx);
  if (postTeardownNudge) return postTeardownNudge;

  return {};
}

module.exports = { run };
