# Recognition release gate

Recognition releases use the fixed 16-case manifest in
`artifacts/recognition-release-canary/manifest.json`. The suite contains five
easy business/landmark cases, four hard visual cases, three ambiguous cases,
two parent/child cases, and two zero-hypothesis recovery cases. Each candidate
cheap model receives the same acquired evidence. Sol is invoked only when the
normal production router requests it.

Run the deterministic contract first:

```sh
npm run test:auto-completion
```

Run the paid release canary only with explicit acknowledgement:

```sh
RECOGNITION_CANARY_CONFIRM_PAID=1 npm --prefix services/media-worker run canary:recognition-release
```

The report must include Exact@1, Exact@3, plausible top-1, easy solve rate,
Sol escalation, model cost, latency, contradictions, automatic completion,
and manual intervention. Select the lowest expected total cost per completed
share that is near-perfect on easy cases and introduces no absurd semantic or
geographic saves.

The historical 91-case and 42-cliff suites are not routine release gates. A
full paid regression is reserved for a major architecture redesign, provider
replacement, major prompt redesign, deliberate benchmark milestone, or a
pre-fundraising/product-quality audit. It requires explicit approval before
spend.

Historical unresolved queue rows are not mass-saved. Their evidence predates
the durable ranked-candidate contract and cannot be assumed safe. Automatic
completion and soft alternatives apply to new submissions; old rows remain
available under their existing semantics.
