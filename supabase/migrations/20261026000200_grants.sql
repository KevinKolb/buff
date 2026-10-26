-- Explicit table permissions. Older Supabase projects granted these by
-- default; newer ones don't. Row-level security still decides which rows
-- each person can touch. These only let the request reach the table.

grant usage on schema public to anon, authenticated;

-- Anyone: read the menu, hours, providers and booking settings.
grant select on public.settings, public.business_hours, public.providers, public.services to anon, authenticated;

-- Signed-in users: everything else goes through the RLS policies
-- (staff only; managers for edits and time-off decisions).
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
