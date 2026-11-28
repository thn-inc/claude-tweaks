# Step 1: Evidence

Loaded by `/claude-tweaks:design` when `status` resumes at step 1.

Find what already exists before any idea is discussed. Nothing is proposed — no approach, no fix, no opinion on the topic — until `evidence.md` has passed its check and been shown to the maintainer.

## 1. Search

`action: 'continue'` with an `evidence.md` already present: read it. When this session still holds every searcher's reply, go to section 2 — or to section 3 when those replies' sources were already checked this session. Otherwise the file does not say which areas were searched, so run every searcher again and merge their claims with the file's, dropping duplicates. Either way the file is shown (section 3) before it is marked done.

> **Parallel execution:** Dispatch one searcher per area below as parallel Task agents — each runs independently and returns claim/source pairs. Assemble results after all agents complete.

`[Use: Fast]` — resolve once with `node "${CLAUDE_PLUGIN_ROOT}/bin/resolve-profile.js" fast` and set each `Agent` call's `model` to the printed `model`, and `effort` to `launchEffort` when it is not `null`. Dispatch every searcher in one message, each a fresh agent (never `subagent_type: "fork"`). The searchers are read-only and carry no git writes: parallel agents with git access race on one index.

| Area | `{area}` | `{how}` |
|---|---|---|
| Issues | open and closed issues | `gh issue list --search "{keywords}" --state all --limit 30 --json number,title,state`, then `gh issue view {N}` for each relevant one |
| Merges | merges of the last six weeks | `git log --merges --since="6 weeks ago" --oneline`, then `git show --stat {sha}` for each relevant one |
| Run data | pipeline run data | Grep `.claude-tweaks/pipelines/*/decisions.md` under the main checkout (the parent of `git rev-parse --git-common-dir`) |
| Code | the code | Grep and Glob over the repository's tracked files |
| Earlier designs | earlier designs | `docs/superpowers/specs/` and `docs/superpowers/plans/` |
| Settings | the settings file and its schema, for a feature built but switched off | `.claude-tweaks/policy.yml` and the policy schema (`plugin/bin/lib/policy-schema.js` in this plugin's own repository, else `${CLAUDE_PLUGIN_ROOT}/bin/lib/policy-schema.js`), plus any settings file and schema the repository has of its own |

Substitute the absolute plugin root for `${CLAUDE_PLUGIN_ROOT}` and the absolute `{repo root}` before dispatch. `{topic}` is the topic (for `#N`, the issue's title); `{keywords}` is two to five plain words from it, letters and digits only.

Each searcher's prompt is this block, filled in, with the resolver's `effortLine` appended when it is non-empty:

```
Task scope: find what already exists in the repository at {repo root} about this topic: {topic}
Search only this area: {area}
How to search: {how}

Read-only: read files and run read-only commands only. Never write, move or delete a file, and never stage, check out, stash or create anything in git. Run every command from {repo root}.

OUTPUT FORMAT (required):
Return ONLY pairs of lines, one pair per finding, most relevant first, at most 12 pairs, no preamble and no narration:

CLAIM: {one fact you found, stated so it can be checked}
SOURCE: {#N | sha | path:line | run folder}

SOURCE is one of: an issue or pull request as #N; a commit as its sha (7 to 40 hex characters); a file and line as a repository-relative path:line, or, for a file under ${CLAUDE_PLUGIN_ROOT}, as its absolute path:line; a run folder as .claude-tweaks/pipelines/{folder name}. A path may contain spaces (a plugin root under a spaced directory) but not ", ", and starts and ends at non-space characters, ending in the file's extension and `:line`. Several sources for one claim are joined by ", ". A claim you cannot give such a source for is not reported.

If your area holds nothing about the topic, return the literal text NOTHING FOUND and, on the next line, the search you ran.

The last non-empty line of your reply, alone:
STATUS: DONE | DONE_WITH_CONCERNS | NEEDS_CONTEXT | BLOCKED
```

A reply that does not match the format is re-prompted once (`_shared/subagent-output-contract.md`'s Re-prompt on violation), then used as it is. A `BLOCKED` searcher (for example, no `gh`) is named when `evidence.md` is shown, with what it could not reach.

## 2. Check each source is real

The source check below only tests a source's shape — any word of seven or more hex letters passes as a sha. Before writing a claim, check its source exists and says what the claim says:

- `#N` — `gh issue view {N} --json number,title` exits 0
- a sha — `git cat-file -t {sha}` prints `commit`
- `path:line` — the file exists under `{repo root}` and has that line; read it. An absolute path is checked the same way under the absolute plugin root instead, and counts only there: the settings area's schema lives under `${CLAUDE_PLUGIN_ROOT}/bin/lib/` outside this plugin's own repository
- a run folder — the directory exists under the main checkout's `.claude-tweaks/pipelines/`

Drop a claim whose source fails, or find it a real one. Merge claims two searchers both made.

## 3. Write, check, show

Write `{folder}/evidence.md` — its H1, its `Status:` line, and one `- {claim} — source: {source}` bullet per claim, nothing else:

```
# Evidence — {topic}
Status: in-progress

- {claim} — source: {source}
```

No area labels, headings or other lines go into the file. An area whose search found nothing, and a searcher that could not reach its area, are not written there — an absence has no source; they are said in the conversation when the file is shown.

When no claim survives section 2 — nothing was found, every claim was dropped, or a resumed search again found nothing — the check needs one claim, so write the zero-claim bullet below, with `{sha}` the full `git -C "{repo root}" rev-parse HEAD` of the checkout searched:

```
- Nothing on this topic was found in {the searched areas, from: issues, merges of the last six weeks, run data, the code, earlier designs, the settings file and schema} — source: {sha}
```

An area counts as searched when its searcher replied (claims, `NOTHING FOUND`, or a malformed reply used as is); the zero-claim bullet names the searched areas with no surviving claim; an area is unreached only when its searcher was `BLOCKED` or never replied; on every write the file holds at most one zero-claim bullet, rewritten from the current results. An unreached area is never named in the bullet; it is said in the conversation as unreached. When no area was searched at all, step 1 cannot finish: stop and tell the maintainer which searchers failed and why. The bullet exists only while there is no other claim: when a later search or a resumed session's merge adds any real claim, drop it.

Then run:

```bash
node "${CLAUDE_PLUGIN_ROOT}/bin/design-session.js" check-evidence --folder "{folder}"
```

While the file says `Status: in-progress` this exits 1 even when every claim is sound; read its JSON and require `unsourced: []` and `unclosedFence: false`. Anything else → fix the lines it names and run it again. Exit 2 → stop and show stderr.

Once `unsourced` is empty and no fence is open, show `evidence.md` to the maintainer, in full, followed by the areas that found nothing (with the search each ran) and any searcher that could not reach its area. Only after it has been shown, set `Status: done` and run `check-evidence` again; it must exit 0. Then run `status` and continue.

A resumed session (`action: 'continue'`) whose `evidence.md` is still `Status: in-progress` with no searches left to run goes straight to this section: check it, show it, then mark it done.
