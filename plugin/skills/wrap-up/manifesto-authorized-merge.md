# Manifesto-Authorized Merge — the `merge-authorization` lever's Auto-merge short-circuit branch

Cited from `wrap-up/auto-merge-short-circuit.md` — read this file only when that file's
applicability check reaches its `merge-authorization` branch (below); the existing `auto:merge`-
label branch is unchanged and does not need this file.

## Applicability (second, independent trigger)

In addition to the existing condition (issue's live labels carry `auto:merge`, or a matured
`auto:merge-pending` — see `auto-merge-short-circuit.md`'s own Authorization step, #309), this
short-circuit also applies when this run's `config.yml` resolves `merge-authorization` to
`pre-authorized`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-policy.js" --run "$PIPELINE_RUN_DIR" --values merge-authorization
```

`flow/manifesto.md`'s lever 13 — always a live Manifesto `confirm`/`hybrid` override answer, never
a `.claude-tweaks/policy.yml` default (`bin/lib/policy-schema.js`'s resolver special case discards
a `policy.yml` value for this key). When this condition is true, Layer 1 (Authorization) of the
short-circuit's two-layer gate is satisfied by the lever alone — no `auto:merge` label is required.
Layer 2 (Content judgment, `assess-agent-autonomy merge-check`) is unchanged and still applies:
the lever authorizes the merge decision, not a skip of the content-judgment safety net.

## Tag selection

Both merge call sites resolve the same `{tag}` the same way: `_shared/pr-first-merge.md` Step 3's
`{tag}` parameter (`pr-first` subsection) and the `local-merge` subsection's `--tag {tag}` argument
to `bin/compose-subject.js` (which carries it as a `[{tag}]` body paragraph of the composed merge
message). `{tag}` is `fast-lane` when the live `auto:merge` label is present
(the standing, pre-existing signal wins when both conditions hold); `manifesto-authorized` when
only the `merge-authorization` lever triggered this branch (no `auto:merge` label).

## Why policy.yml is excluded

`merge-authorization` never reads `.claude-tweaks/policy.yml` — its resolver special case
(`bin/lib/policy-schema.js`) discards a `policy.yml` value and falls back to the `ask` default as
if nothing had set it. This is deliberate: every other lever's project-policy source is a standing
default a human sets once, in the repo, on behalf of every future run. This lever specifically
authorizes an irreversible action (a merge) with zero further human interaction once the run
reaches its terminal step — collapsing that into a project-wide, no-longer-live default would
recreate the exact non-interactive auto-grant `_shared/auto-mode-contract.md`'s `auto:*` invariant
forbids. The only way to set it is a live answer: an explicit Manifesto override reply
(`confirm`/`hybrid` mode, `13=pre-authorized`) — the default `auto` mode's read-only-FYI
Manifesto never asks, so under plain `auto` this lever always resolves `ask` unless a prior step
in *this same run* already wrote `pre-authorized` into `config.yml`.

## Log line (lever-triggered case only)

Both the `pr-first` and `local-merge` subsections of the Auto-merge short-circuit already log an
`AUTO {time} — Fast-lane auto-merge: issue #{n}, ...` line on the `auto:merge`-label path. On the
`merge-authorization`-lever path (no `auto:merge` label present), log instead:

`AUTO {time} — Manifesto-authorized auto-merge: issue #{n}, assess-agent-autonomy verdict
auto-merge (see RATIONALE), pr-first-merge outcome {merged|armed|pending-review}. {Merge commit:
{sha}. Reversibility: high (git revert). | Reversibility: n/a (nothing merged yet).} [lever:
merge-authorization=pre-authorized (run-config)]`

Same shape, same placement, in both the `pr-first` and `local-merge` subsections — only the tag and
the trailing `[lever: ...]` attribution differ from the `auto:merge`-label path's existing line.
