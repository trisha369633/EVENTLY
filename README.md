# EVENTLY

EVENTLY is a React + Vite university event platform. Public events, registrations, user accounts, profiles, roles, and identity records use the configured Supabase project.

## Run locally

```sh
npm install
npm run dev
```

Vite prints the local URL after startup. Run `npm run build` for a production build and `npm run preview` to preview it.

## Supabase environment

Copy `.env.local.example` to `.env.local`, then set:

- `VITE_SUPABASE_URL` — Supabase project URL.
- `VITE_SUPABASE_PUBLISHABLE_KEY` — Supabase publishable key. The existing legacy `VITE_SUPABASE_ANON_KEY` is accepted as a fallback.

`.env.local` is ignored by Git. Never put a Supabase secret or service-role key in any `VITE_` variable. The client validates missing values and rejects server-only keys. Institution and department lists are read from active rows in the Supabase tables; no UI records are fabricated.

In Supabase Auth URL Configuration, allow the app’s local and production `/login` URLs as redirect URLs. Keep RLS policies enabled for self-profile reads, self-role reads, institution/department reads, and a user’s own identity read/insert.

## Routes

- `/` — landing page
- `/events` — searchable, filterable published events from Supabase
- `/events/:slug` — published event details
- `/events/:slug/register` — authenticated participant registration
- `/login` — email or student/employee ID sign-in
- `/register` — Supabase Auth registration
- `/dashboard` and `/dashboard/my-events` — participant registration dashboard with payment status, issued QR display, and ticket PDF download
- `/admin`, `/admin/events`, `/admin/events/create`, `/admin/events/:id/edit`, `/admin/events/:id/preview`, `/admin/events/:id/registrations`, `/admin/registrations`, `/admin/organizations`, `/admin/settings`, `/admin/tickets`, `/admin/distributions` — super-admin panel
- `/admin/reports/registrations`, `/admin/reports/payments`, `/admin/reports/revenue`, `/admin/participants`, `/admin/reports/benefits`, `/admin/reports/volunteers` — Super Admin reporting center
- `/admin/volunteer-management` — Super Admin user search, volunteer-role administration, event/item assignments, and activity
- `/admin/payments` — super-admin manual-payment review
- `/admin/ticket-scanner` — Super Admin ticket check-in scanner
- `/payments/:registrationId` — owner-only payment submission and status
- `/payments/receipt/:registrationId/:paymentId` — owner-only approved payment slip
- `/volunteer` — role-protected assigned-event dashboard
- `/volunteer/scanner` — assigned-event ticket check-in scanner
- `/volunteer/distributions` — assigned-event/item-scoped distribution scan; does not check tickets in
- `/volunteer/history` — recent distribution history for currently authorized items

Public pages use published Supabase event rows; no hardcoded sample events are used by the production routes.

## Phase 3 registration count and privacy helpers

The database policies expose participants only to their own registrations and expose all registration rows to super admins. A browser-side query cannot safely derive public seat counts from those rows. The app therefore calls the two read-only functions in `supabase/manual/phase3-read-functions.sql`:

- `get_public_event_registration_counts(bigint[])` returns counts only for published event IDs.
- `get_my_registered_event_details()` returns display fields only for the signed-in user’s own registrations, including events hidden from public listings.

Review and run this file manually in Supabase SQL Editor. It creates functions only; it does not change tables, policies, or triggers. Run it as a database owner so the `SECURITY DEFINER` functions can read through RLS while returning only their restricted results. Until applied, public seat counts are omitted and the participant dashboard can show only event details visible under the existing published-events policy. The database registration trigger remains authoritative for seat limits, deadlines, duplicate registrations, and fee calculation.

Event `custom_form_fields` are JSONB arrays written by the admin form with objects shaped as `{ "id": "field-id", "name": "field_name", "label": "Field label", "type": "text", "required": true, "options": [] }`. Supported types are text, number, email, phone, dropdown, textarea, checkbox, and radio. Dropdown and radio options are string arrays.

Registration displays the database-calculated fee as a fee snapshot. Paid registrations continue to the manual payment flow; free registrations do not require payment.
The “Registration Closing Soon” label is shown when the deadline is within 24 hours.

## Phase 4 manual payments

Review `supabase/manual/phase4_payment_system.sql` and run it manually in Supabase SQL Editor as a database owner. The migration adds `event_payment_submissions`, owner/admin read policies, RPC-only submission and review functions, a private `evently-payment-proofs` Storage bucket, and bucket-scoped Storage policies. It does not change `events`, `event_registrations`, their trigger, or existing policies. It creates no gateway integrations.

The payment RPC reads the fee snapshot from the participant’s own `event_registrations` row; it does not trust a browser-supplied amount. Participants can read only their own payment submissions. Direct participant inserts, updates, approvals, and receipt creation are not granted. Super Admin approval/rejection is checked against `user_roles` in the database; an approval records the reviewer/time and creates a unique receipt number. Only an approved database record can be used to display a payment slip.

The registration trigger marks registrations as `registered` and the existing seat count includes registered rows. Accordingly, a paid registration reserves its seat while payment is pending; rejection and resubmission do not change the registration status or release the seat. Free registrations create no payment submission. Rejected submissions remain in the payment history, and a corrected submission links to the previous attempt.

The migration creates only the dedicated private screenshot bucket, limited to JPG/JPEG, PNG, and WEBP uploads up to 5 MB. Screenshots are stored under owner/registration-specific paths. Owners and Super Admins can read a linked proof through a short-lived signed URL; participants cannot update or delete linked proofs. If Supabase reports that `evently-payment-proofs` already exists with different settings, stop and inspect it rather than changing the bucket or any unrelated Storage configuration.

After running the migration, verify the bucket is private and the migration-created policies are present before enabling payment submission in production. No SQL is executed by the application.

## Phase 5 QR tickets and event entry

The Phase 5 database migration is `supabase/manual/phase5_qr_ticket_system.sql`. Apply and verify `phase4_payment_system.sql` first; the Phase 5 migration deliberately stops with a clear error if the Phase 4 payment table is absent or incompatible. Then run the Phase 5 file manually in Supabase SQL Editor as a database owner. The application does not execute SQL.

The Phase 5 migration adds `event_tickets`, a separately protected ticket-credential table, and `event_volunteer_assignments`. There was no event-specific volunteer assignment infrastructure in the inspected project, so volunteers receive no global scanning access: a Super Admin must assign a user who already has the `volunteer` platform role to each event in `/admin/tickets`. The migration adds an after-insert registration trigger for free tickets and an after-update payment trigger for approved paid tickets, then backfills eligible existing registrations. It does not replace or edit the existing registration-validation trigger, event tables, registration data, Phase 4 payment data, or existing policies.

Ticket tokens are generated inside PostgreSQL from cryptographically secure UUIDs. The raw credential is stored in a table with RLS enabled and no client table grants; only the signed-in participant’s own ticket RPC can return it. The PDF contains only the opaque token in its QR code and a random ticket reference—not a registration ID, user ID, email, or payment details. The free client-side packages `@zxing/browser`, `jspdf`, and `qrcode` provide camera scanning, PDF creation, and QR rendering.

These packages are included in `package.json` and `package-lock.json`; to add them to another checkout, run `npm install @zxing/browser jspdf qrcode`. No API keys, paid services, or additional environment variables are required.

Each ticket is unique per registration. The validation RPC verifies the selected event and staff scope, registration status, and (for paid events) the latest approved payment. It locks the ticket row and writes the check-in time and staff identity in the same transaction. Concurrent scans serialize: the first receives `VALID`; a subsequent scan receives `ALREADY_USED`. Unknown or revoked tokens reveal no participant details. An authorized scanner may see the assigned event’s participant name/type for an ineligible registration, but volunteer responses never include payment amounts or payment administration data.

Participants can download eligible tickets from their registration dashboard. Pending payments have no ticket; the dashboard explains that a ticket becomes available after approval. Rejected payments remain ineligible. Super Admins can search/filter ticket records, review check-in counts, assign or remove event-specific volunteer access, and revoke an unused ticket. Existing issued tickets for past registrations are created during the migration only when the registration is still active, the event is not cancelled/completed, and the saved fee is zero or the latest payment is approved.

For manual testing after both migrations are applied:

1. Register for a free event and confirm one ticket appears in the participant dashboard.
2. Register for a paid event; confirm no ticket while payment is pending or rejected.
3. Approve its payment as Super Admin; confirm the ticket appears and downloads as a PDF.
4. Scan the QR once and confirm `VALID`; scan it again and confirm `ALREADY_USED` with the previous check-in details. Repeat from two staff sessions at the same time; exactly one may receive `VALID`.
5. Try a modified token, the wrong event, a cancelled/completed event, and a revoked ticket; confirm entry is denied.
6. Assign a volunteer to one event, confirm they can scan only that event, remove the assignment, and confirm the scanner no longer lists it.
7. Attempt to access another participant’s ticket and use participant/volunteer sessions on admin ticket/payment routes; confirm database RPCs and route guards deny access.

Live ticket generation, camera permission, database concurrency, and PDF download cannot be verified against this workspace until the SQL is manually applied and authorized Supabase accounts are used.

## Phase 6 volunteer distributions

Review `supabase/manual/phase6_volunteer_distribution.sql` and run it manually in Supabase SQL Editor as a database owner, after applying and verifying Phase 4 and Phase 5. The migration preflights the existing ticket, payment, and event-volunteer objects and aborts if the required Phase 5 helper functions are missing. No SQL is executed by the application. This workspace has no live-schema connection, so confirm the deployed Supabase schema matches Phase 4/5 before applying it.

The migration creates dynamic event distribution items, append-only distribution records with event/item name snapshots, correction audit records, and item-level volunteer assignments. It reuses Phase 5 `event_volunteer_assignments`: a volunteer must first be assigned to the event in Ticket Management, then a Super Admin grants access to specific items in `/admin/distributions`. Revoking the Phase 5 event assignment also revokes its item assignments; a later event reassignment does not silently restore item access. Distribution item event associations can be changed only while the item has no distribution history or volunteer grants.

The Phase 5 scanner performs ticket validation and atomic check-in on its own route. Item distribution reuses the same QR camera/manual-token scanner component on a separate volunteer route and calls the Phase 6 distribution checklist RPC without changing check-in status. The checklist validates the opaque ticket, active ticket, registration, event, latest approved payment, event assignment, and item-level volunteer access. It intentionally does not reject a previously checked-in ticket. The distribution RPC locks the item row, verifies event and item permissions and ticket eligibility, then checks inventory and participant limits and writes the record atomically. A per-request UUID makes safe retries idempotent. One-per-participant behavior is configured with the item maximum of one; larger limits allow multiple units. Corrections append a reason, quantity, actor, and timestamp instead of deleting history.

The migration adds only database tables/functions/policies and a trigger on the existing Phase 5 event-assignment table. It does not replace ticket validation, modify registrations/payments, or change existing registration triggers. New table writes are RPC-only. Staff read policies constrain item, distribution, correction, and permission rows to Super Admins or the volunteer currently assigned to both the event and item. Admin analytics include inventory, net distributed units, remaining stock, eligible pending participant/items, completion, volunteer totals, and filtered recent history.

Distribution tables are added to the existing `supabase_realtime` publication when the migration runs. The client subscribes using the authenticated Supabase session and authorized row policies; pages display connection state and poll for a safe refetch while the channel is disconnected. Realtime refreshes views only—the RPC and database remain authoritative. If the publication is absent, enable Supabase Realtime for the project and confirm `supabase_realtime` exists before rerunning the migration.

No additional npm packages or environment variables are required; the existing `@supabase/supabase-js` Realtime client is reused.

For manual testing after migration:

1. As Super Admin, create an arbitrary item for an event, set stock/participant limits, and check its live inventory summary.
2. Assign a volunteer to the event in Ticket Management, then grant item-specific access on the item. Confirm the volunteer dashboard lists only authorized events/items.
3. Use the ticket scanner to check in a free ticket or approved paid ticket. Open Item Distribution separately, scan that ticket, and distribute some units; rescan the already checked-in ticket and confirm it can still receive only its remaining eligible quantity.
4. Attempt an invalid, wrong-event, revoked, pending-payment, or rejected-payment ticket. Confirm the distribution RPC denies it even if the scanner response appeared as `ALREADY_USED`.
5. Try to exceed item inventory and participant limits, submit the same request twice, and send concurrent distribution requests. Confirm the transaction lock and constraints prevent over-distribution/duplicates.
6. Observe the Admin and volunteer pages update after a distribution; temporarily disconnect Realtime and verify the reconnect indicator and fallback refetch.
7. Correct part or all of a distribution as Super Admin and verify both the original and correction remain in the audit history.
8. Revoke event or item access and confirm the volunteer can no longer scan/distribute for that scope. Confirm volunteer sessions still cannot access `/admin/payments`.

## Admin panel

The Admin Panel navigation and routes require the `super_admin` platform role. Event management reads and updates the existing `events` table; dashboard and event registration counts use exact, RLS-authorized count queries restricted to the signed-in super admin. Registration records are queried only from super-admin pages and remain protected by the existing `event_registrations` RLS policies. No schema changes or database policies are applied by the frontend.

The Universities & Departments page is intentionally read-only and shows active records from the existing tables. The current checked-in project does not define or document super-admin write policies for these tables, so create/edit/deactivate controls are not exposed. Before enabling those operations, review the project’s existing grants and RLS policies and add narrowly scoped policies that permit only `super_admin` users to manage organization rows; do not broaden public or participant write access.

## Phase 7 admin reporting center

The reporting center reuses the existing Super Admin route guard, role service, registration/event reads, Phase 4 payment records, Phase 5 ticket-admin RPC, and Phase 6 distribution/volunteer RPCs. Reports are read-only and do not add a payment workflow or mutate tickets, assignments, or distributions. Date filters use the relevant activity timestamp: registration time, event creation time, payment submission time, or payment review time. Inventory and volunteer assignments are current-state values; distribution activity is date-filtered.

Registration analytics and participant search use `event_registrations`. The participant report includes accounts with registration history only; the checked-in Phase 2 migration is not available in this repository, so an all-accounts profile search is not assumed. Student/employee ID is used only as a database search predicate and is not included in report exports. Payment and revenue reports use the existing `event_payment_submissions` records, exclude screenshot paths, and count collected revenue only from approved records. CSV and XLSX exports include filtered rows; XLSX is packaged locally with the free `fflate` dependency already listed in `package.json`.

The checked-in Phase 6 RPCs provide aggregate pending participant/item counts and distribution history, but not a participant/item-level pending, partial, or completed report. That detail remains unavailable rather than being inferred from ticket check-in or fabricated. To enable it, provide a narrowly scoped Super Admin-only read RPC over the existing registration, ticket, inventory, distribution, and assignment objects; return only eligible registration/item pairs and their allocated, distributed, remaining, ticket-status, and assigned-volunteer fields. No migration or SQL changes are included or run by the application. If a Phase 4, 5, or 6 object is missing from the deployed database, the corresponding report shows an unavailable state and requires the database owner to apply and verify the existing migration manually.

Run `npm run lint` and `npm run build` from the application directory after changes. Authenticated report queries and exports require an authorized Supabase session and cannot be verified against live data from this workspace.

## Phase 8 volunteer role management

The Phase 2 schema migration is not checked into this repository. The app uses its existing `profiles`, `user_roles`, `user_identities`, `institutions`, and `departments` contracts. Review `supabase/manual/phase8_volunteer_management.sql` against the deployed Phase 2 schema, then apply it manually as a database owner after Phase 5 and Phase 6. The file adds only two Super Admin-checked RPCs (`admin_search_users` and `admin_set_volunteer_role`); it does not create or alter tables or policies, and the application never runs SQL.

The search RPC returns profile name/email, institution/department names, all platform roles, and a count for pagination. The role RPC adds or removes only the `volunteer` row, preserving participant access. Revocation deactivates existing Phase 5 event assignments, which invokes the existing Phase 6 trigger to revoke item permissions. Granting the role does not restore event or item access; a Super Admin must explicitly assign each event and each allowed item using the existing Phase 5/6 RPCs. All RPCs verify the caller’s `super_admin` role in the database.

Until the migration is applied and verified, the Volunteer Management page reports the missing RPC rather than attempting direct `user_roles` or profile-table writes. Do not grant browser table-write privileges to enable role management.

## ID sign-in Edge Function

Email login works directly through Supabase Auth. Student/employee ID login requires deployment of `supabase/functions/login-with-id/index.ts`; it is not live until deployed.

1. Install and authenticate the Supabase CLI, then link the existing project:

   ```sh
   supabase login
   supabase link --project-ref <project-ref>
   ```

2. Copy `supabase/.env.local.example` to `supabase/.env.local` and fill in the values. Keep the server-only key there; `*.local` is ignored by Git. Set the secrets in the linked project:

   ```sh
   supabase secrets set --env-file supabase/.env.local
   ```

   `APP_ALLOWED_ORIGIN` should be the exact deployed web origin. `SUPABASE_URL` is provided by the Supabase Edge runtime, but the local env file also supports `supabase functions serve`. Never put the server-only key in frontend env files.

3. Deploy without gateway JWT verification because ID login starts before the user has a session:

   ```sh
   supabase functions deploy login-with-id --no-verify-jwt
   ```

For local function testing, use `supabase functions serve login-with-id --no-verify-jwt --env-file supabase/.env.local`.

The function performs a small per-isolate attempt limit and returns generic credential errors. This is only best-effort abuse protection; configure durable rate limiting and CAPTCHA or equivalent controls before production.

## Database assumptions

The frontend reads the existing `profiles`, `user_roles`, `user_identities`, `institutions`, and `departments` tables. Registration relies on the existing database trigger for profile and participant-role creation; it does not write roles or profiles. Identity inserts are restricted to the signed-in user and remain unverified. Database RLS remains authoritative for all access.

ID login will continue to reject new identities until an authorized process verifies them (`is_verified = true`); this phase does not include an identity-verification dashboard.
# EVENTLY
