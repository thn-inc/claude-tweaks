export const meta = {
  name: 'tiebreak-batching-replay',
  description: 'Replay archived review tiebreaks: one batched judge per review versus one judge per finding',
  phases: [
    { title: 'Batched', detail: 'one judge per review, all its findings in one agent', model: 'opus' },
    { title: 'Individual', detail: 'control arm: one judge per finding on two reviews', model: 'opus' },
  ],
}

const { root, runs } = args

const VERDICTS = {
  type: 'object',
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'the finding id from the input file, copied exactly' },
          verdict: { type: 'string', enum: ['confirmed', 'refuted', 'cant-tell'] },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low', 'info'] },
          evidence: { type: 'string', description: 'path:line and the whole cited source line, verbatim; empty for cant-tell' },
          recommendation: { type: 'string', enum: ['file', 'drop'] },
          reason: { type: 'string', description: 'one line' },
        },
        required: ['id', 'verdict', 'severity', 'evidence', 'recommendation', 'reason'],
      },
    },
  },
  required: ['verdicts'],
}

function prompt(run, file, many) {
  const tree = `${root}/${run}/tree`
  return `You are the independent tiebreak judge for ${many ? 'each of the code-review findings' : 'the one code-review finding'} in this JSON file: ${file}

Each entry has an id, the review lens it was raised under, a Location (path and line, repo-relative), the reporter's severity, and the claim.${many ? ' Judge each finding on its own, independently of the others: one finding being right or wrong says nothing about the next.' : ''}

The repository at the reviewed commit is a plain extract at ${tree} (not a git checkout: do not run git). Paths in Location are relative to that directory.

For each finding, re-read the live file at Location and decide from the code itself whether the finding holds. You were deliberately given no account of how it was reported.
- Verdict: confirmed | refuted | cant-tell.
- Evidence is required for confirmed and refuted: cite the Location path exactly as given and a line within 5 of Location, and quote the whole cited source line verbatim. cant-tell needs no evidence.
- Recommendation "file" means the finding is worth a fix or a work record; "drop" means it is not worth acting on.
- A vacuity claim (that a test cannot fail, or that its cases are vacuous) cannot be confirmed by reading code: never answer confirmed for one.
- Give your own severity.

Read-only: never run test suites, builds or servers, and never create, edit or delete a file. Read files with the Read tool; for searching use one plain grep command per Bash call with literal absolute paths.

Return one verdict per finding in the file, with each id copied exactly.`
}

const batched = () => parallel(runs.flatMap(r =>
  Array.from({ length: r.chunks }, (_, i) => () =>
    agent(prompt(r.run, `${root}/${r.run}/chunk-${i + 1}.json`, true), { label: `batch:${r.run.slice(-9)}#${i + 1}`, phase: 'Batched', schema: VERDICTS, model: 'opus', effort: 'high' })
      .then(v => ({ run: r.run, chunk: i + 1, failed: v === null, verdicts: (v && v.verdicts) || [] }))
  )
))

const individual = () => parallel(runs.flatMap(r =>
  r.singles.map(id => () =>
    agent(prompt(r.run, `${root}/${r.run}/single-${id}.json`, false), { label: `single:${r.run.slice(-9)}:${id.slice(0, 6)}`, phase: 'Individual', schema: VERDICTS, model: 'opus', effort: 'high' })
      .then(v => ({ run: r.run, id, failed: v === null, verdicts: (v && v.verdicts) || [] }))
  )
))

const [b, s] = await parallel([batched, individual])
return { batched: b, individual: s }
