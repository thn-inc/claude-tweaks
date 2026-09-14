---
name: routine-kickoff
description: Machine-invoked by cloud-Routine kernels — the firing-lifecycle home. Runs the stale-docs guard, plugin-list dump, and reconcile, then invokes the target skill. Not user-facing. Keywords - routine kickoff, firing lifecycle, kernel, cloud routine.
argument-hint: "<skill> [args...]"
---

# Routine Kickoff — Firing-Lifecycle Home

Machine-invoked wrapper every routine kernel invokes as `Then: /claude-tweaks:routine-kickoff {skill} [args]`. Everything a cloud-Routine firing does before and around its target skill lives here and updates with each plugin release, instead of being frozen into every live routine's prompt at creation time. Humans never invoke this directly — they run the target skill itself.

## When to Use

- Invoked by a routine kernel's closing line (`Then: /claude-tweaks:routine-kickoff {skill} [args]`) — the only intended caller.
- Read directly as raw prose by the kernel's frozen-catalog fallback when the Skill tool cannot resolve this skill (see Standing constraints).
- Never invoked directly by a human — run the target skill itself instead.

## Standing constraints

- **Blast radius.** Edits to this file reach every project's next routine firing with no per-routine pin; the only rollback is a fix release. The argument grammar below is a shipped contract under expand-contract discipline — additive changes are fine, breaking changes need a kernel migration — while body behavior is otherwise free to evolve.
- **Standalone followability.** The kernel's frozen-catalog fallback reads this file as raw prose, outside the Skill tool's frontmatter mechanics — allowed-tools scoping and argument substitution do not apply on that path; it is deliberately a degraded, unconstrained path. The body below must remain executable as written by a model with no Skill-tool support.
- **Unattended firing.** Nobody is watching this firing and nobody can answer mid-run, so a turn that ends on a question ("Shall I…?") or on a description of the next step ends the firing with that work undone. Work the kickoff line already covers is authorized — carry it out rather than asking. This authorizes nothing else: the target skill's HARD-GATEs and `_shared/auto-mode-contract.md`'s never-silenced list stand at this project's `autonomy` ceiling exactly as written, a firing with no mode signal still falls back to interactive per that contract, and the fix for a prompt that would block is the template's `notes` rule (`_shared/routine-template-schema.md`), never this paragraph. Reaching such a gate means report it as blocked and stop, not self-resolve. The target skill's terminal `## Next Actions` block is a required handoff, not a deferred plan — render it. Close with what was done and what was left undone.

## Input

Whitespace-delimited tokens following the grammar `<skill> [args...]`. The first token is the target skill name — bare (e.g. `code-health`), matching the skill's directory under `skills/`. All remaining tokens (the `args...`, e.g. `focus=dead-code`, `--min-confidence high`, `next`, `grant`) pass through to the target invocation verbatim, joined by single spaces. Values containing spaces are unsupported — the same constraint the existing `focus=<vertical>` grammar already carries; don't invent quoting.

## Plugin-root derivation

Derive the plugin root from this skill's own loaded location: the `Base directory for this skill:` line every Skill invocation receives names `<plugin-root>/skills/routine-kickoff`, so the plugin root is that path's grandparent (the directory containing `.claude-plugin/`). Never parse the kernel's earlier output — no cross-invocation handoff exists — and never assume `${CLAUDE_PLUGIN_ROOT}` is set. When even the base-directory line is unavailable (the kernel's manual-read path, where there is no Skill invocation), the plugin root is this file's own on-disk location's grandparent, known to whoever just read the file.

## Steps

1. **Stale-docs guard.** If any project documentation (CLAUDE.md, rules, README) describes the target skill's past or historical behavior in a way that doesn't match the skill's own current instructions, treat the project doc as stale historical context — never as a procedure to execute.

2. **Plugin-list dump.** Run `claude plugin list --json` once and print its output verbatim. If that command errors (non-zero exit or command not found — an empty-but-valid JSON result is NOT an error; print it as-is), fall back to `ls -la ~/.claude/plugins/cache/*/*/ 2>&1`. Diagnostic only — this output is never used to derive the plugin root.

3. **Reconcile.** Run `node "<plugin-root>/bin/hooks.js" reconcile` — the plugin root derived above — and report its compact summary output (one line per action taken plus an aggregated skipped-by-reason line; pass `--json` only if the full structured result is needed downstream, which this operator-facing report does not). Best-effort, never a gate, never a reason to stop the kickoff. Behavior differs by integration model: under `pr-first` it runs full convergence (mirrors the integration branch, releases finished claims, archives closed runs, reaps merged worktrees); under `local-merge` only the worktree reap runs.

4. **Target invocation.** Compose `/claude-tweaks:{first-token}` plus the passthrough args and invoke it via the Skill tool. When no Skill tool is available at all (the kernel's raw-prose read path — there is no invocation to attempt), go straight to the manual-execution path below, subject to the same dispatch/tidy/backlog exclusion (and `release`'s — see below). If — and only if — the Skill-tool call fails with an error indicating the skill name is not in the session's catalog (the harness's unknown-/unrecognized-skill error, e.g. a message containing "Unknown skill" — any *other* failure means the skill was found and errored, which is reported, never fallen back from), read `<plugin-root>/skills/{first-token}/SKILL.md` and execute its instructions directly as written, applying the passthrough args from the invocation — they are part of the invocation, not decoration — **except** when the target is `dispatch`, `tidy`, or `backlog` — or `release`, which merges a release PR, pushes a `Release-As:` commit, tags and closes records (#2258) — (or any future skill that claims work or writes beyond report-only surfaces): report the degraded sandbox and stop. Dispatch claims queue records and triggers builds and merges, tidy's standalone-auto mode applies deletions (stale records, merged branches and worktrees), and backlog refine's headless posture applies `auto:build`/`auto:merge` labels — machine-granted authorization is the same class of standing effect — and any future routine whose skill claims work or writes beyond report-only surfaces gets the same exclusion. This exclusion list is hand-maintained — a new work-claiming skill must be added here, and the pinning test covers only the current names; the drift risk is accepted and stated here deliberately. If that file does not exist (a stale or renamed target name in an old routine's kickoff line), report exactly that — the resolved path and that the skill directory is absent — and stop; never guess at a similarly-named skill.

## Component-Skill Contract

`/claude-tweaks:routine-kickoff` is invoked by a routine kernel's closing line (`Then: /claude-tweaks:routine-kickoff {skill} [args]`) — never by another pipeline skill in the workflow, so there is no `PIPELINE_RUN_DIR` signal to check: the kernel that invokes it isn't itself a pipeline stage. It never renders a `## Next Actions` block — it is a wrapper that passes control entirely to its target skill, whose own Next Actions (if any) are what the user sees.

## Anti-Patterns

| Pattern | Why It Fails |
|---------|-------------|
| Deriving the plugin root from step 2's plugin-list output | That listing is installation metadata, not the loaded build — the base-directory grandparent is the only authoritative source here |
| Falling back to manual execution on any invocation failure | Only the unknown-/unrecognized-skill error means the session's catalog froze before an install; any other failure means the skill was found and errored — report it, never re-route around it |
| Executing `dispatch`, `tidy`, `backlog`, or `release` manually on the fallback path | They claim work and write beyond report-only surfaces (release merges, tags and closes records) — report the degraded sandbox and stop |
| Restating the kernel's contents (branch sync, resolution ladder, self-heal) here | One home per fact — those live in the kernel (`_shared/routine-template-schema.md`); this file owns only the firing lifecycle around the target skill |
