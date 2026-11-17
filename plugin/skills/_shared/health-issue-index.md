# Health Sweep — Issue Index for Dedup

Single source of truth for how the five health sweeps (`/claude-tweaks:code-health`,
`/claude-tweaks:harness-health`, `/claude-tweaks:journey-health`,
`/claude-tweaks:docs-health`, `/claude-tweaks:ci-health`) build the `by:{skill}` issue index their
`validate-findings` step dedups against. Each skill's own `gh issue list` command and
fingerprint-parsing instructions stay in that skill's GATHER OPEN ISSUES step; this file
owns transport selection and what each possible outcome means. `ci-health` keeps no durable
state, so the degraded row and the `declined` fallback below are not its: with no readable
index it files nothing (its own GATHER OPEN ISSUES step), and the "four skills" below are the
other four.

`{SKILL}` below is the calling skill's own name (`harness-health`, `docs-health`, …) and
`{ISSUES_FILE}` its own parsed-index path.

## Transport

`gh` present (`command -v gh` exits 0) → run the skill's own `gh issue list` command
unchanged.

`gh` absent → **rebuild the same index via the MCP `list_issues` tool**, filtered to label
`by:{SKILL}` and state `all`, per `_shared/github-write-transport.md`'s CRUD mapping.
Project the results into the identical `{ number, state, labels, fingerprint }` shape and
write them to the same `{ISSUES_FILE}` path, so the `validate-findings` call downstream is
byte-identical on both transports. Never `search_issues` — it rides an eventually-consistent
index and has caused real duplicate-filing incidents (see that file).

Neither `state` nor `labels` needs cleaning before the file is written, on either transport.
`state` may be in either case (`gh` returns `OPEN`/`CLOSED`), and each `labels` element may be
a label name or `gh`'s label object: `loadIssueIndex` (`bin/lib/health-core/issue-index.js`)
lowercases `state` and reduces `labels` to label names. A label element with no string `name` is
dropped, and the load reports the total once on stderr (`ignored {n} label entries with no name`).
An entry whose `state` is missing or not a string is kept with an empty state, which every sweep
treats as not closed, and the load reports the count once on stderr
(`{n} issue entries with no state, treated as not closed`).

A missing `gh` is a reason to **change transport, never a reason to skip this step**. The
detection is a capability probe, not an environment classification: it holds regardless of
*why* `gh` is missing, and the unattended cloud Routine firing where `gh` is reliably absent
is precisely the run that most needs a correct index.

## MCP body sanitization strips the fingerprint marker on read (#1700)

`_shared/pr-early-run-lifecycle.md`'s "Root cause" section documents that the GitHub MCP
server's read path (`bluemonday.StrictPolicy()`) strips every `<!-- ... -->` HTML-comment span
from a fetched body — write-side unsanitized, read-side stripped — and that this applies to
issue reads (`list_issues`, `issue_read`) exactly as it does to PR reads. Consequence for this
file's own MCP projection step: the `<!-- work-fingerprint: {id} -->` marker `extractFingerprint`
(`bin/lib/issues/record.js`) is documented to read is invisibly gone from a `gh`-absent fetch,
even though the marker really exists in the issue's stored body — a `gh`-based read of the same
issue shows it intact. Left unfixed, every `fingerprint` field in the MCP-built index comes back
null, so `loadIssueIndex`'s `if (issue.fingerprint)` guard populates an empty lookup map
regardless of how many matching issues already exist open, and a finding identical to one already
filed re-files as a duplicate — silently, on every headless firing (the same failure class #163
fixed for the empty-vs-unavailable-index distinction, via a different mechanism: here the fetch
succeeds and is non-empty, it just carries no usable fingerprint data).

The fix: `recordPayload` (`bin/lib/issues/record.js`) writes a plain-text companion line
(`work-fingerprint: {id}`, no comment syntax) immediately after the HTML-comment marker,
unconditionally on every transport — the write path is unsanitized either way, so writing both
costs nothing. `extractFingerprint` tries the HTML-comment marker first (both the current and
legacy forms), then falls back to the plain-text companion — the one form an MCP-stripped body
still carries. Every consumer that calls `extractFingerprint` on a fetched body (this file's own
`gh`-absent projection step and each
health sweep's own GATHER OPEN ISSUES instructions) gets the fix automatically — there is no
separate MCP-specific parsing path to maintain.

## The three outcomes are not interchangeable

| Outcome | `ISSUES_FILE` | Meaning |
|---|---|---|
| Index fetched on either transport, one or more issues returned | path to the parsed JSON | Normal. Pass `--issues`. |
| Index fetched, but the repo genuinely has no `by:{SKILL}` issues yet | path to a file containing `[]` | **Legitimate empty index** — a first-ever sweep, or every prior finding since deleted. Dedup against it is correct *and complete*. Still pass `--issues`. |
| Neither transport can reach GitHub (no `gh`, no MCP tool, or the API is down/unauthenticated) | `""` | **Degraded** — the index is *unknown*, not empty. Omit `--issues`, and say so explicitly in the run's output (see below). |

Writing `""` for the second row is the specific mistake this file exists to prevent. An
empty index and an unavailable index produce the same `--issues`-less command but mean
opposite things, and collapsing them is what silently disabled `wontfix` suppression across
three of these four skills (#163).

## Reporting a degraded run

On the third row only, state it in the run's own output — do not let it pass silently:

> Issue index unavailable this run (`gh` absent and no GitHub MCP transport reachable) —
> dedup fell back to durable state only. Findings already suppressed on a prior run stay
> suppressed; a `wontfix` applied since the last successful index fetch is not visible to
> this run.

That last clause is the real residual risk and the reason the fallback below exists rather
than being relied on alone.

## Why a degraded run is survivable

`wontfix` lives on the GitHub issue, so an index-less run cannot read it fresh. What makes
that survivable is that a run which *does* read the index hands its readings forward: every
finding suppressed because its matching issue carries `wontfix` is persisted to the durable
`declined` slice on the `health-state` branch (`_shared/health-state.md`), which — unlike
the local gitignored `cache.json` — survives a scheduled Routine firing's fresh, stateless
container. See `bin/lib/health-core/mark.js`'s `mergeWontfixIntoDeclined`. Three of the four
skills (harness-health, journey-health, docs-health) route the hand-off through
`bin/lib/health-core/validate-findings-dispatch.js`'s shared `wontfixSuppressed` collection;
code-health runs its own `decide()` (`bin/lib/code-health/dedup.js`'s `threshold`/`risk`/
`remember` vocabulary has no equivalent in that shared module) and performs the equivalent
hand-off itself — `dedup.js`'s `decide()` tags a fresh index-match suppression with
`reason: 'wontfix-label'`, `bin/code-health.js`'s `cmdValidateFindings` collects those into
its own `wontfixSuppressed` array, and `bin/lib/code-health/cache.js`'s
`buildValidateFindingsUpdate` folds them into `declined` via the same `mergeWontfixIntoDeclined`
(#171).

So the two mechanisms cover different failures and both are needed:

| Failure | Covered by |
|---|---|
| `gh` missing (the cloud Routine sandbox) | the MCP transport above |
| GitHub unreachable entirely, or a `wontfix` applied before this container existed | the durable `declined` slice |

The local `cache.json` covers **neither** in a Routine: it is recreated empty in every fresh
container. Do not cite it as the fallback for either row.
