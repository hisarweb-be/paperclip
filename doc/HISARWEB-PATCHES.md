# HisarWeb patches on top of upstream

Branch `hisarweb/patches` is upstream release `v2026.1106.0`
(`paperclipai/paperclip` `d69631b01b9c658f80bf8bed389863dce82643e1`) plus the
short commits below, in this order. Each row is one commit. Every commit
carries its own test; the column "Upstream-PR" tracks whether the change has
been offered upstream (`nog` = not yet, see doc/UPSTREAM-PRS.md).

Rebuilding on a newer upstream release: rebase this series onto the new tag,
drop every row whose behaviour upstream now has (record the proof under
"Left out"), bump the CI pin (doc/CI-FORK-DRIFT.md) and renumber migration
`0375_hisarweb_patches` past upstream's last migration only if it has not
shipped yet; once applied anywhere its file name and content stay fixed.

| # | Commit | Purpose | HIS / fork PR | Test | Upstream-PR |
|---|---|---|---|---|---|
| 1 | fix(install): make git payload installs work for the fork | `paperclipai install --repo hisarweb-be/paperclip --ref <sha>` builds a working payload: fork repo and ref honoured, workspace versions resolved in `prepare-bundled-package.mjs`, acpx packaging patch kept. | #39 #40 #42 #43 | `cli/src/__tests__/install-command.test.ts`, `scripts/acpx-patch-packaging.test.mjs` | nog |
| 2 | fix(startup): bound external adapter loading so startup recovery finishes | A hanging external adapter import no longer blocks startup recovery; loading has a time limit and the server logs and continues. | #38 | `server/src/__tests__/external-adapter-load-timeout.test.ts` | nog |
| 3 | fix(queue): age queued runs on a composite score so waiting work cannot starve | Queued runs are claimed on priority plus waiting time, so low-priority work cannot wait forever behind a stream of new work. Row 32 moves this into a pure module and makes it opt-in (`PAPERCLIP_QUEUE_AGE_UP_MIN`, unset = upstream order). | HIS-3507 | `server/src/__tests__/heartbeat-queue-ageing.test.ts` | superseded by row 32 |
| 4 | fix(heartbeat): drain deferred wakes when a queued holder is cancelled on reassignment | Cancelling a queued run on reassignment releases the issue lock and promotes the parked deferred wakes. | HIS-3482 | `heartbeat-lock-release-on-reassignment.test.ts`, `modules/wake-queue/domain/policy.test.ts` | nog |
| 5 | fix(approvals): carry the issue anchor in the plugin approval wake | The wake after a plugin approval names the issue, so the run starts on the right task. | HIS-3147 | `server/src/__tests__/plugin-orchestration-apis.test.ts` | nog |
| 6 | fix(wake-queue): periodic backstop for parked deferred_issue_execution wakes | A periodic sweep promotes `deferred_issue_execution` wakes whose blocking run is gone, so no task stays parked. | HIS-3520 | `wake-queue-deferred-wake-sweep.test.ts`, `modules/wake-queue/**/deferred-wake-sweep.test.ts`, `server-startup-feedback-export.test.ts` | nog |
| 7 | fix(issues): hand a started run over on reassignment instead of cancelling it | Reassigning an issue hands a running run to the new assignee instead of killing delivered work. | HIS-3492 | `server/src/services/reassignment-handover.test.ts`, `issue-agent-mutation-ownership-routes.test.ts`, `heartbeat-lock-release-on-reassignment.test.ts` | nog |
| 8 | fix(issues): name the real blocker and return blockerAttention on the write | A rejected write names the actual blocker and the PATCH response carries `blockerAttention`. | HIS-3568 | `issue-blocker-attention.test.ts`, `issue-blocker-attention-update-route.test.ts` and the route tests that assert the response shape | nog |
| 9 | fix(recovery): bind routine execution issues to the routine's executor | Recovery re-wakes a routine execution issue on the routine's own executor. | HIS-2579 | `server/src/services/routine-execution-binding.test.ts`, `issue-heartbeat-context-execution-review.test.ts` | nog |
| 10 | fix(issues): a run lock needs a live run, not in_progress alone | An issue counts as locked only while its run is actually live. | HIS-4605 | `external-object-routes.test.ts`, `issue-agent-mutation-ownership-routes.test.ts` | nog |
| 11 | fix(issues): give the two remaining cancelRun calls a reason and error code | Every run cancellation records why, so recovery and reports can tell causes apart. | HIS-4483 | `issue-comment-reopen-routes.test.ts` | nog |
| 12 | fix(recovery): a lease-cancelled run counts as delivered work | A run cancelled because its lease moved on is not reported as a failure. | HIS-3613 | `server/src/services/recovery/run-outcome.test.ts`, `run-failure-report.test.ts` | nog |
| 13 | fix(watchdog): keep description and originFingerprint in step | The task watchdog updates description and origin fingerprint together, so it stops reopening the same finding. | HIS-5649 | `server/src/__tests__/task-watchdogs-scheduler.test.ts` | nog |
| 14 | fix(issues): reject a monitor sent with a status PATCH that forbids it | A status PATCH that does not allow a monitor rejects one instead of storing it silently. | HIS-5825 | `issue-execution-policy-routes.test.ts` | nog |
| 15 | fix(execution-policy): dissolve a self-review stage when the status retreats | A self-review stage is dissolved when the issue moves back, so it cannot block the task. | HIS-5999 | `server/src/__tests__/issue-execution-policy.test.ts` | nog |
| 16 | fix(issues): a board monitor write keeps the stored review stages | A board write that only sets a monitor keeps the stored review stages. | HIS-5991 | `issue-execution-policy-routes.test.ts` | nog |
| 17 | perf(dashboard): join recovered_runs instead of a per-row IN subplan | The dashboard counts recovered runs with a join instead of a subplan per row. | HIS-5057 | `server/src/__tests__/dashboard-service.test.ts` ("separates recovered restart kills from true failures", existing; covers the rewritten query, behaviour unchanged) | nog |
| 18 | fix(watchdog): record the review disposition on the done transition | Closing a watchdog finding records the review disposition on the done transition. | HIS-6597 | `server/src/__tests__/task-watchdogs-scheduler.test.ts` | nog |
| 19 | fix(heartbeat): cap automatic retries per agent and task at three per hour | At most three automatic retry chains per agent and task per hour; more are recorded as `issue_retry_hourly_budget` instead of scheduled. | HIS-4580 | `server/src/__tests__/heartbeat-retry-scheduling.test.ts` | nog |
| 20 | fix(recovery): leave a task with a live scheduled retry to that retry | The recovery sweep skips a task whose scheduled retry is still due within the budget window, instead of starting a second chain. | HIS-4581 | `server/src/__tests__/heartbeat-process-recovery.test.ts` | nog |
| 21 | ci: pin the borrowed PR workflow to the base release SHA instead of @master | `pr.yml` calls upstream's reusable `pr-trusted.yml` at the base release SHA, so fork PRs run the CI of their own tree. | HIS-3521, fork #15 | `scripts/__tests__/e2e-shard.test.mjs` | not offered (fork only) |
| 22 | feat(db): migration 0375 with the hand-built production read indexes | Six indexes that production carried by hand (`plugins/bureau-server/db-index.sh`) become migration `0375_hisarweb_patches`, idempotent and concurrent. | HIS-5846 and the 7 Nov DB load measurements | `packages/db/src/hisarweb-patches-index-migration.test.ts` | nog |
| 23 | docs: HisarWeb patch register and upstream PR table | This file and doc/UPSTREAM-PRS.md. | | | not offered (fork only) |
| 24 | test: finish the cancelRun expectation of HIS-4483 and run the HIS-2579 suite on vitest 5 | Test follow-up for rows 11 and 9: the superseded-retry test asserts the full `cancelRun` arguments, and the HIS-2579 suite uses `describe` (vitest 5 has no `describe.sequential`). No runtime change. | HIS-4483, HIS-2579 | `issue-comment-reopen-routes.test.ts`, `issue-heartbeat-context-execution-review.test.ts` | nog |
| 25 | fix(heartbeat): key the HIS-4580 hourly retry budget on the context task when the run is not issue-scoped | Follow-up for row 19: v2026.1106.0 binds a retry's `issueId` only for issue-scoped runs, so the cap was skipped for every legacy-scoped run. The budget is read-only and now falls back to `contextSnapshot.issueId`, the key its counter already matches on. | HIS-4580 | `server/src/__tests__/heartbeat-retry-scheduling.test.ts` ("bounds automatic retries per agent and task to three per hour") | nog |
| 26 | test(issues): align the upstream reassignment-stop tests with the HIS-3492 handover | Follow-up for row 7: the upstream `human self-handoff` tests asserted that a started run is cancelled on every other reassignment. With row 7 only a never-started run is cancelled; those tests now use a queued run, and a started-run variant asserts the handover (200, no `cancelRun`). | HIS-3492 | `server/src/__tests__/issue-agent-mutation-ownership-routes.test.ts` | nog |
| 27 | ouderkind: keep startup recovery alive when blocking a parent on its children forms a cycle | A 422 blocking cycle while recovery blocks a stranded parent on its children leaves that recovery action open and logs it, instead of failing startup recovery and every periodic pass. | HIS-7515 | `server/src/__tests__/heartbeat-process-recovery.test.ts` | nog |
| 28 | his4304: skip agent-initiated wakes on parked issues | An agent comment or explicit agent wake on a parked issue (future monitor check, backlog, done/cancelled, blocked by open blockers) no longer starts an assignee run. People and explicit resume requests still wake. | HIS-4304 | `server/src/services/issue-comment-wakeup.test.ts` | nog |
| 29 | relatedwork: cap relatedWork in GET /issues/:id | At most 50 related items per direction and 5 sources per item, with `outboundTotal`, `inboundTotal` and `truncated` so clients see what was omitted. | HIS-54 | `server/src/__tests__/issue-related-work-limit.test.ts` | nog |
| 30 | tik: make the periodic heartbeat recovery chain single-flight | A scheduler tick skips the recovery chain while the previous chain is still running, so slow chains cannot overlap and feed each other. | | `server/src/lib/single-flight-job.test.ts`, `server-startup-feedback-export.test.ts` | nog |
| 31 | backup: serve findLatestBackup from a cache refreshed asynchronously | `/api/health` no longer scans the backup directory synchronously on every call; the scan is cached and refreshed in the background at most every 60 s. | | `server/src/__tests__/database-backup-health.test.ts` | nog |
| 32 | his3507: optional wait-time ageing for queued run ordering | Replaces the inline ageing of row 3 with the pure module `heartbeat/queued-run-ordering.ts`. Opt-in via `PAPERCLIP_QUEUE_AGE_UP_MIN` (minutes per class step); unset keeps the exact upstream order. Production sets 30. | HIS-3507 | `server/src/services/heartbeat/queued-run-ordering.test.ts`, `heartbeat-queue-ageing.test.ts` | nog |
| 33 | his4997: optional rewake cooldown for issues blocked by an open blocker | Opt-in via `PAPERCLIP_ISSUE_REWAKE_OPEN_BLOCKER_COOLDOWN_MINUTES`: throttle-candidate wakes on a blocked issue with an open blocker are skipped until the cooldown since the agent's last run has passed. Production sets 360. | HIS-4997 | `server/src/__tests__/issue-rewake-throttle.test.ts` | nog |
| 34 | his5018: optional rewake cooldown while a future monitor check is scheduled | Opt-in via `PAPERCLIP_ISSUE_REWAKE_FUTURE_MONITOR_COOLDOWN_MINUTES`: throttle-candidate wakes before a future monitor check are skipped unless new issue input arrived. Production sets 360. | HIS-5018 | `server/src/__tests__/issue-rewake-throttle.test.ts` | nog |
| 35 | cap: make the default adapter capture cap configurable | `PAPERCLIP_ADAPTER_MAX_CAPTURE_BYTES` sets the default stdout/stderr tail kept per run (unset = 4 MB). Production sets 1048576. | HIS-341 | `packages/adapter-utils/src/server-utils-capture-cap.test.ts` | nog |
| 36 | bericht: allow board users to edit their own issue comments | `PATCH /api/issues/:id/comments/:commentId` lets a board user correct their own comment in place (agents 403, other authors 403, deleted 409); the live-update event carries the woken run as `wakeup.runId`. | | `server/src/__tests__/issue-comment-edit-routes.test.ts`, `ui/src/context/LiveUpdatesProvider.test.ts` | nog |
| 37 | pauze: limit stop-evidence run reads to runs that can still hold execution authority | Pause polling reads only runs that are live, recent, leased or awaiting release instead of an agent's whole run history. | | `server/src/__tests__/agent-execution-stop-history.test.ts` | nog |
| 38 | slotrij: reserveRunBudget reads only the six used run columns under the row lock | The budget reservation keeps its row lock but no longer selects `context_snapshot` and the log columns, which shortens the time the companies row is locked. | | `server/src/__tests__/budget-enforcement-scoping.test.ts` | nog |
| 39 | attentionruns: read newer-run issue ids from heartbeat_runs.issue_id first | The failed-run attention query reads `issue_id` and only falls back to the context snapshot when it is null, so it no longer detoasts every snapshot. | HIS-5846 | `server/src/__tests__/attention-service.test.ts` | nog |

## Fork commits per row

| Row | Fork commits (`59c07ede..815ef15db6`) |
|---|---|
| 1 | 9431d6385a, 652f642578, cbc112ecab, 815ef15db6 |
| 2 | b52f60f62b |
| 3 | faa90c4738, 64e23a6cf3 |
| 4 | e0d272faa1 |
| 5 | b30a28a34a |
| 6 | 4b1a277ada, c6dbe6dc8e, 24b0bac091, 768f4f8d32, 553af0f0d8 |
| 7 | df8c20876d, f49242d0da, aada957952 |
| 8 | 95a7a7dec6, 4fc4499f7a, 24c32cc8f0 |
| 9 | 8f16dbb183 |
| 10 | b999940b61 |
| 11 | bc9624f23e, d46824b24d |
| 12 | 3879f4e320 |
| 13 | 2c1d8dff7c, 7cfa7644dc, 6697a65d70 |
| 14 | c10ff8e795, 9bd066fa65 |
| 15 | df8b172dab |
| 16 | acbe850746, ee8da984c7 |
| 17 | 0f9d7d3c33 |
| 18 | 2c1eb05da4, 352f4f9a70, ee202c437b |
| 19 | c4840708c6, 84678d2972 (wip), 526979fd76, a5565e0c60 |
| 20 | c52a8dc680, 36eeb4e166, 256030a542 (code only), ed04a2aa54, 52b68e809d, c163cf9c98 |
| 21 | 6a7d72c92f |
| 22 | none (replaces the manual `db-index.sh` step; see migration plan) |
| 23 | none (fork-only docs) |
| 24 | none (follow-up of rows 9 and 11 found by the branch test run) |
| 25 | none (follow-up of row 19 found by the branch test run) |
| 26 | none (follow-up of row 7 found by the branch test run) |
| 27-39 | none (ported from the production pleisters on bureau-01, see the next table) |

## Production patches (pleisters) these commits replace

Every code pleister that ran as a systemd drop-in on bureau-01 before this
series, and what covers it now. Drop-ins marked as a row or as upstream are
switched off (renamed `*.uit-<date>`) once a build of this branch is live.

| Pleister (drop-in) | Covered by |
|---|---|
| e2big (20) | upstream: v2026.1106.0 no longer passes `PAPERCLIP_WAKE_PAYLOAD_JSON` (`server-utils.ts` strips it, adapters delete it) |
| mcp-get (21) | upstream: `tool-gateway.ts` and `connection-intents.ts` answer GET with 405 `Allow: POST` |
| cap (22) | row 35 plus `PAPERCLIP_ADAPTER_MAX_CAPTURE_BYTES=1048576` |
| prepush (23) | outside Paperclip: every active agent runs through `claude-als-agent` or `agy-als-agent`, which put `/usr/local/lib/agent-git/git-rem.sh` in front of the git wrapper and refuse pushes to main, master and sprint-* |
| bericht (24), server part | row 36 |
| bericht (24) UI part, dashrem (24b), ophaalrem (24c) | not product code: `index.html` changes that stay until the HisarWeb plugin family takes them over |
| relatedwork (25) | row 29 |
| veger (26) | upstream, solved differently: keyset cursor with a frozen boundary, readiness cache per working tree, inspection backoff and a single-flight sweep |
| tik (27) | row 30 |
| backupcache (28) | row 31 |
| approvalwake (29) | row 5 |
| pauze (29) | row 37 |
| his3482 (31) | row 4 |
| his3492 (31a) | row 7 |
| his3507 (31b) | rows 3 and 32 plus `PAPERCLIP_QUEUE_AGE_UP_MIN=30` |
| his3597 (32) | writer side upstream (cancellation source `controller_lease`, error code `controller_lease_lost`); reader side row 12 |
| his4304 (33) | row 28 |
| his4455 | already off in production since 6 Nov |
| his4605 (35) | row 10 |
| his4483 (36) | row 11 |
| his5168 (37) | row 9 |
| his5999 (38) | row 15 |
| his4997 (39, old 34) | row 33 plus `PAPERCLIP_ISSUE_REWAKE_OPEN_BLOCKER_COOLDOWN_MINUTES=360` |
| his5018 | row 34 plus `PAPERCLIP_ISSUE_REWAKE_FUTURE_MONITOR_COOLDOWN_MINUTES=360` (never wired as a drop-in) |
| slotrij (40) | row 38 |
| ouderkind (41) | row 27 |
| attentionruns (42) | row 39 |
| his7596 (43) | upstream bd64eb27b (#16291), an ancestor of v2026.1106.0 |
| db-index.sh (six indexes) | row 22 |

## Left out, with proof

| Fork commit(s) | Reason |
|---|---|
| 178b9e939b, 26b1a5f117 (low-trust handover) | Upstream already hands the run over: `low-trust-red-team-routes.test.ts` in v2026.1106.0 expects the handed-over run via `isHumanSelfHandoff`. |
| 27d5aba24a (rootless influence limit) | Upstream 7b09e3da73 (#12621) adds `sourceIssueId !== null &&` in `cross-issue-influence-limit.ts`. |
| b83057b626 (strip monitor) | Upstream 7c58ea07b2 already strips the monitor. |
| 9c57c4b263, 51de056143 and migration 0355_yummy_preak (Artifacts page, created-at keyset indexes) | Excluded by decision: Artifacts stays upstream. Upstream's `company-artifacts.ts` orders by `updatedAt`, so the three `*_company_created_idx` variants serve no upstream query. They stay in production as harmless extra indexes. |
| 4530902b89, c6cd36598c, 606917c355 (Dependabot bumps) | Not functional; upstream's lockfile in v2026.1106.0 already carries vite 6.4.3 and the MCP SDK 1.31.0 line. |
| 256030a542 measurement files (LEESMIJ.md, meting.mjs, uitkomst.json) | Measurement artefacts, not product code. |
| 4de5b12719, e83ba198bb, 4944418978, 20e840d659, e7b02344b0, 47b152ca1b, c160f347c2, 39dde6744f, 3fd6cf132b, 9732c99089, 927078fb98, ef854d707a, 80506bd23b | Merge commits without content of their own. |

