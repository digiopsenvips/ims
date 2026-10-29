# IMS local repair and verification report

Date: 29 October 2026. Status: **local patch verified; not deployed; production release blocked by the gates below**.

This follows the initial read-only audit of repository main `2619243124c0b79a506838997cba4da3334fbbef`. The user's subsequent “proceed” authorized local code repairs and isolated testing. No production database correction, migration, deployment, or environment change was performed. The initial audit remains a historical baseline, not a description of this uncommitted patch.

## Changes and deliberate behavior restrictions

- Ordinary sales, combo sync, games, inventory allocation/adjustment, and event reconciliation use a shared PostgreSQL transaction advisory lock. Validation and stock checks run inside the transaction. The lock is intentionally coarse; production throughput/load limits remain unverified. Every concurrent writer must run this version for the protection to hold.
- Games deduct a warehouse reward once. Event rewards consume event allocations. Sale/game duplicate keys return the original receipt, including after stock exhaustion or event closure. Seller/event mismatches conflict.
- Sync invokes the same sale handler as online submission. A bundle commits all validated components or none; payment splits must match actual totals. Missing splits are rejected, never invented.
- Online and offline POS/game submissions are durably stored before transmission. Keys survive uncertain responses. Queue records and committed acknowledgements are retained. Legacy ownerless operations become conflicts for review; they are not silently assigned to the current seller. Switching accounts cannot replay another seller's queue.
- Pending stock remains reserved in the local display across reloads. This is a conservative local projection, not a change to authoritative recorded sales. Unresolved/rejected conflicts can understate displayed stock until reconciled.
- Explicit event context is retained rather than silently switching to another active event. Stale fetches cannot replace newer selected-event state. Combo availability uses event stock, including PICK_ANY pools.
- Event reads no longer reconcile or return stock. Timer/manual closure share a locked, once-only return path. Negative discrepancies stop closure for review. Reconciled events cannot reopen or change allocations.
- Sales deletion/purge/header-only edits, event deletion, project deletion, and user deletion are blocked. Product/combo/game retirement preserves records. This intentionally removes unsafe mutations pending an audited correction/reversal design.
- Mixed combo/product carts and multiple combo carts stop before submission. The existing transaction model cannot safely retain their offer pricing/history. Separate ordinary and single-combo bills work; complete mixed-cart support requires a reviewed additive schema design.
- Authorization reloads current roles/permissions from the database. New tokens include a credential-version stamp. Response projections remove password hashes and restrict financial/customer/inventory/activity fields. Socket connections authenticate; broadcasts contain refresh signals rather than transaction payloads. Receipt messaging requires authentication, ownership/privilege, and a stored receipt/recipient.
- Public/missing signing secrets fail startup validation. CORS has an explicit origin list and includes PATCH. Startup no longer performs sequence/DDL initialization. Maintenance push/seed/reset scripts require explicit disposable-local-database opt-in and reject production/remote targets.
- IST date filtering includes the full selected end date; game revenue is counted once; project reporting uses matching item lines. Restricted revenue is labeled Restricted. Member management links are hidden. Mobile header overflow is corrected, login labels are associated, and stall dialog scrolling/dismissal were checked.
- Existing IndexedDB name/version/stores are retained. Cache activation no longer deletes other caches. No production browser queue or storage was opened, cleared, or replayed during these repairs.

## Finding disposition

IDs refer to the initial audit. “Locally verified” does not mean fixed in the deployed portal.

| ID | Local disposition / remaining work |
|---|---|
| F01 | OPEN, critical: broad Supabase anon/authenticated grants and disabled RLS unchanged. Provider Data API exposure, consumers, and policy plan need verification. |
| F02 | Protected: destructive routes blocked or replaced by retirement. Historical correction/reversal workflows still need design. |
| F03 | Locally verified: single warehouse reward deduction, exact-last-unit case. |
| F04 | Locally verified contention cases: shared stock lock. Load testing and coordinated rollout remain. |
| F05 | Locally verified: simultaneous closure returns once; sale/closure race conserves allocation. Offline closure policy remains open. |
| F06 | Locally verified: atomic, event-scoped validated combo sync with one result per operation. |
| F07 | Locally verified: invalid/missing split rejected; existing historical nulls preserved. |
| F08 | Locally verified: durable keys/acknowledgements for ordinary sales and games, including lost responses. |
| F09 | Locally verified: GET does not finalize expired events. |
| F10 | Partial: response projections/role tests added. Exhaustive every-field/every-role privacy review still required. |
| F11 | Locally verified: anonymous socket rejection and payload-free invalidation signals. Production reconnect/load behavior unverified. |
| F12 | Partial: fallback forbidden, DB role refresh, stamped new tokens. Actual Render secret and legacy-token invalidation require a controlled release decision. |
| F13 | Protected, feature restricted: mixed combo carts blocked; full transaction-model support pending. |
| F14 | Locally verified: queue owner isolation, ownerless conflicts retained. Existing uncertain operations need human reconciliation. |
| F15 | Locally verified: discard/clear APIs cannot erase queue payloads or acknowledgements. |
| F16 | Partial: atomic intake and stale adjustment protection. Immutable movement/correction ledger remains absent. |
| F17 | OPEN: 42 historical incomplete payment splits untouched. No inferred Cash/UPI backfill. |
| F18 | Locally verified: selected-event combo quantities and PICK_ANY availability. |
| F19 | Partial: IST, fee totals, and project-line filters tested. Complete all-report/filter/export parity remains unverified. |
| F20 | Partial: Member controls, event context, restricted metrics, and console navigation corrected/tested locally. Not every management flow has browser coverage. |
| F21 | Protected: header-only sale edits blocked; audited amendments/reversals pending. |
| F22 | Protected: authenticated stored-receipt dispatch. Real WhatsApp transport not exercised. |
| F23 | Partial: startup DDL removed, common maintenance scripts guarded. Legacy scripts/source still require deliberate review before execution. |
| F24 | Partial: durable queue, cached-event retention, safe auth failures tested. Browser-native offline/restart/SW matrix remains unverified. |
| F25 | Partial: labels/mobile/header/dialog checks; focus trap, focus restoration, screen-reader and contrast audit remain. |
| F26 | Locally verified: allowed-origin PATCH CORS behavior. |

## Test execution and evidence

Final clean run: **40 tests passed, 0 failed, 0 skipped** via `npm test --prefix backend`. The runner initialized a new empty local PostgreSQL 18.3 cluster on 127.0.0.1:55439 with synthetic data, copied only the active backend schema into its temporary directory, and stopped its own cluster afterward. Production is PostgreSQL 17.11; a matching-version staging run remains advisable before release.

The test loader injects an explicit local Prisma client and rejects dotenv loading. The ordinary DATABASE_URL is poisoned to localhost port 1 during tests. Messaging is mocked. Tests execute actual Express handlers, authentication, transactions, Prisma queries, and Socket.IO behavior; offline tests execute frontend queue code using an in-memory IndexedDB adapter. These are not a complete deployed end-to-end suite.

Tests cover payment validation; concurrent last-unit ordinary/game sales; simultaneous allocation; simultaneous duplicate keys; original receipt after closure; wrong-owner/event keys; one-time stock return; closure/sale races; read-only event GET; full and invalid bundles; preservation endpoints; Member/Head permissions and role spoofing; receipt dispatch rejection; atomic intake rollback; stale adjustments; credential invalidation; IST boundary; fee/project reporting; event combo/PICK_ANY stock; socket authentication; CORS; durable before-send queue; response loss; seller switch; contradictory acknowledgements; ownerless conflict; no discard; pending stock reload; event context; and maintenance guard refusal.

Additional completed checks:

| Check | Result |
|---|---|
| Backend TypeScript, no emit/incremental | PASS |
| Frontend TypeScript, no emit/incremental | PASS |
| Git diff whitespace/error check | PASS |
| Vite production bundle to external temporary directory | PASS; large main chunk warning remains (1.18 MB minified / 291 KB gzip) |
| Local browser ordinary two-product bill | PASS; stored Sale 56, two lines/units, ₹200, correct synthetic event/seller verified by local DB read |
| Local browser game reward | PASS; stored Sale 57 and GS-000018, ₹30, one event reward; event stock 9→8, warehouse unchanged |
| Local Member full stall console | PASS; loaded selected event, no blank screen |
| Local modal at desktop, 375×812, 320×568 | PASS for bounded scrolling/footer and Escape dismissal; not full accessibility certification |
| Local mobile page overflow | PASS after correction; document width matched 369px viewport |
| Production mutation/end-to-end tests | NOT RUN |
| Real WhatsApp delivery | NOT RUN |
| Provider backup/restore drill / production load | BLOCKED / NOT VERIFIED |

The browser preview used only localhost API/database, synthetic accounts, and mocked messaging, with no operational lifecycle timer. It was shut down after checks. Synthetic database directories were retained rather than cleaned/deleted. Final test log: `/tmp/ims-final-regression.log`; final retained cluster: `/var/folders/gv/l50qw0513_jcc2nj1p055jsh0000gn/T/ims-synthetic-RYKXEo`.

## Module status and scorecard

These describe this local patch. No module is certified against all production workflows.

| Module | Status | Limit |
|---|---|---|
| Authentication/users/permissions | PARTIAL | Core rejection/version tests pass; provider key and exhaustive role matrix pending |
| Dashboard/analytics | PARTIAL | Corrected calculations covered; complete production filter/export parity pending |
| POS/sales history | PARTIAL | Persistence/idempotency/concurrency pass; unsafe edits blocked; all browser filters not covered |
| Events/stalls/inventory | PARTIAL | Race/return/context tests pass; offline closure policy and ledger pending |
| Combos | PARTIAL | Single bundle/event availability pass; mixed carts restricted |
| Games | PARTIAL | Persistence/reward/retry pass; all management/UI cases pending |
| Offline sync | PARTIAL | Durable state machine tested; native browser/version and legacy reconciliation pending |
| Navigation/UI/accessibility | PARTIAL | Targeted console/modal/mobile checks pass; full keyboard/screen-reader matrix pending |
| Database security | FAIL | Confirmed grants/RLS concern remains unchanged |
| Backup/recovery/deployed revision parity | BLOCKED | Provider verification/access required |

| Dimension | Assessment |
|---|---|
| Functionality | PARTIAL |
| Data accuracy | PARTIAL; synthetic invariants pass, historical completeness unverified |
| Security | FAIL for unresolved database access control; other changes partially verified |
| Reliability | PARTIAL |
| Performance | NOT VERIFIED; coarse-lock throughput and large frontend chunk remain |
| Accessibility | PARTIAL |
| UI/UX | PARTIAL |
| Maintainability | PARTIAL; shared transaction/sync logic improved, legacy architecture remains |
| Test coverage | PARTIAL; 40 focused tests, no percentage claim |
| Operational readiness | BLOCKED for production release |

## Data preservation report

- Production environment previously inspected: supplied Supabase project `mzshwqbcvzimuqbigfbi`, `postgres.public`, connected through the session pooler; Render/Vercel runtime identity still needs provider confirmation.
- Production operational-record writes initiated in this repair phase: **0**. Production SQL/DDL/grant/sequence writes: **0**. Production schema changes/migrations: **0**. Environment/credential/provider settings changed: **0**. Deployment: **none**.
- Production tables/records affected by repairs: **none**. A schema was initialized only in newly created empty local synthetic databases. Existing production IDs, receipt numbering, relationships, timestamps, users, sales, payments, allocations, game records and queues were not corrected, renumbered, deleted, or replayed.
- Initial read-only before/after baseline: users 4/4; projects 3/3; products 35/35; inventory 35/35; events 3/3; allocations 37/37; sales 80/80; sale_items 91/91; games 1/1; sessions 0/0; combos 20/20; combo_items 27/27. Revenue ₹6,380/₹6,380; units 110/110; negatives/orphan items 0/0; incomplete payment fields 42/42. These are phase-one observations, not new post-repair production reads.
- No production connection was required for this local repair verification. There is no field-for-field after-repair production snapshot. Counts/aggregates do not prove historical completeness or absence of unrelated concurrent operational changes.
- Backup/PITR: **not verified; no backup claimed or created**. Recovery procedure/restore drill remains outstanding.
- Remaining integrity concerns: historical incomplete payment fields; no immutable stock/correction ledger or product/project/game name snapshots; renames/reclassification can still alter historical labels; ownerless/uncertain queues; closure with unseen device queues; migration completeness and database grants. No records were fabricated to resolve any concern.

## Deployment and rollback plan — not executed

1. Review this diff and initial audit. Confirm exact Vercel/Render revisions, intended Supabase target, supported PostgreSQL version, and all other stock writers. Verify runtime private signing secret without printing/changing it. If rotation is needed, obtain separate explicit approval and plan session invalidation.
2. Verify backup/PITR and recovery access through Supabase's supported process, and perform an isolated restore drill. No production database change is authorized by this patch. Any future grants/RLS/schema/data correction requires exact target, backup, baseline, reviewed SQL, impact/rollback limits and separate explicit user approval.
3. Run this suite against isolated matching-version staging. Exercise real browser offline/reload/logout/reconnect and all roles using synthetic data; test transport using an approved test recipient. Review legacy queue keys against authoritative receipts without blindly replaying them. Confirm closure policy for every selling device.
4. Resolve database exposure, missing immutable history, mixed-cart behavior, legacy queues, and secret/session release decisions. Load-test coarse transaction serialization. Ensure no older backend instance, script or integration can bypass the stock lock.
5. After explicit release authorization, deploy coordinated backend/frontend during a controlled window with old writers drained. Keep database schema unchanged for this patch. Smoke-test safe reads first; synthetic mutation checks belong in staging. Do not clear device storage to force an upgrade.
6. Capture approved production read-only counts/invariants before/after release and inspect logs/metrics. Monitor rejected/conflict keys, locks/timeouts, stock discrepancies, and receipt totals without logging customer/credential payloads.
7. Rollback code through provider version rollback only after evaluating compatibility. The previous code reintroduces duplicate/destructive-write risks and cannot safely handle concurrent writers. Retained acknowledgement/queue entries must remain intact. Code rollback does not undo transactions or restore historical data; any correction requires separate reviewed reconciliation. Prefer stopping new mutations and a forward fix where reverting would restore unsafe paths.

## Changed files

Active backend: package scripts; env/http config; auth/PII/preservation/response middleware; analytics/auth/combos/events/games/inventory/products/projects/sales/users/WhatsApp routes; server; availability/eventLifecycle/idempotency/payment/reportDates/stock/WhatsApp services; sockets; disposable-database guard and regression runner/tests.

Active frontend: service worker; LiveStallModal/SyncIndicator/WhatsAppIndicator/Navbar; AuthContext/SocketContext; db/sync/event-context/offline-stock; EventDetails/Events/GamePlay/Inventory/Login/MemberSalePortal/ProjectsProducts/SalesManagement/UserManagement pages; types. Root package setup guard. This report.

No Prisma schema, migration, environment file, lockfile, or inactive root Next application file was changed. After local verification, the user authorized committing and pushing this patch. It is published on the separate `audit/preservation-repairs` review branch, leaving `main` unchanged. No deployment is authorized by that publication; the release gates above still apply.
