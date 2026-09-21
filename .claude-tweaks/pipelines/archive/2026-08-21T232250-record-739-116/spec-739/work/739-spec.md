---
record: 739
origin: human
risk: low
size: medium
ceremony: standard
grants: [build]
surface: backend
---
# 739: assess-agent-autonomy: per-record grant-check re-injects the 7 KB mode-agnostic SKILL.md router — 34 duplicate copies (~57K tokens) in one refine sweep

Surface: backend

## Current State

Every `Skill(claude-tweaks:assess-agent-autonomy, "grant-check #N")` invocation re-injects the full mode-agnostic `SKILL.md` router body (7.4 KB — When to Use / Input / Error Handling / Component-Skill Contract / Anti-Patterns) even though only `grant-check.md`'s own procedure is needed for that call. A 34-record `/backlog refine` sweep measured 37 skill-body injections totaling 291,993 chars in one session; 34 of them the identical `assess-agent-autonomy/SKILL.md` body = 236,402 chars, of which 229,449 chars (~57K tokens, ~60% of the session's total tool-result volume) are pure duplicates of content already loaded on the first invocation. The harness prefixed 11 re-invocations with "instructions were previously loaded" and shipped the full body anyway.

## Deliverables

- Reduce the per-invocation payload of a per-record `grant-check` (and, by the same router shape, `merge-check`/`failure-check`/`ceremony-check`) call so repeated invocations in the same session stop re-injecting the full router body, while preserving `refine-mode.md` Step 3's deliberate per-record invocation discipline (#708) — the invocation *count* is correct and must not change, only the per-invocation payload.
- Investigate whether the harness's "instructions were previously loaded" prefix can be relied on to actually suppress re-injection for a router-then-delegate skill shape, or whether `assess-agent-autonomy/SKILL.md` needs restructuring so the mode-agnostic router content isn't necessary context for a mode sub-file's own procedure.

## Acceptance Criteria

- A `/backlog refine` sweep over N records, measured the same way this record's own investigation measured it (total skill-body injection chars vs. session tool-result volume), shows the router body's per-session injected volume no longer scaling linearly with record count.
- `grant-check`/`merge-check`/`failure-check`/`ceremony-check`'s observable Gather/Judge/Render behavior and output contract are unchanged — this is a context-cost fix, not a behavior change.
- `npm test` green.

## Technical Approach

Two candidate directions, to be judged at build time against what the harness's re-injection behavior actually does:

1. Confirm empirically whether a harness-level "previously loaded" mechanism exists that this router-then-delegate shape could lean on more effectively (e.g., a different invocation pattern for the per-record loop), rather than assuming today's prefix-but-still-ship-full-body behavior is the ceiling.
2. If no such mechanism can be relied on, trim `assess-agent-autonomy/SKILL.md`'s own body so a mode invocation carries less mode-agnostic content by default — without breaking the skill's existing single-router-file structure or its other three modes' own citations of it.

### Key Files

- `plugin/skills/assess-agent-autonomy/SKILL.md`
- `plugin/skills/assess-agent-autonomy/grant-check.md`
- `plugin/skills/backlog/refine-mode.md` — Step 3's per-record invocation loop

## Gotchas

- Any fix must not weaken the per-record invocation discipline #708 protects — the goal is a smaller payload per call, never fewer calls.
- Should not blur the isolation between separate `grant-check` calls across different records in the same sweep — each call must still judge from that record's own fetched content only.

## Original request

assess-agent-autonomy: per-record grant-check re-injects the 7 KB mode-agnostic SKILL.md router — 34 duplicate copies (~57K tokens) in one refine sweep

**Summary:** Every `Skill(claude-tweaks:assess-agent-autonomy, "grant-check #N")` invocation re-injects the full SKILL.md router body (7.4 KB, mode-agnostic — When to Use / Input / Error Handling / Component-Skill Contract / Anti-Patterns), so a 34-record refine sweep paid ~57K tokens of byte-identical duplicate skill text while the actual procedure (`grant-check.md`) was read once.

**Kind:** Gap

**Affected component:** `skills/assess-agent-autonomy/SKILL.md`; `skills/backlog/refine-mode.md` Step 3's per-record invocation loop

**Objective:** Context overhead

**Measurement:** 37 skill-body injections totaling 291,993 chars in one session; 34 of them the identical `assess-agent-autonomy/SKILL.md` = 236,402 chars, of which 229,449 chars (~57K tokens) are pure duplicates — ~60% of the session's total tool-result volume (384,712 chars). The harness prefixed 11 re-invocations with "instructions were previously loaded" and shipped the full body anyway.

**Use case:** `refine`'s grant sub-stage (and `grant` mode's gate 4) invokes grant-check once per worklist record by contract — the per-record invocation discipline is deliberate (#708 protects it), so the per-invocation payload is what must shrink, not the invocation count.

**Definition:** Clear

**Plugin version:** 6.87.0

---
Filed via /claude-tweaks:feedback (session evaluation, self-referenced repo — routed to this project's own backlog).
<!-- fingerprint: feedback-84e6de83 -->

