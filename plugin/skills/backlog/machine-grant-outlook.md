# Backlog Overview — Machine-Grant Outlook

Loaded by `overview-mode.md`'s bare-mode render only when the repo's policy resolves
`autonomy: unattended` with `grant-origination-enabled: true` under `work-backend: github-issues` —
the gate lives at the caller; this file assumes it already passed. On such a repo the funnel's
human-pointed stages are supposed to drain themselves (the fleet's grant unit for `specified`, the
born-ready capture chain for `captured`), so rendering the plain human pointers hides the one fact
that matters: *why a stage isn't draining*. The two annotations below say why, mechanically.

Both are advisory display only — they grant nothing, write nothing, and stay inside the funnel
header's `#`-comment format (no command text on an annotation line). They do not count against the
two annotation lines below the header, which sit under it rather than inside it.

## `specified` stage — grant-gate outlook

Compute the outlook mechanically — `machineGrantOutlook(funnel.specified, { ceiling, grantOriginationEnabled }, trustRows)`
(`bin/lib/issues/backlog.js`), with `trustRows` = the rows Step 1.5 already computed. This file is
loaded separately from `overview-mode.md`'s own fence, so re-resolve the paths rather than
assuming its shell variable survived (`_shared/session-tmp-root.md`; `sessionTmpPath` is
idempotent per session+filename, so this resolves to the identical path Step 1.5 wrote):

`machineGrantOutlook` pre-filters human-filed records (`facets.origin` null/undefined) before
running the gate chain at all — mirroring `refine-headless.md`'s own Step 1 cheap pre-pass on the
same condition — so a human-filed record is never counted under `refused` here, exactly as the
headless posture's own candidate fetch drops it before the chain; excluded records are counted
separately via the returned `excludedOrigin` field rather than folded into `refused` (#1387).
Origin is the only axis the pre-filter aligns: `funnel.specified` still keeps a `ready` record with
an open `Blocked by #N` that `refine-headless.md`'s Step 1 drops
(`deps.every((d) => !openNumbers.has(d))`; the pre-pass also drops a candidate whose body-declared
foreign blocker is open or unreadable, #4793), so `eligible` can exceed the headless posture's
candidate count by that population — one more reason it means "reaches the grant unit's own
grant-check on a future firing", never "is on the headless posture's list this run".

```bash
ST_BACKLOG_OVERVIEW_VIEWS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-views.json)"
ST_BACKLOG_OVERVIEW_TRUST_ROWS="$(node "${CLAUDE_PLUGIN_ROOT}/bin/session-tmp-resolve.js" --value backlog-overview-trust-rows.json)"
node -e "
  const bl = require('${CLAUDE_PLUGIN_ROOT}/bin/lib/issues/backlog.js');
  const rows = require('$ST_BACKLOG_OVERVIEW_TRUST_ROWS');
  const outlook = bl.machineGrantOutlook(require('$ST_BACKLOG_OVERVIEW_VIEWS').funnel.specified, { ceiling: 'unattended', grantOriginationEnabled: true }, rows);
  const line = bl.allRefusedOutlookLine(outlook, rows);
  if (line) console.log(line);
  else {
    const refused = Object.entries(outlook.refused).map(([key, ids]) => [key, ids.length]).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
    console.log(JSON.stringify({ eligible: outlook.eligible.length, refusedTotal: refused.reduce((sum, [, n]) => sum + n, 0), refused: Object.fromEntries(refused), excludedOrigin: outlook.excludedOrigin }));
  }
"
```

The fence reads `trustRows` from `"$ST_BACKLOG_OVERVIEW_TRUST_ROWS"` rather than re-fetching, and the
`specified` bucket from `"$ST_BACKLOG_OVERVIEW_VIEWS"`. Phase-1 gates only (ceiling,
opt-in, `needs:definition`, class trust) — the chain's `by:*` origin gate never fires inside this
call, since the pre-filter above already removed every record it would have refused, so `origin`
can never appear in the `{failedKey}: {count}` list below — never run grant-check here (overview's
"entirely mechanical" contract); `eligible` means "reaches the grant unit's own grant-check on a
future firing", not "will be granted". Render one extra `#`-comment line directly under the
`# specified {n}` line, before its `/claude-tweaks:backlog refine` command line.

**Nothing eligible, something refused.** The fence prints one line starting `# machine grants: none
possible` (`allRefusedOutlookLine`) — it names each refusing gate with its count and, for a
`trust` refusal, the class and why it is not `clean` (for a `mixed` class, its follow-up rate
against the resolved maximum, `trust-follow-up-rate-max-percent`). Render it verbatim in place of
the `# machine-grant live …` line below. The live line is never rendered alongside it. This form omits the excluded human-filed count
(`excludedOrigin`) and the human-grant tail, so it does not say nothing was excluded.

**Otherwise** the fence prints one JSON object `{ eligible, refusedTotal, refused, excludedOrigin }`
(`refused` maps each `failedKey` to its count, already in descending order) and the live line
renders from it, with `{eligible}` its `eligible`:

```
# machine-grant live (≤{cap}/day): {eligible} eligible pending grant-check; {refusedTotal} refused — {failedKey}: {count}, ...; {excludedOrigin} human-filed (excluded — never machine-granted) — refused records need a human grant via /claude-tweaks:backlog refine
```

The `{failedKey}: {count}` list renders in descending count order; when `refused` is empty, omit
it and the `— refused records need …` tail with it. The `; {excludedOrigin} human-filed (excluded
— never machine-granted)` segment renders only when `excludedOrigin` is non-zero — omit it
entirely (including its leading `; `) when zero, the same convention the `{failedKey}: {count}`
list already follows for an empty `refused`. `{cap}` is the resolved `fleet-daily-grant-cap`; when
unset, drop the `(≤{cap}/day)` parenthetical.

## `captured` stage — born-ready chain suppression

Same gate as above, except ceiling `trusted` also qualifies — the born-ready capture chain
(`_shared/autonomy-ceiling.md`) is live from `trusted` up. When any Step 1.5 row whose `key`
starts `producer:capture|` has a verdict other than `clean`, render one `#`-comment line directly
under the `# captured {n}` line:

```
# born-ready capture chain suppressed — producer:capture trust is {verdict(s)}; captures land raw until it clears
```

Nothing when every `producer:capture|*` cell is `clean` or no such cell exists yet — absence of
the line means the stage self-drains (or there is no evidence either way), matching Step 1.5's
render-nothing-when-clean convention.
