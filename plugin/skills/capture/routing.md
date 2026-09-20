# Capture — Immediate Routing

Loaded by `/claude-tweaks:capture`'s `SKILL.md` after a record is filed (Workflow Step 2) — the
full procedure for what happens to a captured idea next: absorb it into an existing record,
brainstorm it, or leave it in the backlog. **Filing-time pre-emption:** an agent-driven filing
may absorb before any record is created at all — see Headless bar below, which runs before
`SKILL.md`'s Workflow Step 1 ever creates a record and short-circuits it entirely when it fires;
the sections below (route execution, absorb mechanics) all describe what happens *after* a
record already exists, i.e. when the headless bar declined to absorb (or didn't apply).

Absorb never targets: (1) a closed record, (2) a `parent-issue` carrier, (3) a `bot:in-progress` carrier (per `_shared/work-record.md`); files fresh with `**Related:** #N` for all three. **Driver mapping:** `github-issues` reads these three states directly off the candidate's live labels. `local-files` reads (1) via the candidate's `facets.closed` field and (2) via `facets.isParentIssue` (`bin/lib/issues/local-store.js`) — both already parsed by the same read that fetched the candidate for matching, no extra fetch needed. `local-files` carries no claim mechanism at all (`_shared/issue-claims.md`'s protocol, and `/claude-tweaks:dispatch`'s Preflight stop, are both `github-issues`-only), so exclusion (3) is vacuously satisfied on that driver — no local record can ever be `bot:in-progress`, so nothing is ever excluded on that ground there.

### Routing via `--route` arg (front-loaded)

`/claude-tweaks:capture` accepts `--route={brainstorm|keep|absorb:N}` to skip the post-capture prompt:

| `--route` value | Action |
|---|---|
| `brainstorm` | Open `/superpowers:brainstorming` with the new backlog record as input — composed per `brainstorming-ceremony.md` in the `/claude-tweaks:specify` skill's directory (see Route execution below) |
| `keep` | Record stays in backlog state — explicitly, no label asserts this; no further routing |
| `absorb:42` | Absorb the record into record `#42`; close the new record as not-planned |

Legacy route values `inbox` and `merge:N` are accepted as aliases for `keep` and `absorb:N`.

When `--route` is provided, log:
```
AUTO {time} — Routing: applied --route={value} for backlog record "{title}".
```
No further prompt. Proceed directly to the routed skill or commit.

### Routing prompt (when `--route` not provided)

In auto mode, apply the silences-table row for /capture from `_shared/auto-mode-contract.md`: if `--route` was passed, honor it; otherwise default to `keep` (the most conservative route — the record stays in backlog state for periodic review at `/tidy`, no further write that wouldn't have happened anyway). Log:
```
AUTO {time} — Routing: defaulted to keep (no --route provided). Reversibility: high (record stays in backlog state; user can re-route via /tidy at any time).
```

**Headless bar** (judged at filing time — before any record is created and before the born-ready chain fires; an absorbing capture never files or chains): agent-driven filings (`$PIPELINE_RUN_DIR` set — the primary signal — `--source`, or `--defer-reason=`; explicit `--route` wins) absorb only if (a) is a literal path match and (b)'s `type:{t}` matches (both below) — standing in for (b)'s operation-match judgment; else files fresh with `**Related:** #N` (Entry Format's field on the stub branch; appended to the composed body before its single write on the Shaped-body branch). **Driver mapping for (b):** `github-issues` reads the candidate's `type:{t}` label; `local-files` reads the candidate's `facets.type` field (same `TYPE_LABELS` vocabulary, `bin/lib/issues/record.js`) — evaluable identically on both drivers, no unevaluable case remains. **`work-types: none` (#1296):** criterion (b) has no `type:{t}`/`facets.type` to read on this config — the bar cannot evaluate it and never fires, so every agent-driven capture files fresh, the safe direction. Bare `auto` keeps the contract's `keep` default; it absorbs only via explicit front-loaded `--route=absorb:N`. If a run directory resolves, log `AUTO {time} — capture absorbed into #{N} (shared path + same type). Reversibility: high (a delimited Absorbed-heading append; deleting that section restores #{N}'s prior body exactly).` per `_shared/auto-decision-log.md`. **Reclassified from `medium` (#1296):** unlike an indistinguishable integration, this append is delimited under its own dated `## Absorbed:` heading (Route execution below) — reversal is one deletion, not a manual reconstruction, so it clears the contract's `high`-reversibility bar cleanly.

In interactive mode (or when explicitly opted in), present "Added: '{title}' (Type: {t}, Definition: {needed|clear})" (rationale clause per Judging Definition above, when applicable) and call `AskUserQuestion`:

- `question`: `"What should happen with this?"`, `header`: `"Route idea"`, `multiSelect`: `false`
- **High similarity** (two-criteria bar below, met by one candidate): absorb is **Option 1** — `label`: `"Absorb into record {N} (Recommended)"`, `description`: `"This belongs in an existing record"` — then Brainstorm and Keep. Several candidates meeting the bar: recommend the one sharing the most file paths, tie-broken by most-recently-updated (`updatedAt` under `github-issues`; the record file's last-commit date under `local-files` — `git log -1 --format=%cI -- {path}`, per `_shared/record-queue-fetch.md`'s Staleness clock section, not raw filesystem mtime, which resets on every fresh checkout and would tie-break on checkout order rather than actual recency); one click declines.
- **Low or ambiguous similarity** (a candidate exists, bar not met): `label`: `"Brainstorm directly"` **(Recommended)**, `description`: `"Run /superpowers:brainstorming now, then /claude-tweaks:specify"`; `label`: `"Keep as backlog record"`, `description`: `"Not ready yet — review at /claude-tweaks:tidy"`; absorb last, conditional Option 3.

The call has 3 options only when absorb is visible, in either ordering; otherwise Brainstorm and Keep only — never an absorb option with a placeholder value.

> **Absorb visibility:** Search for a candidate on the new record's topic keywords, per the active driver from Backend Selection. `local-files` — search `specs/` for a record matching the keywords. `github-issues` — match the keywords against the open records in the session-scoped record snapshot (`_shared/record-queue-fetch.md`; its union field set carries every field judging needs — no search index). Only show absorb when a candidate is found; otherwise absorb is omitted entirely — manual disambiguation against an unspecified record number is worse than no option. The recommended-absorb ordering applies on both drivers — the two-criteria bar below is evaluable under `local-files` the same way (see the headless bar's driver mapping above), so there is no driver-scoped restriction left to state.
>
> **High similarity** means both criteria hold, each anchored on a concrete shared artifact, not a similarity score: **(a) same file/subsystem** — the candidate's body (its `### Key Files` section when spec-shaped, else its title subject) and the capture's `Context:`/`Scope:` text name at least one identical file path or module/subsystem; **(b) same kind of change** — identical `type:{t}` value (the Type axis in `_shared/work-record.md`; `TYPE_LABELS` in `bin/lib/issues/record.js`) AND the same operation on that subject — matching verb-plus-target.

### Route execution, by backend

| Route | `local-files` | `github-issues` |
|---|---|---|
| `brainstorm` | Opens the child skill with the record's text as input | Opens the child skill with the issue title + body as input (reference `#{issue-number}`) |
| `keep` | No further action — the record stays as-is at `specs/{id}-{slug}.md`, no `stage:` frontmatter | No further action — the issue is already open, `by:capture`-labeled, with no stage label. That **is** the backlog state; there is nothing to add. |
| `absorb:N` | Appends `## Absorbed: {YYYY-MM-DD} — {captured title}` under N's existing sections (never rewriting content above), delete the absorbed record's file | Per the Absorb mechanics below, then comment `Absorbed into #N.`, then `gh issue close {n} --reason "not planned"` |

**Ceremony wiring (#2347):** before invoking `/superpowers:brainstorming` on either driver, follow `brainstorming-ceremony.md`'s Steps 1-3 in the `/claude-tweaks:specify` skill's directory — resolve `design-ceremony` via `resolve-policy.js`, compose the actual `args` via `compose-brainstorm-args.js` over the record's text (local-files) or issue title + body (github-issues), then pass that command's stdout, verbatim, as the Skill tool call's `args`. This is the fourth claude-tweaks-owned `/superpowers:brainstorming` call site honoring `design-ceremony` — the same procedure `/specify`'s cases 1, 4, and 5 already use, so `fast-lane`'s consolidated-design-sections behavior applies here identically to a bare topic or record routed through `/specify`.

**Absorb mechanics:** the append is composed once via `_shared/github-write-transport.md` (`gh issue edit {N} --body-file`); past 55,000 post-append chars (vs 65,536 cap), comment instead. Re-judges `size:` per `_shared/work-record.md` — raise only, never lower; `priority:*` stays unwritten, suggest higher priority in output. Names target + append; invalidates the session snapshot per `_shared/record-queue-fetch.md`. **Applies on both drivers:** the `size:`-raise-only and unwritten-`priority` rules, and the `## Absorbed:` heading naming convention, are driver-agnostic — `local-files` re-judges `size:` by rewriting the target's `size:` frontmatter facet in place via `writeRecord` (raise only, same rule), leaves `priority` unwritten, and appends under the identical `## Absorbed:` heading (the local-files column of the Route execution table above already shows this — nothing further to add there). `local-files` has no session-scoped snapshot to invalidate — every read is fresh off disk — so that step is `github-issues`-only.

**Unknown or invalid `N`** — when `--route=absorb:N` names a record that doesn't resolve (nonexistent, already closed/absorbed, excluded per the absorb exclusions above, or a number that doesn't exist under the active backend's numbering), stop before writing or closing anything and report the invalid `N` to the user instead of guessing a fallback route — the same rule `/claude-tweaks:tidy` applies to an unknown scope name. Do not silently fall back to `keep`.

This ensures every captured idea has an explicit next step — either immediate action or a conscious decision to keep it in backlog state.

**Good entries:**

- "Voice command to add item to shopping list" — context explains the need
- "Recipe nutrition facts display" — scope hints at UI + data needs

**Bad entries:**

- Just "nutrition" — too vague to act on later
- Full spec with 20 tasks — that's a spec, not a backlog record
- Notes about an existing spec ("spec 50 needs review") — absorb it into that spec
