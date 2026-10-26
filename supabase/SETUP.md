# Backend setup (Supabase)

Everything the live backend needs is in `supabase/migrations/`. These are the steps to stand it up.

## 1. Create the project

- Supabase account: the dedicated Buff login (email sign-in, not Google).
- Organization: Buff Beauty Bar, Free plan.
- Project name `buff-beauty-bar`, region `us-east-2` (closest free region to New Orleans).

## 2. Load the database

Apply the migrations in order:

1. `20261026000000_init.sql`: tables, row-level security, booking functions
2. `20261026000100_seed.sql`: menu, hours, providers and settings (copied from `js/config.js`)

Then add the manager, using the same email as the Supabase login:

```sql
insert into public.staff (email, role) values ('<manager email, lowercase>', 'manager');
```

Run the security advisor afterwards and fix anything it flags.

## 3. Connect the site

In `js/config.js`, fill in `backend.supabaseUrl` with the project URL and `backend.supabaseKey` with the **publishable** key (`sb_publishable_…`). Never use the secret/service key here.

## 4. Settings only the owner can change (dashboard, works on a phone)

- **GitHub Pages:** repo Settings → Pages → deploy from the branch in use, folder `/ (root)`. The site address will be `https://<github-user>.github.io/buff/`.
- **Supabase sign-in redirect:** Authentication → URL Configuration. Set **Site URL** to the Pages address, and add `<Pages address>staff.html` under **Redirect URLs**. Without this, staff sign-in links open the wrong page.

## 5. Email

Supabase's built-in email only sends to members of the Supabase organization, and only a few messages an hour. That's enough for the manager to test. Before other staff sign in, set up custom SMTP (for example Resend, free tier) under Authentication → Emails → SMTP Settings.

## Adding staff later

```sql
insert into public.staff (email, role, provider_id) values ('name@example.com', 'provider', 'p2');
```

`role` is `manager` or `provider`. `provider_id` links a provider to their column on the schedule, so they can request time off only for themselves.
