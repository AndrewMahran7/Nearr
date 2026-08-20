# Agent task template

Copy this into the brief for each parallel agent. One agent, one worktree, one branch.
Full context in [DEVELOPMENT_WORKFLOW.md](DEVELOPMENT_WORKFLOW.md).

---

## Assignment

```
task          <one sentence: what "done" looks like>
branch        feat/<slug>
worktree      C:\Users\andre\Desktop\Nearr-worktrees\<slug>
base commit   <full sha — from `npm run task:new`>
```

## Rules

1. **Work only inside your worktree.** Never read, write, or `cd` into another
   `Nearr-worktrees\*` directory. They belong to other agents working right now.
2. **Never switch branches** inside the worktree, and never rebase onto or merge
   `main` unless asked. You start from the recorded base commit and stay there.
3. **Commit your own work**, in focused commits, on your branch only.
4. **Never merge into `main`.** Integration is a human step on a separate branch.
5. **Never deploy production.** No `eas update --channel production`, no
   `eas build --profile production`, no `eas submit`, no `supabase db push --linked`,
   no `supabase functions deploy` against the production ref, no `railway up ... production`.
   Use `npm run dev:*` if you need a running backend at all.
6. **Never mutate production data** and never print secret values.
7. If a change needs the phone, say so and stop — the `development` channel is a single
   shared slot and the human decides who gets it.

## Before you report done

```powershell
npm run typecheck
npm run test:prebuild          # or the specific suites your change touches
npm run verify:env             # if you touched config or environment handling
```

## Report back

```
commit(s)         <sha> <subject>
base commit       <sha you started from>
files changed     <list>

migrations        none | supabase/migrations/<file> — what it does, is it reversible,
                  is it additive or destructive
backend impact    none | Edge Function <name> | services/media-worker | RLS/grants
deploy needs      none | OTA-able (JS only) | needs a new native build (say why)
                  | needs a migration before the app ships
                  | needs backend deployed before app (state the order)

tests run         <commands + result>
device check      not needed | needed because <what a simulator cannot show>

risks             what could break that the tests do not cover
conflicts likely  files another task is probably also touching
deferred          anything you chose not to do, and why
```

## Why the report matters

Integration is done by merging your branch into `integration/<milestone>` alongside two or
three others, then testing the combined result on a physical iPhone. The person doing that
cannot see your reasoning — only your diff. Deployment ordering (migration before app?
backend before frontend?) is invisible in a diff and is exactly what breaks production when
several features land together.
