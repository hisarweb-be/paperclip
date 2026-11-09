# Upstream PRs for HisarWeb patches

One row per patch from doc/HISARWEB-PATCHES.md once it is offered to
`paperclipai/paperclip`. When upstream merges it, the row in
HISARWEB-PATCHES.md moves to "Left out, with proof" at the next rebase.

First batch: offered on 8 November 2026, each PR as one fix on a branch
`upstream/<slug>` from upstream `master`, without code comments and
without internal references, as upstream CONTRIBUTING asks. Every PR
passed its vitest files locally (embedded Postgres where needed) and
`pnpm --filter @paperclipai/server typecheck` (plus the adapter-utils
typecheck for row 35).

| # | Commit | Purpose | HIS / fork PR | Test | Upstream-PR |
|---|---|---|---|---|---|
| 2 | 55e3455e0 | Bound external adapter loading, so one hanging package cannot keep startup recovery from finishing. | #38 | `server/src/__tests__/external-adapter-load-timeout.test.ts` | https://github.com/paperclipai/paperclip/pull/20131 |
| 5 | 081573590 | The wake after a plugin approval carries the linked issue, like the web approve route. | HIS-3147 | `server/src/__tests__/plugin-orchestration-apis.test.ts` | https://github.com/paperclipai/paperclip/pull/20132 |
| 10 | da77969e4 | An issue counts as run-locked only while its run is live. | HIS-4605 | `issue-agent-mutation-ownership-routes.test.ts`, `external-object-routes.test.ts` | https://github.com/paperclipai/paperclip/pull/20120 (closed after review: the live-run check has to move under the issue write lock and reuse the native-hold and continuation-claim rules; back in the next batch) |
| 11 (+24) | f6afa39de, 9ff8e239a | The two route cancels get a reason, an error code and a run event. | HIS-4483 | `server/src/__tests__/issue-comment-reopen-routes.test.ts` | https://github.com/paperclipai/paperclip/pull/20123 |
| 14 | 2a97dde91 | A monitor sent with a status that forbids it gets a 422 instead of being dropped. | HIS-5825 | `server/src/__tests__/issue-execution-policy-routes.test.ts` | https://github.com/paperclipai/paperclip/pull/20124 |
| 15 | 6f1a95918 | A self-review stage is dissolved when the status goes back. | HIS-5999 | `server/src/__tests__/issue-execution-policy.test.ts` | https://github.com/paperclipai/paperclip/pull/20125 |
| 16 | 53632630b | A monitor write keeps the stored review stages. | HIS-5991 | `server/src/__tests__/issue-execution-policy-routes.test.ts` | https://github.com/paperclipai/paperclip/pull/20126 |
| 17 | e887b2f3c | The dashboard joins `recovered_runs` instead of a subplan per run row. | HIS-5057 | `server/src/__tests__/dashboard-service.test.ts` | https://github.com/paperclipai/paperclip/pull/20117 |
| 18 | d1d8d6517 | The watchdog records the review disposition when the review card closes. | HIS-6597 | `server/src/__tests__/task-watchdogs-scheduler.test.ts` | https://github.com/paperclipai/paperclip/pull/20133 |
| 29 | b5d4fab31 | `relatedWork` in `GET /issues/:id` is capped at 50 items per direction and 5 sources per item. | HIS-54 | `server/src/__tests__/issue-related-work-limit.test.ts` | https://github.com/paperclipai/paperclip/pull/20127 |
| 35 | 6a87eaa6d | `PAPERCLIP_ADAPTER_MAX_CAPTURE_BYTES` sets the default capture cap. | HIS-341 | `packages/adapter-utils/src/server-utils-capture-cap.test.ts` | https://github.com/paperclipai/paperclip/pull/20128 |
| 38 | aaab001a8 | `reserveRunBudget` reads only the run columns it uses under the row lock. Upstream `master` needs nine columns instead of the six in the fork, because native Stop recovery also reads `id`, `companyId` and `nativeIssueId`. | | `server/src/__tests__/budget-enforcement-scoping.test.ts` | https://github.com/paperclipai/paperclip/pull/20130 |

## Review findings that also apply to the fork

The upstream review found gaps that the fork commits had. All five are
fixed in the fork on 9 November 2026 (rows 2, 15, 16, 18 as the upstream
fix commits, row 10 reworked: the live-run check is repeated under the
issue write lock and shares `runHoldsIssueLock` with the route). Each
item below keeps the finding for the rebase, where the upstream branches
replace these fork commits.

- Row 2 (55e3455e0): an import that goes over the budget still writes its
  UI parser to the cache when it finishes later, so it can replace a parser
  that was reloaded in the meantime. Upstream branch skips that cache write
  once the load has timed out.
- Row 10 (da77969e4): a peer write can pass the live-run check and then
  clear a claim taken before its write lands, and a terminal run under a
  native manual hold or a continuation retry claim counts as unlocked.
- Row 15 (6f1a95918): the self-review exception also accepts `done`, so a
  non-participant can close an issue past a later approval stage. Upstream
  branch limits it to `backlog`, `todo`, `in_progress` and `blocked`.
- Row 16 (53632630b): the body schema fills in `stages: []`, so the
  "no stages key" case never triggers, and `monitor: null` still drops the
  stored stages. Upstream branch records `stages` before parsing and compares
  monitors after `scheduledBy` is applied.
- Row 18 (d1d8d6517): the disposition is also recorded on `cancelled`,
  which the watchdog round does not count as a reviewed disposition.
  Upstream branch records it on `done` only.

## Skipped, with reason

| # | Commit | Reason |
|---|---|---|
| 1 | b77adf679 | Fork install path; never offered. |
| 12 | a71d53422 | Depends on the fork's lease-cancellation stamping (`cancelled_controller_lease_lost`, `resultJson.leaseCancellation`), which upstream does not have. |
| 21 | 09df05e14 | Fork CI; never offered. |
| 22 | 0b38b2019 | Production indexes as a fork migration (`0375_hisarweb_patches`); fork only in this form. |
| 23 | f33a4a846 | Fork docs; never offered. |
| 27 | ce83f0858 | Already upstream as open PR https://github.com/paperclipai/paperclip/pull/13635, which changes the same recovery loop. |
| 30 | 0090c9e3c | Upstream rewrote the periodic recovery: it is scheduled through `registerScheduledWork`, so the fork's promise chain no longer exists. |
| 31 | d51d84c12 | Already upstream as open PR https://github.com/paperclipai/paperclip/pull/14674 (backup health without blocking the event loop). |
| 37 | d27b9d0f5 | Already upstream as open PR https://github.com/paperclipai/paperclip/pull/20037 (same files, same stop-check reads). |
| 39 | ce1a42585 | Upstream rewrote the newer-run probe as a batched EXISTS in `listFailedRunsWithNewerRun`. |

## Next batch

Not offered yet, to keep the first batch at 12 PRs and one fix per PR.
Each needs a duplicate check against upstream `master` and open PRs first.

- Row 10: rework of #20120, with the live-run check under the issue write lock.
- Row 3 and 32: queued-run ageing (32 replaces the inline ageing of 3).
- Row 4: drain deferred wakes when a queued holder is cancelled on reassignment (conflicts with upstream `master`).
- Row 6: periodic backstop for parked deferred wakes.
- Row 7 and 26: hand a started run over on reassignment.
- Row 8: name the real blocker and return `blockerAttention` (conflicts, large).
- Row 9: bind routine execution issues to the routine's executor.
- Row 13: keep the watchdog description and `originFingerprint` in step.
- Row 19, 20 and 25: retry budget per agent and task, and recovery that leaves a live scheduled retry alone.
- Row 28: skip agent-initiated wakes on parked issues.
- Row 33 and 34: optional rewake cooldowns (open blocker, future monitor check).
- Row 36: board users can edit their own issue comments.
