---
files:
  - plugin/bin/lib/repo-resolve.js
  - plugin/bin/pr-checklist.js
  - plugin/bin/lib/compose-subject.js
  - plugin/bin/lib/wrap-up/engine-verify.js
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/materialize.js
  - plugin/bin/fetch-sub-issues.js
  - plugin/bin/lib/issues/parent-gate.js
---

# Run a Pipeline on a GitHub Enterprise Origin Without Exporting GH_HOST

**Persona:** Maintainer whose project's `origin` is a GitHub Enterprise Cloud remote (`https://acme.ghe.com/acme/widgets.git`), with `gh` authenticated to that host and `GH_HOST` not exported. They run a `pr-first` `/claude-tweaks:flow #N` through `/claude-tweaks:wrap-up #N merge`. In #4505's report the PR checklist row stayed unflipped (`gh pr view` timed out), the merge subject failed, and wrap-up verify reported acceptance-labeling `unknown` because its GraphQL call resolved the repo on github.com.
**Goal:** Every claude-tweaks CLI talks to the enterprise host on its own, with no `GH_HOST` export and no per-command `-R`.
**Entry point:** Any plugin `bin/` CLI that shells out to `gh` from inside the GHE checkout, first reached at `/claude-tweaks:build` Spec Step 1 or the first phase exit (`pr-checklist.js --run … --phase build`).
**Success state:** The phase checklist rows flip, `compose-subject.js` composes the merge subject, `wrap-up-engine.js verify` reports acceptance-labeling as a real verdict, and one stderr line per process says which host the plugin chose. The maintainer should feel the plugin simply works on GHE, and can see why.

## Steps

### 1. The first gh call picks the enterprise host — `plugin/bin/lib/repo-resolve.js` `ghOptions`
- **URL:** —
- **Action:** `pr-checklist.js --run … --phase build` runs `gh pr view <n> --json body`. The `ghOptions` seam reads `origin` once for that working directory, sees a known GitHub host (`acme.ghe.com` ends in `.ghe.com`), and runs the child with `GH_HOST=acme.ghe.com`. stderr shows `claude-tweaks: resolved repo acme.ghe.com/acme/widgets (host: acme.ghe.com) — gh calls get GH_HOST=acme.ghe.com` once per process.
- **Should feel:** Quiet and visible at once. Nothing to configure, and one line names the host in case it is wrong.
- **Should understand:** A host is "known" when it ends in `.ghe.com`, is a key in gh's `hosts.yml` (a GHES host after `gh auth login --hostname`), or an enterprise token (`GH_ENTERPRISE_TOKEN`/`GITHUB_ENTERPRISE_TOKEN`) is set and the remote is not SSH. A github.com origin gets nothing injected, and argv and env stay byte-identical. The enterprise-token clause never admits a well-known non-GitHub forge (`gitlab.com`, `bitbucket.org`, Azure DevOps, …), because gh sends that token to whatever host `GH_HOST` names; a `hosts.yml` key still counts. An origin read that times out is not remembered: stderr shows `claude-tweaks: reading origin timed out in {dir} — gh calls there use the default host until it answers` once, and the next call reads origin again.
- **Red flags:** `gh pr view failed on PR #N: spawnSync gh ETIMEDOUT` on a GHE origin; the note printed on a github.com origin; `GH_HOST` injected for a `gitlab.com` origin because an enterprise token is exported.

### 2. The merge subject composes — `plugin/bin/lib/compose-subject.js`
- **URL:** —
- **Action:** `compose-subject.js N --tag human-approved --pr N` runs `gh issue view N --repo acme.ghe.com/acme/widgets --json …`. The host-qualified `--repo` already routes the call, so the seam steps back. The subject prints and the command exits 0.
- **Should feel:** Routine: the merge step does not stall on the subject.
- **Should understand:** Any explicit `-R`/`--repo`/`--hostname` makes the seam step back (the record's Decision Q2). A bare `owner/repo` means github.com. Flag values such as a `--body` that happens to start with `-R` never count as a flag.
- **Red flags:** `gh issue view N failed` on GHE; a `GH_HOST` injected on a call that already names its host.

### 3. Wrap-up verify and the pack reach the host — `plugin/bin/lib/wrap-up/engine-verify.js`, `plugin/bin/lib/wrap-up/pack.js`
- **URL:** —
- **Action:** `wrap-up-engine.js verify` runs its acceptance-labeling `gh api graphql -f owner=acme -f repo=widgets …` with `GH_HOST=acme.ghe.com`, and the wrap-up pack's `gh` probes do the same. Acceptance-labeling reports pass or fail instead of `unknown`.
- **Should feel:** The verify table reads like it does on github.com.
- **Should understand:** GraphQL `-f repo=…` variables are not an explicit repo, so these calls get the host. The upstream-feedback check still reads github.com, because it names its repo with an explicit bare `--repo`.
- **Red flags:** `Could not resolve to a Repository with the name 'acme/widgets'`; acceptance-labeling `unknown` with a GHE origin.

### 4. An explicit choice still wins — `plugin/bin/materialize.js` with `--repo`, or an exported `GH_HOST`
- **URL:** —
- **Action:** The maintainer either exports `GH_HOST=other.example` or runs `materialize.js N --repo owner/name`. With the export, no claude-tweaks call overwrites it. With `--repo owner/name`, every `gh` call that run makes (the issue view and the author-association lookup) goes to github.com, the host the bare slug names.
- **Should feel:** In control: the plugin defers to what the maintainer said.
- **Should understand:** An explicit `--repo` pins its own host for that CLI's calls, so one record is never read from two hosts. The pin stays out of the record's own Premise-check command, which runs with the environment it had before. An SSH host alias remote (`git@github-work:acme/widgets.git`) gets no injection at all, because gh resolves aliases itself.
- **Red flags:** An exported `GH_HOST` replaced by the origin host; `materialize --repo owner/name` reading the issue on github.com but its author on the GHE host; `none of the git remotes correspond to the GH_HOST environment variable` on an SSH-alias checkout.

### 5. Sub-issue lookups name their host — `plugin/bin/fetch-sub-issues.js`, `plugin/bin/lib/issues/parent-gate.js`
- **URL:** —
- **Action:** The parent gate (`parent-gate.js`), or a maintainer, runs `fetch-sub-issues.js 1095 --repo acme.ghe.com/acme/widgets`. The `subIssues` schema probe and every batched page run as `gh api graphql --hostname acme.ghe.com -f query=…`. A truncated or missing parent falls back to the `--resolve-retries` REST call `gh api --paginate repos/acme/widgets/issues/1095/sub_issues --jq .[].number --hostname acme.ghe.com`. The JSON envelope lists the enterprise repo's real sub-issues.
- **Should feel:** The sub-issue list matches what the enterprise issue page shows, with no separate host setup for this one CLI.
- **Should understand:** Each GraphQL call names its own host right after `graphql`, so the result never depends on which `GH_HOST` the process inherited (#4806). A github.com repo sends no `--hostname` at all. The parent gate no longer adds the host to the fetcher's calls itself, because the fetcher already sends it. The gate still adds it to its own parent lookup, REST fallback, and `api user` reads.
- **Red flags:** A sub-issue list that is empty, or that names github.com issues, for an enterprise parent. A `gh api graphql` argv carrying `--hostname` twice. Any `--hostname` on a github.com run.

## Origin
- Created during build of #4505 (bin/ gh calls: GitHub Enterprise host dropped again, regression of #2538)
- Steps 1-4 built in this session: the `ghOptions` seam, its migration across every `plugin/bin` `gh` spawn, the explicit-`--repo` pin, and `tests/gh-host-seam-behavior.test.js` / `tests/gh-host-seam-conformance.test.js`
- Step 5 added during build of #4806 (fetch-sub-issues.js's schema probe and GraphQL pages pass `--hostname` off github.com; parent-gate.js drops its `onHost` wrap of the fetcher), pinned by `tests/fetch-sub-issues-cli.test.js`'s #4806 test and the Enterprise-host tests in `tests/bin-lib/issues/parent-gate.test.js` and `tests/parent-gate-cli.test.js`
- Related: `open-a-run-pr-on-a-slow-gh-host-4554.md` (the same host when `gh` is slow rather than misrouted)
