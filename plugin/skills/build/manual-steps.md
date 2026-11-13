# Spec Step 2.5 — Classify and Seed Manual Steps

Read from `/build` Spec Step 2.5, when the spec has a `## Manual Steps` section or every `## Deliverables` item is operational (the skip path stays in `SKILL.md`); and from Common Step 5.5 (`operational-checklist.md`), which applies the same triage to its operational findings on every build that reaches it.

If the spec has a "Manual Steps" section, classify each item before deciding what to do with it. "Outside the codebase" is not the same as "human-only" — many such tasks have CLIs and should be executed inline rather than dumped to the ledger.

**No Manual Steps section, but every `## Deliverables` item is operational (#2554).** A record whose Deliverables are wholly operational actions — dispatch a deploy workflow, trigger a job run through an API, apply infrastructure, verify a live result — with no source file changes, and no separate `## Manual Steps` section, still has real triage work to do: the `## Deliverables` list itself is the triage input. Read each Deliverable item through the same probe-then-triage procedure below (CLI/API check → credential check → auto-executable / auth-gap / truly-manual), exactly as if it were a Manual Steps line. When **every** Deliverable classifies this way (nothing left that touches the codebase), proceed directly to Common Step 5 after acting on them, writing **one consolidated** `SKIP` entry for the code-oriented steps this run has nothing to do (Spec Step 3, Common Steps 1.5, 1.7, 2, 3, 6, 6.5) instead of one `SKIP` per step — condition: "record is wholly operational (Deliverables triaged as Manual Steps, no code change)". A record with even one Deliverable that touches the codebase is not wholly operational — fall through to the ordinary per-step SKIP/execute behavior in `SKILL.md` instead.

> **Parallel execution:** Use parallel tool calls — the CLI/credential probes for each Manual Steps item are independent Bash operations and should run concurrently, the same shape `operational-checklist.md`'s Common Step 5.5 already parallelizes for its own probes.

For each item, probe in this order:

1. **CLI/API check** — infer the relevant tool from the item text, then probe: `which terraform`, `which vercel`, `which gh`, `which fly`, `which wrangler`, `which stripe`, `which ldcli`, `which aws`, `which gcloud`, etc.
2. **Credential check** — if a tool exists, are creds present? Use `{tool} auth status` (or equivalent: `gh auth status`, `vercel whoami`, `fly auth whoami`, expected env var, config file at the documented path).
3. **Triage:**
   - **Auto-executable** (tool + creds present) — execute now via Bash. In `auto` mode, log command, exit code, and one-line outcome to `decisions.md`. In interactive mode, surface the command and result inline. Do NOT seed the ledger. **`ops=confirm` token:** when present in `$ARGUMENTS`, do not execute automatically even here — call `AskUserQuestion` with the exact command and a one-line description of its effect, options "Run it (Recommended)" and "Skip — seed to ledger instead," before running (or, if skipped, seed as `ops` with `(reason-not-auto: user-declined)`). This applies in both interactive and `auto` mode — `ops=confirm` is a stronger, explicit opt-in for operational/secret-mutating commands specifically, so it is not silenced by `auto`.
   - **Auth-gap** (tool present, creds missing) — in interactive mode, surface the one-time `{tool} login` command and wait; on success, fall through to auto-execute. In `auto` mode, seed as `ops` with `(reason-not-auto: auth-not-configured)` so the user can resolve at the wrap-up Review Console.
   - **Truly manual** (no CLI, requires human judgment, requires signoff) — seed as `ops` with the matching `(reason-not-auto: …)` qualifier from `_shared/ledger-format.md`'s Required-for-ops section.

If the ledger doesn't exist, create it using the ledger skill's create operation.

**Anti-pattern:** Seeding the entire Manual Steps section verbatim into `ops` without probing. The spec writer cannot know which CLIs are installed on the executing machine — that classification must happen here, at execution time, where probes can actually run.
