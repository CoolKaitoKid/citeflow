# CiteFlow

CiteFlow ("CITE-Flow Management System") is a faculty/academic management portal for research and capstone workflows.

## Architecture

- The backend (`index.js`) is a thin Express 5 server that only serves the static frontend in `CITE-Flow-Management-System/` and defines clean URL routes (e.g. `/login`, `/register`, `/dashboard`, `/faculty/dashboard`, `/onboarding`). There is no application logic in the Node server.
- All real functionality (auth, data, storage, realtime, messenger) runs client-side against a **hosted/live Supabase project**. The project URL and anon key are hardcoded in `CITE-Flow-Management-System/shared/supabase-config.js`. There is no local database; the SQL under `supabase/migrations/` and `supabase/functions/` documents the remote schema/edge functions and is not applied locally.

## Cursor Cloud specific instructions

- Run the app in development with `npm run dev` (`node --watch index.js`); it listens on port 3000 (override with `PORT`). `npm start` runs it without watch. Verify with `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login` (expect `200`).
- There is **no test suite** and **no linter** configured. `npm test` intentionally exits 1 (`Error: no test specified`) — do not treat that as a real failure.
- Because the frontend talks to the **live** Supabase project, any UI action that writes data (registering a user, onboarding, submitting workflows) mutates production data and may trigger real emails. For smoke-testing end-to-end connectivity without creating data, submit the login form with bogus credentials and confirm a `400 invalid_credentials` response from `*.supabase.co/auth/v1/token` (the UI shows "Incorrect email or password.").
- Admin self-registration (`/register`) requires an authorization passcode. Valid passcodes are hardcoded in `CITE-Flow-Management-System/shared/auth.js` (`VALID_ADMIN_PASSCODES`, e.g. `CITE-ADMIN-2026`). Faculty accounts are provisioned by admins, not via public registration.
- `.env.local` (`RESEND_API_KEY`) is only consumed by the Supabase edge function `supabase/functions/send-faculty-credentials`, not by the Express server, so it is not needed to run the app locally.
