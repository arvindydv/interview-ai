# Reporting AI-generated responses

Friday AI shows answers written by a generative AI model. To meet Microsoft Store policy 11.16 (Live
Generative AI Content), every answer can be reported from the desktop app, and administrators review
the reports in the admin console.

## How it works

| Step | Where |
| --- | --- |
| The user selects **Report response** (flag icon) on an answer in the overlay, or **Report** on a Warm up answer in the main window | `apps/desktop/src/overlay.tsx`, `apps/desktop/src/home.tsx`, form in `apps/desktop/src/reportForm.tsx` |
| They choose a reason (Harmful, Inappropriate, Misleading or Other), optionally add details, and submit | `REPORT_REASONS` in `packages/shared/src/reports.ts` |
| The Rust side sends `POST /v1/reports` with the user's Supabase access token. The token never reaches the webview | `report_answer` command in `apps/desktop/src-tauri/src/lib.rs` and `api.rs` |
| The API validates the request (signed-in, email-confirmed, not suspended; at most 30 reports an hour), then stores the report with a copy of the question, answer and model taken from its own record of that answer | `apps/api/src/routes/reports.ts` |
| The report goes in `public.content_reports`, with row-level security on and no PostgREST access. Only the API's database role can read it | `supabase/migrations/20261026000000_content_reports.sql` |
| Administrators open **Reports** in the admin console, read the reported answer, and mark it *Actioned* or *Dismissed* with a note. Every review is written to the audit log | `apps/admin/app/(console)/reports/page.tsx`, `apps/api/src/routes/admin/reports.ts` |

The response ID is the answer's `turnId`, which is also stored in `live_turns.turn_id`. If the user
reports the same answer again, the existing report is updated and reopened instead of a duplicate being
created. If the server has no record of the answer, the report keeps the text the app sent and the
console marks it as unmatched.

The user sees *"Thanks, your report was sent"* when the report succeeds. If it fails, an error appears
in the form (for example *"Couldn't send your report. Check your connection and try again."*) and what
they entered is kept so they can retry.

## Testing it as a Microsoft reviewer

Paste this into **Notes for certification** in Partner Center. Replace the account details with a
reviewer account that has paid minutes, so the free trial can't run out during review.

> **Reporting AI-generated content (policy 11.16)**
> 1. Sign in with the test account: `<reviewer email>` / `<password>`.
> 2. In the main window, select **Start interview**.
> 3. Generate an answer. Either:
>    - pick a practice question under **Warm up**, or
>    - in the overlay, select **Chat**, type a question (for example *"Tell me about yourself"*) and
>      press Enter.
> 4. When the answer has finished, select the **flag icon (Report response)** in the overlay's
>    answer header, or **Report** next to **Copy** on a Warm up answer.
> 5. Choose a reason (Harmful, Inappropriate, Misleading or Other), optionally add details, and select
>    **Submit report**.
> 6. The app confirms with *"Thanks, your report was sent."* The report goes to the Friday AI
>    moderation team for review.
>
> Users can also report content by email to `<support email>` or from https://friday-ai.in.

## Running the tests

```sh
# API: validation unit tests, plus end-to-end tests against the local stack (pnpm infra:up).
# The end-to-end suite is skipped unless SUPABASE_SERVICE_ROLE_KEY is set.
cd apps/api
SUPABASE_SERVICE_ROLE_KEY=$(npx supabase status -o env | sed -n 's/^SERVICE_ROLE_KEY="\(.*\)"/\1/p') pnpm test

# Desktop: report helpers (Node's built-in TypeScript support) and Rust unit tests.
cd apps/desktop
pnpm test
```

The end-to-end suite signs in a throwaway Supabase user and checks the following, then deletes the
user and its data:

- the API rejects requests without a valid token
- it rejects unknown reasons
- it stores the server's copy of the answer rather than the client's
- reporting the same answer again updates the existing report
- the rate limit applies
- user tokens can't reach `/admin/reports`
- an administrator can resolve a report, and the change is audited

## Checking the packaged Windows app

Run this on a Windows machine, from an installed release build (`pnpm build:desktop`) signed in
against the production API:

1. Follow the reviewer steps above and confirm the success message.
2. In the admin console, open **Reports**. The report appears with the right reason, details, question
   and answer, and the user's email.
3. Disconnect from the network, report another answer, and confirm the connection error appears and
   the form stays filled.
