# Backend setup (Supabase)

Everything the live backend needs is in `supabase/migrations/`. These are the steps to stand it up.

## 1. Create the project

- Supabase account: the dedicated Buff login (email sign-in, not Google).
- Organization: Buff Beauty Bar, Free plan.
- Project name `buff-beauty-bar`, region `us-east-2` (closest free region to New Orleans).

## 2. Load the database

**From a phone:** open `supabase/setup-all.sql` on GitHub, tap **Raw**, copy all of it, paste it into Supabase → **SQL Editor** → **New query**, and tap **Run**. It's both migrations in one file.

**With the Supabase connector or CLI:** apply the migrations in order:

1. `20261026000000_init.sql`: tables, row-level security, booking functions
2. `20261026000100_seed.sql`: menu, hours, providers and settings (copied from `js/config.js`)

Then add the manager, using the same email as the Supabase login:

```sql
insert into public.staff (email, roles) values ('<manager email, lowercase>', '{manager}');
```

After that, managers add everyone else on the front desk's **Team** tab.

Run the security advisor afterwards and fix anything it flags.

## 3. Connect the site

In `js/config.js`, fill in `backend.supabaseUrl` with the project URL and `backend.supabaseKey` with the **publishable** key (`sb_publishable_…`). Never use the secret/service key here.

## 4. Settings only the owner can change (dashboard, works on a phone)

- **GitHub Pages:** repo Settings → Pages → deploy from the branch in use, folder `/ (root)`. The site address will be `https://<github-user>.github.io/buff/`.
- **Supabase sign-in redirect:** Authentication → URL Configuration. Set **Site URL** to the Pages address, and add `<Pages address>**` (two asterisks) under **Redirect URLs**, so sign-in links can return to any page: `staff.html` for staff, `account.html` for clients. Without this, sign-in links open the wrong page.

## 5. Email

Supabase's built-in email only sends to members of the Supabase organization, and only a few messages an hour. That's enough for the manager to test. Before other staff **or any clients** sign in, set up custom SMTP (for example Resend, free tier) under Authentication → Emails → SMTP Settings.

## Adding staff later

Use the **Staff logins** section of the front desk's **Team** tab. A login can have several roles:

- **Manager**: everything, including the Team and Menu tabs and approving time off.
- **Reservationist**: book clients (`book.html`), the schedule and the waitlist.
- **Service provider**: the schedule and their own time off requests. Linked to their column on the schedule.
