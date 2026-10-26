-- Optional description for each service, shown on the Services page.
-- Managers edit it on the Menu tab. Safe to run more than once.
alter table public.services add column if not exists description text;
alter table public.services drop constraint if exists services_description_len;
alter table public.services add constraint services_description_len check (description is null or length(description) <= 600);
