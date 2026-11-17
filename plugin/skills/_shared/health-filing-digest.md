# Health Filing Digest Mode — Canonical Drain-Rate Cap Shape (#235)

`code-health`, `harness-health`, `journey-health`, `docs-health`, and `ci-health` each throttle new-issue filing against a per-origin open-singleton cap (the `health-open-cap` lever — see `_shared/policy-schema.md`). Below the cap, filing is unchanged from before #235. At or above it, a brand-new finding that would otherwise file its own issue is appended to a single per-origin digest issue instead. This file is the one place the *shape* of the mechanism is defined — same convention as `_shared/health-filing-mechanics.md` — so a correctness fix made to one skill's copy can be checked against the same canonical shape in the others; each consumer still writes the actual bash/node calls inline in its own FILE step (matching how the rest of that step is written), substituting its own `{BINARY}` (`bin/*.js`), `{PREFIX}` (`.claude-tweaks/{PREFIX}` cache/label prefix), and digest label `{PREFIX}:digest`.

All logic lives in `bin/lib/health-core/digest.js` — pure, no I/O, no gh calls. This file only prescribes *when* each consumer's FILE step calls it.

## GATHER OPEN ISSUES step — fold digest fingerprints into the same dedup index

After building the `{ number, state, labels, fingerprint }` array from the raw `gh issue list` output (the array each consumer already writes to `/tmp/{PREFIX}-open.json`), also expand any open digest issue's embedded checklist fingerprints onto the same array before writing it out:

```bash
node -e "
const { expandDigestFingerprints } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/health-core/digest');
const singles = require('/tmp/{PREFIX}-open.json'); // this consumer's own already-built array
const raw = require('/tmp/{PREFIX}-issues-raw.json'); // the raw gh issue list output (has .body)
const digestEntries = expandDigestFingerprints(raw, '{PREFIX}:digest');
require('fs').writeFileSync('/tmp/{PREFIX}-open.json', JSON.stringify([...singles, ...digestEntries]));
"
```

This is what makes dedup continuity work with **no separate digest dedup path**: a finding already sitting in the digest issue's checklist now has an entry in the same issue index Step 8's `validate-findings --issues` consults, so `dedup.js`'s existing "open issue match -> skip" branch recognizes it exactly like a singleton match — no re-judging, no duplicate digest entries.

## FILE step — the cap check, before the filing loop

Compute this origin's current open-singleton count once, before iterating survivors (excludes the digest issue itself and closed issues — never re-count as the loop below adds new ones this run):

```bash
node -e "
const { countOpenSingletons } = require('\${CLAUDE_PLUGIN_ROOT}/bin/lib/health-core/digest');
const raw = require('/tmp/{PREFIX}-issues-raw.json');
console.log(countOpenSingletons(raw, '{PREFIX}:digest'));
" # -> OPEN_COUNT
```

Resolve the cap via the canonical read path (`_shared/policy-schema.md`): `CAP=$(node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --values health-open-cap)` — the resolver applies the schema default and rejects non-numeric values itself.

For each survivor whose dedup decision (Step 8) is `'file'` (never `'reopen'` — a regression always bypasses the cap, per #235's Gotchas): call `decideFilingMode({ action: 'file', openCount: OPEN_COUNT, cap: CAP })`. `'normal'` files the issue exactly as before, **then increments `OPEN_COUNT` by 1** (a running counter — once the cap is crossed mid-run, every remaining new finding this run also digests). `'digest'`:

1. Look up this origin's open digest issue via `findOpenDigestIssue(raw, '{PREFIX}:digest')`.
2. If none exists, create one: `gh issue create --title "{PREFIX} digest" --body "$(initialDigestBody('{PREFIX}'))" --label by:{PREFIX} --label {PREFIX}:digest` (bootstrap the `{PREFIX}:digest` label the same way as the run's other labels — description: `"Digest: findings held back by the health-open-cap throttle — see skills/_shared/health-filing-digest.md"`).
3. Append this survivor via `appendDigestEntries(currentBody, [finding])` and `gh issue edit <digest-issue-number> --body-file <newbody>`.
4. Never call `gh issue create` for a digested finding's own issue — that is precisely the singleton filing the cap exists to defer.

The retry-queue drain (this skill's FILE step, before this run's own new findings) is subject to the identical check — a queued singleton payload from a prior firing does not bypass the cap just because it was already queued. Extract each retry payload's fingerprint via `extractFingerprint(payload.body)` (`bin/lib/issues/record.js`) and run it through the same `decideFilingMode`/`OPEN_COUNT` logic as a fresh `'file'` decision before attempting `gh issue create` for it.

## SUMMARIZE step — always report the throttle, never let it be silently inferred

Add to the summary: `filed: N, digested: M, cap: {CAP}, materiality: K`. Report this line even when `M` and `K` are both `0` — an absent line is indistinguishable from a forgotten one. `M` counts findings routed to *this* origin's cap digest (this file's own mechanism, above); `K` counts findings routed to the separate materiality digest (`_shared/materiality-floor.md`) this same run — the two counts are never combined into one number, since they answer different questions (drain-rate throttling vs. below-floor deferral) and a reader diagnosing either mechanism needs its own count. `K` is `0` on a run where nothing cleared the materiality floor, same convention as `M`.

## Regression bypass

A `'reopen'` decision (regressed finding) is never passed through `decideFilingMode` at all — it always reopens the existing issue directly, exactly as before #235. This is what satisfies the Gotcha that a regressed-reopen must retain its proven drain history regardless of how full the origin's cap currently is.

## Keeping the five copies in sync

When one skill's copy of this mechanism changes (a bug fix, a cap-edge-case correction), check the other four against this file's canonical shape rather than assuming the change was skill-specific — the throttle/digest logic itself has no per-skill behavioral variation, only the `{PREFIX}` substitution and each skill's own dedup-decision vocabulary (`'file'`/`'reopen'`/etc., already shared via `bin/lib/health-core/dedup.js` or code-health's own fork) do.
