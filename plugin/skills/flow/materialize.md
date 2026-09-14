# Materialization — Records to Build-Time Files

One shared procedure, referenced by both `/claude-tweaks:flow` and `/claude-tweaks:build` wherever either accepts a work record reference (`#N` / `#A,#B`) as input. It resolves the record, hard-gates on spec shape, and writes the one build-time file everything downstream (`/superpowers:writing-plans`, execution, verification, review) then treats exactly as it treated a spec file. This is the single definition of the materialized header — every consumer of `surface:`/`design-intent:`/`size:`/etc. reads it from here; nothing else restates the format.

**`bin/materialize.js <n> --run-dir <dir> [--repo owner/name] [--ceremony fast-lane|standard] [--multi-record-slug <n>] [--record-json <path>]`** implements this file's resolution (`work-backend: github-issues`), the Materialization hard gate, header composition (`bin/lib/issues/materialize-format.js`), and the write, mechanically — `/flow`/`/build` invoke it for `github-issues` records instead of hand-composing the header inline per run. `--ceremony` is required only as a fallback when the record carries no `ceremony:*` label (the CLI cannot itself invoke the `assess-agent-autonomy` `ceremony-check` LLM judgment call below — the caller runs that first and passes the verdict through). `work-backend: local-files` is not yet wired into this CLI; that driver still reads inline per the procedure below. **`--run-dir` is a literal write-location prefix, not a run identity** — the CLI writes `{--run-dir}/work/{n}-spec.md` exactly under whatever path is passed, with no worktree-awareness of its own. In `worktree` mode (the "Sequence" below), invoke this from inside the already-created worktree and pass the **worktree-local** path to the run directory — substitute the worktree's own filesystem root for `$RUN_ROOT` in the otherwise-`$RUN_ROOT`-anchored `$PIPELINE_RUN_DIR` value — never the bare `$RUN_ROOT`-anchored value itself; passing that one writes `work/` into the main checkout instead of the worktree, defeating the worktree-first ordering this section exists to enforce.

**`--record-json <path>` (#1459) is the `gh`-absent input path.** This CLI is a plain Node subprocess and cannot itself call an MCP tool — a node subprocess cannot see an agent session's MCP tools, the same platform constraint `release-claim.js`'s header and `reconcile/pr-state.js` state. When `gh` is unavailable (a cloud/Routine sandbox with GitHub MCP tools instead), the **calling skill** — which runs inside the LLM harness and already has MCP access in this case — fetches the record itself via MCP `issue_read` (get mode, `_shared/github-write-transport.md`'s existing read-side CRUD-mapping row), writes the returned JSON (reshaped to the same `{number,title,body,labels,url}` shape `gh issue view {n} --json number,title,body,labels,url` returns — `labels` as the array-of-`{name}`/bare-string shape `parseRecordFacets` expects) to a temp file, and invokes `node bin/materialize.js <n> --record-json <file> --run-dir <dir>` instead of relying on `ghView`. `deps.ghAvailable()` is never consulted on this path. Everything downstream of the record fetch (shape gate, drift, header composition, write) is unchanged, since it already operates on the parsed record object regardless of how it arrived.

**Freshness-stamp drift (#117).** When the record's body carries a `Verified-as-of: {sha}` line (written by the four health-sweep skills via `specShapedBody`'s `verifiedAsOf` param — a plain body-metadata line, same convention as `Surface:`/`Origin:`, never YAML frontmatter), the CLI computes the commit distance from that sha to this checkout's current `HEAD` and includes it in the JSON envelope as `drift: { sha, commits, ageDays, stale }` (`ageDays` is `null` when the stamped commit's date can't be read; `drift` itself is `null` when the record carries no stamp, or the stamped sha isn't reachable from `HEAD` in this checkout — e.g. a shallow clone). When `commits` crosses a threshold (`DRIFT_THRESHOLD_COMMITS`, currently 50), the CLI also prints an actionable line to stderr naming the commit distance and the stamped sha. The caller (`/flow`/`/build`) should surface this as a visible note — "premise is N commits old, re-derive before implementing" — never as a silent skip: a fresh stamp bounds drift, it does not establish correctness, so `[IL-71]`'s instruction to re-verify a filed body's facts stays in force regardless of what this says.

**Named-location drift (#315).** The stamp above bounds a premise's *age*; it says nothing about whether the locations the body *names* still exist, and `drift` is `null` for every record carrying no stamp — which is every record not filed by a health sweep. Before scoping an implementation to a file, function, or step the record's prose names, confirm that location still exists in this checkout (grep the named symbol, `ls` the named path), and treat the stated address as a hypothesis to verify rather than a fact to build on. Record bodies are never rewritten when a later refactor moves what they describe, and a relocation sweep reaches docs and skills but not the open backlog: #464 moved claim acquisition out of dispatch into `/flow`'s Step 2.8 and swept the stale "dispatch claims" attribution from README/docs, yet #315 — filed under the old model — still named "Dispatch's Step 4 claim path" as the fix site in seven places when it was finally built, and the first implementer scoped the fix to that stale module before a second dispatch corrected it.

## Resolution

Input is one or more record references: `#N` (single) or `#A,#B,...` (comma-joined). Grammar — notation, tokenization, and element classification (batch / mixed-list hard error / empty-element naming) — is `_shared/record-batch-input.md`'s contract. A classification failure (a mixed list or an empty element) is reported in one message, naming every offender per that contract, and stops this invocation before any resolution attempt — the same all-or-nothing posture as the Record-not-found rule below (specify shares this choice; `_shared/record-batch-input.md`'s Out-of-scope section notes `/dispatch`/`/demo` instead report-and-continue). Resolve each record independently, the same way regardless of how many are in the batch.

> **Parallel execution:** Use parallel tool calls aggressively — resolving N record references (the `gh issue view` / local-store reads below) are independent per-record fetches and should run concurrently, the same way `multi-spec.md`'s "Frontmatter pre-flight" batches its own reads.

Read the project's `work-backend` config key (`_shared/work-record-config.md`, the key table's canonical home):

- **`work-backend: github-issues`** — `gh issue view {n} --json number,title,body,labels,url`. Derive `facets` from the returned `labels` via `parseRecordFacets` (`bin/lib/issues/record.js`).
- **`work-backend: local-files`** — glob `specs/{n}-*.md` for the matching filename, then `readRecord(path)` (`bin/lib/issues/local-store.js`). `facets` is already on the returned record (`.facets`).

This is the same fetch `/specify`'s Resolve-the-input case 1 uses for a record reference — deliberately identical, so a record looks the same to both skills.

### Record not found

A record reference that fails to resolve — `gh issue view {n}` errors (deleted issue, wrong repo, transposed digit) or no `specs/{n}-*.md` file matches under `work-backend: local-files` — is a hard stop, the same class of failure as the Materialization hard gate below: **STOP** before any worktree or run-dir work happens. Surface: `"Record #{n} could not be resolved (\`gh issue view {n}\` failed — check the issue exists in this repo)."` (or, under `local-files`, `"Record {n} could not be resolved — no specs/{n}-*.md file found."`). For a multi-record run, resolve every target before failing on any of them — report every unresolvable record in one message, not just the first one encountered, the same all-at-once reporting the Materialization hard gate already does for shape failures. This is a reachable path for direct human invocation (the Component-Skill Contract's "a human can also run it directly" case bypasses dispatch's own upstream existence check), not a theoretical one.

`fingerprint` — `extractFingerprint(body)` (`record.js`), run against the raw fetched body on either driver.

### Bare numeric input under `work-backend: local-files`

Under this driver, a local record's storage location *is* `specs/{n}-{slug}.md`. There is no separate GitHub issue to disambiguate against, so bare numeric input (no `#`) and `#`-prefixed input resolve identically, through this same local-files branch — reading the record file plus the shape gate below as a safety net. Under `work-backend: github-issues` a record reference always names a GitHub issue, whichever form is used.

## Materialization hard gate

Before composing anything, check the fetched body against `_shared/work-record.md`'s spec-shaped body definition: the sections `## Current State`, `## Deliverables`, and `## Acceptance Criteria` are present and each non-empty, and no unresolved placeholder marker (`TBD`, `TODO`, `<!-- ambiguity:`) remains anywhere outside the verbatim-preserved `## Original request` section (that heading to end of body is exempt — see that definition's #1240 clause).

- **Passes** — proceed to header composition.
- **Fails** — STOP before any worktree or run-dir work happens: "Record #{n} is not spec-shaped ({missing/empty section list}) — run `/claude-tweaks:specify #{n}` first." For a multi-record run, gate every record before proceeding with any of them — report every failing record's gap in one message, not just the first one encountered.

This gate is the record-level replacement for `/flow`'s pre-flight design-doc rejection (Step 2.7) — see `SKILL.md` Steps 1-2. Step 2.7 still applies to path and topic input, where a design doc can still be named; this gate applies whenever a target is a record reference.

## The pinned header format (single definition — materialize.md owns it)

```markdown
---
record: {n}
origin: {code-health|harness-health|journey-health|docs-health|capture|human}
risk: {low|medium|high}            # omitted when unscored
size: {low|medium|high}            # omitted when unscored
ceremony: {fast-lane|standard}      # always present — see ceremony-check mode below
grants: [build, merge]             # as held at materialization time; may be [build] or []
fingerprint: {fp}                  # omitted when none
blocked-by: [n1, n2]               # omitted when none — see Populating the header
surface: {web|mobile|desktop|backend|infra|terminal}
design-intent: {value}             # omitted for backend/infra
ui-stack: {value}                  # omitted for backend/infra, and whenever the body carries no Ui-stack: line — double-quoted when the value contains `:`/`#` or leading/trailing whitespace, since it's the one free-form field in this header (materialize-format.js's yamlSafeScalar)
design-seed: {opaque token}        # omitted unless the body already carries Design-seed:
parked-at-shaping: true            # omitted unless the record was parked when shaped
---
{record body verbatim}
```

| Field | Named reader |
|---|---|
| `record` | `/wrap-up` close-via-merge carrier (`Fixes #{n}`) + Section E claim release |
| `origin` | `/wrap-up` summary/Review Console display (provenance line) |
| `risk` | Audit snapshot (preserved in the committed file; no active mechanical reader today) |
| `size` | `/build` size-based profile selection — caps at Capable (`low`→Fast / `medium`→Standard / `high`→Capable, `skills/build/SKILL.md` Common Step 2). Frontier is never derived from this field or any other header value — it is invocation-only, reachable solely via a `profile=frontier` token (or its `tier=frontier` alias) typed on the `/build`/`/flow` command line itself (`dispatch.md`'s canonical guard, read from Common Step 2). Consequently `profile=frontier` is never materialized into this header; the run dir's `frontier-tally.log` — not this file — carries Frontier cap state across the build's sequential dispatches, and survives interrupt/resume because the tally is append-only in the run dir. Second reader since #1911: `build/micro-plan.md`'s applicability gate reads `size: low` (alongside `ceremony: fast-lane` below) before Spec Step 3 decides whether to skip `/superpowers:writing-plans`. |
| `ceremony` | `/flow`'s Manifesto (Step 3) bundle-fold into the `ceremony-profile` lever. Second reader since #1911: `build/micro-plan.md`'s applicability gate reads `ceremony: fast-lane` from this same header, not the run's `config.yml` — the header carries the value even for a standalone build with no `config.yml` to fold into. |
| `grants` | Snapshot for audit; `/wrap-up`'s auto-merge check RE-READS LIVE LABELS before any merge (truth, not projection) |
| `fingerprint` | Audit snapshot / dedup cross-reference |
| `blocked-by` | `/flow`'s multi-spec dependency-aware ordering — DAG construction, cycle detection, and Prerequisites check (`multi-spec.md`) |
| `surface` | `/claude-tweaks:design-wrapper` wrapper Layer-2 detection (via /build Common Step 1.7 and /flow polish phase) |
| `design-intent` | design wrapper polish-mode intent-driven dispatch |
| `ui-stack` | `/claude-tweaks:build` Common Step 1.7 (`design-prebuild.md`) forwards it into the implementer subagent's prompt; `/claude-tweaks:design-wrapper` documents the read side in `frontend-detection.md` |
| `design-seed` | Audit snapshot of the Impeccable direction contract's seed key — a build's direction is unreproducible without it, since Impeccable 4.x is deliberately non-deterministic by dice. No mechanical reader consumes it at build time; `/claude-tweaks:demo` reads the record body's own `Design-seed:` line, not this copy |
| `parked-at-shaping` | `/wrap-up` Section E release-with-abandon restores `parked` |

`surface`/`design-intent`/`ui-stack`/`design-seed` values are LIFTED from the record body's `Surface:`/`Design-intent:`/`Ui-stack:`/`Design-seed:` metadata lines (spec 17's wire format). Materialized files live under the run dir — committed as audit trail, never gitignored.

**Reading a pre-rename header:** materialized files written before this field was renamed carry `effort:` where the format above now writes `size:`. Every reader treats an `effort:` line as `size` when no `size:` line is present — the same permanent read-side fallback `bin/lib/issues/record.js` and `bin/lib/issues/local-store.js` apply to the `effort:*` label and the `effort:` frontmatter line. The emit side is `size:`-only: nothing here ever writes an `effort:` line again.

## Populating the header

Every field except `surface`/`design-intent`/`ui-stack`/`design-seed` (next section) and `blocked-by` under `work-links: native` (one extra read — see its bullet below) comes straight off data already fetched during Resolution — nothing extra to read. `ceremony` is usually also free (`facets.ceremony`, from the label `/claude-tweaks:specify` already stamped) — see its own bullet below for the fallback case:

- `record` — the id used to resolve it.
- `origin` — `facets.origin` (the `by:*` label's suffix — see `_shared/work-record.md`'s Label taxonomy table for the members, stated once there), or the literal `human` when `facets.origin` is `null` (no `by:*` label — human-filed, or a side-effect record, per `_shared/work-record.md`'s origin axis).
- `risk` / `size` — `facets.risk` / `facets.size`; omit the line when the value is `null` (unscored).
- `grants` — `facets.grants.build` / `facets.grants.merge`, as the bracket list `[build, merge]` / `[build]` / `[]`. Unlike every other optional field here, always emit the `grants:` line, even empty — a record can reach materialization ungranted (a human running `/flow #{n}` directly against a record nobody authorized).
- `fingerprint` — from Resolution; omit the line when `null`.
- `blocked-by` — the record's dependency targets, driver/`work-links`-dependent: `work-backend: github-issues` + `work-links: body-text` — `parseDependencies(body)` (`bin/lib/issues/record.js`) over the already-fetched body, no extra read; `work-backend: github-issues` + `work-links: native` — one batched `gh api graphql` call across every record in the run (aliased per record number, reusing `buildNativeDependencyQuery`/`hasOpenNativeBlocker` from `bin/lib/issues/record.js` — the same builder and OPEN-state predicate `/claude-tweaks:dispatch` Step 2 and `wrap-up/unblocked-records.md` now reach through `bin/resolve-blockers.js`, the CLI wrapping `bin/lib/issues/native-dependencies.js`'s `fetchNativeDependencies`, rather than through a hand-rolled call of their own), resolving `blockedBy` (the field `capabilities-probe.js`'s `probeSchema` checks for), added to Resolution. A single-record run is the degenerate one-alias case of the same call; `work-backend: local-files` — `facets.blockedBy`, already present on the read record. Emit as `blocked-by: [n1, n2, ...]`; omit the line when empty. Resolution is read-only and safe to run before any run dir or worktree exists (see "When this runs" below), so this data is available to `/flow`'s multi-spec pre-flight (`multi-spec.md`'s "Frontmatter pre-flight") immediately after Resolution — it does not need to wait for the header to be composed and written to disk.
- `parked-at-shaping` — `true` when the labels/facets fetched at materialization time still carry `parked`, omitted otherwise. `/specify` strips `parked` on promotion to `ready` (its permission-matrix row in `_shared/work-record.md`), so this is normally absent by the time a record is buildable; it stays meaningful for a record re-parked after promotion — e.g. by `/tidy`'s Defer action — that still got dispatched anyway, which is exactly the case `/wrap-up`'s restore-on-abandon step (see the reader table above) needs to detect.
- `ceremony` — `facets.ceremony` (the `ceremony:fast-lane`/`ceremony:standard` label `/claude-tweaks:specify` already stamped on every record it shapes). Always emit this line explicitly — never omit it, unlike every other optional field here. **Fallback only:** when `facets.ceremony` is `null` (the record reached `/flow` without ever going through `/specify`'s Step 3 — a hand-authored record, or one created before this behavior shipped), invoke the canonical ceremony-check pattern (`_shared/ceremony-check-invocation.md`) with `#{n}` using the same body/labels already fetched during Resolution. **This call site's delta:** fallback-only, per-record, with `#{n}`, and never writes back — use its `CEREMONY` output for this run's header only; `/specify` remains the sole owner of `ceremony:*`. The fallback call passes the Resolution-fetched body wrapped per `_shared/ceremony-check-invocation.md`'s untrusted-content paragraph; rendered output with no `CEREMONY:` line stops the run for that record — never defaulted to `standard`. Full rationale was `docs/superpowers/specs/2026-07-20-lifecycle-ceremony-tiering-design.md` (deleted `70849915`).

`surface` / `design-intent` / `ui-stack` / `design-seed` are the exceptions — via the lift rule below. `ceremony` is a partial exception, the same shape as `blocked-by`: free from Resolution's already-fetched facets in the common case, one extra invocation only in the fallback case above. `blocked-by` is a partial exception too: free under `work-links: body-text`/`local-files`, one extra read under `work-links: native` — see its bullet above.

## The Surface / Design-intent / Ui-stack / Design-seed lift rule

`/specify`'s Metadata block (`spec-template.md`) writes plain body-metadata lines at the very top of every shaped record body:

```
Surface: {web | mobile | desktop | backend | infra | terminal}
Design-intent: {bold | quiet | minimal | delightful | onboarding | none}
Ui-stack: {free-form component-library/styling-approach string, or an explicit no-preference answer}
Design-seed: {opaque token — never written by /specify; see below}
```

(`Design-intent:` is omitted on backend/infra records — Step 2.5a's frontend detection only asks the design-intent question for a frontend surface. `Ui-stack:` follows that same backend/infra omission, plus a second, independent condition: it is also omitted whenever the body simply carries no `Ui-stack:` line at all — the case for any record shaped before this field existed (pre-#357), since `/specify`'s pre-#357 metadata block never wrote one.) These are body text, not labels and not frontmatter — `parseRecordFacets`/`readRecord` never see them. Lift them verbatim by reading the fetched body's leading metadata block — every line before the first blank line, not a fixed line count, since which of these lines are present varies per record: the header's `surface:` copies the body's `Surface:` value; `design-intent:` copies `Design-intent:` when that line is present in the body, omitted from the header otherwise; `ui-stack:` copies `Ui-stack:` on the same present-or-omitted rule; `design-seed:` copies `Design-seed:` on the same present-or-omitted rule. Legacy `frontend` (pre-migration spec frontmatter) reads as `web`; `mixed` is retired — a record whose body still declares it needs re-shaping via `/specify` first, since a sub-issue that's genuinely both frontend and backend at once is a decomposition smell, not a valid surface value.

`Design-seed:` differs from its three neighbours in **when its value exists**, and materialization must not assume otherwise. `Surface:`/`Design-intent:`/`Ui-stack:` are written by `/specify`, so they are always already there by the time a record is materialized. `Design-seed:` is written *after* the build, by `/claude-tweaks:design-wrapper`'s `review` mode reading the built artifact's Impeccable direction contract (`_shared/design-contract.md`). Materialization runs at the *start* of a build — so on the very run that produces a seed, there is nothing to lift, and the header correctly omits the line. It appears in the header of *subsequent* materializations of the same record: a rebuild, a follow-up, a re-run after changes were requested. That is not a gap to work around; it is the field's normal lifecycle, and the header's copy is an audit snapshot either way.

Consequently, nothing may treat a missing `design-seed:` as an error or a reason to stop, and nothing may block waiting for it. The record body's own `Design-seed:` line — not this header copy — is what `/claude-tweaks:demo` reads at acceptance time, and it is read live from the record, so a first-build record whose header omits the line still shows its seed at `/demo`.

This is a lift, not a move: the body keeps its own `Surface:`/`Design-intent:`/`Ui-stack:`/`Design-seed:` lines exactly where they were written — see Composing the file below.

**Adding a fifth metadata line:** `liftMetadata`'s field regexes (`materialize-format.js`) use `[ \t]*` (never `\s*`) before their capture group — `\s` matches `\n`, so a bare "Field:" line with no value would otherwise cross into the next metadata line and misread its content as this field's own value. #357 shipped this hazard latent on two closed-enum fields before catching and fixing it repo-wide; a new field's regex must follow the same same-line-only pattern from the start.

## Composing the file

```
---
{header fields from above}
---
# {n}: {title}

{record body verbatim}
```

`{title}` is the title fetched during Resolution (`gh issue view`'s `.title` field, or `readRecord(path).title`) — title is a record facet, never body content (`spec-template.md`'s Facets section), so it is not part of "record body verbatim" and needs this explicit heading line to stay visible to everything downstream that expects a spec file's first line to be its title. `{record body verbatim}` is exactly the fetched body, unmodified — including its own `Surface:`/`Design-intent:`/`Ui-stack:`/`Design-seed:` lines; the header's copies of those values are a lift, never a strip.

## Multi-record layout

Each record in a multi-record run (`#A,#B,...`) materializes to its own file, one per record — a partial materialization never happens silently; the hard gate above checks every record in the batch before any file is written.

Single-record and multi-spec runs use the two run-dir shapes already established by `_shared/pipeline-run-dir.md` and `multi-spec.md`:

```
{run-dir}/work/{n}-spec.md                        ← single-record run (git-tracked in the worktree — pipeline-run-dir.md's exception; reaches the main checkout by merge)
{parent-run-dir}/spec-{a}/work/{a}-spec.md        ← multi-record run, record a
{parent-run-dir}/spec-{b}/work/{b}-spec.md        ← multi-record run, record b
```

The multi-record case reuses `multi-spec.md`'s `spec-{N}/` per-spec subdirectory, keyed by record id.

## When this runs

**Resolution and the hard gate are read-only** — safe to run at any point, including before a run directory or worktree exists. `/flow` runs them early (Step 1), performing the design-doc granularity check at the record level.

**Composing, writing, and committing the file needs a resolved `$PIPELINE_RUN_DIR` (`_shared/pipeline-run-dir.md`) and a checkout the write can land in.** The underlying constraint is real: a worktree branches from a commit, so anything merely left uncommitted in the tree it branched from does not travel with it. The remedy is to **create the worktree first, then scaffold the run dir and materialize inside it** — the file is written and committed on the feature branch, where it is already in the right place.

Do **not** write and commit the file on the current (pre-worktree) branch and then branch from that updated HEAD. That ordering is unexecutable on any project with `worktree-always: true`: the write lands in the main checkout, which the policy gate denies — `Write` first, and the `git commit` after it (see `_shared/policy-schema-coverage.md`'s `worktree-always` coverage block). There is no pipeline-bookkeeping exemption that covers it, because the run dir's *committed* half is ordinary tracked content on a branch, not the gitignored state the gate exempts. Worktree-first has no such problem and is correct under either policy, so it is the single documented order rather than a conditional one.

Sequence, in `worktree` mode (the default): create the worktree (`/build`'s Common Step 1, or `/flow`'s own up-front shared-worktree creation for a multi-record run). `{run-dir}` itself is never scaffolded inside the worktree — it is anchored at `$RUN_ROOT` per `_shared/pipeline-run-dir.md`'s Anchoring section (already created there by `/flow`'s own Step 3 Manifesto in the common case, or resolved via `_shared/run-dir-resolution.md`'s Resolution order otherwise). Only `work/` is created — inside the worktree, at the matching relative path under the worktree's own filesystem location — then compose the file and commit it there as the branch's first commit.

In `current-branch` mode there is no worktree to order against — compose, write, and commit on the current branch directly. `worktree-always: true` and `current-branch` are mutually exclusive by construction, so this path never meets the gate.

Consumers that state this ordering: `build/SKILL.md` Common Step 1, `flow/SKILL.md` Step 4.2, and `flow/multi-spec.md`'s shared-worktree pre-flight. They cite this section rather than restating the rationale; if the order ever changes again, it changes here and those three citations follow.

**Standalone fallback (no run dir resolves).** When `/claude-tweaks:build #{n}` runs standalone — no `/claude-tweaks:flow` parent, and neither the `PIPELINE_RUN_DIR` env var nor a most-recent matching directory resolves per `_shared/run-dir-resolution.md`'s Resolution order (steps 1-2) — create the standalone run dir's gitignored half (`decisions.md` + `staged/`, per `_shared/run-dir-resolution.md`'s standalone conventions) at `$RUN_ROOT/.claude-tweaks/pipelines/{ISO-timestamp}-record-{n}-standalone/` (`$RUN_ROOT` resolved per `_shared/pipeline-run-dir.md`'s Anchoring section, not the current directory), and materialize `work/{n}-spec.md` into the **worktree's** copy of that same relative path — per the Anchoring section, `work/{n}-spec.md` is the tracked exception that stays in the worktree, not under `$RUN_ROOT`, and reaches the main checkout only by merge. This is narrower than `_shared/run-dir-resolution.md`'s Resolution-order step 4 (the auto-mode standalone allowlist): it applies regardless of mode — materialization needs somewhere to write the file whether or not `auto` is active — and `/build` is not itself on that allowlist. (This same exception is now also its own numbered step 3 in `_shared/run-dir-resolution.md`'s Resolution order, folded into that algorithm rather than trailing prose after it.) The resulting standalone run dir becomes this build's `$PIPELINE_RUN_DIR` for the rest of the run (ledger, decisions, and cleanup all resolve against it the same as any other run dir).

A record already materialized by a caller earlier in the same run (e.g. `/flow` wrote it before invoking `/claude-tweaks:build #{n}`) is not re-fetched or re-composed — the caller checks for an existing `{run-dir}/work/{n}-spec.md` (or its `spec-{N}/` equivalent) first and reads it in place when present.

## Committed as audit trail, never gitignored

Materialized files are meant to survive as ordinary tracked history on the branch that builds them. Unlike the rest of the pipeline run directory (`config.yml`, `decisions.md`, `staged/`, `run-state.json`, `events.jsonl` — all gitignored, archived as plain files at wrap-up, never committed for a `/flow`/`/build` run; a `*-tidy-standalone*` or `*-sweep-standalone*` run's own `decisions.md`/`report.md`/`staged/**` are the one carve-out to "never committed" — `_shared/auto-decision-log.md`'s tidy-standalone/sweep-standalone clause, #1493/#1494; see `_shared/auto-mode-contract.md` for everything else), the `work/` subdirectory is a deliberate, narrow exception: `.gitignore` carves it out of the otherwise-blanket `.claude-tweaks/pipelines/` ignore so `git add`/`git commit` actually track it, at both the single-record depth (`{run-id}/work/`) and the multi-record depth (`{run-id}/spec-{N}/work/`).

Per this project's own convention for a committable child of an ignored parent (see CLAUDE.md's `.gitignore` guidance — a blanket ignore on a parent directory silently and permanently defeats a naive single-line `!` re-inclusion of anything nested under it), the fix does not rely on that pattern. It explicitly un-ignores each directory level on the way down to `work/`, at both nesting depths.
