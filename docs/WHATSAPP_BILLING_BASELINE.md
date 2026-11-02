# WhatsApp billing safety baseline — 2 November 2026

## Outcome and stop condition

Audit only. Implementation and deployment are stopped under the request's explicit stop-on-risk rule. The existing gateway does not establish that automated sending is permitted or that the linked account is unrestricted. Existing queue code also permits duplicate-message scenarios. Reconnecting can make the current worker eligible immediately; scanning a QR must not be interpreted as permission to drain the backlog.

No application source, dependencies, credentials, sessions, environment files, database schema, or operational records were edited by this audit. Pre-existing working-tree changes were preserved. This document is the only intentional repository addition.

## Repository and architecture

- Origin: https://github.com/digiopsenvips/ims.git; local branch `main`, HEAD `006defabb08fb87384a2061fe9ece7f03a244e78`. The deployed revision was not verified.
- Active root scripts build an Express/TypeScript backend and Vite/React frontend. A separate root Next.js tree also exists; it was not modified.
- `render.yaml` describes a long-running backend web service. `frontend/vercel.json` describes SPA routing. Actual Render service plan, instance count, uptime guarantees, and deployment environment remain unverified.
- Backend Prisma schema uses PostgreSQL. Session-store comments mention Supabase, but the actual production database provider and schema were not authenticated or inspected.
- Baileys is the existing linked-device transport. Session keys use a separately provisioned `whatsapp_sessions` table with local-file fallback. No session was started, reset, logged out, or replaced during this audit.
- `whatsapp_deliveries` and `whatsapp_config` are already declared in the backend Prisma schema. Their production existence and contents are unverified. No backend migration directory was found; root migrations belong to the separate root schema and must not be applied to the backend by assumption.
- Existing queue service starts a four-second server interval on import outside tests. Admin/Developer queue endpoints already exist. Delivery acknowledgements are wired through Baileys `messages.update`.
- Sales list API includes delivery state. No dedicated WhatsApp Billing dashboard route exists in `frontend/src/App.tsx`.

## Existing local work preserved

Before this audit, Git reported modified backend schema, sales route, WhatsApp route, WhatsApp service, regression tests, mixed-checkout tests, and an untracked WhatsApp queue service. These are baseline changes, not changes authored by this audit. System Git initially failed due to the Xcode license; the installed Command Line Tools Git successfully inspected status without changing system settings.

A local source recovery archive and SHA-256 manifest were created and read back successfully: `/var/folders/gv/l50qw0513_jcc2nj1p055jsh0000gn/T/ims-whatsapp-baseline-vioduv3m/`. All 143 archived files matched their hashes. Secrets, session files, database backups, and dependency directories were excluded. This is a temporary local source checkpoint, not a durable production database backup. A verified provider snapshot or database backup is still required before production schema changes.

## Blocking findings from source inspection

1. **Historical reconciliation is unsafe.** `reconcileHistoricalBills` queues untracked bills after the reported 17:22 cutoff solely from sale time. That is not evidence of non-submission. Untracked historical bills must remain UNKNOWN unless independent evidence proves otherwise. Do not run this endpoint as currently implemented.
2. **Retry permits duplicates.** `retryDelivery` rejects only DELIVERED; it can requeue SENT, UNKNOWN, SENDING, or CANCELLED records. Its read/update sequence is not an atomic guarded transition. Cancellation and unknown resolution have similar races.
3. **Global pacing is not durable.** The next-send timestamp and processing flag are process memory. Atomic per-job claim does not prevent different workers claiming different jobs simultaneously. Restart clears pacing, and abandoned SENDING records have no recovery policy.
4. **Ambiguous failures are retried.** The transport collapses send exceptions into generic failure strings. The queue generally schedules retries without proof that submission did not occur. A submitted request with an unknown outcome must become UNKNOWN.
5. **Readiness is insufficient.** CONNECTED is the worker's readiness gate; there is no restriction verification, stable-session interval, expected-sender binding, consent eligibility, or session-scoped operator readiness attestation. Defaults enable automatic sending and disable quiet hours. Configuration failures return enabled in-memory defaults instead of failing closed.
6. **No transactional outbox.** Sales enqueue is an unawaited call after sale commit and broadcasts. A crash or enqueue failure can silently lose the job. A phone-less sale has no delivery record. Existing sale/inventory logic must remain intact while an outbox is added transactionally.
7. **Snapshots are mutable on duplicate enqueue.** The upsert updates phone and bill snapshot for an existing idempotency key. Historical payloads must remain immutable.
8. **Outbound bypass exists.** `/api/whatsapp/test` calls the gateway directly and resets the breaker on success, outside the paced queue.
9. **Privacy and validation gaps.** The authenticated status route returns QR data without an Admin/Developer role guard. Queue lists return full phone/payload/audit objects. Gateway logs print QR and recipient identifiers. Config updates silently ignore invalid fields and do not fully validate the merged policy. Sensitive action audit entries lack operator identity.
10. **Metrics overstate certainty.** ETA ignores quiet hours, retries, budgets, readiness, and pauses. Daily boundaries use host timezone. Counting only successful statuses does not budget ambiguous submissions.
11. **Transport limitation.** Baileys states that it is not authorized by or affiliated with WhatsApp. WhatsApp's responsible-use guidance warns against automated/bulk messaging. Random delays do not establish compliance or account safety. This gateway exposes no verified account-restriction capability.

Sources: https://github.com/WhiskeySockets/Baileys/blob/master/.github/README.md and https://faq.whatsapp.com/361005896189245/?eea=0&locale=en_US

## Incident and reconciliation evidence

The account restriction and approximate stop time are user-reported. Provider enforcement logs, authenticated gateway state, provider message history, and production delivery records were not accessed. Therefore the cause, current connection state, eligible backlog count, delivered count, and number needing manual reconciliation cannot be confirmed. Zero historical jobs were created or reconciled by this audit. No timestamp-based assumptions were applied to data.

Production records were not read or written by this audit. Preservation is supported by having executed no operational database commands, not by a before/after production checksum. No claim is made that records were unchanged by other users or the already deployed application.

## Baseline verification

- Backend build: FAIL — TS2367 at `backend/src/services/whatsappService.ts:213` and `:215` (redundant numeric/enum acknowledgement comparisons). These are pre-existing baseline failures.
- Frontend type check: PASS as the build advanced from `tsc` to Vite. Frontend production bundle: NOT VERIFIED; Vite remained in transformation without completing and the audit's build process was stopped.
- Offline preservation suite: PASS, 10/10. Covers durable offline operations, response loss/idempotency, seller ownership, conflict retention, game acknowledgement retention, stock projection, event context, and maintenance guards.
- Database regression suite: BLOCKED before schema provisioning/tests. A fresh synthetic PostgreSQL cluster was initialized, but port 55439 was occupied. The runner refused to fall back to an existing database. The existing listener was not stopped or reused.
- Full sales/inventory/games/combos/events/login/permissions/Sales History regressions: NOT VERIFIED; the database suite did not run. No new queue behavior tests have been implemented.
- No frontend/backend lint scripts are configured in their package manifests. No production migration check or live/mobile UI check was executed.
- Post-audit SHA-256 comparison: all 143 archived source/config/test files remained identical to the recovery manifest.

## Minimum implementation boundary and proposed migration plan

Keep the existing transport and session intact until an explicitly approved supported-provider transition is available. First build a disabled queue in an isolated synthetic environment using a mocked provider. Proposed scope: backend queue service and pure policy module; WhatsApp routes and gateway adapter; an outbox insertion at existing sale/game/sync commit points after inspecting every path; additive backend migrations/schema; frontend WhatsApp Billing page/navigation, API types, and Sales History status/details; queue tests and deployment documentation. Do not change business calculations or receipt generation.

Use additive objects for durable dispatcher state, submission/attempt history, readiness attestation, and administrative audit. Preserve existing delivery IDs, provider evidence, snapshots, and timestamps. Lock a singleton dispatcher row and atomically claim one job with a persisted next slot; enforce budgets over submission attempts, bound send duration, and recover abandoned submissions to UNKNOWN. Never recover SENDING by blindly requeueing. Require authenticated confirmation and evidence for manual resend and resolution. Actual provider delivery evidence alone may set DELIVERED automatically.

Before selecting migration SQL, compare the actual deployed schema with the backend Prisma schema through read-only access. Review a reversible plan, establish and verify a production recovery point, then obtain approval for production execution. No migration SQL was generated or executed here. Rollback should disable the new worker and restore the approved prior application revision while retaining new queue/audit records and additive tables. Do not drop delivery evidence or restore an old database over later sales.

## Supported sending path and operational prerequisites

Use an officially supported WhatsApp Business Platform provider adapter for automatic billing, with explicit recipient consent, approved transactional templates where required, supported status webhooks, verified sender/account state, and provider-specific limits. Provider onboarding or replacing the linked integration requires explicit approval; none was attempted. Do not run both transports for the same logical receipt.

For any retained gateway that cannot verify restrictions, show STATUS UNKNOWN and require a deliberate, audited, session-bound operator confirmation before eligibility. Such confirmation does not prove that linked-device automation complies with platform policy. Keep automatic delivery disabled until that limitation is resolved.

A supported worker deployment needs confirmed always-on execution, coordinated database locking across instances, monitoring, bounded submission handling, and durable scheduling. Initial values must be reviewed for the chosen provider; the current 15–35 second / 20 per ten minutes / 200 per day defaults are merely existing code values, not endorsed safe limits.

Reconnection must follow restriction expiry confirmed in WhatsApp, sender verification, supported readiness checks or explicit UNKNOWN-state confirmation, a paced first slot, and eligible-only claims. This audit did not scan QR, send test messages, enable/resume delivery, reconcile records, or deploy anything. Automatic resume acceptance criteria remain unmet.
