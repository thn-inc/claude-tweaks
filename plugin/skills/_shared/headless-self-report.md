# Headless Self-Report (`next` form only)

Loaded by the calling skill's Preflight. Scope is caller-specific — the unit a scheduled Routine
fires with nobody present to read a stop message. For `/claude-tweaks:dispatch`, that scope is
the headless drain: a bare drain firing when Routine-fired, and its deprecated `next` alias.
Dispatch's explicit `#N`/`#N,#M,...` forms always run with a human present per the Input table in
`dispatch/SKILL.md`, report the failing check directly, and never reach this file. For
`/claude-tweaks:specify`, that scope is the headless drain: bare invocation (which always
drains immediately, human present or not — there is no separate interactive confirmation
path) and its deprecated `next` alias, per that skill's own Input table. Specify's explicit
`#N`/`#N,#M,...`/`#A-#B`/design-doc-path/topic forms always run with a human present, report
the failing check directly, and never reach this file.

**Consumers:** `/claude-tweaks:dispatch` Preflight (`{caller}` = `dispatch`), `/claude-tweaks:specify` `next-mode.md` Preflight (`{caller}` = `specify`).

**Ordering.** This procedure runs *before* the stop it accompanies — for Preflight's
`work-backend` checks, its Detection Ladder, and (new) a `next`-form firing's first Task call
hitting a Step 2.8 claim contest inside its own `/flow` invocation (`dispatch/settle-and-merge.md`'s
Settle procedure invokes this file directly from inside that Task call when `DISPATCH_HEADLESS=1`
was set — the same file, the same dedup-by-marker mechanism, just a different caller than
dispatch's own Preflight thread). It does not soften or defer any of these stops — the stop still
happens, this just leaves a durable trace first.

**Resolved build.** Every path below records which plugin build this firing actually ran, as one line:

```
Resolved build: claude-tweaks v{version} @ {resolved CLAUDE_PLUGIN_ROOT}
```

Read `{version}` from `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` — the directory these skill files were loaded from, and so the one source that cannot disagree with them. Do not substitute `claude plugin list --json`'s `version` or `installed_plugins.json`'s `gitCommitSha`: both are installation metadata written beside the cache directory rather than read out of it, and the sha in particular is not refreshed by `claude plugin update`. If either value is unreadable, write `Resolved build: unresolved ({what failed})` — never drop the line.

A self-report filed without it is unactionable, because the two explanations it has to distinguish produce identical reports: a sandbox pinned to a stale build, and a defect in the build the marketplace currently serves. #129 is that case — a firing reported a `gh`-CLI hard gate that the shipped build had already replaced with an MCP branch four days earlier, and the report read as a live bug until the installed source was inspected by hand.

---

A failure on this form needs a durable trace instead of a message nobody sees. Before stopping on any of the triggers this file accompanies (see Ordering above for the full list), search for an existing open report first, to avoid re-filing on every firing — never via `gh issue list --search`, which rides GitHub's eventually-consistent search index (the same anti-pattern documented in `_shared/github-write-transport.md`); use the same plain-list + marker-match idiom instead:

```bash
eval "$(node -e "
  const { sessionTmpPath } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/session-tmp.js');
  const os = require('os'); const path = require('path');
  const files = { SELFREPORT_ISSUES: '{caller}-selfreport-issues.json', SELFREPORT_LOOKUP: '{caller}-selfreport-lookup.json' };
  for (const [varName, filename] of Object.entries(files)) {
    const p = sessionTmpPath(process.env.CLAUDE_CODE_SESSION_ID, filename) || path.join(os.tmpdir(), filename);
    console.log(varName + '=' + JSON.stringify(p));
  }
")"

gh issue list --label by:{caller} --state open --json number,title,body,createdAt --limit 500 > "$SELFREPORT_ISSUES"

rm -f "$SELFREPORT_LOOKUP"
node -e "
  const { findByMarker } = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/dedup-lookup.js');
  const issues = require(process.argv[2]);
  const marker = '<!-- {caller}-preflight-marker: ' + process.argv[1] + ' -->';
  const result = findByMarker(issues, marker);
  require('fs').writeFileSync(process.argv[3], JSON.stringify(result));
" "{failing-check-name}" "$SELFREPORT_ISSUES" "$SELFREPORT_LOOKUP"
```

Read `"$SELFREPORT_LOOKUP"` (`_shared/session-tmp-root.md`):
- `null`: read the project's `work-types` config key (per `_shared/work-record.md`'s Config keys table) and branch —
same pattern `/capture`'s Backend Selection already uses, Type is always `bug` here (a Preflight
failure is definitionally a defect). The body now carries the marker so future firings can find it reliably:

```bash
# Bootstrap per _shared/label-bootstrap.md, LABELS_JSON =
# [['by:{caller}', 'Origin: self-filed by /claude-tweaks:{caller} on a headless self-report trigger']]
# — bootstrap the matching type:bug pair too under work-types: labels, same as /capture does.

# work-types: native
gh issue create \
  --title "{Caller} headless self-report: {failing-check-name}" \
  --body "{the exact diagnostic message this check would otherwise report to a human}

Resolved build: claude-tweaks v{version} @ {resolved CLAUDE_PLUGIN_ROOT}

<!-- {caller}-preflight-marker: {failing-check-name} -->" \
  --type bug \
  --label by:{caller}

# work-types: labels
gh issue create \
  --title "{Caller} headless self-report: {failing-check-name}" \
  --body "{the exact diagnostic message this check would otherwise report to a human}

Resolved build: claude-tweaks v{version} @ {resolved CLAUDE_PLUGIN_ROOT}

<!-- {caller}-preflight-marker: {failing-check-name} -->" \
  --label by:{caller} \
  --label type:bug
```
- Otherwise (`canonical` is set — a match was found): if `duplicates` is non-empty (however that happened — this is the hedge, not the expected path), resolve this firing's run dir first — via `_shared/run-dir-resolution.md`'s standalone-auto fallback (the calling skill must be on that fallback's allowlist — dispatch already is; this block runs in Preflight, before Workflow Step 1 would otherwise resolve `$RUN_ID`, so it cannot be assumed already resolved here) — then close every duplicate entry: `gh issue close {n} --reason "not planned"` with a comment `` "Duplicate of #{canonical.number} — same `{caller}-preflight-marker` match, closing to keep one open self-report per failing check." `` — then log one line per closed duplicate to that run dir's `decisions.md`: `AUTO {time} — {caller} headless self-report: closed duplicate issue #{n} (marker match with canonical #{canonical.number}). Reversibility: low (GitHub state; issue can be manually re-opened).` Then, whether or not any duplicates were found, reference `#{canonical.number}` in the stop output and file nothing new — **except** the Resolved build line, under the once-per-build rule below.

**Recording the build on a deduplicated re-file.** Search the canonical issue's body and every comment on it for the literal string `Resolved build: claude-tweaks v{version} @ {resolved CLAUDE_PLUGIN_ROOT}` — this firing's own line, compared whole, so a different version *or* a different plugin root counts as new. Already present → comment nothing; this build is on the record. Absent → post exactly one comment carrying that line plus the firing date, then log one line to this firing's run dir `decisions.md`: `AUTO {time} — {caller} headless self-report: recorded resolved build {version} on existing #{canonical.number}. Reversibility: low (GitHub state; comment can be deleted).`

This is deliberately not gated on the marker: the marker asks "has this check already been reported," and the answer stays yes across every firing, which is what left #129's own self-report issue silent through three later firings on a stale sandbox. The build line asks a different question — "has *this* build already been seen failing this check" — and it is the one whose answer changes when a sandbox is finally repaired, or when it silently rolls back. One comment per distinct build keeps that a timeline rather than a repeat-notification.

No `ready`/`auto:build` on the filed issue — a human confirms and applies the fix, the same conservative default `/capture`'s `keep` route uses elsewhere in this codebase. Self-filing scope follows the caller: for `dispatch`, it covers the headless drain (bare when Routine-fired, including the `next` alias) — the explicit `#N`/`#N,#M,...` forms always run with a human present (per the Input table in `dispatch/SKILL.md`) and just report and stop. For `specify`, self-filing covers bare invocation (drain mode, human present or not) including its deprecated `next` alias — the explicit `#N`/`#N,#M,...`/`#A-#B`/design-doc-path/topic forms always run with a human present (per that skill's own Input table) and just report and stop.

**MCP path** (`gh` unavailable; CRUD mapping per `_shared/github-write-transport.md`): this block's `gh` calls also have a documented MCP path — the list-then-filter lookup (`gh issue list --label by:{caller} ...`) uses the confirmed "list issues by label" mapping (`list_issues`, filtered by label/state — never `search_issues`, same eventually-consistent-index caveat as elsewhere in this file), issue creation (`gh issue create`, both the `work-types: native` and `work-types: labels` variants) uses `issue_write` (create mode), and the duplicate-closing `gh issue close` uses `issue_write` (update mode, state change) — same as every other create/close call site in dispatch's `SKILL.md` and `mcp-transport.md`. The Resolved build once-per-build record uses two more of that file's confirmed mappings: reading the canonical issue's existing comments is `issue_read` (get_comments mode), and posting the one new comment is `add_issue_comment`. This path matters more on MCP than on `gh`, not less — a `gh`-absent sandbox is exactly the shape that was pinned to a stale build in #129.
