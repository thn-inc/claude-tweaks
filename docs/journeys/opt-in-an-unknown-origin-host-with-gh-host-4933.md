---
files:
  - plugin/bin/lib/repo-resolve.js
  - plugin/bin/materialize.js
  - plugin/bin/lib/hooks/git-exec.js
  - plugin/bin/lib/hooks/teardown-run.js
  - plugin/bin/lib/reconcile/post-merge.js
  - plugin/bin/lib/reconcile/format-summary.js
  - plugin/bin/lib/wrap-up/pack.js
  - plugin/bin/post-merge-run.js
  - plugin/bin/lib/compose-subject.js
  - plugin/bin/release-claim.js
  - plugin/bin/repair-claim.js
  - plugin/bin/preflight-records.js
  - plugin/bin/parent-gate.js
  - plugin/bin/resolved-refusal.js
  - plugin/bin/link-records.js
  - plugin/bin/fetch-sub-issues.js
  - plugin/bin/backlog-grant-gate.js
  - plugin/bin/apply-refine-labels.js
  - plugin/bin/file-feedback.js
  - plugin/bin/list-claims.js
  - plugin/bin/lib/number-list-cli.js
  - plugin/bin/stuck-open-prs.js
  - plugin/bin/claim-targets.js
  - plugin/bin/stale-claim-pr.js
  - plugin/skills/backlog/attention-mode.md
---

# Opt an Unknown Origin Host Into gh With GH_HOST

**Persona:** Maintainer on a GitHub Enterprise Server whose project `origin` is `https://git.corp.example/acme/widgets.git`. `gh` works for them through an exported `GH_ENTERPRISE_TOKEN`. They never ran `gh auth login --hostname`, so the host is not in gh's `hosts.yml`, and they do not export `GH_HOST`. Before #4933, claude-tweaks' issue CLIs sent `--repo git.corp.example/acme/widgets` and `--hostname git.corp.example` to gh on the strength of that origin alone. An origin on GitLab or a self-hosted forge got the same treatment.
**Goal:** No claude-tweaks command sends their origin host to gh until they say it is a GitHub host. When a command refuses, it tells them exactly how to say so.
**Entry point:** The first claude-tweaks issue CLI that reads `origin`, typically `materialize.js N` at `/claude-tweaks:build` Spec Step 1. The SessionStart background reconcile reaches the same gate without any CLI run.
**Success state:** The refused command exits 2 and prints one line naming the host and the `GH_HOST={host}` opt-in. After `export GH_HOST=git.corp.example`, every command reaches the host. The maintainer should feel told rather than silently redirected: nothing went to the wrong host while they decided.

## Steps

### 1. An issue CLI refuses the host — `plugin/bin/materialize.js` through `gateOriginRepo` in `plugin/bin/lib/repo-resolve.js`
- **URL:** —
- **Action:** `materialize.js 4933` reads `origin` and finds `git.corp.example`. That host is not `github.com`, does not end in `.ghe.com`, is not a `hosts.yml` key, and no `GH_HOST` is exported. The CLI writes `materialize.js: origin host git.corp.example is not a known GitHub host (not github.com, not *.ghe.com, not a gh hosts.yml key) — refusing to send it to gh; if it is GitHub Enterprise, export GH_HOST=git.corp.example` to stderr and exits 2. It makes no `gh` call besides the `gh --version` probe.
- **Should feel:** Stopped at the door with the key in hand: one line, the host named, the exact export to run.
- **Should understand:** Eighteen CLIs share this gate: materialize, compose-subject, release-claim, repair-claim, preflight-records, parent-gate's gh path, resolved-refusal, link-records, fetch-sub-issues, backlog-grant-gate, apply-refine-labels, file-feedback, list-claims, resolve-blockers, resolve-linked-prs, stuck-open-prs (#4951), claim-targets (#4794, which refuses only: its repo still comes from gh) and stale-claim-pr (#4794). Each one but the last exits 2, its usual "could not resolve owner/repo" code; stale-claim-pr exits 0 with an `unknown-host: {refusal}` verdict whose `match` is false, as it does for every verdict. `/claude-tweaks:backlog attention` runs stuck-open-prs and shows its refusal in the `stuck:open-pr` note line as `(exit 2: {refusal})`. None of them falls back to a bare `owner/repo`, which gh would send to github.com, possibly to a stranger's repo of the same name. An enterprise token alone is not a signal. An exported but empty `GH_HOST` is not an opt-in either; the gh host seam reads an empty value the same way (#4794). `parent-gate.js --facts-json` makes no gh call, so it still parses the origin without refusing.
- **Red flags:**
  - A recorded `gh` argv carrying `--repo git.corp.example/…` or `--hostname git.corp.example`.
  - A bare `--repo acme/widgets` on a refused run.
  - A refusal that does not name `GH_HOST=git.corp.example`.
  - An exit code other than 2.

### 2. A typed `--repo` is never second-guessed — any gated CLI with `--repo git.corp.example/acme/widgets`
- **URL:** —
- **Action:** The maintainer reruns `materialize.js 4933 --repo git.corp.example/acme/widgets`. The CLI sends that `--repo` exactly as typed and does not refuse.
- **Should feel:** In control: an explicit choice is taken at its word.
- **Should understand:** Only an origin-derived host is gated. A typed `--repo`, host-qualified or bare, keeps its existing path: no gate and no normalization.
- **Red flags:** A typed `--repo` refused, rewritten, or lower-cased.

### 3. The opt-in admits the host everywhere — `export GH_HOST=git.corp.example`
- **URL:** —
- **Action:** The maintainer exports `GH_HOST=git.corp.example` and reruns. Every gated CLI now sends the host-qualified `--repo git.corp.example/acme/widgets`, and `--hostname git.corp.example` on `gh api` calls.
- **Should feel:** A one-time setup, not a per-command chore.
- **Should understand:**
  - An exported non-empty `GH_HOST` always wins. That includes a `GH_HOST` naming a different host, such as `github.com` while the origin is GitLab. Then no command names the origin host, the slug is bare, and gh reaches the exported host.
  - The same holds for a known GitHub origin. With `acme.ghe.com` as origin and `GH_HOST=github.com` exported, the bare slug goes to github.com. This is the approved order, kept for review.
  - Running `gh auth login --hostname git.corp.example` puts the host in `hosts.yml` and admits it permanently. gh refuses that login while an enterprise token is exported, so unset the token first.
- **Red flags:** A refusal after exporting a matching `GH_HOST`, or the origin host named to gh while `GH_HOST` names another host.

### 4. Hooks and background passes skip instead of breaking — `plugin/bin/lib/hooks/teardown-run.js`, `plugin/bin/lib/reconcile/post-merge.js`, `plugin/bin/lib/reconcile/format-summary.js`, `plugin/bin/lib/wrap-up/pack.js`
- **URL:** —
- **Action:** Without the opt-in:
  - A run teardown prints `remote ref: skipped (unknown-host) — origin host git.corp.example is not a known GitHub host …` and deletes no remote ref.
  - The reconcile pass reports `skipped: post-merge — unknown-host (origin host git.corp.example is not a known GitHub host … export GH_HOST=git.corp.example)`.
  - `post-merge-run.js` returns the same `detail` on its entry.
  - The wrap-up pack's unblocked probe reports the refusal as its failure.
- **Should feel:** The session carries on. The skip names the same opt-in the CLI gave, so there is one fix for every symptom.
- **Should understand:**
  - Hook-side code never throws or exits on a refused host.
  - A post-merge run that was skipped is retried on a later pass once the opt-in is set.
  - The gate reads an `ssh://`, credentialed or ported origin the way the seam does (#4794), so it is admitted or refused on its host exactly as its plain spelling is; a remote that read does not parse (a cloud sandbox's proxy remote, a local path) falls back to the loose reader (#4857), which never names an unknown host either.
- **Red flags:**
  - A SessionStart error.
  - A `gh api -X DELETE` to an unknown host.
  - A reconcile skip line with no host and no `GH_HOST=` text.
  - A multi-line detail breaking the one-line summary.

## Origin
- Created during the build of #4933 (origin host gated before reaching gh; refuse, never drop), run 2026-11-02T074712-spec-4933-4951.
- Updated during the build of #4951 (stuck-open-prs.js moved onto the gate; its refusal surfaces in `/claude-tweaks:backlog attention`), same run; pinned by `tests/bin-lib/dispatch/stuck-open-pr.test.js`.
- Pinned by `tests/bin-lib/repo-resolve.test.js` (gate unit cases), `tests/gh-host-seam-behavior.test.js` (refusal, pass-through and normalization for each of the 16 `CLI_TABLE` CLIs, plus dedicated refusal cases for claim-targets and stale-claim-pr), `tests/gh-host-seam-conformance.test.js` (the `ORIGIN_GATED` roster), `tests/hooks-teardown-run.test.js`, `tests/bin-lib/reconcile/post-merge.test.js`, `tests/reconcile.test.js` and `tests/bin-lib/wrap-up/pack.test.js`.
- Related: `run-a-pipeline-on-a-ghe-origin-without-gh-host-4505.md` covers the known-host path, where the same origin rules admit the host with no export.
