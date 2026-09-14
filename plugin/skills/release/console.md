# Release Console — Step 4

Read by `/claude-tweaks:release` Step 4. Renders one table naming the version this run would ship, who drove it, and what still stands between here and Step 5 — then evaluates the two HARD-GATEs on the effective version, before Step 5 ever executes anything.

## Inputs

- The preflight fact pack (`{run-dir}/release-preflight.json`, read once in Step 1): `engine`, `lastTag`, `unreleased`, `proposedVersion`, `releasePr`, `ciTip`, `openReleasePrConflict`, `hook`.
- Step 3's whole-branch review verdict: `review: blocking`, `review: findings (n medium/low, staged)`, or `review: clean`, plus the staged finding paths when any exist.
- The arguments: `--as {version}` (the effective-version override) and `--allow-blocking`.
- `work-backend` — read from the project's CLAUDE.md `## Work records` section (a missing flag is `local-files`). The `Records shipped` row branches on this, not on the engine; bookkeeping.md's Step 7 reuses the same resolution.

## The table

Render exactly these rows, in this order, as a two-column `| Row | Value |` table:

| Row | Value |
|---|---|
| Engine | `pr-first (release-please)` when `engine.value` is `pr-first`; `local-merge (bin/release-local.js)` when it is `local-merge`. |
| Since | `{lastTag.value.tag}` when `lastTag.ok`; otherwise `first release`. |
| Records shipped | One line per `(#N)` suffix found in `unreleased.value.commits[].subject`, joined to that record's title and type. **Key this lookup on `work-backend`, never on the release engine** — the two axes are independent, and a `local-merge` project can carry `work-backend: github-issues` (and vice versa), exactly as bookkeeping.md's own Inputs section already states. `work-backend: github-issues`: one `gh api repos/{owner}/{repo}/issues/N` call per distinct `N` (batched, not one shared call — `_shared/github-write-transport.md`'s "Get a single issue by number" read mapping, `issue_read` get mode where `gh` is absent). **Drop any `N` whose payload carries a `pull_request` key** — that number is a PR, not a record. GitHub's default squash subject puts the *PR* number in the trailing `(#N)`, and `gh issue view` on a PR number succeeds silently, so the issue-shaped payload is the only thing that tells the two apart. The dropped numbers render as their own line under this row — `PR-number suffixes (not records): #a, #b` — and are never booked at Step 7. This is a drop, not a failed lookup: the read succeeded and said "PR". The composer-written `(#N)` (`bin/compose-subject.js`, #2251) is always a record number; only pre-composer merges carry PR numbers. `work-backend: local-files` (the default when the flag is absent): the local record file. Step 7 reuses whichever one this step resolved rather than resolving it again. Duplicate `(#N)` suffixes across commits collapse to one line. A commit subject carrying no `(#N)` suffix never drops out of this row — it renders instead under a nested `Unattributed commits` line, one `{sha7} {subject}` per commit. A per-record lookup that **fails** — a non-zero `gh` exit, unparseable output, the MCP equivalent erroring, or a missing/unreadable local record file — renders that record's line as `#N — (title unavailable: {error})` and nothing more. It is never dropped from the shipped set: the commit shipped whether or not its title could be read, and a record silently absent from this row would under-report what the release contains. Nor does it abort the console — the remaining records, the rows below, and the gates all still render. |
| Proposed bump | `{proposedVersion.value.version} ({proposedVersion.value.part}) — driven by {sha7} {subject}`, where the driving commit is the first breaking commit in `unreleased.value.commits[]`, else the first `feat`, else the first `fix`. With `--as {version}` given, render instead: `{version} (Release-As override; commits alone justify {proposedVersion.value.part})` — `{version}` here is the effective version every later row and gate uses. |
| Review | `blocking ({n} critical/high — staged/review-*.patch)`, `clean`, or `findings ({n} staged)` — Step 3's verdict, `{n}` the count of findings at that tier. |
| CI on tip | From `ciTip`: `{state} ({success}/{total})`, with `, tipBehind: local origin/{branch} is behind` appended when `ciTip.value.tipBehind` is true; `n/a` under local-merge; `unknown (error)` when the field is degraded — never rendered as passing. |
| Release PR | `#{number} {state} {mergeable}` when `releasePr.value` is a PR object; `none` when it is the string `none`; `unknown` when the field is degraded. Append `, human-edited: yes` when `openReleasePrConflict.value` is `true` **or** that field is degraded — an edit that cannot be ruled out renders exactly as a confirmed one. |
| Hook configured | Presence only, never Step 6's post-execution result: `yes (release: published workflow)` (pr-first), `yes (release-hook)` (local-merge), `no`, or `unknown` when `hook` is degraded. This row answers "is a hook wired up", not "did it run" — Step 6 verifies that separately, after Step 5, from evidence this row never touches. |
| Overrides | `--as {version}` and/or `--allow-blocking`, each on its own line when given; `none` when neither was passed. |

## Gates

Two HARD-GATEs evaluate here, on the **effective** version (the `--as` value when given, otherwise `proposedVersion.value.version`) — never only the commit-derived proposed bump:

1. **`review: blocking`** — unless `--allow-blocking` was passed, and never lifted by it under `--train` (Step 3's override rule: no human read the finding in an unattended firing).
2. **A major bump** — the major component of `effective` is greater than that of `lastTag.value.version` (a `X.Y.Z` string — split on `.` and compare the first field numerically; `lastTag.value.version` is a string, not a parsed object, so `.major` is not a field to read), or a first release (`lastTag` not `ok`) whose effective version is `>= 1.0.0`. State why in the render: a first tag is a public contract, so shipping it at `1.0.0` or above is a major decision even with no prior tag to compare against.

**A repository that has released before but never tagged.** When `lastTag` is degraded **and** `proposedVersion.value.baseSource` is `manifest` — the pack took the base from the project's release manifest rather than from a tag (`plugin/bin/lib/release-preflight/pack.js`'s `versionBase`) — the first-release clause above still fires, and it will fire on every future run: `v{proposedVersion.value.base}` has already shipped, and nothing but a tag will tell the pack so. The gate is not lifted by this branch; what changes is that its HELD reason and `release-held.md` name the recovery verbatim rather than leaving the operator to infer one, on its own paste-ready line:

```
git tag v{base} $(git log -1 --first-parent --format=%H -S'"version": "{base}"' {tipRef} -- {manifest path}) && git push origin v{base}
```

`{base}` is `proposedVersion.value.base` and `{tipRef}` is `proposedVersion.value.tipRef`; the sha is the commit that last set the manifest to that version — the same commit SKILL.md's Step 3 resolves as its review base. Tagging the **tip** instead would fold this run's entire unreleased set into a version that already shipped, and the next run would then read `nothing to release`. `/claude-tweaks:init`'s release bootstrap (#2259) is the other route to the same tag. Once the tag exists, the next run reads `lastTag.ok` and this gate re-evaluates against a real predecessor instead of the first-release clause.

**`HELD` is mode-independent.** It means the run stopped **before** Step 5 with nothing merged, nothing tagged, nothing moved — here because a HARD-GATE fired at Step 4 (the only other `HELD` reason, the `gh`-absent pr-first stop, lives in `execute.md`'s Transport block and is named in SKILL.md's Step 8). `release-held.md` is staged in **every** mode, not only under `--train`, naming which gate fired, the effective version and its base, and the blocking findings' staged paths (SKILL.md's `--train semantics` composes it). Step 5 never runs and Step 8's summary reads `HELD`.

- **`--train`, `auto`, or headless** — stop with the console already rendered and a one-line reason naming the gate; stage `release-held.md` and exit `HELD`. There is no human here, so the staged file is the only record of why the release did not go out. These are registered HARD-GATEs (`_shared/auto-mode-contract.md`'s "HARD-GATE / BLOCKED / STOP conditions" row), not a new mid-flow stop this skill invents.
- **`interactive`** — one `AskUserQuestion` — `question`: `"A HARD-GATE fired on the effective version {effective} — {which gate} — proceed?"`, `header`: `"Release gate"`, `multiSelect`: `false`, option 1 `label`: `"Proceed (Recommended when the finding is read)"`, option 2 `label`: `"Stop"`. **Proceed** → continue to Step 5, and the outcome is whatever Steps 5–6 produce. **Stop** → stage `release-held.md` exactly as above and the summary reads `HELD`; a human-answered stop and an unattended one leave the same artifact behind, so a later reader never has to know which mode the run was in.

## Auto mode

The console renders read-only and the run proceeds to Step 5 with no `AskUserQuestion` call — except at the two gates above, which stop regardless of mode.

## Log lines

```
AUTO {time} — Step 4: console rendered — {version} ({part}), {n} records, review {verdict}, hook {value}. Reversibility: n/a.
STAGED {time} — Step 4: HARD-GATE {which} — release held. Stage path: staged/release-held.md. Reversibility: high.
```

The first line logs every render, gated or not. The second logs every HARD-GATE stage, in every mode — under `--train`/`auto`/headless, and on an interactive `Stop` answer.
