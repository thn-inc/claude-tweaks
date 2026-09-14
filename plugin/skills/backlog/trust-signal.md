# Trust Signal (Advisory, `github-issues` only)

Cited by `refine-mode.md` Step 3 — read this only when Step 3 actually reaches its Trust signal
gate; nothing else in this skill cites it.

Gate on the `{resolved-ceiling}` value Step 1 already resolved: fetch and render this run's trust
table only when `{resolved-ceiling}` is `trusted` or higher, **or** `--trust` was passed (see
`SKILL.md`'s Input). Below `trusted` with no `--trust`, skip everything else in this section —
`_shared/trust-table.md`'s Fetch section, including its per-parent branches and its `git log`
read, never runs this session — Trust evidence is omitted from the report for this run, and Step
4's footer renders the skip wording given there instead of the ceiling-description wording. On this
skip path, delete or ignore any pre-existing session-scoped `backlog-refine-trust.json` left over
from an earlier run in this same session (`_shared/session-tmp-root.md`; resolve the path, then
`rm -f "$path"`, or simply never read it) — this run must never render a stale trust table left
behind by a prior `--trust` invocation.

When fetching: run `_shared/trust-table.md`'s Fetch section in full (including its
`backlog-fetch-limit` resolution, its `work-links` resolution — which decides which of the two
parent-issue branches to run — and its truncation warning), then look up each worklist record's
class. `{resolved-ceiling}` and `{resolved-window}` below are the literal values Step 1 already
resolved — do not re-run `resolve-policy.js` here, and do not `export` them in an earlier Bash call
and read `process.env` here: shell environment does not survive between Bash calls and never
reaches a subagent, so that expansion always resolves empty and this block would report
`supervised` on a repo configured for `trusted`. It is the same hazard, and the same fix, as the
`backlog-fetch-limit` substitution in the Fetch section this step already cites. The failure is
quiet and in the safe direction, which is exactly why it needs stating: nothing errors, the console
simply renders a false claim about live policy.

This trust block reuses the same session-scoped `trust-table-git-log.txt` the Fetch section above
already wrote — it must never shell its own separate `git log` call, or its verdicts could silently
disagree with the trust table this same run just rendered from the identical underlying evidence.
Re-resolve that path (and the records snapshot's) here rather than trusting a shell variable from
the earlier Bash call to survive — it won't (see `_shared/session-tmp-root.md`); `sessionTmpPath`
is deterministic per session id + filename, so re-resolving returns the identical path the Fetch
section already populated in this same session.
`{resolved-window}` reaches the script as a `process.argv` arg after `--`, never spliced into the
JS source — a value containing a quote character would otherwise break out of the string literal,
the same reason `code-health/focus-mode.md`'s F1 block passes its own values that way.

```bash
eval "$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" \
  BACKLOG_REFINE_TRUST=backlog-refine-trust.json \
  TT_RECORDS=trust-table-records.json \
  TT_GIT_LOG=trust-table-git-log.txt)"
node -e "
  const fs = require('fs');
  const root = '${CLAUDE_PLUGIN_ROOT}';
  const { trustRows, riskBand, parseGitLog } = require(root + '/bin/lib/issues/trust.js');
  const { resolveProvenance } = require(root + '/bin/lib/issues/provenance.js');
  const { resolveCeiling } = require(root + '/bin/lib/issues/autonomy.js');
  const issues = require('$TT_RECORDS').map((i) => ({ ...i, labels: i.labels.map((l) => l.name) }));
  const gitLog = parseGitLog(fs.readFileSync('$TT_GIT_LOG', 'utf8'));
  const policy = { 'trust-revert-window-days': process.argv[1] };
  const rows = new Map(trustRows(issues, gitLog, Date.now(), policy).map((r) => [r.key, r]));
  const ceiling = resolveCeiling({ policy: '{resolved-ceiling}' });
  const out = {};
  for (const issue of issues.filter((i) => i.state === 'OPEN')) {
    const { kind, source } = resolveProvenance({ labels: issue.labels, body: issue.body });
    const row = rows.get(kind + ':' + source + '|' + riskBand(issue.labels));
    out[issue.number] = {
      ceiling,
      provenance: row ? row.provenance : kind + ':' + source,
      band: riskBand(issue.labels),
      verdict: row ? row.verdict : 'no-cell',
      coverage: row ? row.coverage : null,
    };
  }
  console.log(JSON.stringify(out));
" -- "{resolved-window}" > "$BACKLOG_REFINE_TRUST"
```

**This signal never changes what the gate recommends.** `/claude-tweaks:assess-agent-autonomy`'s
`grant-check` remains the sole source of the Recommended column — it reads *this record's* content,
where trust describes *this record's class*, and a class verdict is not evidence about a specific
record's shape. Trust rides along as context for the human making the batch decision. The one thing
the ceiling does change is described in Step 3.6.
