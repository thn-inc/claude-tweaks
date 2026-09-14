'use strict';

// bin/lib/issue-branch-tracking.js
// Pure: extract GitHub closing-keyword issue references from commit messages,
// and generate the companion GitHub Actions workflow
// (.github/workflows/track-issue-fixes.yml) that tracks those references on
// non-default branches (label + comment) and cleans up once the fix reaches
// the default branch (GitHub's native keyword-close fires there). No network
// here — /init writes the generated YAML; the workflow itself runs `gh`
// inside GitHub Actions, independent of claude-tweaks at runtime.
// Note: GitHub's push webhook payload caps at 20 commits, so a push with
// more than that will miss references in the truncated commits — the same
// limitation GitHub's own native keyword parsing already has.

const ISSUE_REF_SOURCE = '\\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\\s+#([0-9]+)';

function extractIssueNumbers(commitMessages) {
  const found = new Set();
  const re = new RegExp(ISSUE_REF_SOURCE, 'gi');
  for (const message of commitMessages || []) {
    if (typeof message !== 'string') continue;
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(message)) !== null) {
      found.add(Number(match[1]));
    }
  }
  return Array.from(found).sort((a, b) => a - b);
}

// Shared "Extract referenced issues" step — identical in both jobs below (each
// needs its own list of issues this push references before doing job-specific
// work with them). Kept as one array so a future fix to the extraction shell
// (e.g. handling multi-line commit messages, or changing the sort -un dedup)
// can never land in one job's copy and not the other's.
//
// The JS side (extractIssueNumbers) matches ISSUE_REF_SOURCE against each
// commit message as one whole string, so `\s+` between the closing keyword
// and the issue number spans an embedded newline (a hard-wrapped commit
// body, e.g. "This closes\n#123"). `grep` without `-z` processes its input
// line-by-line even under `-P`, so `\s+` can never bridge a real newline
// there — the same pattern would silently miss that reference. `jq
// --raw-output0` NUL-terminates each commit message (instead of `-r`'s
// per-message trailing newline), and `grep -z` treats NUL, not newline, as
// the record separator, so `\s+` can span a message's own internal newlines
// while still never crossing into the next commit's message.
function extractReferencedIssuesStep() {
  return [
    '      - name: Extract referenced issues',
    '        id: extract',
    '        env:',
    '          COMMITS_JSON: ${{ toJson(github.event.commits) }}',
    '        run: |',
    `          PATTERN='${ISSUE_REF_SOURCE}'`,
    '          # Drop revert commits: git\'s default revert subject is `Revert "{original subject}"`,',
    '          # which verbatim re-contains any closing keyword the reverted commit had.',
    `          echo "$COMMITS_JSON" | jq --raw-output0 '.[] | select(.message | startswith("Revert \\"") | not) | .message' > "$RUNNER_TEMP/commit_messages.txt"`,
    "          ISSUES=$(grep -zoiP \"$PATTERN\" \"$RUNNER_TEMP/commit_messages.txt\" | tr '\\0' '\\n' | grep -oP '[0-9]+' | sort -un | tr '\\n' ' ' || true)",
    '          echo "issues=$ISSUES" >> "$GITHUB_OUTPUT"',
  ];
}

function generateWorkflowYaml() {
  const lines = [
    'name: Track issue fixes across branches',
    '',
    'on:',
    '  push:',
    '    branches:',
    "      - '**'",
    '',
    'permissions:',
    '  contents: read',
    '  issues: write',
    '',
    'concurrency:',
    '  group: track-issue-fixes-${{ github.ref }}',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  label-fix-branch:',
    "    if: github.ref != format('refs/heads/{0}', github.event.repository.default_branch)",
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...extractReferencedIssuesStep(),
    '      - name: Label and comment on each referenced issue',
    "        if: steps.extract.outputs.issues != ''",
    '        env:',
    '          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    '          REPO: ${{ github.repository }}',
    '          BRANCH_RAW: ${{ github.ref_name }}',
    '          SHA: ${{ github.sha }}',
    '          ISSUES: ${{ steps.extract.outputs.issues }}',
    '        run: |',
    '          BRANCH=$(echo "$BRANCH_RAW" | tr \'[:upper:]\' \'[:lower:]\' | tr \'/\' \'-\')',
    '          LABEL="fix-on-${BRANCH}"',
    '          # Branch-scoped marker embedded in the comment body for dedup -- survives amend+force-push',
    '          # of the same logical fix, unlike matching the exact (unstable) commit SHA text.',
    '          MARKER="<!-- track-issue-fixes:${BRANCH} -->"',
    // #1873: fix-on-{branch} is a dynamic, per-branch label, not a member of
    // _shared/label-bootstrap.md's canonical LABELS_JSON — its own
    // pre-existing --color FBCA04 is left as is (not migrated into that
    // array), noted here so a reader doesn't mistake the coincidental amber
    // for a mid-migration gap.
    '          gh label create "$LABEL" --color FBCA04 \\',
    '            --description "Fixed on ${BRANCH}, not yet on the default branch" \\',
    '            --repo "$REPO" || true',
    '          for ISSUE in $ISSUES; do',
    '            # GitHub\'s REST Issues API returns PRs too, distinguished by a `pull_request` key --',
    '            # a closing-keyword reference to a PR number is not an issue to label/comment on.',
    '            IS_PR=$(gh api "repos/$REPO/issues/$ISSUE" --jq \'has("pull_request")\' || echo "")',
    '            if [ "$IS_PR" = "true" ]; then',
    '              echo "::warning::#$ISSUE is a pull request, not an issue -- skipping label/comment"',
    '              continue',
    '            fi',
    '            gh issue edit "$ISSUE" --add-label "$LABEL" --repo "$REPO" || true',
    '            # Skip if we already commented for this branch (avoids duplicate comments on',
    '            # re-push/force-push, including an amended commit under a new SHA).',
    '            # gh issue view --json comments fully paginates (cli/cli\'s preloadIssueComments',
    '            # loops the GraphQL comments connection, 100/page, until hasNextPage is false --',
    '            # verified against gh v2.96.0 source, pkg/cmd/issue/view/http.go), so this dedup',
    '            # check sees the full comment history rather than a possibly-truncated first page.',
    '            EXISTING=$(gh issue view "$ISSUE" --repo "$REPO" --json comments -q \'.comments[].body\' | grep -F "$MARKER" || true)',
    '            if [ -z "$EXISTING" ]; then',
    '              BODY="Fixed by ${SHA} on \\`${BRANCH}\\`. Will close automatically once this reaches the default branch."$\'\\n\'"${MARKER}"',
    '              gh issue comment "$ISSUE" --repo "$REPO" --body "$BODY" || true',
    '            fi',
    '          done',
    '',
    '  cleanup-fix-labels:',
    "    if: github.ref == format('refs/heads/{0}', github.event.repository.default_branch)",
    '    runs-on: ubuntu-latest',
    '    steps:',
    ...extractReferencedIssuesStep(),
    '      - name: Strip fix-on-* labels from closed issues',
    "        if: steps.extract.outputs.issues != ''",
    '        env:',
    '          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}',
    '          REPO: ${{ github.repository }}',
    '          ISSUES: ${{ steps.extract.outputs.issues }}',
    '        run: |',
    '          for ISSUE in $ISSUES; do',
    '            LABELS=$(gh issue view "$ISSUE" --repo "$REPO" --json labels -q \'.labels[].name\' | grep \'^fix-on-\' || true)',
    '            if [ -n "$LABELS" ]; then',
    '              # One call per label -- a single rejected/already-removed label no longer blocks',
    '              # removal of the others in the same batch (the prior REMOVE_ARGS[] batching did).',
    '              while IFS= read -r LABEL; do',
    '                [ -n "$LABEL" ] && (gh issue edit "$ISSUE" --remove-label "$LABEL" --repo "$REPO" || true)',
    '              done <<< "$LABELS"',
    '            fi',
    '          done',
    '',
  ];
  return lines.join('\n');
}

module.exports = { ISSUE_REF_SOURCE, extractIssueNumbers, generateWorkflowYaml };
