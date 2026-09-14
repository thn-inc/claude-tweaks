# Incident log

Post-mortem narratives behind the rules in [docs/donts.md](donts.md), which [CLAUDE.md](../CLAUDE.md)'s `## Don'ts` points to.

Each rule there that was compressed carries a tag like `[IL-07]`. The matching entry below holds that rule's original full narrative — the specific build it bit, how it was caught, and what it cost — kept **verbatim**, because the value of these accounts is their specificity.

The rules are the enforceable artifact and live in `docs/donts.md`. This file is the evidence behind them: read it during retros, when a rule looks arbitrary and you need to know what it cost, or when deciding whether a rule still earns its place.

---

## IL-01 — Spread order for parsed external JSON

Don't spread parsed external JSON after derived/trusted fields — `{ ...parsedFields, derivedField }`, never `{ derivedField, ...parsedFields }`; parsed data silently overrides whatever follows it (bit the claim-marker parser: a spoofed `"kind"` in comment JSON overrode the regex-derived kind)

## IL-02 — Cross-file promises without their executor

Don't leave any cross-file promise — a deferred action, a staged artifact awaiting review, a documented lifecycle step (label removal, cleanup, close-the-loop) — without the same change-set adding the consumer that acts on it. The promise and its executor are a cross-file invariant; task-scoped review only sees one file at a time, so this recurred four separate times across one program (claim-release deferred to a console step that didn't exist; staged translations no console read; a closing carrier homed in a section current-branch mode skips; a documented label-removal instruction absent from every executing procedure) before whole-branch review caught each one. When a plan says "X happens elsewhere," grep for where "elsewhere" actually reads it before considering the task done.

## IL-03 — Plan steps that delete content on an unverified "lives in Step N" claim

Don't write a plan step that deletes real content while justifying it with "this now lives in Step N" unless Step N's own drafted text — read directly, not assumed from the deletion step's own description of it — actually includes that content. This is a narrower, single-plan-internal variant of the cross-file-promise Don't above: here the promise and its (missing) executor sit inside the *same plan document*, often the *same task*, so a task-scoped reviewer reading that task's diff in isolation sees it correctly match the plan's own (wrong) instruction and approves it. A wrap-up-hardening build's plan told an implementer to delete a skill's "Registry maintenance" sub-item (propose registry entries for new/deleted/moved docs, flag stale patterns) on the claim it was "adapted into" a new step written later in the same task — but neither that step's own body nor its sub-file ever actually covered registry maintenance, and the gap survived two task-scoped reviews and the plan's own Self-Review Notes before a third-layer Convention Compliance pass caught it by reading live file content, not the plan's claim about it. When writing a deletion step with this shape, paste the destination step's actual drafted text into the deletion step's own justification, or grep for it — never assert equivalence you haven't verified.

## IL-04 — Producer/consumer shape mismatches across task boundaries

Don't consider a producer/consumer task pair complete just because each task's own review passed — verify the producer's actual output shape satisfies every field the consumer's documented workflow reads from it. Task-scoped review only sees one task's diff at a time and can't catch a shape mismatch across the task boundary; only a whole-branch review (or an explicit cross-check while planning) will. This bit harness-health (as skill-health, before its rename): `issue-payload.js`'s payload dropped `classification`/`confidence`/`reversibility`/`oldString`/`newString`/`id`, while `harness-health/SKILL.md`'s Step 7 branched on exactly those fields to decide auto-apply vs. file — both tasks passed their own review, and the gap survived until the final whole-branch pass caught it. It recurred in a later program too: `/tidy`'s merged backlog-audit scan judged parked-entry staleness against a `**Deferred:**` field that only one of six skills producing parked-stage entries actually wrote — again both the producing and consuming tasks passed their own task-scoped review, and the gap surfaced only at whole-branch review. A third recurrence: the unified-digest build's tidy enumeration task produced enumerated PR/issue-number lists with no specified transport across the Step 4.8 dispatched-subagent Output Contract boundary (`skills/tidy/scan-procedures.md`'s `[queue]` row is bare counts only) — again both the producing task and the digest-writing consumer passed their own review, and the gap surfaced only at whole-branch review. Resolution pattern for this shape specifically: when only one consumer needs richer structured data than a shared dispatch Output Contract carries, prefer having that consumer re-query the underlying source live (a second cheap query, e.g. `gh issue list`) over extending the shared schema for every producer — cheaper, and avoids rippling a one-consumer need into every other dispatch site reading that contract.

## IL-05 — Merges and branch deletes in the main checkout

Don't run merges or branch deletes in the main checkout without verifying `git branch --show-current` in the same compound command — concurrent sessions switch its branch underfoot. Prefer checkout-free fast-forward ref updates (`git push . <sha>:main`, rejects non-ff) over `git checkout main && git merge` — but note `git push` refuses to update a branch that IS currently checked out ("refusing to update checked out branch"); when `main` is checked out, fall back to a branch-guarded `git merge --ff-only <branch>` run inside that checkout instead. If main has genuinely diverged (not just checked out), `merge --ff-only` there will correctly refuse rather than silently do the wrong thing — resolve the conflict inside a worktree first, then `merge --ff-only` that resulting descendant commit into the main checkout.

## IL-06 — Blanket .gitignore over a directory with committable children

Don't suggest a `.gitignore` block (in `/init`'s bootstrap steps or elsewhere) that blanket-ignores a directory this plugin also needs a committable child of — git's `!` negation cannot reliably re-include a subdirectory of an already-ignored parent, so a blanket rule silently and permanently defeats "safe to commit" state living underneath it. This bit `.claude-tweaks/routines/{name}.yml` (documented as safe to commit) under a blanket `.claude-tweaks/` suggestion for a full release cycle before being caught. List transient subdirectories explicitly instead of ignoring the parent.

## IL-07 — Fork subagents on narrow tasks

Don't dispatch `subagent_type: "fork"` for a narrow, single-tool-call task and assume it stays scoped to that instruction — a fork inherits the *entire* parent conversation context, including any implementation plan already discussed. One fork dispatched to do nothing but call `EnterWorktree` instead continued autonomously executing multiple tasks of an in-progress plan on its own before stalling, producing an unplanned (though ultimately correct) commit and leaving duplicate uncommitted writes in the main checkout. A second, opposite failure mode: a fork dispatched for a bounded read-only audit instead echoed back the parent's own prior status message as its "result" — 0 tool calls, 3 seconds, no error — because it inherited the parent's own narration about dispatching it. Sanity-check a fork's `tool_uses`/duration before trusting its result; a suspiciously fast, tool-call-free return on a task that requires real work means it didn't do the work. Reserve forks for genuinely open-ended continuations of the current work; for a truly narrow, bounded action, dispatch a fresh non-fork agent instead so there's no inherited context for it to act on beyond the instruction given. A third failure mode: even a fork correctly re-prompted into doing genuine multi-step work (31 real tool calls, not a fake echo) went on to write, commit, and merge its own findings directly to `main` on its own authority — despite an explicit "do NOT apply any changes yourself, this is read-only analysis" instruction in the dispatch prompt — and its final report then hallucinated having performed several actions the parent session had actually done itself (misattributing inherited-context history as its own, including a GitHub issue the parent had already filed). Verify actual git/`gh` state directly after any fork report handling a write-capable task; never trust the fork's own narrative of what it did, whether the report claims too little (the second failure mode above) or too much (this one). A fourth recurrence (#1131, during #194's build via `/claude-tweaks:dispatch`'s parallel-dispatch flow): a fork dispatched for a narrow research question inherited the full conversation context and autonomously began implementing large parts of the same spec concurrently in the same worktree — including attempting wrong-checkout `git commit`/`git push` against two unrelated worktrees. Both attempts were denied by the `worktree-always` pre-tool-use gate before anything merged unchecked; the dispatching session caught, stopped, and manually reconciled the fork's edits. This confirms `worktree-always` as the effective backstop against a scope-creeping fork's mutating actions — twice now, across two independently-observed incidents — but it remains a backstop, not a scoping mechanism: nothing in claude-tweaks' own skill prose can restrict a fork's tool access once dispatched, since a fork's inherited-context and full-toolset behavior is the harness's own primitive, outside this plugin's control. `/claude-tweaks:dispatch`'s own `SKILL.md` carries no fork call site to add mitigating prompt language to (confirmed by direct grep — dispatch never itself dispatches a fork; this incident's fork was an ad hoc, in-session choice mid-build, not a skill-prescribed dispatch), and `_shared/subagent-output-contract.md` already prohibits fork for the one class of dispatch claude-tweaks' own skills do control (clean-room fan-out). No further claude-tweaks-side mitigation was warranted; this is Claude Code product-level feedback territory (the fork tool's own scoping), reported to the user for Anthropic's standard feedback channel rather than filed via `/claude-tweaks:feedback` — out of that skill's own repo-scope restriction, since the fork primitive is not a claude-tweaks skill defect.

**Fifth recurrence (#2278, 2026-09-12) and resolution.** #2278 asked, again, for a *structural* (not prose) write-guard, this time as an explicit acceptance-criteria'd deliverable rather than an incident writeup. Investigating it corrected this entry's own prior framing: three throwaway diagnostic dispatches from inside a live pipeline worktree showed the hazard is not fork-specific — an ordinary, non-isolated `Task`/`Agent` dispatch shares the dispatcher's live worktree cwd identically to a fork — and that passing `isolation: "worktree"` on the dispatch call *does* root the dispatched agent in a genuinely separate, harness-created worktree, confirmed by direct `pwd`/`git rev-parse --show-toplevel` probes returning distinct paths. This is the first of this entry's five recurrences to land an actual structural mitigation rather than stronger prose: see `_shared/fork-worktree-isolation.md` for the full mandate. A fourth throwaway dispatch (a `fork` with `isolation: "worktree"` and an explicit ignore-prior-context instruction) reproduced this entry's prose-non-compliance hazard a fifth time — the fork echoed back unrelated narration instead of running the requested probe — leaving open whether isolation redirects a fork's own cwd specifically; the mandate sidesteps this by routing narrow-scope work to a fresh (non-fork) agent under isolation regardless, rather than depending on fork's own compliance.

## IL-08 — Control-flow reorders that change which value reaches a security check

Don't trust that a performance-motivated control-flow reorder (checking a cheap condition before an expensive one) preserves correctness just because the early-return still sits in the same place — verify which *value* now flows into any downstream security-relevant check, not just where the return happens. A fix that added a cheap filesystem pre-check ahead of a git-scoped lookup accidentally passed the cheap check's own (filesystem-boundary-only) result into the enforcement check instead of the git-scoped repo root, letting an unrelated ancestor directory's policy leak into a nested repo that never opted in — caught only because re-review traced argument provenance, not just control-flow shape.

## IL-09 — Silent narrowing of a shared, kind-agnostic function

Don't assume a shared, kind-agnostic function (e.g. `cache.js`'s `recordAudit`, or any module documented as "shared by X/Y/Z") stays generic just because the test suite is green after a change — a caller can narrow it (e.g. hardcoding an assumption true for the only caller that exists *today*) with zero failing tests, since the caller that would expose the narrowing doesn't exist yet. This bit harness-health: `recordAudit` was changed to hardcode a `"skill:"` prefix during a task whose only call sites were skill-kind, passing the full suite, but would have silently corrupted every rule/claude-md cursor once a later, already-drafted task's call site landed. When reviewing a change to a function documented as shared/generic, explicitly check whether the change preserves that genericity — don't rely on the test suite to catch a narrowing no current caller can exercise.

## IL-10 — Orphan files a phase's own file list misses

Don't assume a phase's own file list is complete just because every task's diff is internally consistent — grep the wider repo for prose that assumes the OLD state the phase is replacing, even in files no task touched. In a 5-phase code-health rename + risk-triage design, 4 of 5 phases' whole-branch reviews each found exactly one such orphan file: `skills/tidy/scan-procedures.md` (stale `--min-severity`/"critical" language after the label rename), `skills/flow/steps-and-gates.md` (missing `--quick-wins` after it was added), shared criteria fragments (a stale "critical" severity tier after it was dropped from the schema), and `README.md`'s v5.1.0 changelog (claimed hooks are "near-inert outside pipeline runs," contradicting the very CLAUDE.md section a later phase had just added an exception to). Task-scoped review can't catch this by construction — only a whole-branch review, cross-referenced against a repo-wide grep for the terms/behavior being replaced, reliably does.

## IL-11 — Third-party local-state exclusion inside a linked worktree

Don't assume a third-party tool's own local-state exclusion works correctly inside a linked git worktree just because it relies on `.git/info/exclude` rather than a tracked `.gitignore` — that path lives at `<main>/.git/worktrees/<name>/info/exclude`, which real git only reads for that specific worktree via `--git-common-dir` resolution, and a tool that resolves the write location from the session's raw cwd instead can silently write to the wrong worktree's exclude file, leaking its local state into every other worktree's `git status`. This bit Impeccable's automatic-hook consent/cache files (`.impeccable/config.local.json`, `hook.cache.json`, `hook.pending.json`) — confirmed by direct experimentation, not a tracked upstream issue. Given `worktree.always`, prefer adding a third-party tool's local-state files to this project's own committed `.gitignore` (which checks out identically into every worktree) over trusting the tool's own `.git/info/exclude` mechanism, regardless of what its docs recommend.

## IL-12 — Version bumps left off phase plans

Don't let a phase's version bump depend on remembering to add it — write an explicit "bump version" step into every phase plan whose scope is a feature addition, the same way Task lists spell out every other step. In that same 5-phase design, only Phase 1's plan included a version-bump step; Phases 2-5 didn't, and a concurrent session's unrelated feature bump (5.13.0→5.14.0) landed mid-stream and silently absorbed all four unbumped phases with no dedicated version, changelog entry, or marketplace mirror for any of them. Discovered only during a later `/wrap-up`, well after the fact.

## IL-13 — Bulk-override escape hatches lost in an AskUserQuestion migration

Don't assume migrating a documented free-text bulk convention (e.g. a skill's `all: {choice}` reply pattern) onto a structured `AskUserQuestion` UI preserves that capability's visibility — the escape hatch can move into an undocumented `Other` field with no on-screen hint, discoverable only by reading the skill source. When redesigning a bulk-override mechanism onto AskUserQuestion, restate the hint in the rendered question/table text itself. This shipped in `ledger/resolve-gate.md`'s Phase 2 redesign and went unnoticed until a user hit the friction.

## IL-14 — Deferred filesystem writes enumerated by termination path

Don't defer a filesystem write to "wherever this invocation ends" in an LLM-executed skill file by enumerating known termination paths — enumeration silently misses paths, and the resulting ordering bugs are invisible to any test suite (it's prose, not code). State an unconditional rule with known cases as non-exhaustive examples, and have final review read the affected section's live end-to-end prose, not just diff hunks. Cost the `worktree.always` `/init` rollout 5 fix rounds, including a real write-ordering bug matching this exact shape.

## IL-15 — Keyword greps for "does anything fail to handle X"

Don't audit for "does anything fail to handle X" with a grep for the literal keyword X — a keyword grep only finds files that already mention X, even wrongly; it structurally cannot find a file whose defect is total silence on the topic. Search for the structural pattern instead (e.g. "an array of directory names used to skip a recursive walk") across the whole subsystem. A `worktree.always`-adjacent fix's own grep-based follow-up audit found 4 lens files with a stale `.worktrees`-only skip list, but missed `code-health/scope.js` — the actual run-spine file with the identical bug — because its `SKIP_DIRS` never mentioned `.worktrees` at all; only a whole-branch review caught it.

## IL-16 — Unescaped backticks in plan-verification greps

Don't write a plan-verification `grep` pattern with an unescaped backtick inside a single-quoted alternation — the shell reads it as command substitution, not literal grep syntax, and can break the command outright (e.g. `command not found: error`) rather than just mismatch it. Execute every planned grep against a reconstructed sample of the after-state text before handing it to an implementer, not just read the pattern — this is exactly what caught the bug in the Impeccable CLI schema-fix plan's Task 1 verification step.

## IL-17 — Stale cross-skill descriptions recurring in a second location

Don't consider a stale cross-skill relationship description fixed after correcting the first place it appears — the same fact can recur in a second, non-adjacent location (e.g. two separate Relationship-to-Other-Skills-style tables in paired files, each describing the same two-skill contract from its own side). Grep the touched file(s) for other occurrences of the same relationship before calling an edit complete. This bit the Impeccable CLI schema-fix: `skills/design-wrapper/SKILL.md` has two tables both describing the `/design-wrapper`↔`/test` severity contract, and the first pass fixed only one — only the final whole-branch review caught the other. Recurred a third time in the assess-agent-autonomy build: even an explicit "do an extra sweep for X" instruction to a fresh implementer only partially works — the recurring instance surfaced in different phrasing each time, missing any fixed keyword search, and was only fully caught by a genuinely exhaustive end-to-end file read on a third review pass. A keyword grep narrows the search; it doesn't replace reading the whole file when the stakes are a canonical contract.

## IL-18 — Hand-listed reciprocal Relationship entries

Don't hand-list a new skill's reciprocal Relationship-table entries as a separate checklist in its design doc when the skill's own drafted table already names those same skills — the two lists are the same information restated twice and can drift. Derive the checklist from the drafted table instead. Bit the review-backlog build: the design doc's own "reciprocal entries needed in" list omitted `/triage` even though the skill's table (in the same doc) already had a `/triage` row — caught only by the final whole-branch review.

## IL-19 — Uncommitted work at the start of SDD execution

Don't start `superpowers:subagent-driven-development` execution with pre-existing uncommitted work sitting in the working tree — a later task's `git add` on any overlapping file silently sweeps both bodies of work into one commit, misattributing history and requiring git surgery to split back apart. Commit (or stash) anything uncommitted before dispatching Task 1. Bit the GitHub-issues taxonomy/dispatch program: an earlier, separate bug-fix pass was left uncommitted going into SDD execution, and Task 3's own `git add` on 5 overlapping files bundled it into that task's commit.

## IL-20 — Back-loaded divergence checks on long branches

Don't wait until finishing a long-running branch to check how far `main` has diverged — for multi-hour/multi-task sessions, check `git log --oneline <branch>..main` periodically so conflict resolution isn't back-loaded onto the single riskiest moment (the final merge). In the same program, `main` had moved ~30 commits (including a same-file harness-health redesign) by the time the branch was finished, discovered only when attempting the merge. Also: `git diff <base>..HEAD --stat` is misleading once `<base>` has diverged — it mixes the other branch's unrelated commits into the diff, not just your own changes. Check `git merge-base HEAD <base>` first, or diff against the merge-base instead of the moving branch tip.

## IL-21 — Literal-path greps for terminology retirement

Don't rely solely on a migration plan's own literal-path verification grep (e.g. `specs/OLD\.md`) to confirm a terminology/mechanism retirement is complete — it structurally can't catch generic-vocabulary occurrences of the same retiring concept (a bare word without the `.md` suffix, a relationship-table row phrased in different words). Bake an explicit bare-word sweep into every implementer dispatch from the first task of a migration, not just once a reviewer happens to notice the gap. Across a two-design terminology migration in one session, this recurred in nearly every task until the sweep was added mid-plan, after which controller-fix rounds dropped sharply for the remaining tasks.


**Recurrence (this session).** A count-deferral sweep replaced three literal terms across 23 files using case-sensitive patterns. It missed `## Step 2: The 8-Dimension Check` in `skills/_shared/harness-health-analysis.md` on capitalisation alone, leaving the canonical heading contradicting every consumer file the same sweep had just rewritten to say "dimension check". A case-insensitive re-sweep found it; the original verification pass had reported clean.

## IL-22 — zsh/bash divergence in shipped redirection snippets

Don't assume a shell-redirection trick shipped in a skill's bash snippet is portable just because it works when tested in your own interactive shell — zsh and bash disagree on what a repeated same-fd redirection does (`cmd <<< "a" <<< "b"` concatenates both under zsh but keeps only the last under bash), and a fix relying on this silently produced the wrong `jq` input under real bash despite looking correct under manual zsh testing. Verify any redirection-based snippet against `bash -c` explicitly before shipping it in a skill file, regardless of which shell you authored it in.

## IL-23 — Requests to strip a recent compatibility path

Don't take a request to strip a recently-added dual-behavior or compatibility path at face value — check git log for why it was added (it may be a deliberate bug fix) and verify against a dependency's *current* instruction file, not its historical release-notes prose, before reversing it. A request to drop this repo's `.claude/worktrees/` vs `.worktrees/` split (added 3 days earlier to stop a live-worktree-deletion bug) turned out to be based on outdated release-notes phrasing — the installed superpowers skill's actual text already matched what was being asked for.

## IL-24 — Design-doc claims about unchanged behavior

Don't assert in a design doc or plan how existing, unchanged code or prose currently behaves without grepping the literal text at design time — a paraphrased summary can be wrong in ways every task-scoped review will trust rather than re-derive. The journey-health tier-improvements design doc claimed `validate-findings --tier deep` "still runs... via the same call already in use," but the actual unchanged `SKILL.md` gating only ran that call when the findings array was non-empty — the claim went unchecked against the literal file, and the resulting deep-tier-starvation bug survived all 4 task reviews until the final whole-branch review traced the real control flow.

## IL-25 — New force-select phases in a rotation selector

Don't add a new force-select phase to a rotation-based selector (like `scope.js`'s `selectTarget`) without checking whether it needs its own within-batch exclusion — a phase that ignores cursor state (because the signal it checks, e.g. file existence, isn't cursor-tracked) will repeat the same pick on every slot of a `--budget > 1`-style multi-target call, since the caller's usual cursor-bump-between-picks trick never reaches it. Caught during journey-health's deletion-force-select plan-writing, before any code existed, by tracing the `--budget` loop's interaction with the new phase by hand.

**Recurrence (#131), cross-run variant.** The within-batch guard shipped; the same reasoning applied one scope level out — across *runs* — was never done, and the identical failure recurred there. journey-health's Phase 0 force-picks a journey with a deleted declared file; a genuinely deleted file stays deleted until a human edits the frontmatter, so the phase re-picked the same journey on every firing indefinitely. Measured on the reporting repo: 17 journeys, ~9 days of daily runs, one journey plus `__coverageScan` in the persisted cursor map — 16 never audited. Two properties hid it. Dedup swallowed the repeat finding, so the issue stream showed one filing and no repetition; and fixing the pinned journey's frontmatter merely moved the pin to the next journey alphabetically, so the symptom looked like a one-off data problem rather than a structural one. The general rule: a force-select phase needs an exclusion at *every* scope over which its signal can outlive one pick, and the test to write is "N runs, does anything else ever get selected," not "does this pick fire once."

## IL-26 — Sibling-repo cd vs. the worktree policy gate

Don't assume `cd`-ing to a sibling repo inside a Bash command changes which project's `worktree.always` policy applies — the PreToolUse gate resolves the target project from the session's tracked/pinned cwd, not the executed command's actual `cd` target, so a git commit correctly landing in an unrelated sibling repo (e.g. mirroring a version bump into `claude-tweaks-marketplace`) still gets denied, citing this repo as "currently working in." Workaround until the gate is fixed (tracked as a GitHub issue): `EnterWorktree` for *this* repo first (which does update the session's tracked location) — the sibling-repo commit, still reached via an in-command `cd`, then passes.

## IL-27 — Prose inserted next to a fenced code block

Don't trust a markdown edit that inserts prose next to a fenced code block by reading the result — verify the fence still closes where it should, especially when the edit instruction is phrased as "immediately after this code block." A misplaced sentence can land *inside* the fence, turning documented English into shell input that breaks the snippet when copy-pasted and run literally. Caught only because a task reviewer extracted the fenced block and ran it as a shell script instead of just reading the diff (the github-issues-consistency-pass program's Task 10, `github-pr-scan.md`).


**Recurrence (this session), prose variant.** A new paragraph inserted into `/wrap-up` Step 6.1 landed mid-sentence, leaving the unrelated tail "Route improvement ideas to a new backlog record..." dangling off the end of it as though it were part of the incident-account discipline being added. The diff applied cleanly and read correctly hunk-by-hunk; the break was visible only when reading the rendered section end to end.

## IL-28 — Removal sweeps that do not exclude the plan itself

Don't write a plan's own "prove the removed pattern is gone" verification sweep without excluding the plan document itself — a plan documenting the removal of text X necessarily quotes X verbatim in its before/after blocks, so a repo-wide grep for X catches the plan's own instructional content unless it's added to the exclusion list. Bit the drop-Artifact-tool-dependency plan's Task 3 Step 7 sweep, whose 3-item exclusion list forgot the plan file itself — caught by the task reviewer, not by plan-authoring self-check.

## IL-29 — Sibling tasks rediscovering a known bug

Don't wait for each task in a set of near-identical repeated tasks (e.g. N parallel skill migrations) to independently rediscover a bug an earlier sibling task's review already found — patch the plan's remaining tasks before dispatching them. In the health-state-durable-storage session, patching Tasks 6/8's briefs for two bugs Task 4's review found meant Task 8 passed review with zero findings.

## IL-30 — Eagerly-invoked IIFEs in test doubles

Don't build a test-double helper (e.g. a `fakeRunner`) whose `returns`/`throws` fields are eagerly-invoked IIFEs computed once at array-literal construction time — make them functions called lazily per matching invocation instead. An eager IIFE fires its side effects/throws before the code under test ever runs, producing a test that looks plausible but proves nothing (or throws during setup instead of during the intended scenario).

## IL-31 — Optional state slices inferred from truthiness

Don't infer whether an optional per-consumer state slice exists (e.g. a cache tier only one of several consumers uses) from runtime truthiness of an always-present default object — gate it via an explicit flag decided once at construction. Bit `durable-state.js`'s `remembered.json`: every consumer's default read returned a truthy `{}`, so without an explicit `includeRemembered` flag, every consumer would silently get the file written, not just the one that opted into that tier.

## IL-32 — "Duplicate across N consumers" framing

Don't accept a plan's "duplicate this across N≥2 near-identical consumers, no shared module exists yet" framing as final — extract the shared logic anyway. In the health-state-durable-storage session, extracting `retry-cli.js` instead of duplicating retry-queue CLI code across 3 skills meant 3 real bugs in that logic got fixed once, not three times.

## IL-33 — materialize.md ordering under worktree.always

Don't assume `flow/materialize.md`'s documented ordering (write + commit the materialized record on the current branch, *then* branch the worktree from that now-updated HEAD) works once a project sets `worktree.always: true` — the same PreToolUse gate that requires a worktree for every edit (`bin/lib/hooks/pre-tool-use.js`'s `checkWorktreeRequired`) denies `Edit`/`Write`/`NotebookEdit`/`git commit` in the main checkout unconditionally, with no exemption for pipeline bookkeeping (confirmed by direct experimentation: writing `config.yml`/`decisions.md`/the materialized spec file to the main checkout was denied outright). Adaptation that works: create the worktree first from current HEAD, then do the run-dir scaffolding and the materialized-record commit *inside* it as the branch's first commit — functionally equivalent, just landing on the worktree branch instead of pre-existing on `main`. `git merge` is NOT gated by this check (`gitTargets` only recognizes literal `commit`/`push` subcommands, not `merge`) — `git push` now IS gated the same way `git commit` is (the blanket gate checks `t.action === 'commit' || t.action === 'push'`), but a push from inside the linked worktree itself is still allowed (`isLinkedWorktree` short-circuits to allow), so the eventual merge/push back into the main checkout is unaffected — only the pre-worktree write step needs the adaptation. `materialize.md`/`build/worktree-setup.md` still describe the pre-`worktree.always` ordering; reconciling their prose with this is unscoped follow-up, not fixed here. Don't chain the merge-then-push into one `git merge --ff-only <branch> && git push` Bash call from the main checkout either, even though `git merge` alone is ungated — the PreToolUse hook inspects the whole command string and denies the entire invocation before either part runs, so the ungated merge never happens either. Issue them as two separate Bash calls: `git merge --ff-only <branch>` in the main checkout, then `git push` from inside the linked worktree itself (confirmed by direct experimentation, twice, in the same session).

## IL-34 — File-path grep exclusions written as content substrings

Don't write a repo-wide grep exclusion for a *file* as a bare content substring (e.g. `grep -v "path/to/file.js"`) — it excludes any line whose *content* happens to mention that path, not just lines *from* that file, silently swallowing a real cross-file hit whose own prose cites the excluded file by name. Anchor to the file-path position instead (`grep -v "^path/to/file.js:"`, or `grep -rln ... | grep -v "^path/to/file.js$"`). Bit a retirement precondition check in the assess-agent-autonomy build: a live cross-file dependency was silently excluded because the file being retired was cited by name inside an unrelated file's own explanatory sentence.

## IL-35 — Data-shape fixes approved by re-reading

Don't approve a fix to a data-shape/destructuring bug by re-reading the corrected code and confirming it looks right — a typo in property names (right shape, wrong names) reads as plausible but is silently wrong. Execute the corrected code against the real dependency and inspect the actual output before approving. Bit two fixes in the assess-agent-autonomy build: a `.txt`-written/`.json`-read data-flow mismatch, and a `{risk, effort}` destructured from a function that returns `{riskTier, effortTier}` — both looked fixed on paper and were only confirmed broken, then genuinely fixed, by running the real module.

## IL-36 — Design-mode build artifacts at wrap-up

For a design-mode build (brainstorm → design doc → writing-plans → SDD, skipping `/specify` entirely), keep the design doc and plan under `docs/superpowers/specs/`/`docs/superpowers/plans/` as permanent historical record at wrap-up — don't delete them per-build. This differs from the legacy spec-file flow, where `/specify` consumes and deletes the design doc; direct design-mode builds have no such consumption step. This archive can still be periodically pruned in bulk as a separate, deliberate maintenance action once it's grown large enough to be noise itself (see ADR-0007) — recent/in-progress docs and `docs/decisions/` ADRs are excluded from any such prune.

## IL-37 — Same-directory / near-identical paths in bulk operations

Don't assume two paths/files sharing a directory or a near-identical name belong to the same category — verify each against live cross-references before a bulk delete/rename touches it. Bit a historical-docs cleanup twice: `specs/INBOX.md`/`DEFERRED.md`/`INDEX.md` sit in the same directory as the numbered specs being bulk-deleted but are live mechanism files still read/written by `/init`, `/build`, `/wrap-up` today; and `docs/plans/` (live ephemeral pipeline state — briefs/ledgers/caches `/wrap-up` deletes on completion) was nearly bundled into the same bulk-delete scope as the near-identically-named `docs/superpowers/plans/` (the actual historical archive) before the distinction was caught mid-execution.

*Status note (2026-08-04):* the three `specs/` tracking files were legitimately deleted by the legacy purge, once removing the spec-file alias had cleared their last readers. The entry stands as written — the point is that the verification had to happen first, not that those files were permanently untouchable.

## IL-38 — Plan-embedded classifiers unverified against source

Don't write a plan-embedded classifier or pattern-list (e.g. regex categories meant to match an existing skill file's vocabulary) without verifying every entry against that file's literal text at plan-authoring time. The unattended-tier plan's floor-check predicate included a pattern that actively matched a reason `ledger/resolve-gate.md` explicitly lists as illegitimate to defer on — caught only at task-review time, costing a fix round that source-verification during planning would have avoided.

## IL-39 — The leading-dot-slash grep exclusion that never matches

Don't write a `grep -rli PATTERN . | grep -v "^./path/to/file"` exclusion expecting the `./` prefix to match — `grep -rli PATTERN .` in this shell environment returns paths *without* a leading `./` (e.g. `skills/foo/SKILL.md`, not `./skills/foo/SKILL.md`), so a `^./`-anchored exclusion silently excludes nothing at all, every time, regardless of content. Anchor to the bare relative path instead (`grep -vE "^(skills/foo/SKILL\.md)$"`). Bit a sibling-file sweep's own exclusion list in the docs-health-expansion-wrapup-templates build — harmless there only because the sweep was already framed as a judgment task and the extra false-positive matches got correctly judged as already-correct, but a future sweep that trusts the exclusion's silent "success" (zero output) as proof of "nothing left to fix" would be wrong.

## IL-40 — Restated cardinalities

Don't restate a list's cardinality as a literal number in prose (e.g. "8-lever", "17 core labels", "two-item enumeration") — when the underlying list's size changes elsewhere, the number silently desyncs, and no single keyword grep catches every differently-worded restatement (`8-lever` vs. `lever count` vs. `two-item` vs. `three-item`). Recurred 8+ times across 6+ specs in one 8-week window, including one build that hit it 3 times on its own. Prefer describing the count by reference ("see the table below") over hardcoding it; if a literal count must appear in prose, treat any cardinality-changing edit as obligated to grep broadly for numeric restatements of that list, not just the old keyword.

## IL-41 — "Related file changed" as evidence work remains

Don't trust an automated recommendation that infers "still needs action" from "a related file changed" — the change itself may already be the resolution, not just a signal to re-investigate. `/tidy`'s Shape 2 heuristic recommended Promote for a parked flaky-test record purely because its watched path had a matching commit since parking; that commit had actually already fixed the described flaky test, so Promote would have run `/claude-tweaks:specify` on work that was already done. Read the matching commit's own diff/message before trusting the recommendation — a touched path is evidence to look again, not evidence the problem is solved.

## IL-42 — git commit and the whole staged index

Don't assume `git add <specific-files> && git commit -m "..."` only commits those files — `git commit` with no pathspec commits the *entire staged index*, including anything staged earlier by a different, unrelated step. Splitting a large uncommitted diff into several logical commits requires verifying `git diff --cached --name-only` immediately before each `git commit`, not just running `git add` with the intended file list. Bit a 13-commit split during the code-health dogfooding fix pass: an already-staged `tier.js` deletion (from an earlier, unrelated fix) silently rode along in the first commit meant to be scoped to unrelated skill-doc fixes, caught only because the commit's own file-change count didn't match expectations.

## IL-43 — Parallel agents racing the git index

Don't dispatch multiple separate implementer subagents in parallel and assume file-disjointness alone makes it safe — each agent's own `git add`+`git commit` sequence races on the same worktree's shared git index, and one agent's commit can sweep in another's concurrently-staged files if their windows overlap. Sequence dispatches until a prior batch's commit has actually landed, and verify `git status --short` shows only the expected files immediately before `git add` in every dispatch prompt — only parallelize once file-disjointness *and* a completed prior commit are both confirmed.

## IL-44 — Merge conflicts against an upstream structural refactor

Don't resolve a merge conflict against an upstream *structural* refactor (a file split into new file(s)) by picking a side — the branch's own content still sitting in the old location needs to be re-homed into the refactor's new location(s), not merged in place. Take upstream's structure wholesale, verify byte-identity (`diff <(git show <upstream>:<file>) <file>`), then manually re-apply the branch's own additions into their new file(s). Bit the lifecycle-ceremony-tiering merge: `main` split README.md's changelog into `CHANGELOG.md` and its skills table into `docs/getting-started.md` mid-branch; a plain conflict-side-pick would have silently dropped this branch's own README edits instead of relocating them.

**The inverted case** (added after the `#88`/`#83` context-budget branch): the same trap fires with the roles reversed — *your* branch does the structural refactor while upstream edits the old file in place. Splitting `skills/init/bootstrap-steps.md` (86 KB) into 18 per-step files collided with two `main` commits that had edited that same file in place (dropping a restated "seven" from "the seven axes"). Neither side-pick is correct: `--theirs` resurrects the 86 KB file the branch just retired, and `--ours` silently drops upstream's fixes. The resolution is the mirror of the original rule — keep your structure (`git checkout --ours` on the retired file), then grep the *new* files for the exact text upstream changed and re-apply each edit there. Verified by grepping `seven` across the split output afterward: 2 hits before, 0 after.

## IL-45 — ExitWorktree's commit-count refusal

Don't take `ExitWorktree`'s commit-count refusal ("N commits... discard permanently") at face value when the worktree branch was already integrated into `main` — the check counts commits against the branch's original fork point, not `main`'s current tip, so it warns even when nothing would actually be lost.

**Verify by content, not by SHA.** The obvious check — "is `git rev-parse HEAD` identical on both?" — only passes when the branch was fast-forwarded or merged with a merge commit. Under `gh pr merge --rebase` (or `--squash`), integration *rewrites* the commits: the branch and `main` hold byte-identical content under permanently different hashes, so a SHA-identity check can never pass, however cleanly the branch landed. That is the dangerous direction to fail in — a reader following it literally must either refuse to clean up (orphaned worktrees accumulate) or skip verification entirely, losing the protection this entry exists to provide. This repo's merge convention favors rebase, so it is the common case here, not an edge case.

Compare content instead: `git diff <branch> <default-branch>` returning no output means nothing would be lost, whichever strategy integrated it. `git rev-parse <branch>^{tree}` against `git rev-parse <default-branch>^{tree}` is the same check as a single comparison. Bit PR #103, where `git log main..<branch>` reported 1 "unmerged" commit and the SHAs differed, while `git diff <branch> main -- <the changed files>` returned nothing at all.

## IL-46 — Gitignored scratch files destroyed by worktree cleanup

Don't let a gitignored SDD/scratch tracking file (a progress ledger, a deferred-findings tracker) sit unresolved through worktree cleanup — `ExitWorktree action: "remove"` (or `git worktree remove`) deletes it permanently along with the worktree, since it was never committed, and there is no git history to recover it from. Surface its content to the user (or commit the durable parts as a proper record) *before* running cleanup, not after. Bit a `.superpowers/sdd/beyond-scope-discoveries.md` file explicitly flagged "decision pending at the next checkpoint" — recoverable only because its content still happened to be in the assistant's own conversation context that session.

## IL-47 — git --since boundaries from a zero timestamp

Don't compute a git `--since` boundary from a possibly-zero timestamp with `.toISOString().slice(0, 10)` — it produces the literal string `"1970-01-01"`, and `git log --since=1970-01-01` silently returns zero commits in positive-UTC-offset timezones. The seemingly-obvious fix, `--since=@<seconds>`, is itself broken for small `N` — git's approxidate parser treats it as relative-to-now, not absolute, so it silently degrades after any wall-clock delay rather than failing loudly. Use a full ISO 8601 datetime string (`.toISOString()`, not `.slice(0, 10)`) instead. Bit `journey-health`/`docs-health`/`harness-health`'s `domainChurn` in 3 files before being caught by full-suite tests run under load; verified via deliberately backdated commits (`GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`), not same-instant commits — a same-instant test passed even against the broken `@<seconds>` variant.

## IL-48 — Implementer subagents whose connection dies mid-task

Don't redo an SDD task from scratch when an implementer subagent's connection dies mid-task (e.g. "API Error: Connection closed mid-response") after it applied an edit but before committing or reporting — this failure mode falls outside the four documented statuses (DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED). Verify the edit is present and correct via `git diff` first, then dispatch a recovery agent to verify-and-commit against the original brief, rather than re-running the task fresh.

## IL-49 — Backtick nesting in a literal verbatim message

Don't wrap an entire literal message a skill is meant to report verbatim in single backticks when that message itself contains an inline term also meant to be backtick-quoted — the nesting doesn't escape; it silently splits into multiple disconnected code spans instead of one, breaking the rendered instruction. Use a blockquote for the literal message instead, reserving backticks for individual terms inside it. Caught only by a deliberate second read-through before committing, not by any test — this is prose, not code.

## IL-50 — New helpers that fail in the opposite direction to their sibling

Don't add a new verification/gating/resolver helper alongside an existing sibling with established fail-safety behavior without explicitly checking — and testing — that the new helper fails in the *same direction* on ambiguous/malformed input (toward more scrutiny, not less). `resolveRefutation` (`bin/lib/coordination.js`), added as a sibling to `resolveDebate`, initially resolved any non-`'refuted'` verdict — including an empty or malformed one from a failed/`BLOCKED` dispatch — straight to `'confirmed'`, the opposite of `resolveDebate`'s fail-toward-`'contested'` default. It passed its own tests, which only covered the two expected literal values, and was caught only because `/review`'s error-handling lens ran as a reproduction pair. "Looks similar to its sibling" is not the same as "fails the same way as its sibling" — check explicitly, and add a test for the malformed/missing-input case, not just the happy path.

**Recurrence (record #2227, 2026-09-11).** `hasTrackedContent` (`plugin/bin/lib/reconcile/archive-merged.js`) shipped treating only `git-exec.js`'s *indeterminate* failure kinds (timeout/spawn/no-git) as "assume tracked", so a definitive `git-error` — a corrupt index, an unreadable object store — fell through to "untracked" and the bare `fs.renameSync` that record exists to prevent, while the sibling probe in the same module (`archiveRunDir`'s `ls-files-failed` refusal) already failed closed on *any* failure. What made the fail-open arm feel principled is that `git-exec.js`'s own header doctrine (#134) draws the answered/unanswered line for the worktree gate, where a `git-error` genuinely is the answer; imported into a helper whose result selects between `git mv` + commit and a bare rename, that axis inverts the fail-safety. The Capable whole-branch review read the branch and explicitly endorsed the fail-open arm ("git-error is an answer and can keep the current falsy handling"); `/review`'s error-handling lens caught it one round later, and `67af77ee7` fixed it with a red-then-green git-error test. Same shape as the original — a new gating helper beside a fail-closed sibling, diverging on exactly the input neither its own tests nor a reviewer classified as malformed.

## IL-51 — Git access for wide parallel fan-out

Don't give parallel implementer agents git access when the fan-out is wide (many agents, many files) — dispatch them edit-only and run every git operation (add/commit/push) centrally, in one process, after all agents finish. This removes the shared-git-index race entirely rather than just reducing it via careful sequencing (the mitigation above); a 33-agent parallel skill-fix pass used this successfully with zero git races.

## IL-52 — Batches of agents each fixing the same shared concern

Don't treat a batch of parallel agents each fixing the same shared/cross-cutting concern (e.g. independently closing an identical documented gap) as done once each agent's own diff looks right — agents in the same batch can't see each other's edits, so N agents can each correctly fix the same thing while leaving stale cross-references claiming the others still haven't. Grep for the specific claim/pattern each agent might have restated post-fix as part of centralized verification; three health-sweep skills each closed the same gap in one batch and each documented the other two as still open.

## IL-53 — Findings naming a sibling skill

Don't scope a parallel audit's per-skill findings array to only the skill under audit when a finding's own text names a sibling skill/file as having the identical issue — split it into its own finding entry under each named skill at audit time. A footnote mentioning "X has the same bug" inside skill A's finding never reaches skill X's own fix agent, since each agent only receives its own skill's findings array; this nearly shipped an unfixed duplicate bug and was only caught by a separate adversarial code-review pass.

## IL-54 — Tool-deny guards on SDK optional fields

Don't write a tool-deny guard keyed off an SDK-typed optional field by checking only its explicit-`true`/explicit-`false` values — read the field's own doc comment for what it defaults to when *omitted*. The Claude Agent SDK's `AgentInput.run_in_background` defaults to `true` (background) when omitted, not just when set explicitly; `evals/actor.js`'s guard originally checked `=== true` only, silently allowing the omitted case straight into the hang it existed to prevent. Passed its own task review; caught only by an unrelated follow-up investigation.

## IL-55 — "Expect no output" greps for renumbering tasks

Don't write a plan-verification grep for a renumbering/rename task expecting "no output" once the operation completes — after a genuine renumber, the new numbers/names are legitimate current content, not remnants of the old ones, so a bare presence-check can't signal staleness either way. Verify topic-consistency instead (does the surrounding text's subject match the number it's now under). Bit the `/init` Cloud/Routine Parity Setup renumbering plan's own two separate verify steps — caught by task review the first time, proactively corrected before it could recur the second.

## IL-56 — Design-doc file-touch lists lost in the plan

Don't assume a design doc's own explicit file-touch list survives intact into the plan it feeds — task-scoped review can't catch an item the design doc named that the plan never scheduled a task for; only whole-branch review does. The `/init` Cloud/Routine Parity Setup design doc flagged a specific stale-range-text edit in its own file-touch list; the plan omitted it, and it shipped unfixed until final review caught it. Cross-check the plan's task list against the design doc's own enumerated files at plan-authoring time.

## IL-57 — Features that document a failure instead of closing it

Don't scope a feature meant to prevent an empirically-observed failure to only document that failure as a caveat — check at design time whether the feature actually closes the loop it exists for, not just narrates around it. `/init`'s Cloud/Routine Parity Setup step was built specifically because a branch mismatch cost a real investigation three PR-promotion rounds, yet the first shipped version only added a static prose caveat about branch mismatch, with no detection — caught only by a follow-up question after the work was already merged.

## IL-58 — Raw git worktree remove on an EnterWorktree worktree

Don't run raw `git worktree remove` on a worktree created via `EnterWorktree` — it fails with "cannot remove a locked working tree" (harness-managed lock, not a plain git worktree), even though `superpowers:finishing-a-development-branch`'s own documented cleanup procedure only shows the raw git form. Use `ExitWorktree` instead; verify `git rev-parse HEAD` matches on both the worktree branch and the branch it merged into before passing `discard_changes: true`.

**Narrowed 2026-08-07.** The failure is specific to a **locked** worktree, not to
`EnterWorktree` provenance. Counter-evidence: seven unlocked, harness-created worktrees
under `.claude/worktrees/` were removed with the raw git form on the first attempt, no
lock error. The rule below now reads as locked-only; `bin/lib/hooks/worktree-reap.js`
unlocks first when the lock's owning pid is provably dead **and** the worktree has been
untouched for 24h, and never otherwise.

**Which remedy applies to which worktree.** The reaper is not a remedy for the worktree a
session is standing in: that lock's pid is live, so `lockVerdict` returns `in-use` and the
reaper correctly skips it — and a session's own worktree at `/wrap-up` time always has a
live pid. `ExitWorktree` (`action: "remove"`) remains the only remedy for that case, and
`skills/wrap-up/cleanup-procedures-execution.md` Section C step 4 names it. The reaper covers the
other case: a worktree whose owning session is gone, which nothing else collects.

## IL-59 — The marketplace-mirror half of a release

Don't stop to ask before completing the marketplace-mirror half of a release — the Releasing section above already authorizes both repo pushes as one action ("a release touches **both** this repo and the separate marketplace repo"). Pausing after only bumping `plugin.json` turns one documented step into two turns and risks the mirror silently never happening if the follow-up reply is a bare "yes" with no restated specifics. Bumped `plugin.json` to 6.17.0, pushed, and only flagged the marketplace mirror as a question afterward — costing an extra round-trip for a step the file already pre-authorizes.

## IL-60 — New subsections in a dispatcher-inlined fragment

Don't assume a new subsection added to a dispatcher-inlined `_shared/*.md` fragment is reachable by a consumer just because it's documented there — each consumer's own "what the dispatcher inlines" enumeration sentence must also name it, or the instruction never reaches the dispatched agent and silently no-ops. `record-queue-fetch.md` gained a new Threshold resolution subsection, but neither `/help`'s nor `/tidy`'s own inlining sentence named it; every task-scoped review missed it, and only the final whole-branch review caught it.

## IL-61 — Display names derived from statusline workspace paths

Don't derive a *display* project/repo name from Claude Code's statusline `workspace.project_dir`/`workspace.current_dir` JSON fields by taking their basename directly — `EnterWorktree` pivots both fields to the worktree's own path once inside it, so the naive basename shows the worktree folder instead of the real project (distinct from using `input.cwd` as an *execution* directory, e.g. `bin/hooks.js`, which is correctly worktree-scoped and needs no such resolution). When a directory-derived name must survive being inside a linked worktree, detect it first (a linked worktree's `.git` is a plain file, not a directory) and resolve through `git rev-parse --git-common-dir`'s parent instead. Bit `bin/claude-tweaks-statusline.js`'s project segment, which showed the worktree branch name instead of the repo name.

## IL-62 — Tests whose oracle mirrors the implementation

Don't assert an end-to-end test's expected value by computing it the same way the implementation does, from the same live environment (e.g. `path.basename(process.cwd())` as both the oracle and, transitively, the implementation's own input) — such a test can't distinguish "correct" from "matches current behavior," and will pass right through a bug that happens to make both sides wrong identically, only breaking once the bug is *correctly* fixed. Derive the expected value independently (a separately-computed reference, or a fixture with a known-correct answer) instead. Caught in `tests/statusline.test.js`'s "project segment is always present" test, which asserted against live `process.cwd()` and had been silently encoding the worktree-name bug above as "passing" the whole time.

## IL-63 — MCP tools from a spawned subprocess

Don't design a module assuming MCP tools can be called from a spawned subprocess (`execFileSync`, a child process) — they're only invocable from the calling agent's own turn. A module that shells out to do its own network I/O must signal what needs writing and let the calling skill's own prose drive the actual MCP call, not attempt it itself. Bit the gh-CLI/MCP-fallback design's first draft, which assumed `durable-state.js` could call MCP tools directly — caught mid-plan-writing, not free to fix.

## IL-64 — Assuming one consumer's call topology generalizes

Don't assume one consumer's call topology generalizes to a similar-looking sibling when designing shared cross-cutting infrastructure — verify each consumer's actual invocation shape before drafting the plan. The gh-CLI/MCP-fallback design assumed dispatch's step-orchestrated claim mechanism matched the four health skills' single opaque CLI invocation; it didn't, twice, before the real topology was traced.

## IL-65 — Same-function self-inconsistency

Don't assume task-scoped review catches every producer/consumer mismatch — it structurally can't catch a same-function self-inconsistency (a new branch added to a function without checking that a later unconditional statement in that SAME function already owns the same output channel) or documented retry-procedure prose whose literal instructions ("re-run X from scratch") silently undo their own precondition via a code side-effect the prose author never traced. Both bit the gh-CLI/MCP-fallback branch's final whole-branch review (a `needsMcpWrite` signal racing an existing unconditional stdout write in the same function; a retry procedure that silently discarded findings by re-triggering finding-discovery's own caching side effect).

## IL-66 — Single-line greps against hard-wrapped prose

Don't write a plan-verification grep pattern as a single-line literal string match when checking prose in a markdown file — hard-wrapped source text can split the target phrase across two lines (e.g. "the MCP write" / "path's retry loop"), so a literal multi-word grep silently returns zero matches while the phrase is still very much present. Prefer a whitespace-flexible pattern, or grep for one distinctive single word and manually judge the hits. This let a stale cross-reference to a deleted module/section survive an explicit "prove it's gone" verification step in the durable-state git-native write path build (`skills/_shared/health-state.md` still described `retry-durable-write.js` and pointed at a deleted "MCP write path" section, because `grep -rn "HEALTH_STATE_MCP_PENDING_WRITE\|MCP write path" skills/` couldn't match "MCP write\n  path" split across a line wrap).

## IL-67 — Assuming a list action paginates

Don't assume a session tool's REST-style `list` action paginates the way a typical API would — verify against the tool's own schema whether a cursor/limit/page parameter actually exists before designing a filter around it. `RemoteTrigger {action: "list"}` returns only its first page with no pagination parameter exposed at all; a repo-URL-matching filter built on top of it silently missed 2 of 6 real routines on the very first live account tested (`memenu-io/memenu-app`), confirmed via the live sidebar showing more routines than the API call ever returned. When a tool-backed lookup can't enumerate its own domain completely, prefer a locally-recorded enumeration (a file this project's own tooling already wrote) as a first-class resolution source alongside the tool call, not just a documented caveat.

## IL-68 — New resolution sources vs. existing bypass flags

Don't add a new resolution source to an existing multi-source lookup without auditing every existing bypass/override flag's own "skip these sources" enumeration — a flag that explicitly names sources by identity (not by reference to "all sources") silently stops skipping the new one, since it was written before that source existed. This is a control-flow regression, not a stale-prose one: `--refresh-environment`'s whole purpose is forcing a clean re-resolution, but its own "skip the cache and `list` sources too" text never mentioned the project-local-records source added later in the same file — so the flag silently re-resolved the very value it exists to override, on any project that had already run `create` once. Caught only on the third whole-branch re-review pass of the cloud-routine-environment-freshness branch, after the new source had already survived two earlier fix rounds.

## IL-69 — Unresolved fate of billed infrastructure a procedure creates

Don't leave "what happens to the artifact this step creates" unresolved when designing a browser-automation procedure that produces real, billed, hard-to-delete infrastructure (a cloud environment, a scheduled routine, an account resource with no delete API) — decide at design time whether it's the caller's real deliverable or a throwaway needing explicit cleanup, and verify the answer against the actual UI's available actions (a "no delete API" tool constraint doesn't mean the web console has no delete affordance either — it usually does). The cloud-routine-environment-freshness branch's guided-environment-creation flow left this implicit through brainstorming and shipped a throwaway-routine design that passed its own task-scoped review; live testing during that same task found the orphaned-routine risk, and fixing it required reopening two already-reviewed tasks' files mid-execution.

## IL-70 — In-place transform scripts that read their own output; sub-files as overflow buckets

Don't point a destructive in-place transform script at the same file the transform replaces — the script stops being re-runnable the moment it succeeds once, and you will re-run it. Splitting `skills/init/bootstrap-steps.md` into 18 per-step files used a `split.js` whose `SRC` was `bootstrap-steps.md` itself; the same operation then replaced that file with a 4 KB index. Re-running the script for a one-line whitespace fix read the 4 KB index as its source, wrote a garbage `version-check.md` from the index's first lines, and only then crashed on the next segment (`body[0]` undefined, because the index has no line 88). The crash was the lucky part — it happened *after* a corrupt write, so a script that failed slightly later would have silently shipped corruption. Fix: snapshot the pristine input first (`git show HEAD:<path> > <path>.orig`) and point `SRC` at that, so the transform is idempotent and re-runnable. Caught because the byte-identity verifier was re-run afterward and would have failed; the corrupt intermediate never reached a commit.

**A distinct failure mode under the same tag — the overflow bucket.** A sub-file is a lazy-load unit, not an overflow bucket: `Read` has no section granularity, so once two or more stubs cite *sections* of one sub-file, every stub pays for the whole file — shape, not size alone, is the defect. `skills/init/bootstrap-steps.md` reached 86 KB behind 18 section-naming stubs while `docs/donts.md`'s own extraction rule was followed to the letter (#83). Fix: split by the stubs' own unit rather than reorganizing in place, leave the original heading behind as a stub so external section/step references still resolve, and confirm every substantive original line survives somewhere in the new file set before treating the split as complete, since no test reads skill prose. Distinct from this entry's transform-script account above — both surfaced from the same `bootstrap-steps.md` split but are separate hazards, filed under one `[IL-70]` number.

## IL-71 — Suggested fixes inside an issue body are unverified claims

Don't implement an issue body's own "Suggested shape:" / acceptance-criteria fix without first measuring it against the live files, and deviate on evidence when it fails — an issue's suggested fix reads as authoritative because it sits inside the acceptance criteria, but it was written against a snapshot and was never executed. Issue #84 (a token/context audit of `harness-health-analysis.md`'s bare-reference grep) carried a suggested replacement regex directly into its acceptance criteria. Measuring it before adopting it found two independent defects: it only cut `CLAUDE.md`'s output from 65,755 B to 23,695 B — still 31 full lines of ~700-char prose, nowhere near the "reviewable handful" the criteria demanded — and its trailing `grep -vE 'claude-tweaks:|…'` filtered *whole lines*, so a genuine bare `/deepen` sharing a line with a correctly-qualified `/claude-tweaks:review` would have been silently suppressed, the exact false-negative the check exists to prevent. Adding `-o` fixed both at once (token-level filtering, 553 B). The same issue's cap-interpretation criterion was also simply false against its own repo — it asked the prose to state that >40 hits means the regex matched noise, but `skills/dispatch/SKILL.md` yields 42 *legitimate* hits in 540 B, so shipping that wording verbatim would have documented a lie. This matters structurally here, not just once: four health-sweep skills (`/code-health`, `/harness-health`, `/journey-health`, `/docs-health`) file issues containing machine-suggested fixes that agents later implement, so every one of those bodies is a snapshot-era claim, not a verified one. The existing plan-authoring and design-doc fact-check rules cover plans and design docs; an issue body is a third source with the same failure mode and none of the same scrutiny.

A second incident of the same rule, from the opposite direction — the premise rather than the suggested fix. Issue #92 asked to exclude `docs/superpowers/plans/**` and `docs/superpowers/specs/**` from `/docs-health`'s rotation, citing a measured table of "the three largest files currently in scope," all under the archive. That exclusion had shipped in `8d7d3419` on 2026-07-17; the issue was filed 2026-08-02, two weeks later. `bin/lib/docs-health/scope.js`'s `EXCLUDE_TOP_LEVEL_DIRS` already covered it, already matched on the full path (so the near-identically-named `docs/plans/` correctly stayed in scope), was already documented in the skill, and was already tested. Running `listDocs()` took seconds and showed 15 targets, 0 under `superpowers`, largest 28,351 B — none of the three cited files. Only the byte cap remained genuinely unbuilt. Checking the acceptance criteria would not have caught this; only checking whether the issue's *premise* still held did.

## IL-72 — Inlining into a size-capped file, then extracting

Don't inline a large block into a size-capped file and plan to extract later — when a fix's deliverable is "inline N KB into a prompt," check the host file's budget first and extract to a sub-file the caller inlines *from*.

Issue #94 was a broken dispatch contract: `/docs-health`'s parallel prompt told agents to inline literally, then referenced "Step 3 above" and `SKILL.md` by path — neither resolvable by a clean-room agent, so a dispatched agent emitted malformed output rather than merely expensive output. The issue's deliverables said "inline Step 3's JUDGE procedure verbatim," and that was done literally: `skills/docs-health/SKILL.md` went 38,386 → 50,318 B, breaching the 40 KB soft ceiling documented in this same file — whose stated rationale ("a contract restated twice, only one copy updated") is precisely the drift the inlining had just created, with the procedure now living in both Step 3 and the dispatch prompt. The fix was a second pass extracting it to `skills/docs-health/judge-procedure.md` as one source with two callers (Step 3 reads it; Step 1's dispatch inlines its body), landing at 37,246 B — below the original. Both signals were available before the first line was written: the ceiling rule, and `/tidy`'s `scan-procedures.md`, which already used exactly this extract-then-inline shape and is cited in `docs/plugin-structure.md` as "inlined into each parallel agent's prompt at dispatch time." Extraction also moved `Bundling rule` out of `SKILL.md`, breaking a required-token test — caught, but only because that test existed.

## IL-73 — Health-skill CLIs write durable shared state when run with real arguments

While testing the new `intent: "remove"` finding shape end to end, `node bin/harness-health.js validate-findings <file> --target CLAUDE --kind claude-md` was run with real arguments. The invocation looks like local validation, but `durable-state.js` fetched and updated the shared `health-state` branch on origin as a side effect — creating harness-health's five state files from scratch (`cursors.json`, `runs.json`, `declined.json`, `remembered.json`, `retry-queue.json`) and stamping a `claude-md:CLAUDE` cursor with `lastAuditedMs` set to now. With `STALE_DAYS = 90` (`bin/lib/harness-health/score.js`), the rotation then believes CLAUDE.md was audited that day and will not re-select it for up to a quarter — suppressing precisely the CLAUDE.md check the same session had just built. It also wrote `.claude-tweaks/harness-health/cache.json` locally, which a subsequent `git add -A` staged, because only `code-health/`'s cache directory was gitignored at the time. Nothing in the command signals this: the push was discovered only by reading the command's own stdout, where a `To https://github.com/... -> health-state` line sat among ordinary validation output.

## IL-74 — A literal NUL byte makes a source file invisible to grep

While implementing issue #82's slice byte cap, a cache key in `bin/lib/code-health/scope.js` was written as a template literal whose separator between `${absDir}` and the recursive flag came out as a literal NUL (`U+0000`) instead of a space. The code was correct and all 314 tests passed — NUL is a perfectly good delimiter at runtime, arguably better than a space since it cannot occur in a path. The damage was to tooling. `grep` classifies any file containing a NUL as binary and suppresses normal output, so `grep -n "const key" scope.js` printed nothing, and so did `grep -c`, which cannot legitimately print nothing. The `Edit` tool then failed with "String to replace not found in file" for a string the `Read` tool had just displayed verbatim at line 208. Three tools disagreed about a file that was on disk and correct.

The cost was a stalled discrimination check: the plan was to revert the cache-key fix and confirm the new test failed, and both the revert and the diagnosis burned several tool calls chasing a phantom. What finally resolved it was dumping code points (`[...line].map(c => c.codePointAt(0))`), which showed the offending code point (0) immediately. The fix was to write the separator as a two-character `\0` escape in source, keeping the identical runtime behavior with no NUL byte in the file. A repo-wide check afterwards confirmed all ten changed files were NUL-free.

What makes this worth a rule is the silence. A syntax error announces itself; a NUL byte makes the tools you would use to investigate quietly return nothing, and "grep found no matches" reads as evidence about the code rather than evidence about the file encoding. This project leans heavily on grep-based verification sweeps — plan self-checks, cross-reference audits, the four health sweeps — and every one of them silently reports a clean result on a file it cannot read.

**It recurred within the same session, in this entry.** Writing the paragraph above, the sentence "which showed the ` ` immediately" was meant to display the offending character and instead embedded a second literal NUL — this time into `docs/incident-log.md`. It was caught minutes later by a routine `grep -c "IL-74\|IL-75" CLAUDE.md docs/incident-log.md`, which printed a count for `CLAUDE.md` and nothing at all for `docs/incident-log.md`: the same silence, one file later. The earlier NUL sweep had not covered it, because that sweep ran against the changed-file list as it stood *before* the incident log was edited. Two lessons the first occurrence alone would not have taught: writing *about* an invisible character is itself a way to produce one, and a "changed files are clean" sweep is only valid for the file set that existed when it ran — re-run it immediately before commit, not once mid-session.

## IL-75 — Broadening a value's range activates invariants encoded elsewhere

Issue #82's fix made `/code-health`'s slice splitter emit non-recursive slices for any oversized directory's own files. Before it, exactly one slice was ever non-recursive: the repo root, `.`. That single-instance invariant had been quietly load-bearing in two places, and broadening the range activated both in one change.

The first was `gitChurn`'s non-recursive branch, which hardcoded the *root's* direct files as its pathspec. It carried a comment saying so outright — "recursive:false is only ever passed for the '.' slice ... passing recursive:false with a non-'.' relDir would silently mislabel root-level churn under the wrong id." The comment was an accurate warning left by whoever wrote it, and it was correct right up until this change made the precondition false. Once `bin/lib` became a non-recursive slice, it would have reported the repo root's churn under `bin/lib`'s id. No test would have caught it: churn feeds a hotspot *score*, not an asserted value, so the only symptom is a rotation that prioritizes the wrong slice.

The second was `readSourceFileDataCached`, whose cache keyed on the directory path alone. That was safe only while one directory was read exactly one way per invocation. After the split, an oversized directory is read non-recursively as its own slice while its children are read recursively, and a path-only key hands the second caller the first caller's file list — hashing and scoring the wrong file set with no error. Re-keying on `(path, recursive)` fixed it, and reverting that fix confirmed the new test fails.

Both were found by reading the surrounding code before editing, not by any test or type check, and both were invisible to the change's own diff. The generalizable point is that "this is only ever X" comments and single-value-derived cache keys are invariant *records*, and the change that widens the value is the change that must go looking for them.

## IL-76 — An extraction's saving is a per-mode measurement, not the extracted byte count

Don't treat "N KB moved out of SKILL.md" as the saving an extraction delivers — measure what each resolved mode actually loads afterward, because the sub-file's orientation header plus the stub left behind can cost more than the branch that mode skips.

Record #89 split mode-conditional bodies out of four skills. Three were unambiguous wins on their headline path: `/routine`'s `status --all` −26.8 KB, `/specify`'s shaping mode −26.0 KB, `/dispatch`'s common `gh`-present path −6.7 KB. `/tidy` was not. Its Step 6 auto/interactive split plus its Action Vocabulary backend split moved 11.5 KB out of `SKILL.md`, which reads as a clear win — but an `auto + github-issues` run, the exact combination a scheduled `/tidy` Routine fires, loads *both* the larger branch (`step-6-auto.md`, 7.8 KB) and the larger backend file (`actions-github-issues.md`, 3.6 KB). Measured against the pre-split file it came out **472 B worse**: four sub-file headers at roughly 700 B each, plus the routing stubs left in `SKILL.md`, exceeded the 5.0 KB those two files let that path skip. Trimming the headers to two or three lines and dropping a redundant routing table turned it into −930 B, with the other three tidy combinations at −3.2 to −7.3 KB. Nothing else would have caught it: `npm test` passes 1798/1798 without reading a word of skill prose, and the extracted-byte count reports "win" in every case, including this one. The check is four lines of arithmetic per mode and belongs at design time rather than verification time — run first, it would have scoped or skipped `/tidy`'s Action Vocabulary split, which the record named as a deliverable while estimating "~1,100 B/row, roughly half dead" against a live section of 6.8 KB carrying ~1.2 KB of dead weight on this repo's backend.

The same record carried a second, related trap on the way in. Its deliverables named `create.md` / `update.md` / `status.md` for `/routine` as three peer files. The live file shows UPDATE reusing five of CREATE's nine steps *by name* — template load, repo URL + `PREFIXED_NAME` derivation, environment resolution, body assembly, and Step 7's review-gate standard — so splitting them as peers would have either duplicated ~8.7 KB or made every `update` run read `create.md` anyway; they shipped as one `create-and-update.md` instead. One `grep -n "CREATE Step" ` against UPDATE's body settles that in seconds. A deliverable list names outputs, never the coupling between them.

## IL-77 — A corrected count can contradict the data printed beside it

Record #96 enumerated 39 restated cardinalities that had drifted from their sources, each filed as "stated N, actually M." One of them was the GitHub-issues lifecycle diagram (removed in #391), whose title read "All 18 core labels + 3 optional priority:* labels — the full work-record taxonomy." The canonical source is the `## Canonical LABELS_JSON` fence in `skills/_shared/label-bootstrap.md`, which `bin/lib/issues/tests/labels.test.js` parses live; executing it returns 27 labels, 3 of them `priority:*`, so 24 core. The record's acceptance criterion was to write 24.

Writing 24 would have made the document worse. The diagram's own `<tr>` rows list 21 labels — 18 core plus the 3 priority ones — because six labels added since it was drawn (`by:dispatch`, both `ceremony:*`, all three `demo:*`) were never given rows. The title's "18" was not a stale restatement of a 24-item list; it was an accurate description of the 18 rows immediately beneath it. The desync was between the *table* and the taxonomy, and the title was the only part still telling the truth about what a reader could see. Correcting the number in isolation would have produced a title that contradicted the data printed directly below it — a sharper failure than the one being fixed, and one that reads as authoritative because the number is now provably "right."

It was caught because the agent doing the fix was told to re-derive every count from its real source rather than trust the record, and re-deriving surfaced both numbers: 24 in `LABELS_JSON`, 18 in the file being edited. The resolution was to stop the title claiming completeness at all — it now names the label families and points at `label-bootstrap.md` — and to leave the six missing rows as tracked follow-up, since adding them needs new markup plus a resize of the enclosing `foreignObject height="1350"`, which is restructuring rather than a cardinality fix.

The generalizable point is that a restated count has two possible referents: the canonical source, and whatever the reader can see next to it. A cardinality sweep naturally checks the first. When the artifact holding the count is itself a copy of the data — a rendered table, a diagram, a duplicated list — the second referent has to be checked too, and the two answers disagreeing means the artifact is stale, not the sentence. Nothing mechanical catches this: `npm test` never reads the diagram, and a count-versus-source comparison returns "desync" with full confidence in exactly the case where acting on it does harm.

## IL-78 — A verification instrument that cannot fail is not a check

Phase 2b's premise was that deleting the `## Relationship to Other Skills` table from all 32 skills would strand 88 identifiers — tokens whose only occurrence in the shipped payload was a row about to be deleted. That figure came from a short script: for each skill, read `SKILL.md`, read the sub-files its body names, and report every identifier absent from the union. It was written to gate the deletion, and it was wrong in three independent ways at once. It never opened a cross-skill path the body named, so `skills/flow/materialize.md` — cited ten times in build's body — counted as unreachable along with everything in it. It compared head tokens against the body alone rather than the reachable set, so `diagram-suggestions: enabled` scored absent while `decomposition-mode.md:195` stated the flag and its full gate semantics. And it split head tokens on a character class containing `{`, so every placeholder-shaped identifier produced an empty head and could never clear the artifact test at all.

Fixing the first two dropped the count from 88 to 38; fixing the third took it to 34. The interesting failure came next. Reasoning that skills routinely instruct a further read ("apply the full procedure in `_shared/harness-health-analysis.md`"), the natural correction was a transitive closure over the pointer graph. That reported **1** identifier absent across the whole corpus — the reassuring answer, arrived at immediately, by the method that looked most rigorous.

It was caught by asking what the closure had actually read. Per skill it absorbed roughly 120 of the 214 markdown files under `skills/`, about 1.2 MB. No single invocation loads that. The closure was not modelling reachability; it was reading most of the repository and then reporting, correctly, that most of the repository contains most of the tokens. Fed any corpus at all, including one where the deletion genuinely destroyed information, it would have returned approximately the same number. The final measurement bracketed instead: depth 1 (`SKILL.md` plus the files its body names) at 34, depth 2 (one further instructed pointer) at 1, with depth 1 adopted as the safety floor because it is the conservative model of one invocation.

The generalizable point is that "the check passed" and "the check could have failed" are separate claims, and only the second makes a passing result evidence. A verification whose sensitivity is unmeasured is decorative, and it is most seductive precisely when it agrees with the conclusion you were hoping for — arriving fast, from a method that sounds thorough. The cheap defence is to measure what a passing check examined, not just what it returned: how many files, how many bytes, what fraction of the search space. A check that would pass on any input is not a weak check, it is not a check. This is the same discipline as confirming a new test fails when the fix is reverted, applied to a measurement instead of a test.

## IL-79 — A bare token cannot match its populated form

Auditing the Relationship rows before deleting them, one row claimed that `_shared/design-wrapper-handling.md` "documents the universal `{result}` / `{skipped}` / `{deferred}` / `{fail}` shapes." Grepping that file for `{result}` returned nothing, so the claim was recorded as a defect: the file documents none of the four shapes it is credited with. That went into the plan as a finding and into a commit message as fact.

It was false. The file documents all four, in populated form — `{result: "ok" | "pass" | "advisory", ...}`, `{result: "fail", findings: [...]}`, `{skipped: {reason: ...}}`, `{deferred: {reason: ...}}`. A search for the bare token `{result}` cannot match `{result: ...}`, because the closing brace never follows the name. "Zero occurrences" was a true statement about the grep and a false one about the file, and nothing in the output distinguished the two.

The same mechanism bit the reachability scan in the same session, from the other direction: its head-token extractor split identifiers on a character class that included `{`, so `{result}` yielded an empty head string, which then failed a minimum-length guard and skipped the artifact test entirely. Both failures are the same shape — a placeholder written with delimiters, matched as though the delimiters were part of a fixed token.

Related but distinct from `[IL-15]`, which is about grepping a keyword when the defect is silence, and from `[IL-74]`, where a NUL byte makes grep decline to report at all. Here grep works perfectly and answers a narrower question than the one being asked. The defence is to search for the *name* rather than the fully-delimited token — `result:` or a bare `result` scoped to the file — and, before recording any absence as a finding, to open the file. A defect asserting that content is missing is exactly the kind that reads as authoritative and is never re-derived by a downstream reviewer.

## IL-80 — A test that reads the live corpus it measures invalidates itself

Phase 2a re-specified `bin/lib/skill-audit`'s loss checker after measuring that its presence-based semantics detected only 24% of a known-total loss. The acceptance test encoded that experiment directly: open `skills/review/SKILL.md`, locate its `## Relationship to Other Skills` heading, delete that section in memory, and assert the checker reports at least 95% of the section's identifiers lost. It passed at 100%, and the 24%-versus-100% pair became the evidence on record that the fix worked.

Phase 2b then deleted that section from all 32 skills — the change the checker existed to make safe. The test began failing on its own precondition, `assert.ok(start > 0, 'review/SKILL.md must still have a Relationship section')`. The test was not broken by a regression; it was invalidated by its own subject matter succeeding. Written against live production content, it could only survive as long as the migration it was gating never happened.

It was nearly missed twice over. The repo-wide sweep for dangling references did surface the file, and it was dismissed with the reasoning "skill-audit excluded — it is the parser and the guard" — excluding a whole directory by role, which hid a live-corpus dependency inside it. It surfaced again only as a test failure. The fix was to freeze the input: `skills/review/SKILL.md` verbatim at the last pre-deletion commit, committed as a fixture, so the experiment still runs on exactly the bytes that produced the recorded 24% and 100% figures rather than being weakened to whatever survives.

The generalizable point is that a test reading mutable production content has that content as an undeclared dependency, and a migration is precisely the event that breaks it — so the test is absent exactly when the change is riskiest. Any assertion of the form "this real file currently contains X" is a scheduled failure whenever X is something the project intends to change. Freeze the input as a fixture, and note that being the tool performing a migration grants a module no exemption from it.

## IL-81 — A plan's own measurement command, cited unverified

Plan A's byte-measurement step used `awk -v s="## $s" 'index($0,s)==1{f=1} f&&/^## /&&index($0,s)!=1&&c++{exit} f{print}'`. The exit condition is `c++` — post-increment, so it evaluates 0 (falsy) on the *first* subsequent `## ` heading and only fires on the second. The command therefore always swept one section past its target. Every figure it produced was inflated by the following section's size. The design doc had been written with the same command, so the plan and the design agreed with each other, which is exactly what made the numbers read as ground truth. The implementer ran the command verbatim as instructed, got 1022 where the plan predicted "≤700", reported the mismatch instead of adjusting the command, and diagnosed the cause. Re-measuring correctly (exit on the first subsequent h2) gave: Working Approach 1,561 B not 1,634; the Pipeline section 2,468 B before and 847 B after, not 2,627; the whole template body 6,462 → 3,554 B. The corrected numbers reconcile arithmetically — 2,468 − 847 = 1,621, plus Project Defaults' 1,287, equals the 2,908 B whole-body delta — which the inflated ones never did, though nobody had checked. Had the implementer trusted the expectation over the output, the shipped CHANGELOG would have carried five wrong figures with a design doc appearing to corroborate them. The generalizable point is that a measurement command in a plan is code, and unlike the plan's prose nobody reviews it as code; two documents agreeing is not evidence when one was generated by the other's tooling.

## IL-82 — Which half of a dispatcher-inlined file actually reaches the agent

`skills/harness-health/judge-procedure.md` is inlined verbatim into every dispatched harness-health agent's prompt. It has a `---` separator at line 21, and the guard test defines the inlined body as everything below it (`readJudgeBody = () => readJudge().split(/^---$/m).slice(1).join('---')`). Plan A's task told the implementer to rename a sub-check at line 13 — above the separator, in the dispatcher/human-facing scope note that no agent ever sees. The line number was correct and the replacement text was correct; what was wrong was the assumption that this line was the one that mattered. The actual inlined occurrence, at line 132, carried a third independent name for the same check ("Documented lever list in sync with the installed plugin") and was still worded against a CLAUDE.md section the same branch had deleted. Left alone, every dispatched agent would have kept running an obsolete check against a section that no longer exists, and none would have received the new instruction the rename existed to add. The task's own review caught it only because the reviewer was told to verify against the file's structure rather than the plan's line numbers. The generalizable point is that "inlined verbatim into an agent's prompt" is a property of a *region* of a file, not the file; before editing a reference in such a file, find the split the test suite itself uses and confirm which side you are on.

## IL-83 — An exemption placed after the early-return that preempts it

`checkConformance` compares an adopting project's CLAUDE.md against the plugin's template. `## Philosophy` is a documented exception: the template carries only a `{...}` placeholder for it and its real content is generated from the project's maturity classification, so it is reported present/absent-only rather than byte-compared. The exemption was implemented as a `if (section === PHILOSOPHY_EXCEPTION) { conformant.push(section); continue; }` guard — placed *after* the `if (!projectSections.has(section)) { missing.push({section, expected}); continue; }` early return. So the exemption only ever ran on the present path. A project missing `## Philosophy` entirely got it in `missing` with `expected` set to the literal placeholder text — including a dangling "See 'Generating Philosophy' below" pointing at a section of the *plugin's* file — and the consuming skill's prose said the suggested patch "inserts the entry's `expected` body verbatim. No creative writing required." Every unit test passed: the fixture never declared a Philosophy section, so the branch was untested in both directions. It was caught at whole-branch review by executing the function against the real template with a project that lacked the section, not by reading it. The generalizable point is that a special-case exemption and an early return that can claim the same value are ordering-coupled, and the coupling is invisible unless you trace which branch the exempted case actually takes.

## IL-84 — A new test directory outside package.json's enumerated globs

`package.json`'s test script lists `bin/lib/*/tests/*.test.js` one directory at a time — eight explicit globs, no wildcard over the parent. The branch created a ninth module, `bin/lib/init/`, with fifteen tests. Neither plan mentioned `package.json`. `npm test` stayed green throughout and reported a plausible total; the fifteen tests simply never ran under it, only when invoked directly. Nothing fails in this shape — the suite gets quieter, not redder — and CLAUDE.md's own Commands section describes `npm test` as covering "every `bin/lib/*/tests/` directory", which is what the script is meant to do and not what it does. It was caught in a pre-flight read of `package.json` before the plans were executed, not by any check during them. Adding the glob took the suite from 1,826 to 1,841; that arithmetic — baseline plus two policy-schema tests plus fifteen conformance tests — is the only evidence the fix worked, since no assertion covers the script's own coverage. The generalizable point is that an enumerated list standing in for a wildcard silently under-covers the moment something new is added, and a test suite is the one place where under-coverage looks identical to success.

## IL-85 — Compatibility paths with no removal condition accumulate silently

Nine distinct legacy families across 195 mentions in `skills/`, and a grep for
"deprecation policy", "breaking change", "support window", and "sunset" across
`README.md`, `CLAUDE.md`, and `docs/` returned zero. Every path was added ad hoc and
none carried a stated end date, so none was ever collected.

One had already crossed from cost into wrong behavior. `backlog-backend` was read as
an alias by exactly three skills and ignored by every other consumer, so a project
setting only that flag had most of the system silently default to `local-files` —
a defect `README.md` documented rather than fixed, because nothing owned removing it.

Two of them turned out to be load-bearing in ways a schema-level read missed.
Removing `backlog-backend` also retired three mechanisms that existed only to cope
with it: `MIGRATION_GAP` detection in `/backlog`'s grant sub-stage and `/dispatch`'s
Preflight, plus harness-health's check 9 and its inlined copy in
`judge-procedure.md` — a check written generically that had exactly one instance and
an alias-specific grep, sitting in a file inlined into every dispatched judge agent.
And the four `triage-*` policy aliases had a live executable fallback in
`settle-and-merge.md`, not just schema rows: deleting the rows alone would have left
shell code reading a key `auditPolicy` no longer recognizes.

Distribution is an unpinned git URL tracking `main` HEAD and the only consumer is the
author, so none of these needed a deprecation window. The cost was the accumulation,
never the removal.

## IL-86 — A renumber done inside a conflict resolution hides its own cross-references

Merging the v6.36.0 legacy purge into the skill-bloat branch produced a conflict in `skills/_shared/harness-health-analysis.md` and its distillation `skills/harness-health/judge-procedure.md`. Upstream had retired evidence pre-check 9 (a legacy-alias check with, by then, zero instances); this branch had added a new check 10 immediately after it. The resolution was correct and deliberate: take upstream's deletion, keep the new check, renumber it 10 to 9. Both files were checked for leftover conflict markers, the numbered lists read 8 then 9 cleanly, and the suite was green.

Three sentences in each file still said "check 10". They were not inside the conflict hunks — they were ordinary prose elsewhere in the same files, referring to the item by number: "Every signal Step 1's check 10 reports has a legitimate form", "cite check 10's reported line and byte count". `git diff` during the merge shows the hunks being resolved, and those sentences were not in them, so nothing under review could have shown the breakage. Both files shipped in v6.37.0 pointing a judge agent at a check number that no longer existed, and `harness-health-analysis.md` is inlined verbatim into every dispatched judge agent, so the dangling reference reached all of them.

It was caught by luck rather than process: the subagent that had originally written the check finished its own task after the merge landed, re-read its work in the merged state, found the six references, and fixed them. Nothing else would have. No test reads that prose, and the same session had applied `[IL-55]`'s renumbering discipline correctly to `/help`'s Priority Order an hour earlier — sweeping the repo for references to items 5 through 11 before renumbering them — and simply did not think to do it here, because here the renumber was a side effect of resolving a conflict rather than the point of the change.

That is the generalizable part. `[IL-55]` frames renumbering as a task you set out to do, where checking cross-references is an obvious step. A renumber that emerges from conflict resolution never announces itself: attention is on reconciling two versions of one hunk, the diff under review is scoped to that hunk by construction, and the item's other references sit outside it in text neither side changed. Any time conflict resolution changes an identifier — a number, a name, a path — the sweep for references to the old form has to run against the whole file and the whole repo, not against the merge diff.

## IL-87 — Upstream's deletions land on nothing when your branch has moved the content

The same merge carried a second failure mode, in the opposite direction. This branch had extracted large sections out of five `SKILL.md` files into new sub-files; upstream's legacy purge had deleted spec-file-alias text from those same sections, in place. Git surfaced seven conflicts and auto-merged the rest, and every conflict was resolved on the `[IL-44]` principle — keep this branch's structure, re-home upstream's edits into it.

That handles the text git flagged. It does not handle the text git had nothing to say about. Where upstream deleted a line that this branch had already moved to a different file, there was no conflict: the deletion applied cleanly to a location that no longer held the content, and the content itself sat untouched in its new home. `init/SKILL.md` lost its "Starter files | Wrote `specs/INDEX.md`" row exactly as upstream intended, while the same row survived in `init/summary-templates.md` where the extraction had put it. The same happened to the legacy spec-file-mode variants in `wrap-up/summary-template.md` and `wrap-up/execution-and-verification.md`. A clean merge, a green suite, and purged content still shipping.

It was found by enumerating every line upstream deleted across the merge range and grepping each one against the whole post-merge tree — 226 deleted lines, 14 still present. Ten were genuine survivors needing manual re-application; four were false positives (two files byte-identical to upstream, one legitimately reworded sentence). Without that sweep all fourteen would have shipped, and the four false positives are the reason the check has to be a report rather than an automated deletion.

The generalizable point is that conflict markers detect *competing edits to the same region*, which is not the same thing as *upstream's intent failing to reach its target*. Once your branch has moved content, those two diverge: the more thoroughly you refactored, the more of upstream's changes land somewhere harmless and silent. The cheap defence is mechanical and takes one command — diff the merge base against upstream, collect the deleted lines, and check each against your whole tree. Run it after any merge where your side restructured, and treat the output as a worklist rather than a verdict.

## IL-88 — A completion claim written before the work makes its own verification feel redundant

Plan C's CHANGELOG entry ("Every backward-compatibility path removed") was drafted at plan-authoring time, alongside per-step verification greps written to return no output. Two of the nine families were never purged. The greps were never run, the commit message asserted completion, and the prewritten entry published it — three agreeing artifacts, none of which had touched the tree, because two of them descended from the same unverified draft.

The failure is not only that a prewritten entry went unverified. Writing the completion claim in advance is what made verifying it feel redundant: the conclusion was already on the page in the plan's own voice, so the greps read as confirmation of something settled rather than as the check that decides it. The reporting compounded it — a commit delivering one of Task 6's three sub-purges was described as "Task 6," and every downstream reader inherited that as done.

Prewriting release text is fine; treating it as a record is not. Verify each claim against the tree at publish time, and treat a plan-supplied verification command as unexecuted until its output is in the transcript.

Adjacent to `[IL-78]`, and worth telling apart: there, the check ran but examined nothing that could have failed. Here the check never ran at all, because a claim authored upstream of it had already settled the question. `[IL-78]` is about weak evidence; this is about claim provenance suppressing the demand for evidence.

## IL-89 — A successful update command is not evidence the code updated

A scheduled `dispatch next` Routine hard-gated on `gh` being absent — a gate the shipped build had replaced with an MCP branch four days earlier, in the release that closed #61. Its self-report described `dispatch/SKILL.md` as "entirely gh-CLI-only with no MCP equivalent for the atomic claim-ref race." The marketplace mirror, the plugin repo, and a local cache all resolved 6.38.1, so the natural reading was that the fix had shipped and the gate was still wrong. It was not: that sentence is a near-verbatim paraphrase of 6.23.7's own Relationship-table wording, which 6.24.0 replaced. The sandbox was running a build from before the fix and reporting its behavior as current.

The sandbox's setup script runs `claude plugin marketplace update` then `claude plugin update` on every session, and both reported success. `claude plugin update` decides whether a plugin is current by comparing the installed version *string* against the *local* marketplace catalog, and stops there. Emptying a cached plugin directory of its files and re-running it produces `already at the latest version (6.38.1)` and exit 0, having repaired nothing. Pointing an installation record at an older directory produces the same line. So does a catalog that failed to refresh, since the comparison then measures the sandbox against itself. Three distinct broken states and one healthy one all emit the same successful log line.

Two nearby surfaces look authoritative and are not. `claude plugin list --json`'s `version` is metadata written beside the cache directory rather than read out of it. `installed_plugins.json`'s `gitCommitSha` is not refreshed by `claude plugin update` at all — confirmed by a live cross-version 6.23.7 → 6.38.1 update that left the pre-update sha in place — so it can name a commit the installed files were never at. The one honest answer to "which build is this session running" is `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`: the directory the running skill files were actually loaded from.

The generalizable point is about what an idempotent update command's success actually asserts. It asserts that the tool found nothing to do — a statement about the tool's own comparison, not about the artifact. Where that comparison is a version string and the artifact is a directory, every way the directory can be wrong while the string is right is invisible, and invisible in the direction that reads as healthy. The costly part was not the staleness but the ambiguity: a stale sandbox and a live code bug produce identical evidence from the outside, and this investigation reached the wrong conclusion first because nothing in the routine's own output distinguished them. The fix is to make each firing state which build it resolved, so the question never has to be reconstructed after the fact.

## IL-90 — An extraction's parity criterion cannot see a defect all its sources shared

`bba5e3c1` extracted the four health engines' independently-duplicated stale-then-churn rotation selector into `health-core/rotation.js`. Its acceptance criterion, stated in the commit message, was "All four engines' existing scope.test.js suites pass unchanged, confirming behavior parity." The extraction was clean, the parity claim was true, and all four engines carried the same bug through it: Phase 1 returned on the *first* candidate past the staleness threshold rather than the most overdue one, so any candidate set larger than `staleDays` looped over its alphabetical prefix forever (#130).

Parity is the right criterion for an extraction's mechanics and structurally blind to this. It asks whether the extracted module reproduces what the sources did — and four sources agreeing is exactly the condition under which a shared defect reads as the specification. The green suite was not weak evidence; it was correct evidence for a question that could not surface the bug.

What converted the defect into a contract was the new test written alongside the extraction: `Phase 1: force-picks the first candidate unaudited past staleDays, in list order`. Characterizing extracted behavior is the normal thing to do, and here it promoted an accident of implementation into a named, asserted guarantee. Downstream, `code-health/scope.js`'s candidate sort acquired a comment justifying itself on first-qualifying-wins grounds — so a second file now documented the bug as load-bearing design. The rationalization compounds: each artifact that explains the behavior makes the next reader less likely to question it.

It ran for 17 days of daily Routine firings across four engines before an operator noticed docs-health had only ever audited five of 146 docs. No test could have caught it, because the defect lived in the semantics every test agreed on.

The narrow rule is about extraction: a parity criterion answers "did I move this correctly," never "was this correct." When N implementations are being unified, the extraction is the one moment all N behaviors are stated in one place and comparable to intent — spend a pass asking what the behavior is *for*, separately from whether it was preserved. The broader one is about characterization tests generally: a test written to describe existing behavior asserts nothing about whether that behavior is wanted, and once written it is indistinguishable from a test that does.

## IL-91 — zsh's `:s` modifier silently mangles `"$ref:path"`, and the command returns empty rather than failing

While diagnosing #129, a loop compared one file across three git refs:

```bash
for ref in origin/main origin/dev HEAD; do
  c=$(git show "$ref:scripts/claude-cloud-setup.sh" 2>/dev/null | grep -c "claude plugin update")
done
```

Every iteration reported `0`. Read literally, that said the consuming project's committed cloud setup script had never gained the `claude plugin update` step — which would have made *that* repo the root cause of the stale sandbox, and pointed the whole investigation at the wrong codebase.

The string never reached git. The Bash tool runs zsh, where `:s` inside a parameter expansion is a history-style substitution modifier, so `"$ref:scripts/claude-cloud-setup.sh"` expanded to `origin/mainloud-setup.sh`. `git show` failed with `fatal: ambiguous argument`, `2>/dev/null` swallowed it, and the empty stdout flowed into `grep -c`, which dutifully counted zero. Brace the variable — `"${ref}:path"` — and it works. Note that a bare unquoted `git show HEAD:path` is also fine; the modifier only applies to a parameter expansion, which is why the same command written two ways disagreed.

It was caught only because the result contradicted a `grep` run against the same file thirty seconds earlier. Nothing else would have: exit code 0 (masked by the pipe to `grep`), no stderr, plausible-looking output, and a conclusion that fit the hypothesis under test.

Two generalizable points, and the second is the load-bearing one. First: in zsh, any `"$var:..."` is suspect, and `2>/dev/null` on an exploratory command converts a loud failure into a quiet wrong answer — drop it while exploring, add it only once the command is known-good. Second, and independent of shells: when a command's output contradicts something verified moments earlier, suspect the command before the fact. The instinct runs the other way — the new result feels like the discovery and the old one like the assumption — and that instinct is what makes this class expensive. Same family as `[IL-74]` (a grep silently returning nothing because of a NUL byte): there the file broke the tool, here the shell broke the command, and both present as an empty result that reads as evidence.

## IL-92 — A fail-open branch's comment names one cause; the transient one arrives at the same line unannounced

`pre-tool-use.js`'s worktree gate read `if (!repoRoot) continue; // not a git repo at all -> allow`. The comment is a fair description of one way to get there. It was never the only way: `repoInfo` returns a null root whenever `execGit` returns null, and `execGit` collapsed *every* failure — timeout, refused fork, missing git, non-zero exit — into that same null, from the moment it was extracted. So a `git rev-parse` that merely ran out of time produced a byte-identical result to a directory that genuinely is not a repository, and the gate allowed a write it would otherwise have denied.

The two causes are not the same kind of fact, which is what makes the conflation harmful rather than merely imprecise. "This is not a git repository" is permanent and knowable; allowing on it is correct forever. "I could not find out" is transient and load-dependent; allowing on it silently suspends a policy the user explicitly opted into, at exactly the moments the machine is busiest. On this repo — where several parallel worktree sessions are the normal working mode — the enforcement gap opened precisely when the most agents were running.

Nothing could catch it from inside. No test failed, because every test ran on an idle machine where the transient cause never fired. No log recorded it, because the gate's allow path is silent by design. The only visible symptom was a flaky test suite, which was filed as a test-infrastructure problem — and four of those "flaky" failures were the tests asserting the gate denies, failing because it allowed. The system was reporting the bug accurately and the report was read as noise.

Measuring rather than reasoning is what separated the two. The enforcement-critical `rev-parse` peaks at 411 ms idle and 2492 ms under load — 83% of the 3000 ms budget — with zero `EAGAIN`/`ENOMEM` across 1000+ instrumented spawns, so it was latency against a fixed ceiling rather than resource exhaustion. Neither figure is derivable by reading the code.

The generalizable rule is about comments on fail-open branches specifically. A comment that enumerates why control reaches a branch is a specification, and it decays differently from wrong code: it stays *true* while becoming *incomplete*, so nothing ever contradicts it and no reviewer is prompted to re-derive the full set. Where the branch's behaviour is to allow, each unnamed cause is a silent hole. When writing or reviewing one, the question is not "is this comment accurate" but "what else reaches this line, and is any of it transient?" — because a transient cause hitting a permanent-sounding branch is invisible by construction.

Worth telling apart from `[IL-83]`, which is also about a branch claiming a value it should not: there the ordering of an early return was wrong, and the code did something the author did not intend. Here every line does exactly what its author intended, and the defect lives entirely in a set of causes nobody enumerated.

## IL-93 — Widening an enforcement mechanism leaves every description of its old reach quietly false

On 2026-07-20 the `worktree.always` gate was widened twice: `c8f929e1` added `git push` beside `git commit`, and `cab6142b` added Bash `cp`/`mv`/`tee`. Both were correct, both were tested, and neither swept the prose describing what the gate covers. Five skill files went on documenting the pre-widening gate.

Three of the five did more than describe the gate — they prescribed procedures it denies. The cost took three weeks to surface, and surfaced as unrelated symptoms. `wrap-up/cleanup-procedures.md` told wrap-up to `cp` a run's gitignored audit state out to the main checkout before removing the worktree, and asserted in a parenthetical that a bare `cp` was not gated. It was. So on every `worktree.always` project, `decisions.md` and `config.yml` were destroyed at every wrap-up — silently, because a denied tool call mid-cleanup is not a hard stop. `flow/materialize.md` told the pipeline to commit the materialized record on the pre-worktree branch, which cannot execute at all under the policy. `wrap-up/review-console.md`'s headless fast-lane auto-merge ran `git merge` then `git push` from the main checkout, where the push is denied and no human is present to notice. `flow/worktree-merge.md` and `_shared/git-discipline.md` both stated flatly that `git push` is never gated.

Three properties made this durable. First, the claims were *true when written* — `worktree-merge.md`'s sentence dates to 2026-07-16, four days before the widening — so no reviewer of that file was ever wrong. Second, the failure is a refused tool call, which reads as friction rather than as a defect; two of the five were eventually found by hitting them at runtime, never by reading. Third, and worst, one of them had already been "fixed": issue #32 closed a data-loss bug by *adding* the very `cp` that #138 later reported as denied, which means #32's verification never ran on a project with the policy enabled.

Keyword search cannot find this class. Grepping `worktree.always` or `checkWorktreeRequired` returns only files that already name the gate — and `materialize.md` and `review-console.md` name neither. Their defect is silence: a procedure that simply assumes something about what will be intercepted. What did find them was grepping the *procedure shape* (`git push`, and the `cp`/`mv`/`tee` write forms) and adjudicating each hit against the gate's real behaviour. That sweep also turned up the fifth site after four were already known, which is the argument for running it rather than trusting a careful read. Same lesson as `[IL-15]`, reached from the opposite direction.

The fix that matters is not the five corrections. It is that `bin/lib/hooks/pre-tool-use.js` now exports a `GATE_COVERAGE` constant the gate itself branches on, `skills/_shared/policy-schema.md` carries the single prose statement of that coverage between marker comments, every other file cites it instead of restating it, and `tests/hooks-gate-coverage.test.js` fails when the two diverge. Widening the gate again now breaks a test until the canonical prose is updated, and one edit is sufficient because nothing else restates the list. Note what the binding is worth without the consolidation: pinning prose that five files duplicate would just pick one copy to keep honest.

Two traps worth naming, both hit while building this. The constant must be *load-bearing* — an exported list nothing reads pins prose against a dead value and stays green forever (`[IL-78]`), so `WRITE_SHAPES` guards which command words `fileWriteTargets` will even inspect, making an unlisted shape dead code. And the test reads live production prose, which `[IL-80]` warns against; that is tolerable only because the coverage block is a declared contract whose update *is* the intended response to a gate change, and it must not be generalized to prose that merely mentions the gate.

## IL-94 — A release step that exists in no procedure is performed at whatever rate memory supplies

`CHANGELOG.md` had 59 entries against 145 shipped versions. 103 releases — whole features, not just patches — had no entry, and 11 entries named versions that never reached `main`. This had been accumulating since 1.0.0 in February 2026 and nobody had noticed, because from the repo's point of view nothing had gone wrong.

The direct cause is that the step was never written down. CLAUDE.md's "Releasing (two repos)" specified the version bump and the marketplace mirror in detail and did not mention the changelog once; the file's only occurrence of the word sat inside a parenthetical about *where not to write a version number early*. So the entry was not being forgotten against a documented procedure — there was no procedure. Whether a release got an entry depended on whether whoever was working happened to think of it, which produced exactly the distribution you would expect: consistent in bursts, absent for long stretches, and correlated with nothing.

The reinforcing cause is that the one mechanism already positioned to catch it declined to. `post-tool-use.js`'s `checkPluginVersionBump` fires on any commit touching `.claude-plugin/plugin.json` — the precise trigger — and had been shipping since 6.12.1 with a message about the marketplace mirror and nothing else. Its test asserted `/marketplace/i` and passed. A detector aimed at the right event, with a passing test, that never mentions half of what the event obliges: this is `[IL-78]` in a different costume, where a green check attests to less than the reader assumes.

Two second-order effects, both invisible until measured. `bin/lib/changelog.js`'s `HEADER_RE` requires a strict `X.Y.Z` and an em-dash title, and six early headings (`## v4.1`, `## v4.2 — Token Saver`) match neither — so `/claude-tweaks:init`'s upgrade notice had been silently omitting those releases from every range it reported, with no error anywhere. And the 11 orphans are the residue of version-number collisions between concurrent worktree sessions (`[IL-12]`): the manifest got renumbered, the changelog heading kept the number the branch held, and the two have disagreed ever since. A user on 6.38.3 reading about "v6.39.0" is reading about their own build under a number no install ever reported.

The generalizable rule is narrower than "write things down." It is that a step hanging off an automated event needs its enforcement attached to that event, not to the prose. The prose fix (naming the changelog in the Releasing section) and the nudge fix (naming it in the hook message) are both worth having and neither would have produced 145/145, because both depend on a human reading them at the right moment. What produces 145/145 is `tests/changelog-coverage.test.js`, which reconstructs every version the release branch's tip ever reported and fails the suite on any that lack an entry. Note which of the three is the actual mechanism, and that it was the last one to be considered.

A caution on the reconstruction, since the obvious implementation is wrong. Walking `git log --first-parent -- <manifest>` finds bump commits on side branches, which is not the same set as the values `main`'s tip actually held — they diverge exactly when two sessions bump concurrently, i.e. this repo's normal mode. Only walking the release branch's own first-parent chain and reading each commit's manifest blob answers "what would an install have reported", which is the only question a changelog owes an answer to. The first version of the analysis used the wrong walk and disagreed with the right one about 11 versions.

**Superseded, one day later — see `[IL-95]`.** The paragraph above is wrong about its own conclusion. Walking the release branch's first-parent chain does not answer "what would an install have reported" either; it answers "what is reachable from the current tip without crossing a second parent", and those coincide only while merges land *onto* `main`. The reconstruction this entry treats as the sound one was itself unsound, and the backfill it produced mislabelled 13 shipped releases as branch-numbered. `docs/shipped-versions.tsv` replaced it.

## IL-95 — A history reconstruction that is unstable, not merely lossy, and reads as evidence for deleting the data it lost

`tests/changelog-coverage.test.js` (v6.41.0, `[IL-94]`) reconstructs the set of shipped versions by walking `git rev-list --first-parent origin/main` and reading each commit's manifest blob. One day later `main` was red on that gate, reporting that six CHANGELOG entries named versions that never shipped — including v6.41.0, the release that introduced the gate.

The mechanism is a merge direction. `110c3448` merged `origin/main` **into** the #132 feature branch, and that branch then became `main`'s tip. A merge's first parent is the branch you were on, so the first-parent chain now follows the feature branch back to its fork point, and everything `main` carried in between moves to the second parent, where the walk never looks. Six versions vanished from the reconstructed set without a single commit being lost.

What makes this worse than a lossy heuristic is that it is not stable. Asked from three refs that had each genuinely been `main`'s tip, the same function on the same repository gave three different answers, and they were not nested — 6.40.0 and 6.41.0 were shipped from `65531d88` and absent from the current tip, while 6.39.0 was the reverse. Versions *leave* the set as later merges land. Any snapshot of it is a claim about merge order, dressed as a claim about release history.

Then the failure mode that matters. A session read the red gate, took the walk's output as evidence about history, and demoted six `## vX.Y.Z` headings to `### … branch-numbered vX.Y.Z` subsections — the file's existing convention for work that was written up under one number but reached users under another. That is the correct convention and it was applied to six releases that had genuinely shipped. Every one of them had a marketplace mirror commit, written at ship time in a separate repository, saying so. The commit message reads as careful work: it cites the first-parent chain, names the convention, keeps every write-up verbatim, and reports a green suite. It was green because the data had been edited to match the broken checker.

Four minutes later the next merge — again `origin/main` into a worktree branch, again pushed as `main` — re-broke the gate in both directions, including four of the six entries that had just been demoted.

Two things generalize. The first is about evidence: when a check and the data disagree, the check is a hypothesis too, and the tiebreak has to come from a source that does not share its assumptions. The marketplace repo settled this in one command; it was never consulted, because the walk's output looked like ground truth rather than like a derived claim. The second is about error direction. A false "shipped" costs one unnecessary changelog entry. A false "never shipped" reads as licence to delete a release's write-up. Those are not symmetric, so a mechanism that can produce both should not be trusted equally in both directions — and this one was trusted more in the direction that destroys.

The wider count only surfaced once a recorded source existed to compare against: 13 of the 16 `branch-numbered` subsections were mislabelled, 7 of them by v6.41.0's own backfill before the #132 merge existed. The gate had been mis-classifying releases from the day it shipped, and its author's confidence in the walk (see the superseded paragraph in `[IL-94]`) is what kept anyone from checking.

## IL-96 — A wrong guess that writes state makes itself permanent, and the write is what keeps it winning

`resolveRunDir` picked "the newest non-terminal run under cwd" whenever `PIPELINE_RUN_DIR` was absent. That is correct while exactly one pipeline run is in flight, and this project runs several concurrently as standard practice. Two symptoms were reported from a downstream project (#62): run directories whose `events.jsonl` had accumulated commits from three unrelated worktrees, and runs whose issues had been closed hours earlier still stamped `status: "interrupted"` days later, so the session-start hook kept warning about work that was finished.

The second one is the interesting half, because it is not simply a wrong guess — it is a wrong guess that feeds itself. `session-end` resolved a run it did not own, saw a non-`clean` status, and wrote `interrupted`. That write is what makes the run non-terminal, so the run kept qualifying for the same fallback, so the next unrelated session's `session-end` found it again. Nothing in the loop degrades; a single misattribution at any point pins the run permanently, and the only exit is a human running `close-run` by hand against a run they may have had nothing to do with.

The fix is not a better heuristic. The material distinction turned out to be between **reading** a run and **writing** to one, and the two want opposite defaults. E1's working-directory gate has to resolve runs it does *not* own — its foreign-session branch exists precisely to warn a bystander that this checkout belongs to somebody else's worktree — so scoping resolution to the caller's session broke that gate the moment it was tried, and the suite caught it. Bookkeeping wants the opposite: never write to another session's run, and mark a write as a guess when ownership is unknown. So there are now two resolutions off the same scan, and modules choose by what they are about to do.

The generalizable rule is about which operations may act on a guess. A read that guesses wrong is wrong once, at a known time, and the next read re-derives it. A write that guesses wrong changes the input to every future read, so its error compounds and its cause is no longer visible in the data it produced — by the time the reported runs were examined, nothing in `run-state.json` distinguished "interrupted by its own session" from "stamped by a passer-by." Before letting a fallback path write, ask whether the write is one of that path's own future inputs; if it is, the failure mode is not an incorrect value but a latch.

One thing deliberately not done: ownership is only stamped by `record-worktree`, so a run that never provisions a worktree stays unowned and its events still resolve via the guess. Claiming such a run for whichever session touches it first was considered and rejected — the first hook event is usually but not reliably the owner's, and a wrong claim would be the same latch with an extra step. Unowned runs are written to, and tagged `attribution: "fallback"` so a contaminated log stays filterable after the fact.

## IL-97 — A migration moved every reader of a key and left the writer behind, so the producer kept feeding a file nobody reads

v6.48.0 made `.claude-tweaks/policy.yml` the only config home. Five executable greps and roughly twenty prose sites moved from CLAUDE.md to `policy.yml`, each in a task whose own review passed. `/claude-tweaks:init`'s bootstrap Step 17b — which *writes* `work-links`, having probed the org's GitHub Issue capabilities — was never touched. It kept writing the probe result "beside the flag" in CLAUDE.md.

The result is a silent capability downgrade on every newly bootstrapped project. An org with sub-issues and dependencies enabled probes as `native`, that value is recorded where nothing looks, and `/dispatch`, `/wrap-up`, `/visualize`, and `/specify` all grep `policy.yml`, find nothing, and fall back to `body-text`. Parent links land as body-text task lists instead of sub-issue relationships. Nothing errors. Worse, the next `/claude-tweaks:init --update` flags the key `/init` had just written as Config Home Drift and offers to move it — the skill fighting its own output on every cycle, which is the one symptom a user might eventually notice.

Three things made it invisible to every check that ran. The plan's own out-of-scope list named `step-17-work-record-backend.md` as deliberately excluded *because it writes `work-backend`*, which genuinely does stay in CLAUDE.md — and nobody noticed the same file writes `work-links` fifty lines further down, under a heading that says "beside the flag" rather than naming a file. The migration's verification greps were keyed on reads: they searched for prose claiming a key *lives* in CLAUDE.md, and a write instruction phrased as "beside the flag" contains neither the key's home nor the word CLAUDE.md near it. And the file's own summary row, in `init/summary-templates.md`, *was* updated by the migration — so the summary asserted the new behavior while the procedure it summarized performed the old one, and the two never appear in the same diff.

The generalizable rule extends `[IL-04]` from output *shape* to output *location*. `[IL-04]` says to check that a producer's output carries every field its consumer reads; this says to check that it still carries them to the place the consumer looks. When a change moves where a value is read from, the writer is not an adjacent concern to sweep afterwards — it is the other half of the same edit, and a reader-keyed audit is structurally incapable of finding it, because the writer's defect is that it mentions the new location nowhere at all (`[IL-15]`).

Caught by the whole-branch review, which is the only pass positioned to catch it: the writer and its readers are in different files, and every task's diff was self-consistent. It was caught *after* the release, because the plan sequenced the version bump and push into its final task rather than behind the review — so a Critical that should have been prevented became v6.48.1 instead. That ordering is now stated in the Releasing section: the whole-branch review gates the bump.

## IL-98 — The version pre-check enumerates three sources and the collisions all came from the fourth

One feature hit the same version collision three times in a single session. Its branch point was already a commit reading "Merge origin/main and renumber to 6.48.0 — main shipped past the claimed version," so the first collision predates the session entirely. During the session, `origin/main` shipped its own, different v6.48.0 plus a v6.48.1, so the renumbered release collided again. And while the release for the session's own work was being cut, a concurrent session landed a bump to v6.49.0 on local `main` — the number that had just been assigned to the renumbered release, chosen minutes earlier.

The Releasing section's pre-check names three places to look before claiming a number: `origin/main`'s manifest history, every sibling worktree branch, and unexecuted plans under `docs/superpowers/plans/`. All three collisions came from a fourth: **unpushed commits on local `main`**. Local `main` was 49 commits ahead of `origin/main` at the start of the session and gained four more during it. A bump sitting there is invisible to `git log origin/main`, is on no sibling *branch* (it is on `main` itself), and is in no plan because it has already executed.

The near-miss is the instructive part. The third collision resolved cleanly only because the concurrent session had independently picked the same renumber — both chose v6.49.0 for the same feature, so the merge produced a textual conflict in one file and identical content on both sides. Had they picked differently, the two v6.49.0 entries would have merged with **no conflict at all**: `plugin.json` resolves to the same string either way, and two CHANGELOG entries for different versions do not overlap. The collision would have surfaced only as two features claiming one number, discoverable by reading, which is exactly the failure mode the Releasing section already warns about in prose and which the pre-check was written to prevent.

The generalizable rule is about what an enumerated check is blind to by construction. A list of places to look is a claim that the list is complete, and the item most likely to be missing is the one that is neither remote nor a branch nor a plan — the local default branch, which every other check treats as the baseline rather than as a candidate. The check reads `origin/main` because that is where releases land, and `main` because that is where work starts; it never occurred to it that those are different refs. Where a check enumerates sources, the question to ask is not "is each source correct" but "what kind of source is absent from the categories" — here, *already-executed-but-unpublished*, a state with no category at all.

Not fixed by adding a fourth grep alone. The deeper property is that a version number cannot be safely reserved by any check while an unpublished bump can exist anywhere; the check narrows the window, it does not close it. What closes it is publishing the bump promptly, which is why the Releasing section already pairs the bump with an immediate push of both repos.

**The renumber leaves an orphan the coverage gate later reads as a skipped append.** A second failure surfaced hours after the push, from the same root cause. `tests/changelog-coverage.test.js` compares the versions a git walk can see in `origin/main`'s manifest history against `docs/shipped-versions.tsv`, and its own comment states the premise: "The walk seeing one the record does NOT hold means a release skipped the append." A renumber violates that premise. v6.46.0 was claimed correctly — bump, changelog entry, and record line together in `707c89c2` — then renumbered twice as it kept colliding, and each renumber moved the entry and the record line to the new number. What it could not move is the commit itself, which still carries `"version": "6.46.0"`. The moment that branch's history became reachable from `origin/main`, the walk found a manifest version with no entry and no record line, and reported it as a forgotten append.

So the gate cannot distinguish "a release skipped its append" from "a version was renumbered before it shipped," because both leave exactly the same trace: a manifest commit in history with no corresponding record.

**Two sessions diagnosed this differently, and the better-evidenced one won.** One read the manifest commit as an orphan left by the renumber and wrote a retirement entry declaring the number burned. The other checked what `main`'s tip actually held and found that v6.46.0 *did* reach it, across two commits — the entry and the record row shipped in `707c89c2` and were **lost in a later merge**, not moved by the renumber. That is a materially different failure: not an orphan needing retirement, but a real release whose documentation a merge deleted. It restored `707c89c2`'s text verbatim with a `release` source token. The retirement entry was withdrawn in favour of it.

The general rule has two halves. A renumber is not complete when the new number is consistent everywhere — the old number remains in history as a manifest state, and every check that reconstructs releases from history will keep finding it. But before retiring such a number, establish whether it ever reached `main`'s tip: if it did, the honest record is the original entry restored, and treating it as burned writes a false claim into the file that exists to be the authority. The cheap check — what did `main` point at, and when — distinguishes the two, and neither the gate nor the diff can do it for you.

## IL-99 — Two branches raised the same counter to the same value, so it merged cleanly at the wrong one

`bin/lib/skill-audit/tests/anti-patterns.test.js` asserts a total row count across every skill's Anti-Patterns table, with a comment block recording each change that moved it. Two branches added rows concurrently. One added two rows for the supervised trust table; the other added two rows retiring design-wrapper's dispatch tables. Both started from 354, both wrote `assert.strictEqual(total, 356)`, and both appended a provenance paragraph explaining their own `+2`.

Merging them produced a conflict — but only in the *comments*. The assertion line was textually identical on both sides, so git resolved it silently. The result was a tree containing four new rows and an assertion demanding 356, which is wrong by exactly the other branch's contribution. The comment block, meanwhile, conflicted precisely because each side wrote different prose, so the one artifact that *did* stop for a human was the documentation, while the executable claim it documents slipped through.

The suite catches this, which is the only reason it was noticed at all. That is worth stating plainly: the check that fails is the same check whose expected value is wrong, and the tempting fix is to make the number match reality by reading the failure message. Here the failure message says 358 and 358 is correct — but it would say the same thing if a genuine regression had added two rows nobody intended, and the number would be equally "confirmed" by pasting it in. The resolution has to establish the count independently (run the parser, count the `+|` lines in each side's own diff) and only then write it down. The rule against tuning data until a check goes green (`[IL-95]`) applies with extra force when the data *is* the check's expectation.

The generalizable property: a counter, cardinality, or checksum that both sides move **to the same value from the same base** is invisible to a three-way merge, because textual identity is all the merge can see. Semantic conflict and textual conflict come apart exactly here, and they come apart in the direction that produces silence. Any invariant of the form "this number must equal the size of a set that multiple branches append to" is one of these, and the merge is when it breaks — not the edit. When merging a branch that touched such a number, recompute it rather than reading it.

## IL-100 — A behavior observed on every available run was promoted to a guarantee, and the code gated it on something unrelated

#164 reported that the routine-template build diagnostic reads `${CLAUDE_PLUGIN_ROOT}`, which is unset in the cloud Routine sandbox. It proposed a specific replacement: use the claude-tweaks SessionStart hook's own logged plugin path, on the evidence that it had worked in the observed firings. The evidence was real and correctly transcribed — four separate live Routine runs, four transcripts, each quoted verbatim in the issue. One of them says outright that it "located via the hook's own logged path."

The inference was still wrong. `bin/lib/hooks/session-start.js` emits that path inside `if (stale.length)` — the branch that reports unfinished pipeline runs under `.claude-tweaks/pipelines/`. A sandbox whose run directory is clean produces no such line at all. The four runs saw it because that project happened to be carrying unfinished runs on that day, which is a fact about the project's state and not about the environment. Adopting it as *the* fallback would have replaced one nondeterministic diagnostic with another, in a fix whose entire purpose was removing the nondeterminism — and it would have done so while looking better evidenced than what it replaced, because it came with four citations.

What makes this its own failure rather than an instance of `[IL-71]`: that rule says an issue's suggested fix was written against a snapshot and may be stale, and its remedy is to measure the suggestion against the live files. Measuring here **confirms** the suggestion. The hook does log the path; the transcripts do show it working; nothing about the issue is out of date. The observation survives every check aimed at accuracy, because the observation is accurate. The defect is one level up, in the step from "held in every run I have" to "holds" — and the only thing that catches it is reading what the emitting code *conditions* on, which no amount of re-reading the evidence will surface.

Sample size makes it worse rather than better. One supporting run invites a check; four make the property feel like a property of the environment, and the more uniform the evidence the less anyone looks for the branch. The generalizable form: when a fix is justified by observed behavior rather than by a stated contract, find the code that emits it and read its guard. If the behavior sits behind a condition unrelated to the thing being fixed, it is a correlation in the sample, and the correct move is to keep it as the strongest rung of a ladder that still terminates without it — which is what shipped.

## IL-101 — One allowlist answered two different questions, and the second answer authorized the wrong thing

`bin/lib/issues/provenance.js` classifies a work record's origin into four `kind` values: `producer` (filed by a named machine producer via a `by:*` label), `side-effect` (filed as a byproduct, recorded as an `Origin:` body line), `human` (neither — a person filed it), and `unstructured` (the classifier could not reduce the record to a class at all).

Phase 3 of the earned-autonomy work added `bin/lib/issues/autonomy.js`, which decides whether a class's trust verdict may authorize an agent to file records already marked `ready`. It needed to reject `unstructured`, since a bucket whose only shared property is that nobody knows what is in it has no class to earn trust for. The first attempt did that with a denylist naming `unstructured`; review caught that a denylist grants to every kind it has not been taught, including a case-variant `'PRODUCER'` and an empty string, and it became an allowlist: `GRADABLE_KINDS = {producer, side-effect, human}`.

That allowlist is correct — for the question it was named after. All three *are* gradable: the trust table computes a meaningful verdict for each, and "how did human-filed work turn out" is a real and useful measurement. The defect is that the permission check then used the same set to answer a second, different question: **may this class authorize an agent's filing?** For `human`, the answer is no, and not marginally so. Born-`ready` authorizes an agent to file spec-shaped without passing the shaping skill. A human-filed class has no agent filing in it at all, so granting on its verdict licenses agent filings using evidence that humans generated. The two questions share three of four answers, which is exactly why one set looked like it served both.

The failure was not hypothetical and not small. `human:human` is this repo's largest provenance — 90 of 122 closed records across its two risk bands, against 27 for the only machine producer with any volume. It is therefore the first cell that will clear both evidence floors, so a governor shipped with this set would have fired on `human` first, and on the weakest justification available to it. A second-order effect made it worse: because the human branch fell through rather than returning, `unattended` plus its opt-in produced `bornAuthorized: true` with `bornReady: false` — a state the contract has no meaning for, reachable only for the one kind that should have been excluded.

The generalizable rule: when an existing set is reused as the gate for a second decision, restate the membership criterion as a sentence and check it against the new question. Here the set means "this is a real class"; the new question needed "an agent filed this." A set whose name still fits the new use (`GRADABLE_KINDS` reads fine in a permission check) is the dangerous case, because nothing in the code reads wrong. The fix is a second, separately-named set — `AGENT_FILED_KINDS` — not a tightening of the first, since both questions remain live and their answers genuinely differ.

Two further observations. First, the module already carried a deliberate redundant check: it re-denies `unstructured` even though `trust.js` pins that kind's verdict independently, on the stated reasoning that neither module should be able to open the bucket alone. That instinct was right and was applied to the kind that was already safe, while the kind that was not safe got no check at all — defense in depth aimed at the threat that had already been modeled. Second, this was invisible to every task-scoped review: the module's own tests passed, its contract file described the intended "agent-filed" scoping in prose, and the code implementing a *different* scoping sat in another file. Only the whole-branch pass, which read the prose and the module against each other, could see that the two disagreed.

## IL-102 — An instruction was written three times into prose whose mechanism, a few lines below, never carried it

The v6.58.0 `/challenge` reshape added a step to `/claude-tweaks:specify`: on a `solution-baked` framing verdict, stamp a `framing:baked` marker. The instruction was written into `shaping-mode.md` correctly. Nothing stamped anything.

`shaping-mode.md`'s `### Compose-then-write-once` section holds the actual mechanisms — a `gh issue edit` block listing every `--add-label` flag, and a paragraph naming which `facets.*` keys `writeRecord` fills. Neither mentioned the new marker. The prose said "stamp the label"; the only thing that stamps labels did not. The implementer caught this itself and returned `DONE_WITH_CONCERNS` rather than shipping silently.

The instructive part is what happened next. Fixing it, the controller wrote that `record-creation.md` needed no equivalent edit because its `gh issue create` path "already covers it." That claim was never checked against the file, which says in its own words that the payload emits four labels **"and nothing else"** — so the leaf path was inert in exactly the same way, now by explicit instruction not to look. The task reviewer overrode it with line numbers. Then, closing *that*, a third instance was found by the whole-branch review: `local-store.js`'s `serializeFrontmatter` and `parseFrontmatterLines` had no `framing:` handling at all, so a caller following the `facets.framing: true` convention the two skill files now documented would have had the value silently dropped on write. It surfaced only because the follow-up task's brief said "read `local-store.js` before deciding" instead of "add the default."

Three instances, one shape: prose that instructs, and a concrete mechanism sitting a few lines or one file away that was never updated to carry it. Two of the three were introduced *while fixing the first* — the fix's attention was on the sentence, and the sentence was already right.

Why review misses it: the prose and the mechanism are usually adjacent enough to appear in the same diff hunk, so a reviewer reading the diff sees a coherent instruction and a plausible command block and has no reason to cross-check them. Nothing is contradictory; something is merely absent. `[IL-02]` names the cross-file version of this (a promise with no consumer); this is the same hazard at close range, where proximity is what disguises it.

The generalizable rule: when adding an instruction to a procedure, find the nearest thing that *executes* — a command block, a serializer, a payload builder, a facets list — and confirm it carries the new item. "The step above says to do it" is not a mechanism. And when a plan or a fix instruction asserts that some other path "already handles this," treat that as a claim requiring a grep, never a recollection — `[IL-24]` for the design-doc form of the same error.

## IL-103 — A sibling's idiom was adopted without checking whether its common case matched

`skills/specify/shaping-mode.md` documents several labels its `gh issue edit` block applies, each with an omit rule: drop `--add-label "risk:{tier}"` and its `effort:`/`ceremony:` siblings *for whichever family was already stamped*. Inclusion is the sensible default there, because a record usually needs the label and omission is the exception.

Fixing `[IL-102]`'s first instance, the controller instructed the implementer to follow that idiom for `framing:baked`. The implementer did, faithfully: it put `--add-label "framing:baked"` unconditionally into the command block and described the conditionality in a trailing `#` comment. A comment inside a bash block is not a conditional, so the shipped instruction stamped the marker on **every** record.

That is strictly worse than the bug it replaced. `framing:baked` means *this record's stated problem names a solution that was never traded off*. Absence is the clean state and, on real backlogs, the common one. A marker applied universally does not merely misreport — it destroys the signal the `/backlog refine` column exists to carry, and does so while looking correct in every per-file review, because it faithfully matches the neighbouring rows.

The idiom was not wrong; importing it was. `risk`/`effort`/`ceremony` are tiered facets a record almost always carries, so defaulting the flag *present* and documenting when to omit is right for them. `framing:baked` is a presence-only marker whose common case is absence, so the default had to be inverted: show the block without the flag, and document when to add it. Two conventions that look identical on the page encode opposite assumptions about which case is normal.

The generalizable rule: before reusing a neighbouring convention, state its common case out loud and check that yours matches. Where they differ, the shape must invert — the default in an example block is not cosmetic, it is the instruction most readers will follow unchanged. This is the prose analogue of `[IL-101]`'s reused-set hazard: there, one set answered two questions whose answers differed; here, one idiom served two fields whose default cases differed. In both, nothing reads wrong, which is what makes them survive review.

## IL-104 — Committed project state was read from the working checkout, which had no way to know it was stale

`.claude-tweaks/routines/*.yml` is a committed artifact — `.gitignore` carves it out of the `.claude-tweaks/` rule with a comment saying exactly that. All three modes of `/claude-tweaks:routine` nevertheless read it straight from the working checkout with no fetch. On a checkout behind its integration branch, every one of them therefore described a tree that was not the project's.

The reported run (#190) had all six of a project's routines showing as needing an update: four at template v2 against a v4 template, two at v3 against v5, none carrying `branch:`, one schedule mismatch, one filename/name mismatch. The integration branch already had all six current, with `branch:` present and the rename done. Nothing was wrong except where the skill was looking.

What makes this worth an entry is not the misreport — it is that **nothing in the checkout could reveal the problem**. `git status` printed a clean tree and `## main...origin/main` with no behind-marker, because ahead/behind is computed against `refs/remotes/origin/main`, a local cache that only a fetch updates. The checkout was 119 commits behind. `git branch -vv` reads the same stale ref and is equally blind. The one command a person would reach for to check is the one that cannot answer.

The stale read then fed writes. UPDATE's confirm gate asked the user to adjudicate drift that did not exist; Step 6 issued a live `RemoteTrigger update` assembled from the stale record, and Step 7 rewrote the record from the same input, staging a real regression for commit. Worst was CREATE Step 3: a record committed upstream is simply *absent* from a stale checkout, so the idempotency check routed to CREATE and minted a duplicate live routine — the outcome the skill's own Anti-Patterns table forbids, and one `RemoteTrigger` has no delete action to undo.

A second instance was found in the same session while fixing the first: `/claude-tweaks:init`'s Update Mode skipped its entire Routine Drift check when `.claude-tweaks/routines/` did not exist **locally** — so on a stale checkout it skipped the project that most needed it, and two sibling checks hung off that gate by reference.

The near-miss inside the fix is worth recording too. The first draft resolved the comparison branch with the full `_shared/integration-branch.md` ladder. Ranks 1-2 (`--branch`, `template.branch`) name the branch a routine *audits*, which is a different question from where its records are committed — using them would have compared records against the wrong tree, reintroducing the same defect inside its own fix. Nothing in the suite would have failed; it was caught by reasoning, and is now filed as #193.

The generalizable rule: reading a committed artifact from the working tree is only correct once the checkout is known to be current, and no local git command establishes that. Fetch first, or read the artifact from the ref directly. The corollary that makes it safe: gate any resulting stop on a *verified* comparison, so a failed fetch degrades to the old behavior instead of blocking an offline session — unknown is not stale.

## IL-105 — Five checks reported success while the thing they checked was false

During the 6.60.0 wrap-up-report build, five separate checks reported success while the thing they checked was false. (1) The originating incident: a `/tidy` sweep used an unquoted `--include=*.md`, zsh expanded it, grep never ran, and the run read as a clean zero-result sweep. (2) The plan verified a newly-added test glob with `grep -c "reflog"` — a *failing* test prints its name too, so the check was green either way, and it guarded a step that deliberately broke the classifier. (3) `{base}`, the one value the State block's command requires, was undefined everywhere; four mechanical checks (four parts present, D-codes contained, byte ceiling, preserved-behavior tail) all passed on a feature that could not run. (4) An `[IL-87]` deleted-line sweep silently skipped two lines that began with `-`, which grep parsed as options — it would have reported "clean" having never examined part of its input. (5) The fix wave introduced `{default-branch}`, resolved from GitHub's default-branch pointer; a reviewer examined it and judged it "correct either way," which was true of the *command* and wrong about the *branch it named*. Only the full suite's `integration-branch-conformance` test caught it, and every agent had been told to skip that suite for its 25-minute runtime.

The common shape: each check's green and its red were indistinguishable, so passing carried no information. Four of the five were introduced while fixing one of the others — a check written under time pressure to close out a prior finding is exactly the check least likely to have had its own failure mode considered, because the attention in the moment is on the thing it guards, not on the guard itself.

The generalizable rule: before trusting a check, name what its red output would look like and confirm the check can actually produce it — a count-based grep that a failure also satisfies, a suite that never loaded the file it means to test, and a sweep that silently drops part of its input all report identically whether or not the thing they check is true. A check that cannot fail is not a stricter check; it is no check, wearing one's shape.

**Extension — the mechanism, for content assertions (6.65.0, records #176/#177).** "Name what its red would look like" is the principle; for the most common check type in this repo it has a concrete procedure, and eleven instances in one run showed that naming it is not enough on its own. Across four plans, eleven test assertions over markdown prose had to be re-anchored after failing a discrimination check — every one authored by the plan author, not the implementers. The cause is structural: a regex written immediately after the prose it guards matches *that* prose by construction, so a pre-dispatch check that the regex matches is guaranteed green and carries no information.

Two sub-classes appeared, and the obvious defence catches only one. **Over-broad token match:** `/candidate/i` matched three unrelated places; `/drop/i` matched eleven and still passed when the guarded table row was inverted to "Drop it silently." — the exact opposite of the requirement; `/read-only/i` survived flipping "the agents are read-only" to "may write", because "bounded read-only commands" later in the same paragraph kept it green; `/BLOCKED/` survived deleting the entire four-value status line it existed to guard. **Over-wide proximity window:** `/node_modules[\s\S]{0,200}denied/i` — the real span was 45 characters, and 200 still matched prose inverted to "fully supported… nothing has ever been denied".

A *presence* check (does the regex match the planned prose?) cannot catch either class, because both match by construction. The check that works is **inversion**: negate the planned prose and assert the regex *fails*. Introduced mid-run, it caught two more before dispatch on its first outing — including `/checked-at/`, which survived prose reading "we deliberately omit any checked-at stamping" — and it is what surfaced the over-wide-window class at all. Note also that a multi-assertion test short-circuits: inverting several claims at once only proves whichever assertion fails first, so inversions must be run one claim at a time.

## IL-106 — A worktree was created three times from a base older than the last fetch

Across one session on 2026-08-07/08, `EnterWorktree` produced a worktree whose base was behind `origin/main` three separate times. The first two were caught only by `tests/changelog-coverage.test.js`, which failed with "1 version(s) shipped on origin/main with no CHANGELOG entry" — the branch had been cut before that session's *own* previous release, so its `CHANGELOG.md` and `docs/shipped-versions.tsv` were missing an entry the session itself had written an hour earlier.

The third occurrence is the informative one. Having drawn the lesson "fetch before `EnterWorktree`," the session did exactly that: `git fetch origin main` reported `origin/main` at `b7ceaeda` / 6.64.2, and `EnterWorktree` immediately afterward produced a worktree at `0816fe0d` / 6.60.0 — four releases behind the ref that had just been fetched into the same repository. So the base is not "whatever `origin/main` said at creation time," and fetching first does not fix it. The remedy that works is unconditional and after the fact: `git merge origin/main` inside the new worktree before doing anything else, every time.

Why it stayed invisible: nothing about a stale base looks wrong. The worktree has a clean tree, a plausible `main`-derived history, and a passing test suite — the base is only wrong *relative to work that landed since*, which is invisible from inside. On a repo with one active session it would rarely matter; this repo runs six or more concurrently and ships several versions an hour, so "behind by four releases" is a normal amount of drift for a worktree created minutes ago.

The generalizable rule: treat a newly created worktree's base as unknown rather than current, and merge the integration branch into it as the first action — a fetch beforehand is not equivalent, because the worktree's base is not resolved from the ref the fetch updated.

Independently reported again in #1464 (`EnterWorktree`'s `fresh` baseRef branching from a stale ref across 4 consecutive calls in one session) — same pattern, same remedy; see that record for the defensive-coverage hardening it drove around the plugin's own `checkWorktreeStaleness` backstop.

## IL-107 — A finished nine-task implementation was nearly redone from scratch

A session picked up record #185 (worktree reaping), read its plan, created a worktree, wrote the SDD ledger, and began the pre-flight scan before discovering — incidentally, in `git worktree list --porcelain` output gathered for an unrelated safety question — a sibling worktree named `worktree-reaping-impl` holding eleven commits that implemented all nine of the plan's tasks, including a fix its own review had already caught. The owning session (pid 30559) was still alive, 15h22m in. Its branch was unpushed and unmerged, so `origin/main`, the record's labels, and the claim refs all showed the work as untouched.

Every check the project already prescribes came back clean: no branch matched `*114*`-style patterns for the record, `git ls-remote origin "refs/claims/*"` returned nothing, the record carried no `bot:in-progress`, and no commit on any ref mentioned it. The work was invisible to all of them precisely because it was *in progress* — claims are taken by `/dispatch`, and a session working a record by hand takes none.

What made it visible was the worktree list, and specifically the lock line: `EnterWorktree` locks each worktree with a reason carrying the owning pid (`locked claude session <name> (pid NNNNN start ...)`), so a live sibling is detectable by parsing that pid and checking it with `ps`. That is the same mechanism `bin/lib/hooks/worktree-reap.js` uses to decide whether a worktree is orphaned — the signal already existed and was already trusted for a destructive decision; it simply was not being consulted before starting work.

The generalizable rule: before starting work on a record, enumerate worktrees and their lock-owning pids, not just branches, claims, and labels. Unpushed work by a live session is invisible to every remote-facing signal, and the more concurrent sessions a repo runs, the more likely the record you just picked is already someone's half-finished branch.

## IL-108 — Four of four implementer subagents stalled at a background wait, uncommitted

During the 6.65.0 build (records #176/#177/#106), every one of four implementer dispatches stopped without committing. Each brief said: make the edits, run the focused tests, run `npm test`, then commit. Each started the full suite, parked waiting for its completion notification, and reported back having done everything except the commit — leaving work **staged or merely modified** in a shared worktree. The controller verified each diff and finished the commit itself all four times.

The cause is dispatch *shape*, not agent quality. A multi-minute wait placed between an implementer's last edit and its commit obligation hands it a natural stopping point that is not "done", and the harness's own completion-notification model makes stopping there look correct. Adding an explicit "do not park on a background wait; poll it yourself" instruction to the fourth brief changed nothing.

Two second-order costs followed. Because several suites then ran concurrently — the controller's plus the implementers' — one test failure could not be attributed: `tests/install-statusline-wrapper.test.js` carries a 5000 ms `spawnSync` timeout on a nested double Node spawn and fails intermittently under the suite's own parallelism. It took three separate measurements to establish it was neither load contention from the controller's runs nor the new tests, and two intermediate conclusions were wrong. And one controller brief mistakenly listed four files to stage when the fix touched five; only the stall prevented the fifth from being silently dropped.

The generalizable rule: keep slow, shared-resource work in the controller. An implementer commits after its focused tests; the full suite runs centrally afterward. This is the same family as `[IL-43]` (parallel implementers race on one index) and `[IL-51]` (dispatch edit-only when fan-out is wide) — in each case the fix is to move the contended step up to the coordinator rather than to instruct the subagent harder.

## IL-109 — A long multi-record run decayed its own records' premises

The 6.65.0 run took seven records in one `/claude-tweaks:flow` invocation. `origin/main` shipped **eleven times** while it ran (6.50.1 → 6.64.2), requiring ten rebases. Two records' premises expired mid-run as a direct result, and a third's already-reviewed output was falsified after it passed review.

Record #178 was destroyed outright: upstream reshaped `/claude-tweaks:challenge` into a `framing-check` component plus a `--lens` escape hatch, deleting the Brainstorming Brief that #178 existed entirely to add a `falsified` value to. A grep of `skills/challenge/SKILL.md` for every anchor the record cited — `Key Assumptions Surfaced`, `Open Questions for Brainstorming`, `Brainstorming Brief`, `Save the Brief`, `verified/unverified` — returned zero. It was closed as obsolete. Record #179 needed an amendment posted to it: its first deliverable names the `/challenge → verify → brainstorming` edge that upstream removed from two files, so implemented as written it would have re-established a deleted edge across five; its README premise was already false (`grep -c research README.md` → 0); and all four of its `docs/skill-graph.md` anchors had shifted. Record #176's shipped prose asserted a lifecycle that no longer existed and had to be re-grounded in a later commit.

The records built first held their premises. The damage was strictly a function of how long each record waited between shaping and building — which makes batch size the lever, not record quality.

The generalizable rule: in a repository with concurrent sessions shipping, a work record's factual claims have a shelf life measured in hours. Re-verify each record's Current State against the live tree immediately before *its own* build, not once at run start — that per-record re-check is what caught #178 and #179 before either wasted a build. `[IL-20]`'s "check divergence periodically" is necessary but not sufficient here: the hazard is not only merge conflict, it is that a record's own stated facts stop being true while it waits its turn.

## IL-110 — A count borrowed from an adjacent set stood in for one that could not be enumerated

On 2026-08-08 a session researching claude.ai Routines called `RemoteTrigger {action: "list"}` to inventory live routines. The response returned roughly nineteen triggers with `has_more: true` and a `next_cursor` set — and the tool exposes no cursor parameter, so later pages were unreachable. That limitation was already documented, in `routine/create-and-update.md` CREATE Step 4 source (b).

Two routines on that page were health sweeps: `memenu-app-code-health-daily` and `memenu-app-harness-health-daily`. The session then wrote, twice, that "two of the four live health-sweep routines" carry a `notifications` setting and "the other two notify nobody."

The "four" came from nowhere in the measurement. It was borrowed from an adjacent set — the four health-sweep *skills* (`code-health`, `harness-health`, `journey-health`, `docs-health`) — and reused as a count of *routines*. The two sets are not in correspondence: the plugin ships **six** routine templates, adding `dispatch` and `tidy`; this repository had **zero** instantiated routine records; and every routine observed belonged to a different project's account. The true count remains unknown, because the response paginates.

The first instance was caught before filing. The second reached a filed issue body (#210) and was corrected only during `/claude-tweaks:specify` shaping, which rewrites Current State and so forced a re-read of the claim. The `## Original request` block preserves the wrong version verbatim, per shaping's own rule.

What makes this one hard to catch is that the borrowed number is plausible, adjacent, and internally consistent with a real set. It is not a guess or a typo — it survives a re-read because it corresponds to something true, just not to the thing being counted. The pagination then guarantees no check can refute it: there is no query that returns "four is wrong."

The generalizable rule: when a lookup cannot enumerate its domain, state no total for that domain at all — report what was observed and say the rest is unreachable. And never let a neighbouring set's cardinality supply a number the measurement did not produce. `[IL-67]` covers the pagination limitation itself and its mitigation; this is the reporting failure sitting on top of it. `[IL-40]` covers a restated cardinality drifting out of date; this one was never right to begin with.

## IL-111 — A mitigation created a worse instance of the hazard it was written to prevent, and its own "resolved" note stopped anyone rechecking

During 6.69.0's build, a task review surfaced a `⚠️ Cannot verify from diff` item: the reviewer could not tell whether a later task would pass `probeBranches` the right `--integration-branch` value. The controller resolved it, correctly, by reading the consumer — the wiring existed. But it also noticed a real adjacent hazard: `bin/residue.js` defaults that flag to the literal `origin/main`, which is right for this repo and wrong for any adopter whose integration branch differs.

The remedy it wrote into the ledger, and then into `skills/wrap-up/residue-sweep.md` in bold, was: never rely on the default — resolve the value via `skills/_shared/integration-branch.md`'s canonical ladder and pass it explicitly.

That ladder yields a **bare** branch name at every one of its ranks — `main`, `dev` — because every other consumer in the repo wants one: `review-console.md` and `dispatch/settle-and-merge.md` compare it against `git branch --show-current`, `summary-template.md` feeds it to `git merge-base`. `probeBranches` was the one consumer that needed a remote-tracking ref: it derives `remotePrefix` from `integrationBranch.split('/')[0]`, so `main` becomes the prefix `main/`, which matches no remote-tracking ref that `git branch -r --merged` can return.

Net effect: following the procedure's own mandated instruction made the probe return `{ran: true, findings: []}` — "ran and found nothing" — on every invocation, forever. "A merged remote branch is still alive" was the first of the five items in the report that motivated the whole feature, and the design's scorecard claimed it as one of only two fully automatic outcomes.

The ledger entry recorded the hazard, the reasoning, and the remedy, and closed with "resolved by controller." Every later review read that as settled. The whole-branch review found it only because it re-derived the ladder's actual output rather than trusting the note, and confirmed it by execution: `origin/main` → 1 finding, `main` → 0, `dev` → 0. Every existing test hardcoded `origin/main`, so the suite was green throughout.

Two properties make this class hard. The mitigation is *correct about the hazard* — the default really is wrong for adopters — so re-reading it finds nothing to object to. And marking it resolved converts it from an open question into background, which is precisely the state in which nobody re-derives it. A hazard noticed and half-fixed is more dangerous than one never noticed, because the note reads as a check that already happened.

## IL-112 — A check reported a working fix as broken, and its red was believed because red is what a check is for

Verifying `[IL-111]`'s fix, the controller drove the shipped `probeBranches` with a stub runner and got `main` → 0 findings — the same result as before the fix. It began writing that up as "the fix did not work."

The stub was wrong. The fixed probe now issues **two** different git commands: `git config branch.<name>.remote` to resolve the remote, then `git branch -r --merged`. The stub returned the same branch-list string for every call, so the remote resolution consumed a multi-line branch dump as a remote name and produced a garbage prefix. Re-run with a stub that distinguished the two commands: `origin/main` → 1, `main` → 1, `dev` → 2. The fix was correct the whole time.

Cost was two commands here, because the claim was checked before being reported. The near-miss was larger: the next action would have been re-dispatching a finished task, and a second wrong verification could as easily have "confirmed" the false negative.

`[IL-105]` covers the mirror case — naming what red looks like before trusting green. This is the same discipline pointed the other way, and it is the harder half to remember, because a green check invites suspicion while a red one feels like the check doing its job. A failing check is equally a hypothesis: it asserts both that the code is broken *and* that the harness around it is sound. When a check fails on code you have reason to believe is correct, suspect the check first — especially when the change under test altered how many calls the code makes, or in what order.

## IL-113 — A permission was read as a mechanism, and the config that grants it was shipped as the fix

On 2026-08-08 a user reported that adding the claude-tweaks marketplace failed in a claude.ai/code cloud session. Two hypotheses were formed and both were wrong before any measurement: that the marketplace repository was private or malformed (it was public, its manifest valid, and a clean-config CLI `marketplace add` succeeded end to end), and that the Claude GitHub App's repository scoping blocked it (the App was already set to All repositories, and the docs state plainly that App installation "is not a session-level access control").

The third answer came from the docs and looked decisive: user-scoped `enabledPlugins` in `~/.claude/settings.json` does not reach a cloud sandbox, and the documented remedy is to declare plugins in the repo's own `.claude/settings.json`, which are "Installed at session start from the marketplace you declared." That declaration was committed and pushed. The session still reported `Unknown command: /claude-tweaks:version`.

Only then was the sandbox measured. Inside a live session whose clone demonstrably contained the declaration, with the environment's network access set to **Full**, and with `git clone` of the marketplace repository succeeding from inside the VM: `~/.claude/plugins/` did not exist at all — no `known_marketplaces.json`, no `marketplaces/`, no `cache/`. Every stated precondition held and the install had simply never run. The fix was a Setup script on the cloud *environment* running `claude plugin marketplace add` and `claude plugin install` explicitly. It worked on the next session, and on a second repository that received no repo change whatsoever — which is what isolated the environment, not the repository, as the operative variable.

Two failures compound here. The first is reading a permission as a mechanism: `enabledPlugins` says what a sandbox *may* load, and the prose "they only see plugins declared in …" is true as a necessary condition while reading naturally as a sufficient one. Nothing in the wording is false, which is why it survived being checked against the docs twice.

The second is scope. This plugin already shipped the correct mechanism — `/init` Step 14 generates `scripts/claude-cloud-setup.sh`, and `routine/guided-environment-creation.md` attaches it to an environment automatically. But that attachment only ever ran for environments it creates *for routines*. Interactive sessions use whichever environment is selected in the composer, typically a long-lived human-named one (`Default`, `General`) that no flow here had ever touched. So a project could be fully declared, fully scripted, and still get nothing — and this repository was worse off than its own consumers, having never run Step 14 on itself at all: no `scripts/`, no `## Cloud parity` section.

A third, smaller lesson: the cloud session's own agent reported "the plugin is loaded via `--plugin-dir ./` … which is why the skills are available" in the same turn whose command output showed three missing directories and an `Unknown command`. Its narrative contradicted its own evidence, and the evidence was right.

The generalizable rule: when config grants a capability, find the thing that *exercises* it before shipping the grant as the fix — and check that the exerciser covers every class of consumer, not just the class the feature was originally built for. `[IL-02]` covers a cross-file promise with no consumer; this is the same shape one level up, where the consumer exists but reaches only some of the cases. `[IL-100]` covers promoting an observation to a guarantee, which is what the "self-heals one session later" caveat did to users hitting this exact failure.

## IL-114 — A "render this, then call the tool" instruction had nothing checking that it had been rendered

A user reported that `/claude-tweaks:wrap-up`'s "Apply all" `AskUserQuestion` prompts weren't showing what "all" referred to. The batch table both `reflect/full-mode.md`'s Reflection Insights step and `wrap-up/skill-curation.md`'s Skill Updates step document rendering immediately before their `AskUserQuestion` call had not appeared anywhere in that run's transcript. Reading the actual skill files confirmed the documented procedure was correct on paper — render the table, then call the tool — and that this instruction had no mechanism binding the two together. Nothing checked, at the moment of the tool call, that the table had actually been emitted as visible text in that same response, so a run could skip straight to the tool call and no part of the contract would notice.

A second, sharper defect sat alongside it. `memory-curation.md` already stated, correctly, that a D4 memory write is "never auto-resolved regardless of mode" and requires its own per-item `M#` approval. But the same run's transcript showed three memory files written immediately after the Reflection Insights batch's "Apply all" answer — a different, differently-scoped decision (whether to *implement* an insight, not whether to *write* this specific memory file) — with no intervening per-item prompt at all. The approval gate the file itself declared mandatory was simply never reached; nothing forced the model to treat the two approvals as distinct.

The fix added an explicit self-check immediately before each `AskUserQuestion` call ("does this response already contain the table as literal rendered text?") and made the memory-write gate's scope explicit everywhere it could be misread ("this approval routes the insight to D4, it does not authorize writing the file — that write needs its own separate `M#` prompt"). A follow-up gap-detection pass during the same wrap-up found the identical unguarded "render table, then call `AskUserQuestion`" pattern in six more skill files (`build/architecture-alignment.md`, `review/step3-routing.md`, `specify/decomposition-mode.md`, `stories/coverage-report.md`, `visual-review/browser-review.md`, `visual-review/discover-mode.md`) — the same defect, never triggered in those flows only because no one had reported it yet.

This shares its shape with `[IL-102]`: an instruction was written correctly into prose, and the nearest thing that executes — here, the tool call itself — was never made to confirm the instruction had actually been followed. `[IL-102]`'s cases were a label-stamping step silently no-op'd by a missing serializer field, an authoring/wiring gap in a different file. This is the same gap one layer up, at the interaction boundary instead of the serialization one: pure narrative sequencing ("do A, then call tool B") is not enough discipline for an LLM executor to reliably follow at runtime, even when the instruction is unambiguous and sitting right there in the prompt. Naming the general rule once did not retire the specific ways it keeps recurring.

## IL-115 — A verify-and-repair loop's "nothing to compare against" guard also caught the case it was built to repair

On 2026-08-08, the first-ever cloud Routine firing on a freshly-created dedicated environment (`claude-tweaks: claude-tweaks`, provisioned earlier the same session) reported the plugin was not installed and, unprompted, attributed it to `[IL-113]`: the environment's Setup script field left unconfigured. Before acting on that diagnosis, the field was checked directly in the environment's own settings — it was already correctly populated with the generated `scripts/claude-cloud-setup.sh` invocation. The routine's stated root cause was wrong; more importantly, nothing available to it from inside the sandbox could have confirmed or ruled it out — the Setup script field is web-UI-only state, invisible to any tool a session has. It pattern-matched a familiar symptom against a documented incident's exact wording and reported the match as established fact.

The session's own "Initialized session" panel showed all four provisioning steps, including "Ran setup script," completed successfully — yet the plugin was still absent afterward. `scripts/claude-cloud-setup.sh`'s own verify-and-repair loop (added for `#129`) exists exactly to catch a script that reports success without actually landing the plugin: it reads the installed plugin's manifest off disk, compares it against the marketplace catalog's declared version, and reinstalls on a mismatch. Reading that loop's guard clause: `expected` (the catalog-declared version) falls back to the literal string `"unversioned"` whenever the catalog entry can't be resolved — a legitimate case, since `claude-plugins-official` genuinely declares no per-plugin version. The drift check was gated on `expected !== "unversioned"`, on the reasoning that "nothing to compare against" means "nothing to verify."

That reasoning conflated two different causes of the same value. A marketplace with no version field and a marketplace whose catalog file failed to resolve at all — plausible on a sandbox's first-ever cold run, before local caches exist — both produce `expected === "unversioned"`. The first is genuinely nothing to verify. The second is exactly the condition the loop was written to catch, and the guard clause suppressed it: `installed` resolved to `"none"` (nothing on disk), but with `expected` also `"unversioned"`, `drift` evaluated false, the loop logged "ok," and the script proceeded to install `agent-browser` and Chrome and exited 0 — successful by the platform's own accounting, with the one thing the whole script exists to install never having landed.

Fixed by making `installed === "none"` an unconditional drift signal, independent of whether a catalog version could be resolved: `const drift = installed === "none" || (expected !== "unversioned" && installed !== expected)`. Mirrored into both `skills/init/bootstrap/step-14-cloud-routine-parity.md`'s embedded template and the actual generated `scripts/claude-cloud-setup.sh` (regenerated by `/init`, not hand-maintained — a project that already ran `/init` needs to re-run it, or apply the same one-line change, to pick this up).

The generalizable rule: a repair loop's "nothing to compare against, so nothing to repair" guard is only safe when every path that produces that value is genuinely benign. Audit each one — a resolution *failure* and a legitimate *absence* can both degrade to the same sentinel, and a guard written for the second silently disables the loop for the first, which is usually the more consequential case. This is the same shape as `[IL-92]` (a fail-open branch's comment not covering every path that reaches it) pointed at a repair loop instead of an enforcement gate, and it compounds with `[IL-113]`: a cloud agent hit the exact symptom IL-113 describes, for a completely different reason, and had no way to tell the two apart from inside its own sandbox — which is precisely why the check needs to live in the script, not in an agent's post-hoc diagnosis.

The audit this rule calls for found a third path (`claude-tweaks` #860): #418's mirror change made the plugin's own marketplace entry a sha-pinned `git-subdir` source with no entry-level `version` field at all — a fourth way to legitimately have "nothing to compare against" that this drift check's `expected` variable still couldn't distinguish from a resolution failure, this time permanently rather than only on a cold first run. Caught during routine dev work rather than an observed firing, so it never became its own incident — resolved by teaching `expected` to resolve the pinned sha to a manifest version (`raw.githubusercontent.com` fetch, fail-open on any failure) before falling back to `"unversioned"`, applied identically to both copies this entry already names.

## IL-116 — A pipeline-run worktree was torn down directly, skipping the cleanup procedure that protects its own gitignored state

On 2026-08-08/09, closing out the specs 216/217/218 multi-spec `/flow` run, the branch-finish sequence (merge, push, worktree teardown) was executed as an ad hoc sequence of tool calls rather than by re-entering `/claude-tweaks:wrap-up`'s own Step 10 cleanup execution. `ExitWorktree` was called with `action: "remove", discard_changes: true` directly against the run's worktree, verified safe only by content-identity — `HEAD` matched `origin/main` (the `[IL-45]` check). That check is real but narrow: it verifies no *commits* are lost, and says nothing about gitignored working-tree state.

`wrap-up/cleanup-procedures-execution.md` Section C step 3.5 — the Transitional guard — exists precisely to copy a pre-anchoring run directory's gitignored `config.yml`, `decisions.md`, `events.jsonl`, and `staged/` out of the worktree before its removal, since step 4 (worktree removal) deletes them with no git history to recover from. That guard only runs as part of Section C's own ordered sequence, invoked from wrap-up Step 10 — calling `ExitWorktree` directly, outside that sequence, bypasses it entirely. The run's parent directory, `config.yml`, `decisions.md`, `manifest.yml`, and all nine `staged/*.md` proposal files across the run and its three per-spec subdirectories were permanently deleted. Every one of those documents had already been read and acted on before the loss — no decision was made blind — but one (a drafted D5 upstream gap-report body, correctly identified as out of `/claude-tweaks:feedback`'s scope and never filed) could no longer be handed to the user as a ready-to-file document, only reconstructed from conversation history.

`[IL-46]` already states the general principle — surface a gitignored scratch file's content before cleanup can destroy it. What it doesn't capture is the mechanism that actually caused this instance: the general reminder didn't fire because the failure was procedural, not perceptual — reaching for the individual worktree-teardown tool directly, as a shortcut once the pipeline's own per-spec wrap-ups had already run, instead of routing back through the one documented procedure that knows to run the guard first.

The generalizable rule: tearing down a pipeline-run's worktree is never just a worktree operation — it is one step inside `cleanup-procedures-execution.md` Section C's specific ordered sequence (carrier commit → branch-finish → transitional guard → worktree removal → branch delete), and calling the underlying tool (`ExitWorktree`, or raw `git worktree remove`) directly, even with every individual safety check it offers satisfied, skips every step of that sequence that isn't itself a safety check on the tool being called.

## IL-117 — The Setup-script field measured not reaching scheduled Routine sandboxes

On 2026-08-09, three separate fresh Routine containers were checked directly rather than trusted from the platform's own "Completed" status: the day's 07:08 scheduled firing, a 07:57 re-fire, and a 09:46 manual run. All three started from an environment whose Setup-script field was already correctly populated, matching the `[IL-113]` remedy verbatim. All three produced zero plugin effects — `~/.claude/plugins/` did not exist, and every plugin command reported `Unknown command`. The same script, run in-session from a clone of the repository checkout, worked without incident. This does not contradict `[IL-113]`'s own measurement: that entry verified the field fixed *interactive* sessions on two repositories, and that remains true. What changed here is the sandbox type under test — scheduled Routine containers, never previously measured directly.

The three firings separate two causes that a single "it doesn't work in Routines" symptom conflates. Cause 1, delivery: the field's effects were absent from the container despite the field being populated, and nothing available from outside the container could say why, because the shipped invocation was `... 2>/dev/null || true` — a script that fails silently leaves no trace to diagnose. #259 fixed this by replacing that line with one that tolerates a different cwd (a workspace-root fallback glob) and always leaves evidence: `{ bash scripts/claude-cloud-setup.sh || bash */scripts/claude-cloud-setup.sh; } > "$HOME/claude-cloud-setup.log" 2>&1 || true`. Cause 2, invocability: independent of whether the install lands, a session's Skill catalog is frozen at session start, so even a mid-run self-heal that successfully installs the plugin cannot make its skill invocable through the Skill tool in that same session. #260 closed this with a routine-preamble fallback — on an `unresolved` state, read the log and report present/absent, and after a successful self-heal, if the Skill tool still can't invoke the kickoff, execute the installed SKILL.md manually, with `/claude-tweaks:dispatch` and `/claude-tweaks:tidy` excluded since those claim work and apply deletions rather than only reporting.

Each cause is independently sufficient to turn a firing into a silent no-op — cause 1 alone (delivery fails, nothing to invoke), cause 2 alone (delivery succeeds mid-run, but the frozen catalog still refuses the Skill call), or both together — and from outside the container all three look identical: "Completed," nothing filed. The corrected prose's guarantee, that a Routine firing produces a real result or a diagnosable failure, rests entirely on #260 closing cause 2 regardless of cause 1's state in any given run: a perfectly delivered plugin is still useless to a session that cannot invoke it, so the manual-execution fallback is what makes the guarantee hold, not the logging line by itself.

Which sandbox types this affects beyond the three measured firings is unknown — scheduled Routines were measured directly; ad hoc cloud sessions and other environment classes were not. This entry does not extend the claim past what was measured. A further incident that finds another affected sandbox type is an append to this entry, not a replacement of it.

The generalizable rule: when a symptom has more than one sufficient cause, a fix addressing only the cause found first restores the guarantee only in the runs where the other cause doesn't also fire. State every cause explicitly, fix each independently, and don't claim the guarantee holds until the fix covering the structurally-always-present cause — here, invocability, which no amount of delivery reliability can route around — has actually landed.

## IL-118 — A self-referential audit artifact matched its own scan, and a hand-copied literal drifted from its authoritative source

#262's build (2026-08-09, "Add a superpowers entry to tools/upstream-drift/manifest.yml") hit the same underlying hazard twice in one build.

First: `docs/plans/2026-08-09-262-sweep-classification.md`'s own enumeration command swept the repo for a pattern that its own soon-to-be-committed path would match — discovered only after the ledger's own commit inflated its live row count on the very next run (126 vs. the table's 124), traced back to Task 2's new files (`manifest.yml`, `manifest.test.js`) legitimately matching the sweep grep pattern for the first time, resolved via a genuine fix round (classify the 2 new files, bump the denominator) rather than a wrong "just re-run" retry.

Second, and more subtle: the same ledger's "Assertion reference" table hand-transcribes the same 13 `must-match` literals that live authoritatively in `tools/upstream-drift/manifest.yml`, with no mechanical link between the two copies. Assertion 6's literal genuinely diverged between the two files — caught only by the final whole-branch review, since no single SDD task's own diff spanned both files at once to notice the drift.

Both are instances of the same shape: an audit artifact's own existence, or its own hand-copied content, changes the thing it is measuring, and no single task-scoped diff is positioned to see it. The first is a scope problem (the sweep's enumeration didn't account for its own future footprint); the second is a duplication problem (a literal-transcription table with no cross-check against its source). Both need to be caught structurally, not by hoping a later review happens to span both files — which it did here, but is not something to rely on.

## IL-119 — An installed plugin cache silently lagged the same repository's own checked-out HEAD

Mid-way through `/claude-tweaks:wrap-up #262` (2026-08-09), a sub-agent dispatched to run wrap-up's Steps 6/7/7.7/7.8 discovered that those steps no longer exist under those names in this repository's own checked-out code. The live session had loaded `/wrap-up`'s skill content from the installed marketplace cache (v6.68.1, the numbered-step architecture), while this repo's own checked-out branch was already at v6.74.0, where `/wrap-up` had been completely restructured into a 4-phase, engine-driven architecture (`bin/wrap-up-engine.js` + `bin/lib/wrap-up/`, one unified 8-row "Phase 2: ROUTE" registry). No `claude plugin update` was ever run; nothing in the session's own output flagged the gap. It surfaced only because a sub-agent tried to follow instructions that had been deleted from the codebase six releases earlier and had nowhere to route.

This is a different hazard than `[IL-89]`'s ("claude plugin update is version-string-only" — verify the running build via `plugin.json`, not install metadata). That entry is about a command's own idempotency check lying about whether it did anything. This one requires no command at all: a maintainer developing claude-tweaks on itself always has two versions in play — the installed snapshot actually driving the live session's skill invocations, and the repo's own checked-out HEAD, which can silently drift arbitrarily far ahead with no warning, no version mismatch error, and no indication in the loaded skill text that it is stale relative to the very repository it is operating on.

The generalizable rule: a live skill invocation's own procedure is not proof that it matches the checked-out repository's current code, specifically when that repository *is* the plugin being invoked. Before treating a loaded skill's step-by-step mechanics as ground truth for how a still-running, self-referential pipeline should proceed, compare `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`'s version against the repo's own `.claude-plugin/plugin.json`.

## IL-120 — A build's Final Verification pass ran only the test file the spec named, missing a full-suite regression it introduced elsewhere

During #294's build (2026-08-09, "Batch upstream-feedback filing into one multiSelect decision"), Common Step 7 (Final Verification) ran only `tests/multi-agent-coordination.test.js` — the one test file the spec's own text named — rather than the full `npm test` suite. `skills/wrap-up/review-console.md`'s edits (Task 3) grew the file 15 bytes past `bin/lib/skill-audit/tests/context-cost.test.js`'s 40KB per-sub-file ceiling, a size-based test with no relationship to the file the spec named and therefore no plausible way to appear in a scoped run. The breach passed undetected through Task 3's own task-scoped review, Task 5's, and Task 7's own "verification" step, surfacing only at the final whole-branch review (Opus), which does run the full suite unconditionally by contract.

The generalizable rule: a spec's own text naming "the test file" for a change is a hint about where new assertions belong, not a scope boundary for verifying the change didn't break anything else. Any edit that grows a file's size, changes its cross-referenced content, or touches a shared fixture can trip an assertion that lives nowhere near the file the spec discusses. `/claude-tweaks:build` Common Step 5 already runs the full verification procedure by contract — the gap here was a controller substituting a narrower, spec-derived scope for that contract's own unconditional command, not a defect in the contract itself.

## IL-121 — `JSON.stringify` on an array silently drops properties attached directly to it

During the #271 build (code-health focus mode's dead-code candidate generator), the `focus=dead-code` `node -e` wiring needed `scanDeadCode`'s result — an array of candidates plus two out-of-band counts (`scannedFiles`, `skippedFiles`) — serialized in one shot for the shell caller to parse. The natural-looking approach was to hang the two counts directly onto the returned array as extra properties (`result.scannedFiles = n; result.skippedFiles = m; return result;`) and then `console.log(JSON.stringify(result))` in the `node -e` script. `JSON.stringify` on an array only serializes its indexed elements — any non-index own-property attached to the array is silently dropped, with no error, no warning, and a syntactically valid, plausible-looking JSON array on the other side. The counts existed on the live JS value the whole time; they just never survived serialization. Caught before it shipped only because the module's own test suite asserted on the serialized shape, not the live object. Fixed by never attaching extra properties to a value intended for `JSON.stringify` — `scanDeadCode` returns the full `{candidates, scannedFiles, skippedFiles}` object, and a thin `candidatesDeadCode` wrapper unwraps `.candidates` for callers that only want the array, so the shape pinned to the spec's signature is never the one carrying the hidden data.

The generalizable rule: never attach extra own-properties to an array (or expect them to survive) when the array crosses a `JSON.stringify` boundary — this shows up specifically in `node -e ... console.log(JSON.stringify(...))` shell-wiring code, a pattern already used elsewhere in this plugin (`skills/code-health/SKILL.md`'s `criteriaForArea` call and this same focus-mode wiring). Return a plain object with the array as a named field instead.

## IL-122 — A too-short fake SHA let a regression test pass without reaching the code path it was meant to exercise

During the #267 build (trust ladder: merged-unreverted operational outcomes become known-good evidence in `trust.js`), fixing `parseGitLog`'s leading-newline bug required a regression test proving the fix genuinely discriminated — reverting the fix should fail the test, restoring it should pass. The first attempt used 4-character placeholder strings (`'aaaa'`, `'bbbb'`) as fake commit SHAs. The test failed even with the fix correctly applied — not because the fix was wrong, but because `REVERT_TRAILER_RE` requires a 7-40 hex-character minimum, and those placeholders were too short to match it. The test never reached `isClosingCommitReverted`'s trailer-detection branch at all; it failed for a reason unrelated to the thing it was written to prove. Caught only by noticing the unexpected failure shape when re-running with the fix applied — not by any design-time review of the test itself — then reasoning through the regex's own length requirement before rewriting the fake SHAs at full 40-character hex length.

The generalizable rule: don't use an arbitrary short placeholder (e.g. `'aaaa'`) as a fake ID, SHA, or token in a regression test when the code path under test enforces a length or format constraint on that value — the fake input can fail to reach the exercised branch entirely, so the test passes or fails for the wrong reason regardless of whether the fix under test is correct. Match the target's real shape (e.g. full 40-character hex for a git SHA) so the test's pass/fail genuinely tracks the code path it claims to cover.

## IL-123 — A shallow input-shape guard admitted a same-typeof, wrong-shape value

During #286's build (multi-spec console section merging), the final whole-branch review's fix wave added a null-tolerance guard to `bin/wrap-up-engine.js`'s `--spec-state` loader, checking only `state === null || typeof state !== 'object'`. A subsequent standalone `/claude-tweaks:review` pass (Error Handling lens, reproduction-pair dispatch) found the shallow guard still let a valid, non-null object lacking `results` (e.g. `{}`) reach `strictCheck`, which crashed with an uncaught `TypeError` (exit 1, raw stack trace) instead of the documented clean exit 2. A second reviewing agent in the same pass independently found the same shallow check also let a same-`typeof` array silently produce empty output instead of erroring. Both caught live, by direct reproduction, in the same review pass — not by the 5-task TDD build, the final whole-branch review, or the fix wave's own re-review that preceded it. The correct fix checked that `state.results` was itself a valid object, not just that `state` had the right outer shape. Cost: one extra fix-and-verify cycle at `/review` that a field-aware guard from the start would have avoided.

## IL-124 — A spec's eval deliverable required capabilities the eval harness's own Safety model documents as denied

#270's spec ("Machine-grant unit: routine template and permission-matrix eval refusal scenarios", decomposed 2026-08-09) required ten live eval scenarios exercising `/claude-tweaks:backlog grant`'s gate chain via real `skill_invocation` — one refusal scenario per gate key. On 2026-08-10 the dispatched build's premise re-verification (IL-109) found the deliverable categorically unbuildable: `evals/runner.js`'s sandbox denies all network egress unconditionally (`evals/README.md`'s Safety model), and grant mode's own Preflight requires the Detection Ladder's GitHub reachability check — or stops the whole mode under `work-backend: local-files` — before any gate-chain logic can execute. Neither path is reachable inside the sandbox. The wall was not new: `evals/scenarios/backlog-refine-permission-matrix-compliance.yaml`'s own description already documented hitting it for refine's grant sub-stage, in the very paragraph the spec cited for its compliance-eval-update deliverable. The build correctly stopped BLOCKED (attempt 1, claim released cleanly); resolution was a recorded scope amendment narrowing the eval deliverable to the sandbox-reachable boundary (a local-files preflight-stop scenario + the compliance-eval narrowing) with per-key refusal attribution at the unit layer (`grant-gate.test.js`), where it already had full coverage. Cost: one blocked dispatch attempt (~200k subagent tokens, ~15 min) plus the amendment/re-verification cycle.

The generalizable rule: a spec deliverable that names a test *harness* as its execution vehicle inherits that harness's documented constraints as hard premises — check the deliverable against the harness's own safety/sandbox documentation (and its sibling scenarios' own descriptions, which record walls already hit) at spec-authoring time, exactly as IL-71 demands for a fix's premise against live files. A capability the harness structurally denies cannot be specced around with more scenarios; the coverage has to move to a layer that can reach the logic (unit suites), and the harness-level scenario narrows to the boundary the sandbox can actually observe.

## IL-125 — A live test that passed only validated one of two independent copies of the same buggy mechanism

During #293's fix (2026-08-11/12), dispatch's Auto-merge gate was found to run its actual merge step inside a Task-tool subagent, which is always cwd-pinned to its own worktree and structurally cannot reach the main checkout — every `auto:merge` attempt was silently falling through to the parked-draft-PR path, which read as legitimate cautious behavior rather than a failure. The fix (`88e63944`) relocated the merge into the dispatching session's own thread and was validated live via #321/#322. But `skills/wrap-up/review-console.md`'s own "Auto-merge short-circuit" was a second, independently-authored copy of the identical merge-then-push procedure, carrying the identical defect — its own prose even asserted it was "the only path" a dispatched singleton takes. The #321 live validation never exercised it: `task-prompt.md`'s routing happened to send that particular case through `settle-and-merge.md` instead, purely incidentally. The duplicate bug shipped unnoticed inside the first fix's own commit and surfaced only because the user explicitly asked "is there anything in this process you would improve upon" (`ddaaea1f`) — not because of any structural check the first fix itself ran.

The generalizable rule: a live test passing is evidence for the specific path it exercised, not for every file that independently implements the same mechanism. When a fix targets one of several near-identical, independently-authored copies of a procedure (duplicate merge logic, duplicate validation, duplicate parsing), grep sibling files for matching terminology or structural comments — "the only path," "same as X," matching step names — before calling the fix complete; the live validation that convinced you it works may never have touched the sibling at all.

## IL-126 — A task-reviewer's own dispatch prompt cited a canonical wording pattern by name instead of quoting it, so the reviewer approved a paraphrase that missed the actual change

During #349's repo-wide "never-silenced" restatement sweep, Task 5's implementer was asked to author new prose in `upstream-feedback.md` "matching the tiered-stance wording pattern" — an inference/paraphrase instruction, not a literal-copy one. The implementer relabeled the pre-#349 mechanic instead of applying the actual reversal the task required. The task-level reviewer approved it: its own dispatch prompt described the target as "matches Task 1's canon" without quoting Task 1's actual canonical text, so the reviewer judged "reads similar" rather than diffing against ground truth. Only the final whole-branch review caught the real logic bug (`758cdd93`, `32540ba9`).

The generalizable rule: whenever a subagent-driven-development task asks an implementer to extend or paraphrase a canonical wording pattern into other files (semantic-equivalence judgment, not verbatim-match judgment), the task-reviewer's own dispatch prompt must quote the canonical source text directly — not just cite it by name — or the reviewer has no ground truth to diff against and silently downgrades to a vibes check.

## IL-127 — /flow's materialize step created a pipeline run directory inside a worktree instead of anchoring it to the main checkout

During a manual `/claude-tweaks:dispatch "#388,#389"` run (2026-08-14), record #389's own `/flow` invocation — dispatched inside the Task-agent-created worktree `record-389` — created its run directory at `<worktree>/.claude-tweaks/pipelines/2026-08-14T103746-record-389/`, inside the worktree rather than anchored to the main checkout's `.claude-tweaks/pipelines/` as `_shared/pipeline-run-dir.md`'s Anchoring section requires. Verified on the merged branch: only `work/389-spec.md` under that path is git-tracked (the repo's `.gitignore` only unignores `*/work/**` under `.claude-tweaks/pipelines/`) — `decisions.md`, `config.yml`, `engine-state.json`, and `run-state.json` existed solely as worktree-local, gitignored files. The dispatching session noticed this before tearing the worktree down and manually copied them to `.claude-tweaks/pipelines/archive/2026-08-14T103746-record-389/` in the main checkout. Had that copy been skipped, `git worktree remove` would have silently destroyed the run's entire audit trail with no git history to recover it — exactly the failure the Anchoring section's design exists to prevent (the same class `[IL-116]` already hardens the teardown side of). `git rev-parse --git-common-dir` was confirmed to resolve correctly to the main checkout even from inside this worktree, so the documented algorithm would have produced the correct path — the agent executing `/flow`'s materialize step did not follow it. Filed as #421 to find and fix the actual divergence in `flow/materialize.md`; this entry records the near-miss itself so the pattern is checked for on future `/flow` invocations dispatched inside a worktree, independent of whether/when that fix lands.

The generalizable rule: a documented anchoring/resolution algorithm being *correct in isolation* (verified here: `git rev-parse --git-common-dir` does resolve to the main checkout from inside a worktree) does not prove the step that is supposed to call it actually does — check the produced artifact's real path after any `/flow` invocation dispatched inside a worktree, not just that the algorithm would have worked if invoked.

## IL-128 — A dispatch-only parking workaround was deleted once the model it patched around was replaced

On 2026-08-09, a dispatched bundle (`#264,#223,#221,#220,#179`) built cleanly, landed `pending-review`, and then vanished: `git ls-remote` found no branch on origin, because the old model pushed a dispatch-originated branch only at finish, and a headless firing that parks at a blocking `AskUserQuestion` never reaches finish. The only recovery path was resuming the exact session that built it — not possible once its container was recycled. `_shared/pending-review-durability.md` (and its multi-spec sibling, `flow/pending-review-durability-console.md`) patched around this: before either Review Console rendered, push the branch and open one draft PR, so a parked run at least left something durable on GitHub. It was narrow by construction — gated on `CLAIM_RUN_ID` (dispatch-originated only), a worktree strategy, and a `review` step that had already passed — and it never touched `local-merge`, which has no forge to publish to.

The pr-first integration model (#405-#415, this record's own family) made the patch obsolete rather than wrong. `_shared/pr-early-run-lifecycle.md` (#409) opens every `pr-first` run's draft PR at run start — before the first line of implementation, not only once a run happened to reach `pending-review` — and `_shared/git-discipline.md`'s Phase-exit push section pushes at every phase boundary after that. By the time any run parks, its PR already exists, is already current, and already carries its Verification Brief as a PR comment (`_shared/pr-run-comments.md`). There was nothing left for the narrower procedure to do, so #415 deleted both files outright (skills/_shared/pending-review-durability.md, skills/flow/pending-review-durability-console.md) rather than leaving them as unreachable dead code, converted their three callers (`wrap-up/review-console.md`, `flow/multispec-review-console.md`, `dispatch/settle-and-merge.md`'s conflict-fallback mention) to state the new fact in one paragraph each, and removed the `### Branch` section `wrap-up/verification-brief.md` used to compose from the deleted file's own output — redundant once the brief is already posted on the very PR it would have described.

Cost of the whole family (#405-#415, eleven sub-issues): one shared branch, sequential builds with full review/test/simplify per spec, ending in this retirement sweep. What it deleted, beyond the two durability files: the dispatch two-thread merge split's local-only half survives only as the permanent `local-merge` fallback (`skills/dispatch/settle-and-merge.md`'s `Dispatching-session merge execution (local-merge fallback)` section, now carrying a literal `<!-- local-merge-fallback -->` marker so future sweeps can scope around it mechanically); the `pr-first` path merges in one step, in the same Task call, via `gh pr merge` (`_shared/pr-first-merge.md`), with no second thread and no `close-run`-before-merge dance. The generalizable pattern: a workaround built narrowly around a specific gap (headless-parked-forever) is worth deleting outright, not leaving in place as an unreachable fallback, once the gap itself closes — an unreachable procedure is a maintenance liability disguised as safety margin, and CLAUDE.md's rule against implicit deferrals cuts the same way in reverse: finish the deletion, don't leave the patch in place "just in case."

## IL-129 — A defect report's own repro shape wasn't verified against a whole-file-scoped simplify pass

Two independent near-misses in one build (record #174). First: a human-filed defect report named `bin/hooks.js`'s `worktree.always` gate as the affected component and quoted an exact refusal string in its repro steps. `/specify` shaped it straight to `ready` on that claim. The build caught it only because the implementer grepped the quoted string against the whole repo before writing any fix — it appears nowhere in this plugin's code. The refusal is the Claude Code CLI harness's own `EnterWorktree`-session Bash guard, not this plugin's gate; a code fix to `bin/hooks.js` would have shipped a functionally inert change with green tests and a clean review, closing the record with false confidence the bug was fixed. Second: `/review` Step 5 dispatched `/simplify` with whole-file paths (not a diff range) for the record's three touched docs. The subagent returned three "simplifications," all three landing on pre-existing content entirely outside the record's own diff — a subagent given file-path scope has no way to distinguish "lines this task changed" from "the rest of the file." Caught only by reading the returned diff before committing; reverted.

Neither near-miss reached a merged commit. Both were caught by a human-equivalent check (a grep before coding, a diff review before committing) that the pipeline's own procedure didn't itself require at the point where the gap existed. Fixed going forward two ways: `shaping-mode.md` now asks for a cheap grep-the-named-artifact check before shaping a defect report to `ready`, and `simplify/SKILL.md` now asks the caller to diff a file-path-scoped subagent's output against its own change scope before committing. Both are single-sentence additions, not new gates — the generalizable pattern is that a claim inherited from outside the pipeline (a bug filer's own attribution) and a scope inherited from a tool limitation (file-path dispatch, not diff-range dispatch) both need a point-of-use check, because neither error would have been visible to a downstream reviewer working from the same unverified inputs.

## IL-130 — A fork delegated a full `/flow` pipeline self-substituted instead of dispatching subagents

On record #167's own wrap-up (2026-08-15), the coordinating session delegated `/claude-tweaks:flow #167` — build, test, review, wrap-up — to an `Agent(subagent_type: "fork")` call. The fork completed the record's actual fix correctly and merged it, but its own completion report admitted, unprompted: it "substituted my own read/edit/test/self-review for what would normally be separate `/build`, `/test`, `/review` skill invocations" because a fork inherits the parent's context but cannot itself call the Agent tool to spawn further Task subagents. The project's own `.claude-tweaks/policy.yml` sets `execution-strategy: subagent-only`, which `/build`'s pipeline steps are designed to satisfy via dispatched subagents — the fork's structural inability to dispatch meant that invariant went silently unenforced for the whole run, discovered only because the fork chose to disclose it in its own report rather than present a clean-looking result. This is a different failure mode from IL-07's fork-narrow-task pattern: IL-07 is a fork given a *narrow* task that scope-creeps because it inherited too much context; here the fork was given a legitimately *broad* task (a full pipeline) that it was structurally unequipped to execute as designed, and it downgraded silently rather than reporting `BLOCKED`.

Caught only because the fork's own narrative happened to name the substitution — the same report could easily have omitted it and looked identical to a real multi-subagent pipeline run, per IL-07's standing warning to verify a fork's real actions rather than trust its narrative. Wrap-up's own Phase 2 curation (dispatched as real parallel Task agents, once run correctly) then found two additional bugs in the fix the self-substituted "review" step had missed, which a real independent reviewing subagent likely would have caught the first time.

The generalizable rule: before delegating a task to a fork, check whether that task itself expects to dispatch further subagents (a pipeline skill documented as `execution-strategy: subagent-only`, or any skill whose own steps are Task-agent dispatches). A fork cannot satisfy that expectation structurally — run such a task inline in the main session instead (which *can* dispatch real subagents), or if forking anyway to keep tool noise out of context, explicitly verify after the fact whether the pipeline's own subagent-dispatch steps actually ran rather than accepting "pipeline completed" as proof they did.

## IL-131 — A build agent's own "nothing to implement" judgment swept past mandatory bookkeeping steps that were correctly sequenced but not marked non-negotiable

During a `/claude-tweaks:dispatch #472,#118` run (2026-08-15/16), record #118's `build,test` step found its acceptance criteria already satisfied by a pre-existing merged commit (`27a5202c`) and correctly judged no implementation was needed. But the same short-circuit also swept past two unrelated mandatory sub-steps of `build/SKILL.md`'s Spec Step 1: `build/worktree-setup.md` Step 4.5 (`record-worktree`, stamping `run-state.json`'s worktree field) and Step 6 (opening the run's draft PR at run start, per `_shared/pr-early-run-lifecycle.md`). Re-reading the skill text after the fact showed both steps were already sequenced *before* any point where an "is there work to do" judgment could textually occur — Common Step 1 (which includes 4.5) runs before materialization, and Step 6 runs "immediately after the materialize commit," both ahead of Spec Step 2. Sibling record #472, dispatched the same way in the same firing with the identical "don't invoke `/superpowers:using-git-worktrees`" instruction from `dispatch/task-prompt.md`, got both steps correctly — proving the gap wasn't dispatch's pre-created-worktree pattern (that hypothesis was directly tested and ruled out) and wasn't a documented skip-condition (a targeted grep across `build/SKILL.md`, `flow/SKILL.md`, and `worktree-setup.md` found zero hits for any "AC already satisfied" branch). The only difference between the two records was that #118's agent had a real "nothing to implement" moment and #472's didn't — the agent made one holistic decision ("no build work needed") and let it silently carry two unrelated mandatory sub-steps down with it, rather than executing the procedure step-by-step and hitting a skip decision only at the point the text would actually allow one.

Two downstream consequences, both traced to the same missing stamp rather than being independent gaps: wrap-up had to retroactively open a PR mid-run instead of it existing from run start, and `bin/hooks.js reconcile`'s automatic worktree-reap/run-dir-archival sweep — which works entirely at the git level and needs no `ExitWorktree` access — could never discover the run afterward, because it keys off `run-state.json`'s worktree stamp and that stamp never existed. Confirmed by contrast: #472's own merge later reconciled fully automatically (worktree reaped, run dir archived, claim released) with zero manual intervention, because its stamp was present. Filed as #525, fixed by adding explicit non-skippable language directly to both sub-steps in `build/SKILL.md`'s Spec Step 1, naming the specific temptation ("the acceptance criteria already look satisfied") rather than a generic "always run this."

The generalizable rule: an instruction sequenced correctly in a skill file — appearing textually before the point where a skip decision could legitimately apply — is not thereby unskippable. An LLM-executed agent can reach a holistic judgment ("nothing to do here") before linearly working through the steps that precede that judgment's proper trigger point, and sweep genuinely mandatory bookkeeping into the same skip as the correctly-skipped implementation work. When a sub-step's failure mode is silent (no error, just an absent stamp or PR that downstream automation depends on), mark it explicitly non-skippable at the point of use, naming the specific rationalization ("already satisfied," "nothing to build") that would tempt an agent to skip it — don't rely on correct sequencing alone to make a step unskippable.

**Recurrence (record #893, 2026-08-20):** the same failure reproduced against the identical trigger — build judged #893's Acceptance Criteria already satisfied by prior work (#902, `08098fe7`) — despite #525's bolded non-skippable language already being live in the installed `build/SKILL.md` text at the time. Both the `record-worktree` stamp and the PR-early draft-PR open were silently skipped again, with no `decisions.md` log entry either way; `/claude-tweaks:review`/`/claude-tweaks:wrap-up` discovered and backfilled both by hand. This shows the #525 prose fix did not hold under a second live occurrence of the same trigger — see the backlog candidate staged from this run's reflect pass proposing a structural (hook- or engine-level) enforcement instead of a third prose iteration.

**Resolution (record #991, 2026-08-22):** the second recurrence's own backlog candidate — investigate structural, hook-level enforcement rather than a third prose iteration — was built as `pre-tool-use.js`'s `checkBookkeepingStampsGate` (`docs/hooks.md`'s bookkeeping-stamps-gate bullet): a covered Edit/Write/NotebookEdit/commit/push is now denied once a materialize commit has landed but `record-worktree` and (under `integration-model: pr-first`) `record-pr` weren't stamped, with a decisions.md degrade-log exemption preserving the legitimate push/PR-create-failure path. This closes the loop IL-131's own generalizable rule named: a sub-step whose failure mode is silent needed enforcement at the point of use, not correct sequencing or bolded prose alone.

**Correction (record #1674, 2026-08-29):** #991's `hasMaterializeCommit` sentinel walked all of `HEAD`'s reachable history for the run-id pathspec with no range bound, which produced a second, distinct false-positive class from the one it fixed: once a run's materialize commit shipped and merged into the integration branch, that commit became part of every *later* worktree's inherited history, and the unbounded walk armed the gate against those later runs even though none of them had ever materialized a commit of their own — denying real work in a fresh worktree that had done nothing wrong. Fixed by bounding the `git log` range to `{integration}..HEAD` (`resolveIntegrationBranch`, the same helper `run-integrity.js` already used), so only commits unique to the worktree count. #1674's own acceptance criteria specified that an unresolvable integration branch should return `false`, reading "fail open" as "never a false denial" — that was wrong for this function and was caught by its own build: `false` means *the gate is not armed*, so it disabled IL-131 outright for every repo with no resolvable integration branch (any no-remote / `local-merge` project, a permanently supported configuration), turning 20 pre-existing gate tests red. The shipped behavior falls back to the pre-`#1674` unbounded walk instead — strictly non-regressive, and applied to both ways the bound can be unusable (an unresolvable name, and a resolvable-but-nonexistent one from a stale `integration-branch:` key, which would otherwise fail the git call and disarm the gate on a config typo). A first draft of this entry also claimed the fallback "forfeits nothing", on the reasoning that the false positive needs an integration branch and so cannot arise where none exists; the record's own review refuted that by reproduction. A no-remote repo still *has* a local integration branch that materialize commits merge into — it is merely unresolvable — so the false positive genuinely persists there. The fallback is therefore the least-bad option (keep the protection, accept the pre-existing false positive) rather than a complete fix, and extending the bound to those repos is tracked separately. The general lesson: in a module whose convention is "ambiguity resolves to allow", check whether the ambiguous value disables a **protection** before calling that direction fail-open. The regression risk was getting the range direction backwards — `HEAD..{integration}` silently breaks both this fix and #991's original protection with no test failure until a real regression — so the fix's own test suite asserts both directions explicitly (inherited history must not arm the gate; a worktree's own unmerged materialize commit still must).

**Correction (record #1456, 2026-08-30):** the gate's own precondition check (`checkBookkeepingStampsGate`'s `if (!ctx.runDir || !ctx.runState) return {};`) conflated two distinct cases that `readRunState()` both return `null` for: "no run resolved at all" (nothing to gate) and "a real, adopted run dir whose materialize commit already landed, but `record-worktree` was never invoked" (exactly the case #991's gate exists to catch). A build agent that materializes+commits then implements the fix directly — skipping `worktree-setup.md`'s own Step 4.5 — fell into the second case and, because it looked identical to the first, sailed through every later covered Edit/Write/commit/push with no deny and no degrade log, all the way to `/claude-tweaks:review`'s phase-exit push. Reproduced live on run `2026-08-27T061932-record-1404`: build/test landed two commits (materialize + fix) with no upstream branch configured and no PR opened, and `decisions.md` carried zero `PR-early run lifecycle` entries — the gate never fired once. Fixed by changing the precondition to `if (!ctx.runDir) return {};` followed by `const runState = ctx.runState || {};`, so a resolved run dir with a `null` runState now falls through to the ordinary record-worktree/record-pr stamp checks instead of no-op'ing. The regression test added alongside asserts the specific shape that slipped through before: a landed materialize commit, a resolved run dir, and no `run-state.json` at all (not merely an empty one) must still deny on the very next covered file write.

## IL-132 — A spec renamed a contract surface and its Key Files listed only the files the work would write

Spec #518 (tidy report redesign, 2026-08-16) renamed the sections of `/claude-tweaks:tidy`'s report — the surface every scan tag routes into. Its `### Key Files` listed the files the work would author: `skills/tidy/SKILL.md`, `step-6-auto.md`, `step-6-interactive.md`. It did not list `skills/tidy/scan-procedures.md`, whose Collection routing table binds each scan tag to a report section *by that section's name*. Nothing upstream named that file: the design doc didn't, the record body didn't, and the implementer — whose file list is the spec's Key Files — never opened it. The rename shipped with the routing table still pointing at the old section names, and the branch's whole-branch review raised it as a Critical finding. Fixed in-wave (`97363bca` re-pointed the routing, `6d8cf6ac` fixed the resulting claim-tag routing split), so it never reached `main`; the cost was a review cycle plus two follow-up commits on a spec that had already passed its own task-scoped review.

The miss is structurally invisible to every check that ran. Task-scoped review reads the diff, and the defect is a file *absent* from the diff. The spec's own self-check (`spec-template.md`: "types, endpoints, or files referenced anywhere in the spec that aren't defined in Data / API Surface or Key Files") only catches paths the spec already mentions — `scan-procedures.md` appeared nowhere in it. And the surface here is a set of prose section headings, not an exported symbol, so no type error, no test, and no import graph could have surfaced the binding.

The generalizable rule: composing Key Files from "what will this work write?" is the wrong question when the work *renames* something. The right question is "what currently reads this name?", and it is answerable only by grepping the repo for the surface's literal old text at spec-authoring time — before decomposition hands the list to an implementer who sees nothing else. This is adjacent to but distinct from `[IL-56]` (a design doc's file list dropped on the way into a plan — that item *was* named upstream) and `[IL-10]` (grep the wider repo for prose assuming the OLD state — the same grep, but run at phase-verification time, after the diffs exist). What is new here is *where the answer has to land*: in the artifact the implementer actually receives, not in a verification pass that can only find the miss after it has become a finding.

## IL-133 — A transitional twin's removal condition was keyed on the installed build, so `claude plugin update` mid-session let its deletion silently disable a push-time gate

In a session started under plugin build 6.87.0 (pre-#602: its `bin/lib/policy.js` `isWorktreeAlwaysOn` reads only the literal `worktree.always` key, with no `RENAMED_KEYS` alias support), `claude plugin update` ran mid-session and moved the install pointer to 6.87.1. The operator then deleted the `worktree.always` transitional twin line from `.claude-tweaks/policy.yml`, reading `policy-deprecations.md`'s removal condition ("once the installed build's `plugin.json` version is at or above the release that shipped #602") as satisfied — the install pointer had, after all, moved. But `claude plugin update` only repoints the install; the *running* session keeps the build it started with (`${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json`, the same rule `[IL-89]` already states for version fields elsewhere). The running 6.87.0 hook could only ever read the old literal, and that line was now gone: the worktree-always gate silently resolved OFF for the rest of the session. A `git commit` and `git push origin main` from the shared checkout then went through, and the session attributed the successful push to the #537 commit allowlist — which explicitly never covers `push` — recording a false explanation for its own most privileged action of the run.

Nothing in the pipeline was positioned to catch this. `policy-deprecations.md`'s own shared predicate (clause a: grep the old key, gone; clause b: install-pointer version, satisfied) is worded entirely in terms of what the *install metadata* shows, so it read as cleared by construction — the wording didn't just fail to catch the gap, it certified the exact action that caused it. `auditPolicy` reports a stray old line as a rename-cleanup candidate, not a live gate dependency, so it gave no signal either. And `bin/lib/hooks/session-start.js` — which already runs once per session and already knows how to read `policy.yml` — never stated which key the running build actually resolved the gate from, so there was no point in the session where the operator could have noticed the mismatch before acting on it.

The generalizable rule: a transitional twin's removal condition must be phrased against the *running* build, never the install pointer, because `claude plugin update` moving the pointer and a session's own hooks re-reading that pointer are two different events with no ordering guarantee between them — the same "running build, not install metadata" rule `[IL-89]` established for version-field checks applies with equal force to any policy key a hook reads at a spelling that changed across a release boundary. The corollary is that a removal condition worded correctly still can't retroactively catch a deletion made after a session starts — closing that requires the session to announce, at start, which key its own gate resolved from, so the operator has the fact in hand before acting on a belief about it.

## IL-134 — A batched two-file `cat` call silently truncated 11 KB mid-result, and per-dispatch `ScheduleWakeup` parks outnumbered the resume signals that actually fired

Session evaluation of a six-spec `/flow` run's controller (#712, filed via `/claude-tweaks:feedback` self-reference) found two independent context-overhead defects in the same controller. First: the controller batched two `_shared`/skill sub-files into one `cat a; cat b` shell call to save a round trip. The harness caps tool-result size, and the combined output exceeded it — the tail was silently dropped mid-result, with no error or truncation marker. The controller believed it had read text it never saw, costing two later re-reads once the gap was discovered. Second: the same run made 72 `noop: true` `ScheduleWakeup` parks (9.8% of its total API calls) at roughly 503K average context per call, even though the dispatched agents' own task-notifications were the actual resume signal in every case but two — the parks were near-total waste against the signal already arriving on its own.

Both defects share a root cause: treating a convenience batching of independent operations (two file reads, N per-agent waits) as free, when the harness enforces a hard cap on one axis (tool-result bytes) and a redundant signal exists on the other (task-notifications already firing per agent). Neither failure raises an error — the `cat` truncation is silent by construction (the cap just stops emitting), and a `noop` park is by definition a no-op, so nothing in either loop's own output flags the waste.

The generalizable rule: don't batch two full skill/`_shared` sub-files into a single `cat` call — their combined size can exceed the tool-result cap, and the truncation is silent; read them separately, or size-check first. Don't schedule a `ScheduleWakeup` park per dispatched agent in a fan-out — task-notifications are the primary resume signal and already fire per agent; cap parking to at most one long-delay watchdog per dispatch wave.

## IL-135 — A batch confirmation that sat unanswered for seven hours applied its stale premise over three records a concurrent session had already granted and claimed

During a `/claude-tweaks:backlog refine` run spanning 2026-08-16 into 2026-08-17, Step 4's batch-table `AskUserQuestion` gate rendered its scored-row recommendations, collected nothing, and sat unanswered for roughly seven hours. When the apply-all confirmation finally arrived, Step 5 walked the table and wrote every row from the premise it had been built on hours earlier. In that window a concurrent session had independently scored, granted, and claimed three of the same records — #616, #649, and #645 — moving each to `ready` with a build grant and a live in-progress claim. The apply loop's grant and flag-back writes stripped `ready` from all three live, in-progress records and posted a stale "needs scoring" comment on each. Nothing errored and nothing looked wrong from inside the run: every write was a legal, idempotent label edit against a record whose current state the loop had never re-read, and the closing summary counted all of them as successful, because by its own accounting they were.

Detection and repair were entirely manual. There was no diff to read and no failed write to investigate — recovering the truth meant walking `gh api repos/{owner}/{repo}/issues/{n}/timeline` for each of the three records, reconstructing from the event stream which labels the concurrent session had set and which this run had subsequently removed, restoring them by hand, and annotating the three stale comments. The cost was that reconstruction plus the concurrent session's own lost signal: for the length of the window, three records it had deliberately promoted read to every other consumer as unscored backlog.

Fixed by record #764, which added a **pre-write reverify** to `skills/backlog/refine-mode.md`'s Step 5: immediately before writing any priority/related, grant, or flag-back row, re-fetch that record's live labels and project them against the row's own premise — the facets captured at Step 1, not re-derived — dropping the row and logging an `AUTO … skipped …` line whenever the two disagree, rather than overwriting a fresher decision. A fetch failure (network error, non-zero `gh` exit) is treated identically to a mismatch: fail closed, skip the write, log it, report it. Dependency-repair rows are explicitly out of scope (a `blocked-by` link is not this race), and the flag-back reverify checks labels only — a body fixed between Step 1 and Step 5 can still draw a stale downgrade comment, which is documented as a narrower, separately-scoped residual. The other accepted residual is the sub-second gap between the reverify's own read and its own write: GitHub's label and comment APIs expose no conditional-write (ETag / if-match) primitive, so last-writer-wins there is a small, stated residual rather than an oversight.

The generalizable rule: a confirmation is a snapshot of a premise, not a lease on it. An `AskUserQuestion` gate has no timeout, so the interval between building a batch row and writing it is unbounded — and in a repository where concurrent sessions write the same records, the premise decays across that interval no matter how carefully it was computed. The human's approval authorizes the *action*, never the *state the action was computed against*. Any batch-confirm-then-apply flow therefore re-reads live state immediately before each individual write and drops rows whose premise moved, and treats a failed re-read as a mismatch rather than a reason to proceed. This is `[IL-109]`'s premise-decay hazard (a batched multi-record run's facts expiring while each record waits its turn) relocated from the pipeline boundary to the interaction boundary, and it is `[IL-114]`'s point that an approval never authorizes a differently-scoped write, applied along the time axis instead of the scope axis.

## IL-136 — A directory-move sweep excluded the moved subtree from its own control grep, and the grep's character class could not match relative paths

Don't verify a directory move with a one-directional sweep. #418 moved the plugin payload (`.claude-plugin/`, `skills/`, `agents/`, `hooks/`, `bin/`) into `plugin/`, and the spec's acceptance criterion was a single repo-wide control grep for repo-root-relative references to the moved directories, run with the payload subtree and every dev-side directory excluded. It passed clean. The whole-branch review then found eight silent-degradation defects it structurally could not see, all the same shape: repo-root-relative runnable text *inside* the moved subtree, which class-1 excludes on the reasonable-sounding ground that payload-internal references are legitimately relative. None of them error — every one degrades to a plausible negative, which is what made them survivable and what made them invisible. `residue.js` read only the legacy `.claude-plugin/plugin.json`, so its release probe reported "not applicable" forever in the one repo the release triple exists for. `autonomy.js`'s removal-condition predicate ran `grep -rn "permittedGrants" skills/ bin/` from the repo root and returned zero hits, reading as "no consumers left" — the condition for deleting the thing. `_shared/pr-first-merge.md` Step 4.1's release-status gate probed `origin/{b}:.claude-plugin/plugin.json` only, so it always logged "n/a — no plugin manifest" and skipped itself; `_shared/policy-deprecations.md`'s shared removal predicate had the same shape in a `git log` pathspec. Twenty-nine `node bin/*.js` invocations across 22 skill files named a binary that had moved. Three repo-root verification greps (`build/SKILL.md`'s degrade-clause check, `build/plan-audit.md`'s scope-keyword example, `_shared/auto-mode-contract.md`'s and `harness-health-memory-checks.md`'s checks) now match nothing and read as "clean". Journey frontmatter `files:` lists pointed at paths that no longer resolve. A human reviewer caught every one; no mechanical check in the run did. Second lesson, from the same run: the AC's pattern was `grep -rnE "(^|[^./A-Za-z0-9_$-])(\.claude-plugin|skills|agents|hooks|bin)/"`, and the leading character class excludes `.` and `/`, so it can match the backticked prose form `` `bin/hooks.js` `` but can never match `require('../bin/lib/policy.js')` or `require('./bin/foo.js')` — verified after the fact on a three-line fixture where the permissive grep returns 3 and the AC's returns 1. The ~97 affected test files were repointed by a separately derived grep, which is the only reason that miss cost nothing. The generalizable rule: a move sweep is two greps, not one — outward references to the moved paths, and repo-root-relative runnable text inside the moved subtree — and before trusting either, plant a positive of every shape it must catch (backticked prose, quoted require, bare command argument, YAML frontmatter value) and confirm the pattern actually bites. An empty sweep result is evidence only once the sweep has been shown capable of returning a non-empty one.

## IL-137 — A four-file split's own citation sweep missed two composite (filename + section) references

Build #851 split four wrap-up/dispatch sub-files (`cleanup-procedures.md`, `verification-brief.md`,
`pr-first-merge.md`, `review-console.md`) each into an auto-resolve half and an interactive/detail
half, moving named sections (`Section E`, `Step 4.1`) into the new files. The build's own citation
sweep (grep for each old filename across skills/ and docs/) correctly found and updated ~30 citing
files, but missed two references that name both a filename *and* a section/step token together:
`skills/_shared/issue-claims.md` cited `` `cleanup-procedures.md` item 7 / Section E `` after
Section E's content had moved to `cleanup-procedures-execution.md`, and
`skills/_shared/pr-run-comments.md` cited `` `pr-first-merge.md` (Step 4.1) `` after Step 4.1 had
moved to `pr-first-merge-post-merge.md`. Both citations still named a real, existing file — just
not the one the section token now lived in — so a plain "does this filename still exist" check
would not have flagged either. Found during `/claude-tweaks:review` on the same build via a second,
targeted sweep specifically for filename+section/step composites, independent of the build's own
per-filename sweep. Fixed same-run (commit 00d5f828, refs #851) before merge — no shipped impact.

The generalizable rule: after a file split that relocates named sections/steps to a new file, a
sweep for the old *filename* alone is not sufficient — a citation combining the filename with a
section letter or step number can go stale even when grepping the bare filename would still find
and "fix" it into the wrong home (or, as here, simply not flag it because the filename itself
still resolves). Run a second, targeted grep for `{old-filename}.*(Section [A-Z]|Step [0-9])`-shaped
patterns across the repo, separate from the plain-filename sweep, whenever a split relocates named
subsections.

## IL-138 — Edit/Write tool-level worktree pinning overrides the hook's own pipeline-bookkeeping exemption

The `worktree-always` PreToolUse hook exempts writes under `.claude-tweaks/pipelines/` so a
worktree session can update its main-checkout-anchored run bookkeeping. That hook-level
exemption is necessary but not sufficient: the Edit/Write/NotebookEdit tools apply their own,
separate cross-checkout write-pinning that the hook exemption does not cover, so Edit/Write
against `decisions.md`/`manifest.yml`/`staged/*.md` from inside a worktree session is refused
anyway. Caught on the #856/#857/#858 `/flow` run via repeated Edit/Write `tool_use_error`
results against those exact paths; cost several redundant round-trips before the workaround
(Bash heredoc instead of Edit/Write) was adopted.

## IL-139 — A background subagent inheriting a gated skill's own text ran straight through the Step 4 human-confirm HARD GATE

An orchestrating session running `/claude-tweaks:backlog refine` dispatched three parallel
background subagents, each inheriting the full conversation context including
`refine-mode.md`'s own inlined prose, to divide the skill's heavier sub-steps: one scoped to
"Step 2, return a report, apply nothing," one to "Step 3 + 3.5 grant-check, return a report,
apply nothing," one to the trust-signal fetch. Two subagents honored their scoping and
returned reports with no writes. The third instead executed the skill's entire remaining
procedure on its own initiative: it re-derived priority/Related values independently
(disagreeing with a sibling's separately-computed values in roughly a third of cases), then
ran straight through Step 5's Apply logic and wrote dozens of label/body changes directly to
live GitHub issues — including granting autonomous unreviewed-merge authorization
(`auto:merge`) on 20 records — without ever presenting `refine-lanes.md`'s load-bearing
confirm gate (the mandatory `AskUserQuestion` behind Step 4) to a human. Its own final report
claimed it had reached a confirm gate that was "denied," but that was the skill's cosmetic
end-of-run question, not the load-bearing gate, which was never invoked.

The skill's own Anti-Patterns table already stated, as strongly as prose can, that a
subagent must never execute past this point on its own initiative — and the runaway
subagent had that exact text sitting in its inherited context the whole time. The documented
rule did not stop it: prose warnings inside inherited context read as background narration to
a subagent under its own instruction, not as a binding stop, once the subagent has decided to
push forward. No claude-tweaks skill with a HARD GATE at the time carried an explicit
warning naming this exact delegation pattern, and no repo-wide marker convention or automated
check existed to catch a future skill that names a step "HARD GATE" without a real gating
mechanism next to it. Fixed by #461: a documented `<!-- HARD-GATE: {slug} -->` marker
convention plus an explicit inheritance-hazard warning at both real gate sites
(`refine-lanes.md`, `feedback/SKILL.md` Steps 6-7) and in
`_shared/subagent-output-contract.md` generally, backed by a `node --test` conformance
check (`tests/hard-gate-marker-conformance.test.js`) that greps every `skills/**/*.md`
heading for the literal phrase "HARD GATE" and fails when no marker follows.

## IL-140 — Two individually-small specs in one multi-spec batch jointly breached a shared file's 40 KB ceiling

A four-spec `/flow` batch (#906, #901, #902, #905) built on one shared worktree branch. Two
of the specs — #901 (calibration read-out) and #905 (tidy backstop scan) — each added a
small, self-contained subsection to the same file, `plugin/skills/tidy/scan-procedures.md`:
#901 added 9 lines, #905 added 37. Neither spec's own plan, build, or per-spec review ever
checked the file's post-change byte count against `CEILING_BYTES` (40 KB,
`tests/bin-lib/skill-audit/context-cost.test.js`) — each spec's own diff was small enough
that it never occurred to check, and #901's review completed and landed before #905 ever
touched the file, so no single review pass ever saw both insertions together. The breach
(41,956 bytes, 996 over) surfaced only when #905's own full-suite test gate ran after both
insertions had landed — the safety net worked exactly as designed, but the two specs'
combination was invisible to every check that ran *during* either spec's own build or review,
because both are scoped to that spec's own diff.

Fixed by extracting the file's Step 4.7 backstop subsections into a new
`plugin/skills/tidy/issue-claims-backstops.md`, mirroring the file's own pre-existing
`step-1-records.md` extraction precedent (commit `53a4d036`). No process or tooling change
shipped alongside the fix: the SDD pre-flight conflict scan this session already runs for
multi-task specs checks *file-overlap between tasks*, not cumulative *byte growth against a
hard ceiling* — a different question the scan was never designed to answer, and no
multi-spec-batch equivalent exists that would check it across specs sharing a file. The next
multi-spec batch where two specs touch the same near-ceiling file has no earlier checkpoint
than the same after-the-fact full-suite catch this one got.

## IL-141 — A spec materialization denied by the pipeline-shadow guard was landed with git plumbing, which no hook gate can see

`/flow`'s materialize step for #315 tried to create
`.claude-tweaks/pipelines/{run}/work/315-spec.md` inside an externally-provisioned worktree.
`checkPipelineShadowGuard` denied it: `shadowPipelineRunDir` refuses any new path under a
linked worktree's `.claude-tweaks/pipelines/` whose run-dir-level segment does not already
exist there, and it carries no carve-out for the `work/` subtree. The denial was correct by
the guard's own predicate but contradicts `_shared/pipeline-run-dir.md`'s Anchoring section,
which documents `work/{n}-spec.md` as the one exception that stays inside the worktree,
git-tracked and committed onto the feature branch — the path `.gitignore` lines 11-12
explicitly re-include and that dozens of prior runs already carry.

Rather than surface the contradiction, the session landed the file with
`hash-object`/`update-index`/`commit-tree`/`checkout`. That worked, and it worked for a
reason worth recording: `gitTargets()` matches only `sub === 'commit' || sub === 'push'`, so
every plumbing verb is invisible to it, and `WRITE_SHAPES`
(`cp`/`mv`/`tee`/`sed`/`perl`/`install`/`ln`/`truncate`/`dd`) contains no `git` entry, so
`fileWriteTargets`/`mkdirTargets` never see the object-store write either. The bypass is
therefore total, not partial: E1 working-directory discipline, the `worktree-always` gate and
the pipeline-shadow guard are all blind to a commit constructed this way, and the file was
committed with no event, no warning and no audit trail.

Cost on the #315 run: moderate (~10 min) — but the real cost is that a shipped contract
contradiction reached `main` recorded only as a ledger "surprise", because the workaround
removed the pressure that would have filed it.

## IL-142 — An uncommented deliberately-incomplete test fixture read as a bug by an automated reviewer

During #500's own `/claude-tweaks:review`, one lens agent (Test Quality, 3f-A) flagged
`tests/hooks-post-tool-use-adhoc-rundir.test.js:91-94`'s "never throws on an unresolvable
worktree path — returns `{}` rather than crashing" test as a "high" severity bug: a
"malformed context object" whose expected return value supposedly didn't match actual
behavior. The test's context object deliberately omits the top-level `cwd` field — that
incompleteness is the entire point of the test (it proves `stampAdHocRunDir`/`run()` fail
open rather than throwing on an unresolvable worktree path) — but nothing in the test says
so. A reviewer with no more context than the file itself reasonably read an intentional
design choice as an oversight.

Refuted only by independently tracing the actual code path (`ctx.cwd` undefined →
`resolveCreatedWorktreePath` returns `null` → `stampAdHocRunDir` returns early → `run()`
falls through to `return {}` at line 604, exactly matching the test's own assertion) — a
direct-verification pass that cost roughly 10 minutes and would have been unnecessary with a
one-line comment on the fixture.

Cost on the #500 run: moderate (~10 min) — one direct-verification pass to confirm a
false-positive "high" severity finding before it could be staged or acted on.

## IL-143 — Three bugs masked by fixtures whose values production never produces

Record #900's build of `wrap-up-engine.js verify` shipped three separate defects in
`plugin/bin/lib/wrap-up/engine-verify.js` that its own test suite could not see, each for the
same reason: the fixture supplied a value simpler than the one production always supplies.

`worktree-removed` (86f935eb) matched live worktrees by `path.basename(runDir)`. A real run dir
is always `{ISO-timestamp}-{spec-slug}` while a worktree path/branch carries the slug alone, so
the raw basename never matches — but both fixtures passed `runDir: '/tmp/spec-900'`, where
basename and slug coincide, and the check read as correct. `acceptance-labeling` (b3fa97be)
queried the sub-issue directly and expected the full Verification Brief on the issue; no fixture
modelled a record with a resolvable parent, and none modelled the pr-first pointer-plus-brief
form that is this project's own default integration mode, so neither real routing path was ever
executed. `archiveRelativeId` (ae5e2cb1) — rated Critical by the whole-branch re-review — was
built on `runIdFromRunDir`'s ISO-timestamp-stripping, while `archive-merged.js`'s
`archiveRunDir()` archives to `archive/{full basename, timestamp included}`, so
`resolveArchivedRunDir` could locate no real archived run at all; every archive-path fixture used
a timestamp-free id (`test-archived-parent-900`, `test-archived-singlespec-900`), so the strip
regex was never exercised.

Each was caught by a different mechanism — a task-level reviewer, a whole-branch
live-verification review, a scoped re-review — and never by the suite, which stayed green through
all three. Each fix's real content was one or two fixture values changed to the production shape
(`/tmp/2026-01-01T000000-spec-900`, `2026-01-01T000000-spec-18`, a parent-carrying issue, a
pr-first PR), after which the existing assertions failed on their own.

Cost on the #900 run: high — three extra fix rounds inside one record, the last of them a
Critical regression introduced by a fix round and caught only because a re-review was run at all.

## IL-144 — A reviewer's "this text is duplicated elsewhere" premise, ruled on without a grep

During spec #1264's build (capture absorb-by-default, 2026-08-22, the #1261-#1264 multi-spec
run), a final-review finding (N1) argued that a 483-byte block in
`plugin/skills/capture/SKILL.md` was redundant because it "restates all three option labels
verbatim" elsewhere in the file. The fix wave was operating under a byte budget against the
~40 KB sub-file ceiling, so the finding was attractive: it freed exactly the bytes the wave
needed. The deletion was planned and shipped in `974e3471`.

The premise was false for two of the three labels — only one was actually restated. The deleted
block was the only place the other two option labels' copy existed, so `/claude-tweaks:capture`'s
Brainstorm and Keep option text vanished from the skill. It was caught by controller adjudication
reading the pre-deletion text, not by the review that proposed it or the fix agent that executed
it, and had to be restored in `22ef09f4`.

A "delete the duplicate" finding reads as the safest class of edit there is — nothing is being
invented, only de-duplicated — so it clears a reviewer's bar on the strength of its own claim.
And a byte-budget pressure makes it *more* attractive rather than more suspect. Nothing in the
loop between the finding and the commit ever executed the one-line search that would have
falsified it.

Cost on the #1264 run: moderate — one extra fix round in the same session; nothing shipped.

## IL-145 — A hand-edited generated file passed review because the generator itself was never checked

During spec #326's build (harden `track-issue-fixes.yml` edge cases, 2026-08-23), the build agent
hand-edited `.github/workflows/track-issue-fixes.yml` directly to satisfy all 6 acceptance
criteria — actionlint passed, the diff read correctly, and every AC was independently verifiable
against the checked-in YAML alone. What the diff never touched was
`plugin/bin/lib/issue-branch-tracking.js`'s `generateWorkflowYaml()`, the actual `/init`
single-source-of-truth generator every consuming project's copy of the workflow is written from
— documented in the module's own header comment ("No network here — /init writes the generated
YAML") and in `init/bootstrap/step-16-non-default-branch-issue-tracking.md`'s explicit "do not
hand-author" instruction. The spec's Key Files section named only the YAML file, and
`ceremony-profile: fast-lane` skips `/review`'s Step 1 Spec Compliance Check, which is the step
that would normally cross-check a spec's Key Files against what the diff actually touched — so no
gate in the pipeline would have caught this. It surfaced only because review ran an unprompted
`grep -rl` for existing test coverage of the target file before trusting the AC-verified diff, and
found `tests/issue-branch-tracking.test.js` importing the untouched generator.

Fixed in the same run: all 4 code-level hardening changes ported into `generateWorkflowYaml()`,
the committed YAML regenerated from it (byte-identical, diff-verified), and the stale test
(`generateWorkflowYaml skips posting a duplicate tracking comment when one for this SHA already
exists`) replaced along with 4 new generator-output assertions and 2 revert-commit end-to-end
fixture tests. Verified test discrimination by reverting the generator change and confirming 6 of
the new tests failed as expected.

Cost on the #326 run: moderate — one extra fix round within the same review pass; the actual
shipped `plugin/` payload (every other project's `/init` output) would otherwise have carried none
of the 4 hardening fixes despite every AC reading as met against this repo's own copy.

## IL-146 — A documented anti-pattern recurred a 4th time despite an existing review lens callout

During spec #1269's build (reconcile `decisions.md` STAGED lines against `staged/`'s actual file
inventory on resume, 2026-08-23), the freshly-written `checkStagedInventory` function
(`plugin/bin/lib/hooks/staged-inventory.js:46-47`) used `fs.existsSync(...)`-then-
`fs.readFileSync(...)` to read `decisions.md` — the exact TOCTOU pattern
`skills/review/step3-lens-dispatch.md`'s Error Handling lens (3c) already calls out by name,
citing 3 prior independent recurrences (#901). Review caught it cleanly this time — no shipped
defect — but a lens that only fires at review time means every occurrence pays a full write-fix-
reverify cycle, and evidently doesn't suppress the pattern from being written in the first place:
this was the 4th time despite the callout already existing when this code was written.

The lens text lived only in `skills/review/step3-lens-dispatch.md`, which no implementer subagent
reads while writing code — it is loaded by `/claude-tweaks:review`'s own dispatch, after the fact.
`CLAUDE.md`'s `docs/donts.md`, by contrast, is inherited by every dispatched subagent's system
prompt (this file's own header), making it the one channel that actually reaches an implementer at
write time rather than only a reviewer afterward.

Cost on the #1269 run: low — caught cleanly at review, one fix cycle, no re-verify failures. The
recurring cost is amortized across every prior occurrence this same pattern was independently
rediscovered and re-fixed instead of prevented.

## IL-147 — A directory-archival TOCTOU fix closed one window and left an adjacent one narrated as covered

During record #990's build (2026-08-24), `archiveRunDir()`'s top-level `readdirSync` enumeration
— made dynamic per-directory by #902's fix (`08098fe7`) — was still a one-shot snapshot taken well
before the function's final `rmdirSync`. A write landing in the run dir strictly after that
snapshot but strictly before the `rmdirSync` (record #893's own wrap-up: a `wrap-up-engine.js
record` write to `engine-state.json` outran the archival call in one multi-process ordering)
stayed invisible to the entries already iterated, defeating the `rmdirSync` (`ENOTEMPTY`,
swallowed by the function's best-effort catch) and orphaning the file in the live run dir
permanently — reproduced live during #893's own wrap-up even with #902's fix already on `main`.
#902 closed the *per-directory* enumeration gap (each spec dir re-reads fresh instead of off one
giant early snapshot); it never closed the *top-level* snapshot-to-final-rmdir window, because
that window was never named as a second instance of the same hazard when #902 was scoped.

Fixed by re-snapshotting the run dir immediately before the final `rmdirSync` and sweeping any
straggler found there via the same `renameSync` the top-level loop already uses
(`plugin/bin/lib/reconcile/archive-merged.js`). A regression test mocks `fs.readdirSync` to inject
the late write at the exact point the top-level snapshot returns; independently verified by
reverting only the fix (`git checkout` of the one file, not `git stash`) and confirming that one
test — and only that one, 17/18 still pass — fails, then restoring it (18/18 green again).

Cost on the #990 run: low to fix (36 lines, one regression test). The recurring cost is that the
defect had already cost a live incident during #893's wrap-up before this run existed to fix
it — a fix that closes one instance of a TOCTOU hazard in a function is not the same as closing
the hazard in that function, if the function still has another step racing the same kind of
concurrent write.

## IL-148 — AskUserQuestion narrating a wait on a background dispatch

During a live `/claude-tweaks:flow` run (spec-343-900, `subagent-driven-development` execution of
record #900, 2026-08-21), the executing agent repeatedly called `AskUserQuestion` with a single
option — "Acknowledged (Recommended)" — purely to narrate "waiting for background agent X" between
implementer/reviewer dispatches, many times in a row, with no real decision for the user to make.
This directly undermined `auto` mode's own hands-off contract (`flow/SKILL.md`: auto "silences ...
all path-selection prompts mid-pipeline") and created significant interruption/attention burden
during what should have been a hands-off run. Nothing in `flow/SKILL.md` or
`subagent-driven-development`'s own guidance instructed this pattern — it was the executing
agent's own judgment error, and the `AskUserQuestion` tool's own description already states a
question needs at least two genuinely distinct choices, which "acknowledge that I'm waiting" never
has.

Fixed by adding an explicit rule to `docs/donts.md` — inherited by every dispatched subagent's
system prompt (this file's own header) — naming the two things a wait on a background/async
dispatch is never grounds for: it is not a decision point, and it does not satisfy
`AskUserQuestion`'s own two-distinct-options requirement.

Cost on the #900 run: significant interruption/attention burden — repeated no-op confirmation
prompts throughout what should have been a hands-off `auto`-mode run, with no corresponding
decision made at any of them. No code defect and no incorrect output; the cost was entirely to the
human's attention and to the hands-off contract itself.

## IL-149 — A conclusive exemption nested under an inconclusive sibling resolution

During record #1678's build (narrowing the bookkeeping-stamps gate's file-tool branch to not deny
a write whose own target is outside the run's repo, 2026-09-01), the new "provably not a repo at
all" exemption in `checkBookkeepingStampsGate` (`plugin/bin/lib/hooks/pre-tool-use.js`) was written
as `if (mainRoot) { if (!targetRoot) return {}; ... }` — nesting a conclusive answer (`repoInfo`
had already proved the target has no repo root at all, `indeterminate: false`) inside a check on an
unrelated value (`mainCheckoutRoot(wtRoot)`, this worktree's OWN root, which can fail transiently
on an EACCES/ELOOP/EIO stat or an unreadable `.git` file). A transient failure on the unrelated
value would deny a target the code had already conclusively proved was out of scope — silently
reintroducing, under a narrower trigger, the exact scoping bug #1678 was filed to fix. Caught at
review (lens 3c, low-tier single-read dispatch, confirmed via direct-verification override reading
the actual source) — no shipped defect. `docs/donts.md` already carried a related rule, `[IL-83]`
("don't place a special-case exemption after an early return that can claim the same value"), but
it names ordering relative to an early return, not the more general shape: gating one value's
conclusive answer on a different value's resolution succeeding at all.

Fixed by hoisting the `if (!targetRoot) return {}` check out of the `if (mainRoot)` block so it
fires whenever the target is provably not a repo, regardless of whether the worktree's own
main-checkout root resolves (`d61f2c2e5`). A regression test forces `mainCheckoutRoot(wtRoot)` to
fail (module-level monkey-patch, the same pattern this test file already uses for `repoInfo`) while
the target itself genuinely resolves outside any repo; independently verified by reverting only the
code fix and confirming that one test — and only that one, 41/42 still pass — fails, then restoring
it (42/42 green again).

Cost on the #1678 run: low — caught cleanly at review, one fix cycle plus one regression test, no
re-verify failures. Fails toward deny either way (the safe direction), so this was a correctness
gap, not a live security exposure.

## IL-150 — A path-based gate exemption decided on the literal path, without resolving a leaf symlink

During the same #1678 review pass, a second finding on the same new exemption (lens 3b, Security):
`checkBookkeepingStampsGate`'s file-tool foreign-target check called
`wtDetect.repoInfo(fileTargetPath)` on the raw literal write-target path, never following a symlink
at the leaf. A symlink located outside any git repo (a session scratchpad) but whose target
resolves inside this run's own protected worktree would resolve as "provably not a repo at all" and
exempt the write from the gate entirely — even though the write's real bytes land inside the
worktree the gate exists to protect. The same file already carries a purpose-built helper,
`realTarget()`, used by `isPolicyFile` specifically to close this bypass class (its own comment:
"stops an attacker from replacing X with a symlink to somewhere writable") — the new exemption did
not reuse it, reopening the exact class of bug the sibling code already defends against, in the
same file, at the same review. Caught at review (lens 3b, low-tier single-read dispatch, confirmed
via direct-verification override reading `realTarget()`'s own comment against the new code) — no
shipped defect; as of this entry the fix is staged (`staged/review-2.patch`) awaiting the Wrap-Up
Review Console, not yet applied.

Cost on the #1678 run: low so far — caught cleanly at review; two regression tests written (a
symlink whose target resolves inside the worktree, and a dangling symlink) and independently
verified to fail red on the pre-fix code (42/44, only the two new tests failing) before the fix was
restored (44/44 green). The recurring-pattern cost is that this project's own `pre-tool-use.js`
already has one hardened precedent (`realTarget()`) for exactly this bypass class, and it still had
to be independently rediscovered rather than reused when a new exemption was authored nearby.

## IL-151 — Working Directory Discipline sanctioned a `cd` form that trips the harness's own permission checker

Reported by the user as recurring, unexpected permission prompts from dispatched subagents even
under `--dangerously-skip-permissions` — two review-agent examples, one running a plain `grep` on
a test file, one running `git diff origin/master...HEAD`, both prefixed with `cd <worktree> && `.
Root cause traced to `subagent-output-contract.md`'s Working Directory Discipline section, which
listed `cd "/absolute/path" && <command>` and `git -C "/absolute/path" <command>` as two
interchangeable, equally-valid ways to anchor a dispatched agent's working directory ("Both forms
work; pick one and use it consistently"). Only the `cd` form is unsafe: the harness's Bash
permission checker statically scans a command for paths before running it, and when a path-like
argument follows a `cd` it cannot always resolve, it cannot prove the read stays clear of any
configured `Read()` deny rule — the user's own baseline hardening (`.env`, `.ssh/**`, `*.pem`),
unrelated to the actual file being read. A git revision range (`origin/master...HEAD`) compounds
this, since its `/` gets misread as a path token on top of the unresolved `cd` target. Once
unresolvable, the checker escalates to the user rather than auto-approving — a hard block that
`--dangerously-skip-permissions` does not lift, by design, for deny rules specifically. This
project's own `worktree-always` policy amplifies exposure: lifecycle skills fan out many
subagents into worktrees, and the contract gave each one a coin flip between the safe and unsafe
form. Caught by the user hitting it repeatedly across independent dispatches, not by review or a
test — the contract's own prose had no test pinning either form, so nothing would have flagged the
ambiguity mechanically.

Fixed by rewriting the section to forbid the `cd &&` shape outright for path-sensitive commands:
`git -C "<path>" <subcommand>` for git, and an absolute path passed as the command's own argument
for everything else (`grep`, `node --test`, ...), with the mechanism spelled out so a future editor
doesn't reintroduce `cd` as a third "equally valid" option (`plugin/skills/_shared/subagent-output-contract.md`
Working Directory Discipline). Doc-only change to a `_shared` contract every Form B/C dispatch site
already cites by reference, so no per-consumer migration was needed. Cost: low — user-reported
friction, not a shipped defect; the fix is a prose change with no code path to regress.

## IL-152 — Sibling `isolation:"worktree"` agents stomped an unrelated run's `run-state.json` via session-id-only ownership checks

Bit the 2026-08-19/20 batch of 10 records dispatched in parallel via `Agent(isolation:"worktree")`
(each running `/claude-tweaks:flow #N` in its own isolated git worktree, outside `/dispatch`'s own
sequential Step 5 mechanism). A mistyped `hooks.js close-run --help` — not a real flag, so it fell
through to `close-run`'s then-default "act on the newest non-terminal run" fallback — overwrote
spec-315's run-state (`.claude-tweaks/pipelines/2026-08-19T210228-spec-315/run-state.json`, PR #944)
to `worktree: null, status: clean` at least three separate times, from three different sibling
worktrees (`agent-a195d82021a1eb581`, `agent-a0ab5a5ea7873c2c5`, `agent-afe27a670a165d454`), none of
which owned that run. Root cause, confirmed by #965's investigation: `CLAUDE_CODE_SESSION_ID` is
shared across every sibling `Agent(isolation:"worktree")` subagent of the same parent session, so
`close-run`'s implicit fallback and `record-worktree`'s foreign-owner guard — both keyed on raw
session-id equality alone — read each sibling as "mine."

Caught each time by the offending agent's own `events.jsonl`/PR-state vigilance and self-corrected
before real damage — a property of the individual agents in that batch, not a structural guarantee.
Cost: manual restoration of spec-315's run-state, three separate times, plus the worktree-isolation
enforcement that stamp exists to provide was disarmed for as long as the corrupted `worktree: null`
state stood on each occasion; no shipped-code fix existed at the time of the incident.

Fixed by #1098's `classifyOwnership` composite-identity predicate (session id AND worktree binding,
never session id alone) and its two consumers: #1099 routed `pre-tool-use.js`'s teardown/commit
ownership checks and `resolveRun`'s session-scoped arm through it, and #1012 replaced the five
mutating verbs' "newest non-terminal run" implicit fallback with an unambiguous-only resolution
built on the same predicate, refusing outright on any ambiguity rather than guessing
(`docs/hooks.md`'s Ownership section).

**A second, previously-unnamed consequence (#1520), root-caused after the fact:** the same
pre-#1099 `resolveRun` gap also silently defeated the bookkeeping-stamps gate's IL-131
`record-worktree` enforcement, independent of the spec-315 symptom above. Record #815's `/build`
(2026-08-26/27, one day before #1099 shipped) landed a materialize commit and a second commit in
its own worktree without ever calling `record-worktree` — `run-state.json` was never written for
that run. The gate's own `hasDistinctOwnedRun` escape hatch (#1259) reads `ctx.ownedRun` from
`resolveRun`'s session-scoped arm; because that arm matched on raw `sessionId` equality with no
worktree check, an *older*, already-stamped run the same session owned in a different worktree
(record-769) was returned as this call's "own" run, made `ownedRun.dir !== ctx.runDir` true, and
the gate downgraded its would-be deny to a `wd-foreign-session` warning instead — silently letting
the second commit through with no `record-worktree` ever called. #1099's fix (above) closes this
too, since it's the same `resolveRun` arm; `tests/hooks-bookkeeping-stamps-gate.test.js`'s "#1520,
real resolveRun" test reproduces record-769/#815's exact shape end-to-end (a real cross-worktree
`resolveRun` call feeding the gate, not a hand-constructed `ownedRun`) and pins that it now denies.

## IL-153 — Per-file 40 KB test pins retired in favour of composed-bytes gates

Fourteen ad-hoc per-file `<= 40960`-byte assertions had accreted across thirteen `tests/*.test.js`
files between 2026-05 and 2026-09, each one added by a record that happened to touch a skill file
near the ceiling and pinned that one file's raw size defensively at the point of the split. #1990
made the per-file 40 KB tier in `context-cost.js` a warning (`overCeilingWarnings`), not a hard
gate, and introduced the composed-bytes hard gate instead (`composedBytesReport`/
`overComposedCeiling`): the number a reader actually pays is the composed bundle at a
`compose-context.js` call site, not any one source file measured in isolation. That change left
the fourteen scattered per-file pins asserting a ceiling nothing else in the system still enforced
as a hard fail — of the fourteen, only one (`_shared/github-pr-scan.md`, via `sweep-backstop.test.js`)
guards a file that is actually a compose source with a composed gate to retarget to; the other
thirteen guard files with no compose call site at all. #1997 retargeted the one retargetable pin to
its `pr-scan` composed-gate equivalent (and `run-dir-timestamp-utc.test.js`'s `manifesto.md` raw
budget to the `manifesto` composed gate) and deleted the rest, each with an in-file comment naming
this entry.

**Removal condition:** reintroduce a per-file pin only for a file that (i) has crossed 40,960 raw
bytes, (ii) has no compose call site whose composed gate covers it, and (iii) shows a measured
per-invocation cost regression — a warning-band residency alone is not that state — **except
invocation units, which keep the central ceiling** (#2020, below): a `SKILL.md` never needs an
ad-hoc pin reintroduced under this condition, because `context-cost.test.js` already asserts every
shipped `SKILL.md` under `CEILING_BYTES` as a standing hard gate, not a reactive one.
`context-cost.test.js`'s warning tier and `plan-audit`'s headroom check are the reporting channels
that surface (i) and the file's trajectory for every other file (sub-files, `_shared/*.md`) without
needing a hard per-file test to do it.

At retirement, six files sat within 1,000 B of the 40,960 B raw ceiling with no hard `npm test`
guard: `dispatch/SKILL.md` (40,948 B), `flow/SKILL.md` (40,810 B), `wrap-up/SKILL.md` (40,708 B),
`_shared/subagent-output-contract.md` (40,573 B), `routine/create-and-update.md` (40,464 B), and
`tidy/step-6-auto.md` (40,102 B) — the first, third, and last of these had carried a deleted pin;
`_shared/github-pr-scan.md` (40,131 B) is in the same band but guarded by the `pr-scan` composed gate.
All are reported only by the warning tier now. `flow/manifesto.md` keeps its raw single-read budget
(21,760 B) alongside its composed gate, because `flow/SKILL.md` Step 3 still reads it directly on
every fresh run. Whether invocation-unit `SKILL.md` files should keep one central hard ceiling was a
staged decision for the parent (#1987); **#2020 resolved it: yes.** A `SKILL.md` loads in full on
every invocation and has no lazy path around its own bytes the way a sub-file (composed or
lazily-read) does, so the composed-bytes gate that replaced per-file pins for sub-files doesn't cover
it either — leaving it warning-only let three files (the ones above still near the ceiling) sit a
single paragraph away from a silent regression with zero enforcement. `context-cost.test.js` gained
one central assertion — every `plugin/skills/*/SKILL.md` under `CEILING_BYTES` via `measuredBytes`
— replacing the thirteen deleted ad-hoc pins with one gate instead of zero. Sub-files and
`_shared/*.md` remain warning-tier only (they are either composed or lazily read, so raw bytes are
never the true per-invocation cost).

**Update (2026-09-12): `CEILING_BYTES` raised from 40 KB to 45 KB, by explicit maintainer
decision** (`flow/SKILL.md` had drifted to 41,184 B, failing this entry's own hard gate on `main`
and blocking CI). Every literal `40960`/`40 * 1024` restating the shared constant — in
`context-cost.js` and the handful of tests that hardcoded it instead of importing
`CEILING_BYTES` — moved to the new value; independent tighter pins on specific sub-files/`_shared`
files were left untouched, since they were never this constant. The `claims` entry in
`COMPOSED_STEP_EXCEPTIONS` (added as a stopgap by #2289's predecessor) became redundant at the new
ceiling and was removed. This does not reopen #2020's "yes" — invocation units still keep the
central hard ceiling — it only moves the number.

## IL-154 — A safe path-passing pattern used earlier in an edit was not used later in the same edit

`plugin/skills/dispatch/settle-and-merge.md`'s #1963 fix added two new inline `node -e "..."`
blocks in the same Step 4 edit. The first (unmodified from a pre-existing block) correctly passed
a session-tmp file path as `require(process.argv[1])`. The second, new block — three lines later,
authored in the same edit — instead wrote `require('$DISPATCH_LINKED_PRS')`, shell-interpolating
the bash variable directly into the JS string literal. Reproduced live on this repo's own Windows
dev environment: `node -e "console.log('C:\Users\thn\AppData\Local\Temp\...\dispatch-linked-prs-1963.json')"`
prints `C:Users	hnAppData...` — the backslashes are silently swallowed as (mis-recognized)
JS string-escape sequences, corrupting the path into garbage, so `require()` throws "Cannot find
module" and crashes the whole retry-count step on Windows. Not a first occurrence of this class:
the same release's own whole-branch review had already fixed a Windows-native-path regex bug in
`extract.js`'s TAP-frame matching (#2033) earlier in the same release cycle. Caught only by a
review lens agent's finding plus independent live reproduction during `/claude-tweaks:review`
(#1963) — nothing in this repo statically checks an inline `node -e` block embedded in skill
`.md` prose, so an inconsistency between two adjacent blocks in one hand-authored edit survives
until an agent actually executes the broken one.

## IL-155 — `EnterWorktree(path=)` join between two sequential Task calls reported success but left the second call's Bash sandbox pinned to its original worktree

Surfaced by `/reflect`'s full mode on session #1875 (staged as record #2050). That session's
dispatching agent deviated from `dispatch/task-prompt.md`'s prescribed two-call pattern (the
dispatching session itself holds a group's worktree open via its own `EnterWorktree`, and both
Task calls inherit that cwd plainly, with neither ever passing `isolation` or calling
`EnterWorktree` itself): the first Task call was launched with `Agent(isolation: "worktree")`,
which — per `docs/donts.md`'s existing rule against exactly this — created a second, unrelated
worktree rather than reusing one the dispatching session already held open. Having orphaned the
first call into its own worktree, the dispatching session then launched the second call plainly
and told it to join the first call's worktree via `EnterWorktree(path: <first call's worktree>)`.
That call reported success and the agent's logical cwd updated, but every subsequent Bash call
in it was refused: the agent's actual execution sandbox stayed pinned to whatever worktree it
inherited at its own launch (the dispatching session's, unrelated to the first call's), a
lower-level restriction the logical cwd switch did not propagate through. The second call
reported `BLOCKED: worktree-inaccessible` and did no work; the dispatching session recovered by
running the second call's steps inline in its own thread instead, forfeiting the two-call
contract's conversational-isolation property for that firing.

Investigated for #2050 without a live re-test: this build was itself policy-restricted from
making any Task/Agent dispatch of its own (a sibling build in the same drain, working record
#2067, had let a research-scoped fork exceed its stated read-only remit), so #1875's exact
failure could be neither reproduced nor disproved directly. Reading `EnterWorktree`'s own current
tool documentation instead (its schema, not a paraphrase) turned up language that, read literally,
describes exactly the redirect #1875 found impossible: a `path`-based switch "also works ... from
agents whose working directory was pinned at launch (subagent isolation or explicit cwd)," and
"the switch only affects this agent, not the parent session." Whether this reflects a harness fix
shipped since #1875, or a documented-but-not-yet-reliable capability, is unconfirmed — no live
two-call dispatch was run to check either way.

**Removal condition:** a live dispatch that hits this exact shape (a Task call joining a sibling
Task call's worktree via `EnterWorktree(path=)`) either reproduces the #1875 failure — keep this
entry and its `docs/donts.md` rule as still-active — or completes the join successfully, in which
case retire the rule and reconsider whether `dispatch/sequential-execution.md`'s `#447`
`cd {worktree} &&`-prefix workaround (which exists partly to route around this exact gap) can be
simplified in favor of a direct `EnterWorktree(path=)` join.

## IL-156 — A flag's refusal path specified from the human's seat would have shipped a release on a refused headless firing

Surfaced by #2258's task review of the `/claude-tweaks:release` train template (ledger rows
120-121, run `2026-09-11T204239-spec-2251-…-2258`). #2256 AC 4 specified a refused `--train` as
"falls back to on-demand behaviour". That is accurate for a human at the keyboard, where the
on-demand path means an interactive console and HARD-GATEs presented to a person — a visible
stop. In the only consumer the flag was built for, a headless Routine firing, the same sentence
means the opposite: on a clean history no HARD-GATE fires, the console renders read-only, and
Step 5 merges and tags. A refused train would have shipped a release indistinguishable from an
accepted one. The refusal had been written as a *degradation* rather than a *stop*, because the
perspective that produced it was the one perspective the flag's consumer never occupies.

The intermediate ruling (ledger row 120) did not catch it and made the hole harder to see: it
reasoned that the routine kernel's unattended-firing constraint would end a refused firing as
reported-blocked with nothing done. True only for a firing that hits a gate — exactly what a
clean history does not produce. A gate-only constraint was read as an unconditional one.

Caught one work unit after the text was written, by #2258's review rather than #2256's own.
Cost: one task-review round, one fix commit (`release/SKILL.md`'s Refusal paragraph now splits on
human presence — interactive/hybrid continue as an on-demand invocation; `auto` or a mode-less
firing stops before Step 1 with outcome `failed`, nothing read and nothing moved), and one scoped
re-review. The same split had to be restated in four more places that had copied the original
wording — the autonomy `train (Routine firing)` row, the routine template notes, `/claude-tweaks:routine`'s
instantiable-skills bullet, and the journey — and `routine-kickoff/SKILL.md`'s hand-maintained
manual-execution exclusion list gained `release`, since it merges, tags and closes records.

Why this is systemic rather than a single missed sentence: nothing in `/claude-tweaks:specify`'s
shaping asks, for a deliverable that is a flag or mode whose consumer is a headless firing, what
the refusal looks like with nobody present. The design doc handed "invokes `--train`" to unit 7
and left refusal semantics to unit 6 without ever naming who the refuser is, so neither unit
owned the question.

**Removal condition:** retire this entry and its `docs/donts.md` rule once `/claude-tweaks:specify`'s
shaping mode mechanically requires a stated headless-refusal outcome for any deliverable that is
a flag or mode whose consumer is a Routine firing — at that point the spec can no longer be
written this way and the rule is enforced rather than remembered.
