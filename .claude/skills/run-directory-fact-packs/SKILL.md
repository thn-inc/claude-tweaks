---
name: run-directory-fact-packs
description: Use when adding a fact pack for a pipeline phase, adding a probe to an existing one, or changing what a skill's prose reads out of one — the anchored read-only CLI, the per-field {ok, value | error} envelope, the 0/2/3 exit vocabulary, and the location/freshness/phase trace every field owes before it is written. Keywords - fact pack, pack.js, preflight.js, wrap-up-pack, flow-preflight, probe, envelope, run dir, anchored, degraded field, consumer timing.
---

# Run-Directory Fact Packs

A fact pack replaces N ad-hoc reads scattered through a skill's prose with one deterministic
process: a CLI gathers everything that phase needs, writes one JSON document into the run dir,
and the prose reads fields out of it. The runner owns execution and bounding; the skill owns
judgment. Three are shipped — `plugin/bin/lib/wrap-up/pack.js` + `plugin/bin/wrap-up-pack.js`
(wrap-up Phases 3-4, eight probes), `plugin/bin/lib/flow/preflight.js` +
`plugin/bin/flow-preflight.js` (`/flow`'s second call) and
`plugin/bin/lib/release-preflight/pack.js` + `plugin/bin/release-preflight.js`
(release preflight, eight probes) — and they agree on every rule below
except selective-probe filtering (see the `--only` bullet).
Read them before writing a fourth.

## The shape

- **Module and CLI split.** The gathering module (`lib/<phase>/pack.js`) exports `gatherPack`-style
  entry points and a `PROBE_NAMES` list; the `bin/` CLI owns argument parsing, anchoring and the
  exit code. Every fs read, git call and subprocess goes through `deps` so tests inject fakes —
  the injectable-runner rules in `gh-api-module-pattern` apply here unchanged.
- **Per-field envelope, per-field degradation.** Each probe returns `{ok, value}` or `{ok: false,
  error}`. A probe that fails degrades its own field and nothing else; the pack is still produced.
  This is why the CLI exits 0 "whenever the pack was produced" — a BLOCKED freshness verdict or an
  unavailable `gh` is *data the skill acts on*, never an exit code.
- **Exit vocabulary: 0 / 2 / 3, no 1.** 0 the pack was produced, 2 malformed invocation, 3 the
  `--run` directory (or `--json`'s parent) does not resolve under the main checkout. Both CLIs get
  the anchoring predicate by importing `lib/stage-item/write.js`'s `resolveTarget` rather than
  re-deriving it, and both decide on the *real* path ([IL-127], [IL-150]). This is the
  sanctioned-writer vocabulary, and a fourth pack must not invent a 1.
- **Read-only apart from the pack file**, and say so in the header. Nothing in a pack releases a
  claim, archives, posts, or edits a record — a pack is re-runnable at any point in the phase.
- **Write atomically** (`lib/atomic-write.js`), because a consumer may be reading the previous
  pack while this one is written.
- **`--only <probe,...>`** so a consumer that needs one field does not pay for eight —
  `wrap-up-pack.js`/`pack.js` and `release-preflight.js` only; `flow-preflight.js` has no `--only` flag, and
  `flow/preflight.js`'s `gatherPreflight` computes every probe unconditionally regardless of
  `--steps` (its own parse-error text calls `--steps` "metadata — every field is computed
  regardless"), since `/flow`'s second call always needs the full set.
- **A pack proposes; it never decides.** Any field an engine or a forge will later own — a version,
  a merge state, a PR number — is labelled a *proposal* in the consumer's prose, is re-read from
  that engine after the engine acts, and the reconciliation is written **once**, at the consumer,
  never per use site. `release-preflight`'s `proposedVersion` is the shipped instance (#2256): the
  pack never fetches, release-please reads config the pack does not, and a sibling release can land
  between the gather and the engine's run, so the pack's number is the *gating* version and the
  engine's return is the *shipped* one (`plugin/skills/release/execute.md`'s "Two versions"
  section). Treating the proposal as the number to verify and to book cost two fix waves on one
  confusion; this is the freshness question of the next section asked one level up — not "is the
  value stale?" but "whose value is it?".

## Every field owes a location, a freshness, and a phase — traced before it is written

This is the expensive rule; it cost #1930 three fix rounds and two removed probes. For each
proposed field, answer three questions against the code, at plan-authoring time:

1. **Where does this data live at gather time?** Not where it lives conceptually. #1930's records
   probe read `work/`, which never exists in the main-checkout run dir.
2. **Does the consumer mandate a freshness step first?** `mergeSize` was dropped from the wrap-up
   pack because its consumer must measure *after its own fetch* — a pre-gathered value is stale by
   construction.
3. **Does the consumer run before or after the gather?** `release` was dropped because its consumer
   runs post-merge; the pack is gathered pre-merge.

A field failing any of the three is not a pack field. Plan and code will agree with each other
regardless — the defect surfaces only when the pack is run against a real run directory, so run it
against one before the review does.

## The prose half

- **Every field needs a named prose consumer.** A field nothing reads is context nobody spends;
  #1930 walked the pack field-by-field and cut the ones with no reader.
- **Every field read carries an absent-file fallback.** The pack may be missing (an older run, a
  `--only` subset, a degraded probe), so each reading sentence states what the skill does without
  it — never "read `pack.residue`" with no else-branch.
- **Live where liveness matters.** A field whose value can change between gather and use is read
  live at the point of use, not out of the pack. Say which fields those are.
- **Pin the literals to one source.** Where the pack carries note text or adoption-case wording the
  prose quotes, that text lives in the module (`flow/preflight.js` owns the five adoption-case note
  literals) and a conformance test pins the prose against it — not two copies drifting.

## When to use

- Adding a fact pack for a pipeline phase, or a probe to an existing one.
- Changing which pack field a skill's prose reads, or removing a field.
- Reviewing a plan that proposes a pack: check every proposed field against the three questions.

## When not to use

- A single read a single sentence needs — one `node -e` or one `git` call is not a pack.
- Anything that mutates. A pack is read-only; a writer belongs with the sanctioned writers
  (`log-decision.js`, `stage-item.js`, `set-config.js`).

## Origin

Derived at wrap-up from the multi-spec run that shipped #1930 (`wrap-up-pack.js`) and #1931
(`flow-preflight.js`) — ledger rows 52 and 56 of
`docs/plans/2026-09-05-spec-1921-…-1929-ledger.md`.
