# Upstream Drift — JUDGE Procedure

The single canonical judging procedure for `/upstream-drift`, used by two callers:

- **Step 4 (JUDGE)** of `SKILL.md`, on the sequential single-dependency path — read this file and apply it in the main thread.
- **The parallel dispatch prompt** in `SKILL.md` Step 2, when more than one dependency is due — inline the body below **verbatim** into each Task agent's prompt. Agents only see what's in their own prompt; a pointer to this file does not reach them.

Both callers substitute the same four placeholders before use: `{dep.name}` (the manifest entry's `name`), `{installed-tag}` and `{latest-tag}` (from Step 3's tag resolution), and `{root}` (the resolved repository root).

Keeping this in one file is deliberate — the same reason `plugin/skills/docs-health/judge-procedure.md` exists: a procedure restated in both the sequential step and the dispatch prompt drifts, and only one copy gets updated.

Everything below the horizontal rule is the inlinable body.

---

You are triaging one upstream dependency, `{dep.name}`, for two independent classes of finding. Do not merge them; they have different evidence standards and different readers.

| Class | Question it answers | Where the evidence comes from |
|---|---|---|
| `drift` | Does a claim this repo already wrote down still hold? | The deterministic checks (`tools/upstream-drift/checks.js`), already run. You report; you do not re-derive. |
| `capability` | What exists upstream that this repo does not know about? | A structural comparison of the upstream file tree at two tags. Nothing to assert against — this is the judgment half. |

The two-class split is the load-bearing decision. Every deterministic assertion tests a claim someone already wrote; new capability has nothing to assert against, which is precisely why it needs a judge. Conflating them produces a report where a broken contract and an unexplored idea carry the same weight.

## 1. Report the drift class — do not re-derive it

You were handed the parsed output of `checkVersion`, `checkAssertions`, and `replayFixtures` for `{dep.name}`. Convert it, mechanically:

| Deterministic result | Finding |
|---|---|
| `version.status: "breach"` | One `drift` finding, `severity: "high"`. The installed artifact is not the version this repo verified against, so every other claim below is provisional. Say that explicitly in `reason`. |
| `version.status: "absent"` | One `drift` finding, `severity: "low"`. Not installed is not the same as wrong — do not describe it as a breach. |
| Any `assertions.results[]` entry with `status: "unmatched"` | One `drift` finding per entry. `reason` names the citing file from `.file`, the claim from `.claims`, and the literal from the manifest that no longer resolves. |
| Any `assertions.results[]` entry with `status: "missing-file"` | One `drift` finding per entry, `severity: "high"` — a moved or deleted upstream path breaks the citation outright rather than merely aging it. |
| `assertions.status: "skipped"` | No finding. An unresolvable root means absent, which `checkVersion` already reported; emitting a second finding here manufactures evidence. |
| Any `fixtures.results[]` entry not `ok` | One `drift` finding per entry, `severity: "high"`. Executed behavior changed — the strongest evidence class available, since it observed the artifact rather than reading it. |

Do not re-run the checks, and do not "verify" a passing one by reading the file yourself. If everything is `ok`, emit zero `drift` findings and proceed to the capability class — an all-green deterministic half is the normal, expected state, not a reason to go looking.

## 2. Resolve the two tags — installed, and latest

The diff runs between the **installed** tag and the latest, never between two arbitrary recent tags. A capability report against a version the machine is not running describes work that cannot be done yet, and reads as actionable when it is not.

```bash
gh api "repos/{dep.upstream.repo}/tags?per_page=100" --jq '.[].name'
```

Filter to the entry's `upstream.tag-prefix` — a repo that ships several products from one tree (Impeccable ships `skill-v*`, `cli-v*` and `ext-v*` from `pbakaus/impeccable`) will otherwise hand you the wrong product's version line entirely. `{installed-tag}` is `tag-prefix` + the version `checkVersion` reported as installed; `{latest-tag}` is the highest-sorting tag carrying that prefix.

If `{installed-tag}` and `{latest-tag}` are equal, there is no capability class to judge. Emit the drift findings from step 1 and stop.

If `checkVersion` reported **several** installed versions (a `plugin-cache-glob` probe legitimately resolves more than one cached copy), diff from the one matching `pinned`. The others are stale cache directories, not the running artifact.

## 3. Map the contract root — the step that is wrong by default

**An upstream repository's layout is not the installed artifact's layout, and assuming they match is the single most likely way to produce a worthless report.** Resolve the mapping before diffing anything, per dependency, from evidence.

Take one path from the entry's `contract-paths`. Those paths are **installed-root-relative** — `checkAssertions` joins them onto the installed root, so that is the only thing they are known to be relative to. Find where that same file lives in the upstream tree:

```bash
gh api "repos/{dep.upstream.repo}/git/trees/{installed-tag}?recursive=1" --jq '.tree[] | select(.type=="blob") | .path' > /tmp/ud-installed.txt
grep -n "<basename of the contract path>" /tmp/ud-installed.txt
```

The upstream path will be some prefix + the contract path. That prefix is the **contract root**. Two verified examples from this repo's own manifest, which map differently:

| Entry | Installed root | Contract path | Upstream path | Contract root |
|---|---|---|---|---|
| `impeccable-cli` | `$(npm root -g)/impeccable/` | `cli/bin/cli.js` | `cli/bin/cli.js` | *(empty — identity)* |
| `impeccable-plugin` | `~/.claude/plugins/cache/impeccable/impeccable/4.0.2/` | `skills/impeccable/SKILL.md` | `plugin/skills/impeccable/SKILL.md` | `plugin/` |

Two entries against the *same upstream repository* need different prefixes. Never carry one entry's mapping to another.

**If the basename matches at more than one prefix, that is the normal case, not an anomaly.** Some upstreams vendor one source tree into a directory per agent harness. At `skill-v4.0.4`, `pbakaus/impeccable` carries `skills/impeccable/SKILL.md` under fifteen distinct prefixes — `plugin/`, `.claude/`, `.cursor/`, `.gemini/`, `.agents/`, and ten more. Pick the one prefix whose subtree corresponds to the installed root, by checking that the installed root's *own* top-level directory names appear under it. For `impeccable-plugin` the installed root holds `agents/`, `hooks/`, `skills/`, and upstream `plugin/` holds `agents/`, `hooks/`, `skills/` (plus packaging metadata) — that is the match; `.claude/` holds only `skills/`, and is not.

**`plugin/` in this section always means a prefix inside the *upstream* repository being diffed.** Since #418 this repo has its own `plugin/` payload subtree as well. The two are unrelated: a `plugin/…` path in a finding's `upstreamPath` is upstream's, one in `localSeam` is ours.

## 4. Diff the contract root's subtree, at both tags

```bash
gh api "repos/{dep.upstream.repo}/git/trees/{latest-tag}?recursive=1" --jq '.tree[] | select(.type=="blob") | .path' > /tmp/ud-latest.txt
sort /tmp/ud-installed.txt > /tmp/ud-a.txt
sort /tmp/ud-latest.txt > /tmp/ud-b.txt
comm -13 /tmp/ud-a.txt /tmp/ud-b.txt | grep "^<contract-root>" > /tmp/ud-added.txt
comm -23 /tmp/ud-a.txt /tmp/ud-b.txt | grep "^<contract-root>" > /tmp/ud-removed.txt
```

With an empty contract root, drop the `grep` rather than writing `grep "^"`.

Restricting to the contract root's subtree is not merely tidiness — it is what makes the result correct:

- **It deduplicates the vendored mirrors.** Across the whole `pbakaus/impeccable` tree, `skill-v4.0.2` → `skill-v4.0.4` adds the same handful of files once per mirror; restricted to `plugin/`, it adds twenty-five paths, each once.
- **It captures generated files that the canonical source does not have.** It is tempting to diff the upstream *source* directory instead (`skill/`, here) on the theory that it is the real thing and the rest are copies. Do not. `skill/` gains twenty-one paths across those tags; `plugin/` gains twenty-five. The four-file difference — `plugin/skills/impeccable/reference/degraded/{asset-producer,documenter,finish-reviewer,manual-edit-applier}.md` — exists only as a build output and appears in no source directory at all. The contract root is the subtree that mirrors what you would actually receive on upgrade, which is the only subtree that answers the capability question.

Removals matter as much as additions: an upstream file that disappeared is a capability this repo may currently depend on. Judge both lists.

## 5. Compare structurally — never by keyword

**Do not decide whether this repo already handles an upstream file by grepping for its name.** That search can only find files that already mention it, and is structurally incapable of finding the file whose defect is total silence (`[IL-15]`) — which is the exact defect this class exists to catch. A grep for `live-setup` across `plugin/skills/design-wrapper/` returns nothing, and the correct reading of that nothing is "unhandled," not "not applicable."

Instead, for each added or removed path:

1. **Read the file** at `{latest-tag}` (`gh api "repos/{dep.upstream.repo}/contents/<path>?ref={latest-tag}" --jq '.content' | base64 -d`). Read enough to state what it does — its frontmatter, its opening contract, its headings. A finding written without opening the file is a listing, not a triage.
2. **Identify the seam in this repo it would touch**, by reasoning from what the file does to which of this repo's files own that responsibility. Locate those by their role (`plugin/skills/design-wrapper/modes/live.md` owns live mode; `plugin/skills/visualize/` owns DESIGN.md consumption), then read them to see what they currently assume.
3. **State why it might matter, concretely** — a named consequence for a named file. "New reference doc" is not a reason. "This repo's live-mode wrapper enumerates the states it delegates and this one is not among them, so a project without the config file has an unmodelled precondition" is.
4. If, having read both sides, the answer is genuinely "this repo has no seam here," say so and drop it. An honest `no-op` beats a padded finding, and this step is where padding gets caught.

## 6. Release notes are evidence of nothing

**Never read release notes, changelogs, or tag descriptions to decide what changed.** Not as a shortcut, not as corroboration, not as a tiebreaker when the diff is large.

The measured reason, from the dependency this tool was built for: all five `skill-v4.0.x` releases of `pbakaus/impeccable` carry **byte-identical** bodies — 2791 bytes, one MD5 across 4.0.0, 4.0.1, 4.0.2, 4.0.3 and 4.0.4. The 4.0.0 announcement, re-posted five times. Meanwhile `skill-v4.0.2` → `skill-v4.0.4` changes 300+ files by +9,586/−2,514 lines, including a live-mode rewrite that added a whole `scripts/live/frameworks/` tree. None of it is announced anywhere.

A judge that reads those notes for "what changed" will confidently report that nothing did, and will be wrong in the most expensive possible direction — a clean bill of health. The file tree is the only source. If you find yourself wanting the notes to explain a diff you don't understand, read the files in the diff instead.

## 7. Judge each finding's fields

- `severity` — `"high"` when the finding describes something already broken (any drift class marked high above) or an upstream removal of surface this repo cites; `"med"` when new capability maps to a seam this repo demonstrably models incompletely; `"low"` when it maps to a seam that merely *could* use it. Capability findings are never `"high"`: an unexplored opportunity is not an outage.
- `confidence` — `"high"` when the evidence is mechanical and directly checkable (a deterministic check's own status; a path present at one tag and absent at the other). `"med"` when it rests on a judgment call about relevance a reasonable second reviewer could see differently — most capability findings land here. `"low"` when the upstream file's purpose is itself ambiguous from its content.
- `effort` — your honest estimate of adopting it: `"small"` (a citation or one paragraph), `"med"` (a new sub-file or a reworked step), `"large"` (a new mode, a new integration surface).

Calibrate honestly, not optimistically — the runner (`#143`) uses these to decide what files as an issue and what stays in the report.

## 8. Emit each finding in this shape

```json
{
  "dependency": "{dep.name}",
  "class": "drift | capability",
  "installedTag": "{installed-tag}",
  "latestTag": "{latest-tag}",
  "upstreamPath": "<the upstream file this finding is about; empty for a version-status drift finding>",
  "changeKind": "added | removed | version | assertion | fixture",
  "title": "<one line, names the upstream thing and the local seam>",
  "localSeam": "<repo-relative path(s) this would touch, or 'none' — never a guess>",
  "severity": "high | med | low",
  "confidence": "high | med | low",
  "effort": "small | med | large",
  "whatItIs": "<what the upstream file/change actually is, from having read it>",
  "whyItMatters": "<named consequence for a named local file — the reason it might matter>",
  "evidence": "<the tag pair and path, or the deterministic check's own detail string, verbatim>"
}
```

`whatItIs` and `whyItMatters` are separate fields on purpose: a reader must be able to act on this without re-running the diff (and without network access). If `whyItMatters` only restates `whatItIs` in different words, you have not done step 5.2.

## 9. Do not flag

- Upstream's own tests, CI config, lockfiles, demos, or documentation *about upstream's development* — none of it is surface this repo could consume.
- A file that moved within the contract root without changing (an `added` path whose `removed` counterpart is the same basename with the same size). Report a move as one finding, not two, and only when this repo cites the old path.
- Version bumps in upstream's own manifests, absent a behavior change you can point at.
- Upstream code quality, or the wisdom of upstream's design decisions. This procedure reports what exists, not whether it should.

## Worked example — `impeccable-plugin`, 4.0.2 → 4.0.4

The real diff, run against `pbakaus/impeccable` on 2026-08-07. Deterministic half: all `ok` — pinned 4.0.2 is installed, all three assertions resolve, no fixtures for this entry. Zero `drift` findings. That all-green result is exactly the state in which the capability class carries the entire value of the run.

Contract root resolves to `plugin/` (step 3). The subtree diff (step 4) yields 25 added paths, 0 removed. Two of the resulting findings:

```json
{
  "dependency": "impeccable-plugin",
  "class": "capability",
  "installedTag": "skill-v4.0.2",
  "latestTag": "skill-v4.0.4",
  "upstreamPath": "plugin/skills/impeccable/reference/live-setup.md",
  "changeKind": "added",
  "title": "Live mode gained a one-time project-setup path that this repo's live wrapper does not model",
  "localSeam": "plugin/skills/design-wrapper/modes/live.md",
  "severity": "med",
  "confidence": "med",
  "effort": "small",
  "whatItIs": "A new reference sub-file documenting the one-time creation of .impeccable/live/config.json (files/exclude/insertBefore/commentSyntax/cspChecked), with a per-framework table for the inject target. live.md loads it only when live.mjs reports config_missing or config_invalid, on configDrift, or when the config lacks cspChecked.",
  "whyItMatters": "live.md:27 delegates to upstream verbatim but enumerates the states it expects — 'boot, poll loop, generate/accept/discard/exit' — and the config-missing branch is not among them. A project with no .impeccable/live/config.json therefore has a precondition the wrapper's reachability gate does not check, so live mode is gated as available and then stalls on setup. Note that grepping this repo for 'live-setup', 'config_missing' or 'cspChecked' returns nothing at all; the gap is visible only from the tree comparison.",
  "evidence": "Present in tree at skill-v4.0.4, absent at skill-v4.0.2; contract root plugin/."
}
```

```json
{
  "dependency": "impeccable-plugin",
  "class": "capability",
  "installedTag": "skill-v4.0.2",
  "latestTag": "skill-v4.0.4",
  "upstreamPath": "plugin/agents/impeccable-documenter.md",
  "changeKind": "added",
  "title": "A fourth upstream subagent writes DESIGN.md from the shipped artifact — a producer for surface this repo only consumes",
  "localSeam": "plugin/skills/visualize/SKILL.md, plugin/skills/design-wrapper/SKILL.md, plugin/skills/init/bootstrap/step-11-impeccable-design-integration.md",
  "severity": "low",
  "confidence": "med",
  "effort": "med",
  "whatItIs": "A subagent definition (tools Read/Write/Bash/Glob/Grep, maxTurns 30) that records DESIGN.md and its sidecar after a build, deriving tokens from the built code rather than from intent, and reconciling rather than replacing an existing DESIGN.md. The installed 4.0.2 exposes three agents; this is the fourth.",
  "whyItMatters": "Nine files under plugin/skills/ read DESIGN.md — /visualize styles its output from those tokens — but nothing in this repo produces it, so the tokens are whatever a human last wrote. This is the missing producer for an already-wired consumer, and it arrives with an upgrade this repo has not taken.",
  "evidence": "Present in tree at skill-v4.0.4, absent at skill-v4.0.2; contract root plugin/."
}
```

Note what neither finding does: neither says "new file added." Both name the upstream thing, name the local file whose current text leaves a gap, and state the consequence. That is the bar (acceptance criterion 3 of `#142`).
