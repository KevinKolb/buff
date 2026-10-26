-- Buff Beauty Bar: full database setup in one file, for pasting into
-- Supabase → SQL Editor on a brand-new project. Run it once.
-- Generated from supabase/migrations/ (edit those, not this).

-- Buff Beauty Bar booking backend.
--
-- Clients never read tables directly. They call the RPC functions at the
-- bottom (availability, book, waitlist, find/cancel), which only return
-- what a client is allowed to see. Staff sign in and read/write through
-- row-level security, gated by the staff table (matched on login email).

-- ---------- reference data (editable in the Supabase table editor) ----------

create table public.settings (
  id int primary key default 1 check (id = 1),
  timezone text not null default 'America/Chicago',
  slot_step_min int not null default 15,
  days_ahead int not null default 30,
  min_notice_min int not null default 60,
  max_guests int not null default 3
);

create table public.business_hours (
  dow int primary key check (dow between 0 and 6), -- 0 = Sunday; no row = closed
  open_time time not null,
  close_time time not null check (close_time > open_time)
);

create table public.providers (
  id text primary key,
  name text not null,
  initials text not null,
  blurb text not null default '',
  sort int not null default 0,
  active boolean not null default true
);

create table public.services (
  id bigint generated always as identity primary key,
  cat text not null,
  name text not null unique,
  price numeric(8, 2) not null check (price >= 0),
  mins int not null check (mins > 0),
  price_note text,
  sort int not null default 0,
  active boolean not null default true
);

create table public.staff (
  email text primary key check (email = lower(email)),
  role text not null check (role in ('manager', 'provider')),
  provider_id text references public.providers (id),
  created_at timestamptz not null default now()
);

-- ---------- operational data ----------

-- Short, readable references like BB-7KQ2MX (no 0/O/1/I).
create function public.gen_ref(prefix text) returns text
language sql volatile set search_path = '' as $$
  select prefix || '-' || string_agg(substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6)
$$;

create table public.bookings (
  id text primary key default public.gen_ref('BB'),
  date date not null,
  start_min int not null check (start_min between 0 and 1439),
  mins int not null check (mins > 0),
  provider_pref text not null default 'any',
  provider_ids text[] not null,
  services text[] not null,
  guests int not null default 1 check (guests >= 1),
  total numeric(8, 2) not null,
  client_name text not null,
  client_phone text not null,
  client_email text not null,
  note text not null default '',
  status text not null default 'booked' check (status in ('booked', 'arrived', 'no-show', 'cancelled')),
  cancelled_by text check (cancelled_by in ('client', 'staff')),
  cancelled_at timestamptz,
  created_at timestamptz not null default now()
);
create index bookings_date_idx on public.bookings (date);

create table public.waitlist (
  id text primary key default public.gen_ref('WL'),
  date date not null,
  mins int not null check (mins > 0),
  provider_pref text not null default 'any',
  services text[] not null,
  guests int not null default 1,
  total numeric(8, 2) not null,
  client_name text not null,
  client_phone text not null,
  client_email text not null,
  note text not null default '',
  created_at timestamptz not null default now()
);
create index waitlist_date_idx on public.waitlist (date);

create table public.time_off (
  id text primary key default public.gen_ref('TO'),
  provider_id text not null references public.providers (id),
  date date not null,
  start_min int not null check (start_min between 0 and 1440),
  end_min int not null check (end_min between 0 and 1440),
  all_day boolean not null default false,
  reason text not null default '',
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  requested_by text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_min > start_min)
);
create index time_off_date_idx on public.time_off (date);

-- ---------- who is staff ----------

create function public.staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select s.role from public.staff s where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create function public.staff_provider_id() returns text
language sql stable security definer set search_path = '' as $$
  select s.provider_id from public.staff s where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

-- ---------- row-level security ----------

alter table public.settings enable row level security;
alter table public.business_hours enable row level security;
alter table public.providers enable row level security;
alter table public.services enable row level security;
alter table public.staff enable row level security;
alter table public.bookings enable row level security;
alter table public.waitlist enable row level security;
alter table public.time_off enable row level security;

-- Menu, hours and providers are public; managers can edit them.
create policy "public read" on public.settings for select to anon, authenticated using (true);
create policy "public read" on public.business_hours for select to anon, authenticated using (true);
create policy "public read" on public.providers for select to anon, authenticated using (true);
create policy "public read" on public.services for select to anon, authenticated using (true);
create policy "manager write" on public.settings for all to authenticated using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');
create policy "manager write" on public.business_hours for all to authenticated using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');
create policy "manager write" on public.providers for all to authenticated using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');
create policy "manager write" on public.services for all to authenticated using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');

-- Staff can see who's on staff (to show their own role); managers manage it.
create policy "staff read" on public.staff for select to authenticated using (public.staff_role() is not null);
create policy "manager write" on public.staff for all to authenticated using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');

-- Client data: staff only.
create policy "staff read" on public.bookings for select to authenticated using (public.staff_role() is not null);
create policy "staff update" on public.bookings for update to authenticated using (public.staff_role() is not null) with check (public.staff_role() is not null);
create policy "staff read" on public.waitlist for select to authenticated using (public.staff_role() is not null);
create policy "staff delete" on public.waitlist for delete to authenticated using (public.staff_role() is not null);

-- Time off: providers request for themselves, managers for anyone; only managers decide.
create policy "staff read" on public.time_off for select to authenticated using (public.staff_role() is not null);
create policy "staff request" on public.time_off for insert to authenticated
  with check (status = 'pending' and (public.staff_role() = 'manager' or provider_id = public.staff_provider_id()));
create policy "manager decide" on public.time_off for update to authenticated
  using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');

-- ---------- client RPCs ----------

-- Open start times for a visit. Same shape the front end's mock returns
-- (minus the display label, which the browser formats).
create function public.get_availability(p_date date, p_mins int, p_provider text, p_guests int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  h public.business_hours;
  open_m int; close_m int; earliest int; t int;
  local_now timestamp;
  free text[]; chosen text[]; pid text; ok boolean;
  slots jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  if p_mins is null or p_mins <= 0 or p_mins > 600 or p_guests is null or p_guests < 1 or p_guests > s.max_guests then
    raise exception 'invalid_request';
  end if;

  select * into h from public.business_hours where dow = extract(dow from p_date)::int;
  if not found then
    return jsonb_build_object('closed', true, 'slots', '[]'::jsonb);
  end if;
  open_m := extract(hour from h.open_time)::int * 60 + extract(minute from h.open_time)::int;
  close_m := extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int;

  local_now := now() at time zone s.timezone;
  if p_date < local_now::date or p_date > local_now::date + s.days_ahead then
    earliest := 100000; -- outside the booking window: show the day, nothing open
  elsif p_date = local_now::date then
    earliest := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int + s.min_notice_min;
  else
    earliest := 0;
  end if;

  t := open_m;
  while t + p_mins <= close_m loop
    select coalesce(array_agg(pr.id order by pr.sort, pr.id), '{}') into free
    from public.providers pr
    where pr.active
      and not exists (
        select 1 from public.bookings b
        where b.date = p_date and b.status <> 'cancelled' and pr.id = any (b.provider_ids)
          and b.start_min < t + p_mins and b.start_min + b.mins > t)
      and not exists (
        select 1 from public.time_off x
        where x.date = p_date and x.status = 'approved' and x.provider_id = pr.id
          and x.start_min < t + p_mins and x.end_min > t);

    ok := t >= earliest and cardinality(free) >= p_guests and (p_provider = 'any' or p_provider = any (free));
    chosen := '{}';
    if ok then
      if p_provider <> 'any' then chosen := array[p_provider]; end if;
      foreach pid in array free loop
        exit when cardinality(chosen) >= p_guests;
        if not pid = any (chosen) then chosen := chosen || pid; end if;
      end loop;
    end if;

    slots := slots || jsonb_build_array(jsonb_build_object(
      'time', lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0'),
      'available', ok,
      'providerIds', to_jsonb(chosen)));
    t := t + s.slot_step_min;
  end loop;

  return jsonb_build_object('closed', false, 'slots', slots);
end;
$$;

-- Shared input checks for booking + waitlist. Prices and durations come
-- from the services table, never from the browser.
create function public._visit_from(p jsonb, out services text[], out mins int, out total numeric, out guests int)
language plpgsql stable security definer set search_path = '' as $$
declare
  n int;
begin
  services := array(select jsonb_array_elements_text(p -> 'services'));
  guests := coalesce((p ->> 'guests')::int, 1);
  if cardinality(services) = 0 or cardinality(services) > 10 then raise exception 'invalid_services'; end if;
  select count(*), sum(sv.mins), sum(sv.price) into n, mins, total
  from public.services sv where sv.active and sv.name = any (services);
  if n <> cardinality(services) then raise exception 'invalid_services'; end if;
  total := total * guests;
  if length(trim(coalesce(p #>> '{client,name}', ''))) < 3
     or length(regexp_replace(coalesce(p #>> '{client,phone}', ''), '\D', '', 'g')) < 10
     or coalesce(p #>> '{client,email}', '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or length(coalesce(p #>> '{client,note}', '')) > 500
     or length(p #>> '{client,name}') > 100 then
    raise exception 'invalid_client';
  end if;
end;
$$;

create function public.create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  rec public.bookings;
begin
  select * into v from public._visit_from(p);
  -- one booking at a time per day, so two people can't take the same slot
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), trim(p #>> '{client,email}'), trim(coalesce(p #>> '{client,note}', '')))
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

create function public.join_waitlist(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  rec public.waitlist;
begin
  select * into v from public._visit_from(p);
  insert into public.waitlist (date, mins, provider_pref, services, guests, total, client_name, client_phone, client_email, note)
  values ((p ->> 'date')::date, v.mins, coalesce(p ->> 'provider', 'any'), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), trim(p #>> '{client,email}'), trim(coalesce(p #>> '{client,note}', '')))
  returning * into rec;
  return jsonb_build_object('id', rec.id);
end;
$$;

-- Lookup by reference + the mobile number it was booked with.
create function public.find_booking(p_ref text, p_phone text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select to_jsonb(b) from public.bookings b
  where b.id = upper(trim(p_ref))
    and right(regexp_replace(b.client_phone, '\D', '', 'g'), 10) = right(regexp_replace(p_phone, '\D', '', 'g'), 10)
    and length(regexp_replace(p_phone, '\D', '', 'g')) >= 10
$$;

create function public.cancel_booking(p_ref text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  rec public.bookings;
begin
  update public.bookings b set status = 'cancelled', cancelled_by = 'client', cancelled_at = now()
  where b.id = upper(trim(p_ref))
    and right(regexp_replace(b.client_phone, '\D', '', 'g'), 10) = right(regexp_replace(p_phone, '\D', '', 'g'), 10)
    and length(regexp_replace(p_phone, '\D', '', 'g')) >= 10
    and b.status = 'booked'
  returning * into rec;
  if rec.id is null then raise exception 'not_found'; end if;
  return to_jsonb(rec);
end;
$$;

-- Functions are callable only where intended.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.get_availability(date, int, text, int) to anon, authenticated;
grant execute on function public.create_booking(jsonb) to anon, authenticated;
grant execute on function public.join_waitlist(jsonb) to anon, authenticated;
grant execute on function public.find_booking(text, text) to anon, authenticated;
grant execute on function public.cancel_booking(text, text) to anon, authenticated;
grant execute on function public.staff_role() to authenticated;
grant execute on function public.staff_provider_id() to authenticated;
-- gen_ref runs as the column default for whoever inserts
grant execute on function public.gen_ref(text) to anon, authenticated;

-- Starting data, copied from js/config.js. After this, edit it in the
-- Supabase table editor: the live site reads menu, hours and providers from here.

insert into public.settings (id, timezone, slot_step_min, days_ahead, min_notice_min, max_guests)
values (1, 'America/Chicago', 15, 30, 60, 3);

insert into public.business_hours (dow, open_time, close_time) values
  (0, '10:00', '17:00'),
  (1, '09:00', '19:00'),
  (2, '09:00', '19:00'),
  (3, '09:00', '19:00'),
  (4, '09:00', '19:00'),
  (5, '09:00', '19:00'),
  (6, '09:00', '18:00');

insert into public.providers (id, name, initials, blurb, sort) values
  ('p1', 'Provider 1', 'P1', 'Hair · Makeup', 0),
  ('p2', 'Provider 2', 'P2', 'Wax · Brows · Lashes', 1),
  ('p3', 'Provider 3', 'P3', 'Nails', 2),
  ('p4', 'Provider 4', 'P4', 'Spray tan · Jewelry', 3);

insert into public.services (cat, name, price, mins, price_note, sort) values
  ('Hair', 'Blow Out', 55, 45, null, 0),
  ('Hair', 'Dry Style', 35, 30, null, 1),
  ('Hair', 'Updo', 70, 60, null, 2),
  ('Hair', 'Styling Add-on', 10, 15, '+', 3),
  ('Hair', 'Conditioning Treatment', 25, 15, null, 4),
  ('Hair', 'Smoothing Treatment', 150, 90, null, 5),
  ('Wax', 'Brow Wax', 25, 15, null, 6),
  ('Wax', 'Brow Tweeze', 25, 15, null, 7),
  ('Wax', 'Bikini', 45, 20, null, 8),
  ('Wax', 'Extended Bikini', 55, 25, null, 9),
  ('Wax', 'Brazilian', 65, 30, null, 10),
  ('Wax', 'Half Leg Lower', 45, 30, null, 11),
  ('Wax', 'Half Leg Upper', 55, 30, null, 12),
  ('Wax', 'Full Leg', 80, 45, null, 13),
  ('Wax', 'Chin and Jaw', 20, 10, null, 14),
  ('Wax', 'Sideburns', 20, 10, null, 15),
  ('Wax', 'Under Arm', 25, 15, null, 16),
  ('Wax', 'Half Arm', 35, 20, null, 17),
  ('Wax', 'Full Arm', 50, 30, null, 18),
  ('Wax', 'Neck', 20, 10, null, 19),
  ('Wax', 'Shoulders', 20, 15, null, 20),
  ('Wax', 'Half Back', 45, 25, null, 21),
  ('Wax', 'Full Back', 75, 40, null, 22),
  ('Nails', 'Manicure', 30, 30, null, 23),
  ('Nails', 'Pedicure', 50, 45, null, 24),
  ('Nails', 'Dazzle Dry Manicure', 45, 45, null, 25),
  ('Nails', 'Dazzle Dry Pedicure', 65, 60, null, 26),
  ('Nails', 'Gel Manicure', 45, 45, null, 27),
  ('Nails', 'Gel Manicure with Removal', 50, 55, null, 28),
  ('Nails', 'Gel Pedicure', 65, 60, null, 29),
  ('Nails', 'Gel Pedicure with Removal', 70, 70, null, 30),
  ('Nails', 'Gel Removal', 10, 15, null, 31),
  ('Nails', 'Dip Manicure', 55, 60, null, 32),
  ('Nails', 'Dip Manicure with Removal', 70, 75, null, 33),
  ('Nails', 'Dip Removal', 20, 20, null, 34),
  ('Face', 'Brow Tint', 25, 15, null, 35),
  ('Face', 'Lash Tint', 25, 20, null, 36),
  ('Face', 'Eyes Only Makeup Application', 45, 30, null, 37),
  ('Face', 'Full Face Makeup Application', 85, 60, null, 38),
  ('Face', 'Strip Lashes', 20, 10, null, 39),
  ('Face', 'Individual Lashes', 40, 20, null, 40),
  ('Tanning', 'Spray Tan', 55, 20, null, 41),
  ('Tanning', 'Basecoat', 10, 5, null, 42),
  ('Tanning', 'Topcoat', 10, 5, null, 43),
  ('Jewelry', 'Permanent Bracelet', 75, 30, null, 44),
  ('Jewelry', 'Permanent Anklet', 90, 30, null, 45),
  ('Jewelry', 'Permanent Necklace', 165, 45, null, 46);

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

-- Order of the category buttons on the booking page, editable on the
-- front desk's Menu tab. Categories not listed follow in menu order.
alter table public.settings add column if not exists category_order text[] not null default '{}';
update public.settings
set category_order = array['Jewelry', 'Tanning', 'Hair', 'Wax', 'Nails', 'Face']
where id = 1 and category_order = '{}';

-- Staff booking for phone and walk-in clients.
--   * get_availability gains p_staff: signed-in staff skip the online
--     minimum-notice rule (they can book someone in for right now).
--   * _visit_from can skip the email requirement (phone clients may not give one).
--   * staff_create_booking: same double-booking protection as online,
--     records which staff member made the booking.

alter table public.bookings add column if not exists booked_by text; -- staff email; null = booked online

drop function if exists public.get_availability(date, int, text, int);
create function public.get_availability(p_date date, p_mins int, p_provider text, p_guests int, p_staff boolean default false)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  h public.business_hours;
  open_m int; close_m int; earliest int; t int; notice int;
  local_now timestamp;
  free text[]; chosen text[]; pid text; ok boolean;
  slots jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  if p_mins is null or p_mins <= 0 or p_mins > 600 or p_guests is null or p_guests < 1 or p_guests > s.max_guests then
    raise exception 'invalid_request';
  end if;
  notice := case when p_staff and public.staff_role() is not null then 0 else s.min_notice_min end;

  select * into h from public.business_hours where dow = extract(dow from p_date)::int;
  if not found then
    return jsonb_build_object('closed', true, 'slots', '[]'::jsonb);
  end if;
  open_m := extract(hour from h.open_time)::int * 60 + extract(minute from h.open_time)::int;
  close_m := extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int;

  local_now := now() at time zone s.timezone;
  if p_date < local_now::date or p_date > local_now::date + s.days_ahead then
    earliest := 100000; -- outside the booking window: show the day, nothing open
  elsif p_date = local_now::date then
    earliest := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int + notice;
  else
    earliest := 0;
  end if;

  t := open_m;
  while t + p_mins <= close_m loop
    select coalesce(array_agg(pr.id order by pr.sort, pr.id), '{}') into free
    from public.providers pr
    where pr.active
      and not exists (
        select 1 from public.bookings b
        where b.date = p_date and b.status <> 'cancelled' and pr.id = any (b.provider_ids)
          and b.start_min < t + p_mins and b.start_min + b.mins > t)
      and not exists (
        select 1 from public.time_off x
        where x.date = p_date and x.status = 'approved' and x.provider_id = pr.id
          and x.start_min < t + p_mins and x.end_min > t);

    ok := t >= earliest and cardinality(free) >= p_guests and (p_provider = 'any' or p_provider = any (free));
    chosen := '{}';
    if ok then
      if p_provider <> 'any' then chosen := array[p_provider]; end if;
      foreach pid in array free loop
        exit when cardinality(chosen) >= p_guests;
        if not pid = any (chosen) then chosen := chosen || pid; end if;
      end loop;
    end if;

    slots := slots || jsonb_build_array(jsonb_build_object(
      'time', lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0'),
      'available', ok,
      'providerIds', to_jsonb(chosen)));
    t := t + s.slot_step_min;
  end loop;

  return jsonb_build_object('closed', false, 'slots', slots);
end;
$$;

drop function if exists public._visit_from(jsonb);
create function public._visit_from(p jsonb, p_need_email boolean default true,
  out services text[], out mins int, out total numeric, out guests int)
language plpgsql stable security definer set search_path = '' as $$
declare
  n int;
  email text := trim(coalesce(p #>> '{client,email}', ''));
begin
  services := array(select jsonb_array_elements_text(p -> 'services'));
  guests := coalesce((p ->> 'guests')::int, 1);
  if cardinality(services) = 0 or cardinality(services) > 10 then raise exception 'invalid_services'; end if;
  select count(*), sum(sv.mins), sum(sv.price) into n, mins, total
  from public.services sv where sv.active and sv.name = any (services);
  if n <> cardinality(services) then raise exception 'invalid_services'; end if;
  total := total * guests;
  if length(trim(coalesce(p #>> '{client,name}', ''))) < 2
     or length(regexp_replace(coalesce(p #>> '{client,phone}', ''), '\D', '', 'g')) < 10
     or ((p_need_email or email <> '') and email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$')
     or length(coalesce(p #>> '{client,note}', '')) > 500
     or length(p #>> '{client,name}') > 100 then
    raise exception 'invalid_client';
  end if;
end;
$$;

create function public.staff_create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  rec public.bookings;
begin
  if public.staff_role() is null then raise exception 'not_staff'; end if;
  select * into v from public._visit_from(p, false);
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests, true) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, booked_by)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), trim(coalesce(p #>> '{client,email}', '')),
          trim(coalesce(p #>> '{client,note}', '')), lower(auth.jwt() ->> 'email'))
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

revoke execute on function public.get_availability(date, int, text, int, boolean) from public;
revoke execute on function public._visit_from(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.staff_create_booking(jsonb) from public, anon;
grant execute on function public.get_availability(date, int, text, int, boolean) to anon, authenticated;
grant execute on function public.staff_create_booking(jsonb) to authenticated;

-- Roles and the staff booking page.
--
-- * A staff login can hold several roles: manager, reservationist, provider
--   (service provider). staff.role becomes staff.roles.
-- * Staff booking (book.html) follows the same rules as online booking:
--   email required, normal minimum notice, and the cancellation policy must be
--   confirmed. Only managers and reservationists can book for clients.
--
-- Safe whether or not 20261026000400_staff_booking.sql was run first.

-- ---------- roles ----------

alter table public.staff add column if not exists roles text[] not null default '{}';
do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'staff' and column_name = 'role') then
    update public.staff set roles = array[role] where cardinality(roles) = 0;
    alter table public.staff drop column role;
  end if;
end $$;
alter table public.staff drop constraint if exists staff_roles_valid;
alter table public.staff add constraint staff_roles_valid
  check (cardinality(roles) > 0 and roles <@ array['manager', 'reservationist', 'provider']);

create or replace function public.staff_roles() returns text[]
language sql stable security definer set search_path = '' as $$
  select coalesce((select s.roles from public.staff s where s.email = lower(coalesce(auth.jwt() ->> 'email', ''))), '{}')
$$;

create or replace function public.has_role(r text) returns boolean
language sql stable security definer set search_path = '' as $$
  select r = any (public.staff_roles())
$$;

-- Kept for the existing row-level security policies, which check
-- "staff_role() is not null" (any staff) and "staff_role() = 'manager'".
create or replace function public.staff_role() returns text
language sql stable security definer set search_path = '' as $$
  select case
    when 'manager' = any (public.staff_roles()) then 'manager'
    when cardinality(public.staff_roles()) > 0 then (public.staff_roles())[1]
  end
$$;

-- ---------- bookings: who booked, policy confirmation ----------

alter table public.bookings add column if not exists booked_by text;            -- staff email; null = booked online
alter table public.bookings add column if not exists policy_agreed_at timestamptz;

-- ---------- availability and input checks (back to one set of rules) ----------

drop function if exists public.get_availability(date, int, text, int, boolean);
drop function if exists public.get_availability(date, int, text, int);
create function public.get_availability(p_date date, p_mins int, p_provider text, p_guests int)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  h public.business_hours;
  open_m int; close_m int; earliest int; t int;
  local_now timestamp;
  free text[]; chosen text[]; pid text; ok boolean;
  slots jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  if p_mins is null or p_mins <= 0 or p_mins > 600 or p_guests is null or p_guests < 1 or p_guests > s.max_guests then
    raise exception 'invalid_request';
  end if;

  select * into h from public.business_hours where dow = extract(dow from p_date)::int;
  if not found then
    return jsonb_build_object('closed', true, 'slots', '[]'::jsonb);
  end if;
  open_m := extract(hour from h.open_time)::int * 60 + extract(minute from h.open_time)::int;
  close_m := extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int;

  local_now := now() at time zone s.timezone;
  if p_date < local_now::date or p_date > local_now::date + s.days_ahead then
    earliest := 100000; -- outside the booking window: show the day, nothing open
  elsif p_date = local_now::date then
    earliest := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int + s.min_notice_min;
  else
    earliest := 0;
  end if;

  t := open_m;
  while t + p_mins <= close_m loop
    select coalesce(array_agg(pr.id order by pr.sort, pr.id), '{}') into free
    from public.providers pr
    where pr.active
      and not exists (
        select 1 from public.bookings b
        where b.date = p_date and b.status <> 'cancelled' and pr.id = any (b.provider_ids)
          and b.start_min < t + p_mins and b.start_min + b.mins > t)
      and not exists (
        select 1 from public.time_off x
        where x.date = p_date and x.status = 'approved' and x.provider_id = pr.id
          and x.start_min < t + p_mins and x.end_min > t);

    ok := t >= earliest and cardinality(free) >= p_guests and (p_provider = 'any' or p_provider = any (free));
    chosen := '{}';
    if ok then
      if p_provider <> 'any' then chosen := array[p_provider]; end if;
      foreach pid in array free loop
        exit when cardinality(chosen) >= p_guests;
        if not pid = any (chosen) then chosen := chosen || pid; end if;
      end loop;
    end if;

    slots := slots || jsonb_build_array(jsonb_build_object(
      'time', lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0'),
      'available', ok,
      'providerIds', to_jsonb(chosen)));
    t := t + s.slot_step_min;
  end loop;

  return jsonb_build_object('closed', false, 'slots', slots);
end;
$$;

drop function if exists public._visit_from(jsonb, boolean);
drop function if exists public._visit_from(jsonb);
create function public._visit_from(p jsonb, out services text[], out mins int, out total numeric, out guests int)
language plpgsql stable security definer set search_path = '' as $$
declare
  n int;
begin
  services := array(select jsonb_array_elements_text(p -> 'services'));
  guests := coalesce((p ->> 'guests')::int, 1);
  if cardinality(services) = 0 or cardinality(services) > 10 then raise exception 'invalid_services'; end if;
  select count(*), sum(sv.mins), sum(sv.price) into n, mins, total
  from public.services sv where sv.active and sv.name = any (services);
  if n <> cardinality(services) then raise exception 'invalid_services'; end if;
  total := total * guests;
  if length(trim(coalesce(p #>> '{client,name}', ''))) < 2
     or length(regexp_replace(coalesce(p #>> '{client,phone}', ''), '\D', '', 'g')) < 10
     or coalesce(p #>> '{client,email}', '') !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
     or length(coalesce(p #>> '{client,note}', '')) > 500
     or length(p #>> '{client,name}') > 100 then
    raise exception 'invalid_client';
  end if;
end;
$$;

-- Online booking: unchanged rules; now records the policy checkbox when sent.
create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  rec public.bookings;
begin
  select * into v from public._visit_from(p);
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, policy_agreed_at)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), trim(p #>> '{client,email}'), trim(coalesce(p #>> '{client,note}', '')),
          case when (p ->> 'policyAgreed')::boolean then now() end)
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

-- Staff booking: managers and reservationists. Same rules as online, plus
-- the staff member must confirm they read the cancellation policy to the client.
drop function if exists public.staff_create_booking(jsonb);
create function public.staff_create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  rec public.bookings;
begin
  if not (public.has_role('manager') or public.has_role('reservationist')) then raise exception 'not_allowed'; end if;
  if coalesce((p ->> 'policyAgreed')::boolean, false) is not true then raise exception 'policy_required'; end if;
  select * into v from public._visit_from(p);
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, booked_by, policy_agreed_at)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), trim(p #>> '{client,email}'), trim(coalesce(p #>> '{client,note}', '')),
          lower(auth.jwt() ->> 'email'), now())
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

-- ---------- permissions ----------

revoke execute on function public.get_availability(date, int, text, int) from public;
revoke execute on function public._visit_from(jsonb) from public, anon, authenticated;
revoke execute on function public.staff_create_booking(jsonb) from public, anon;
revoke execute on function public.staff_roles() from public, anon;
revoke execute on function public.has_role(text) from public, anon;
grant execute on function public.get_availability(date, int, text, int) to anon, authenticated;
grant execute on function public.create_booking(jsonb) to anon, authenticated;
grant execute on function public.staff_create_booking(jsonb) to authenticated;
grant execute on function public.staff_roles() to authenticated;
grant execute on function public.has_role(text) to authenticated;
grant execute on function public.staff_role() to authenticated;

-- Clients and client logins.
--
-- * clients: one record per person (matched on email). Staff can see and edit
--   all of them; staff_note is never shown to the client.
-- * Clients sign in with an emailed link (Supabase Auth, same as staff). On
--   first sign-in, claim_client() links their login to their client record,
--   creating one if needed. Clients reach their own data only through the
--   functions below, never the tables.
-- * Every booking links to a client. Existing bookings are matched by email.

create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  name text not null default '',
  phone text not null default '',
  email text not null check (email = lower(email) and email ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'),
  staff_note text not null default '',
  user_id uuid unique references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists clients_email_key on public.clients (email);

alter table public.bookings add column if not exists client_id uuid references public.clients (id);
create index if not exists bookings_client_idx on public.bookings (client_id);

-- backfill from existing bookings (latest name/phone per email wins)
insert into public.clients (name, phone, email)
select distinct on (lower(trim(client_email))) trim(client_name), trim(client_phone), lower(trim(client_email))
from public.bookings
where lower(trim(client_email)) ~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
order by lower(trim(client_email)), created_at desc
on conflict (email) do nothing;
update public.bookings b set client_id = c.id
from public.clients c
where b.client_id is null and lower(trim(b.client_email)) = c.email;

alter table public.clients enable row level security;
drop policy if exists "staff read" on public.clients;
drop policy if exists "staff write" on public.clients;
drop policy if exists "staff update" on public.clients;
create policy "staff read" on public.clients for select to authenticated using (public.staff_role() is not null);
create policy "staff write" on public.clients for insert to authenticated with check (public.staff_role() is not null);
create policy "staff update" on public.clients for update to authenticated using (public.staff_role() is not null) with check (public.staff_role() is not null);
grant select, insert, update on public.clients to authenticated;

-- ---------- which client a booking belongs to ----------
-- p_staff = true: staff are booking, so they may pick a client (clientId) and
-- update the stored details. Online: a signed-in client books as themselves
-- and may update their own name/phone; anyone else is matched by email and
-- can't change an existing record.
create or replace function public._client_for(p jsonb, p_staff boolean) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  cid uuid;
  em text := lower(trim(coalesce(p #>> '{client,email}', '')));
  nm text := trim(coalesce(p #>> '{client,name}', ''));
  ph text := trim(coalesce(p #>> '{client,phone}', ''));
begin
  if p_staff then
    if coalesce(p ->> 'clientId', '') <> '' then
      select id into cid from public.clients where id = (p ->> 'clientId')::uuid;
      if cid is null then raise exception 'client_not_found'; end if;
      if exists (select 1 from public.clients where email = em and id <> cid) then raise exception 'email_in_use'; end if;
      update public.clients set name = nm, phone = ph, email = em,
        staff_note = coalesce(p #>> '{client,staffNote}', staff_note), updated_at = now()
      where id = cid;
      return cid;
    end if;
    select id into cid from public.clients where email = em;
    if cid is not null then
      update public.clients set name = nm, phone = ph,
        staff_note = coalesce(p #>> '{client,staffNote}', staff_note), updated_at = now()
      where id = cid;
      return cid;
    end if;
    insert into public.clients (name, phone, email, staff_note)
    values (nm, ph, em, coalesce(p #>> '{client,staffNote}', '')) returning id into cid;
    return cid;
  end if;

  if auth.uid() is not null then
    select id into cid from public.clients where user_id = auth.uid();
    if cid is not null then
      update public.clients set name = nm, phone = ph, updated_at = now() where id = cid;
      return cid;
    end if;
  end if;
  select id into cid from public.clients where email = em;
  if cid is null then
    insert into public.clients (name, phone, email) values (nm, ph, em) returning id into cid;
  end if;
  return cid;
end;
$$;

-- Online booking (as before, plus the client link).
create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  cid uuid;
  rec public.bookings;
begin
  select * into v from public._visit_from(p);
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;
  cid := public._client_for(p, false);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, policy_agreed_at, client_id)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')),
          case when (p ->> 'policyAgreed')::boolean then now() end, cid)
  returning * into rec;
  return to_jsonb(rec) - 'client_id';
end;
$$;

-- Staff booking (as before, plus picking/updating the client).
create or replace function public.staff_create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  cid uuid;
  rec public.bookings;
begin
  if not (public.has_role('manager') or public.has_role('reservationist')) then raise exception 'not_allowed'; end if;
  if coalesce((p ->> 'policyAgreed')::boolean, false) is not true then raise exception 'policy_required'; end if;
  select * into v from public._visit_from(p);
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;
  cid := public._client_for(p, true);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, booked_by, policy_agreed_at, client_id)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')),
          lower(auth.jwt() ->> 'email'), now(), cid)
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

-- ---------- client account ----------

-- The signed-in person's client record, linked on first sign-in.
create or replace function public.claim_client() returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  em text := lower(coalesce(auth.jwt() ->> 'email', ''));
  c public.clients;
begin
  if uid is null or em = '' then raise exception 'not_signed_in'; end if;
  select * into c from public.clients where user_id = uid;
  if c.id is null then
    update public.clients set user_id = uid, updated_at = now() where email = em and user_id is null returning * into c;
  end if;
  if c.id is null then
    insert into public.clients (email, user_id) values (em, uid) returning * into c;
  end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email);
end;
$$;

create or replace function public.update_my_profile(p_name text, p_phone text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  c public.clients;
begin
  if length(trim(coalesce(p_name, ''))) < 2 or length(trim(p_name)) > 100
     or length(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')) < 10 then
    raise exception 'invalid_client';
  end if;
  update public.clients set name = trim(p_name), phone = trim(p_phone), updated_at = now()
  where user_id = auth.uid() returning * into c;
  if c.id is null then raise exception 'not_signed_in'; end if;
  return jsonb_build_object('id', c.id, 'name', c.name, 'phone', c.phone, 'email', c.email);
end;
$$;

-- The signed-in client's bookings (no staff-only fields).
create or replace function public.my_bookings() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(b) - 'booked_by' - 'client_id' order by b.date desc, b.start_min desc), '[]'::jsonb)
  from public.bookings b
  join public.clients c on c.id = b.client_id
  where c.user_id = auth.uid()
$$;

create or replace function public.cancel_my_booking(p_id text) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  rec public.bookings;
begin
  update public.bookings b set status = 'cancelled', cancelled_by = 'client', cancelled_at = now()
  where b.id = p_id and b.status = 'booked'
    and b.client_id = (select c.id from public.clients c where c.user_id = auth.uid())
  returning * into rec;
  if rec.id is null then raise exception 'not_found'; end if;
  return to_jsonb(rec) - 'booked_by' - 'client_id';
end;
$$;

-- ---------- permissions ----------
revoke execute on function public._client_for(jsonb, boolean) from public, anon, authenticated;
revoke execute on function public.claim_client() from public, anon;
revoke execute on function public.update_my_profile(text, text) from public, anon;
revoke execute on function public.my_bookings() from public, anon;
revoke execute on function public.cancel_my_booking(text) from public, anon;
grant execute on function public.create_booking(jsonb) to anon, authenticated;
grant execute on function public.staff_create_booking(jsonb) to authenticated;
grant execute on function public.claim_client() to authenticated;
grant execute on function public.update_my_profile(text, text) to authenticated;
grant execute on function public.my_bookings() to authenticated;
grant execute on function public.cancel_my_booking(text) to authenticated;

-- Sample data for trying things out: a week of made-up bookings and clients,
-- marked is_sample so they can be removed in one go. They behave like real
-- bookings (they fill time slots) and show gray on the front desk.
--
-- Managers add or remove them from the front desk. This file also adds one
-- sample week right away.

alter table public.bookings add column if not exists is_sample boolean not null default false;
alter table public.clients add column if not exists is_sample boolean not null default false;

create or replace function public._add_sample_week() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  names text[] := array['Ava Broussard', 'Camille Robichaux', 'Simone Thibodeaux', 'Lauren Mouton', 'Josie Landry',
                        'Margot Dupre', 'Tess LeBlanc', 'Brielle Hebert', 'Nina Prejean', 'Claire Fontenot',
                        'Maya Guidry', 'Delphine Guillory'];
  s public.settings;
  h public.business_hours;
  today date;
  d date;
  pr record;
  sv record;
  c record;
  open_m int; close_m int; t int;
  n int := 0;
begin
  select * into s from public.settings where id = 1;
  today := (now() at time zone s.timezone)::date;

  for i in 1 .. array_length(names, 1) loop
    insert into public.clients (name, phone, email, is_sample)
    values (names[i], '(504) 555-' || lpad((1000 + i)::text, 4, '0'), lower(replace(names[i], ' ', '.')) || '@example.com', true)
    on conflict (email) do nothing;
  end loop;

  for k in 0 .. 6 loop
    d := today + k;
    select * into h from public.business_hours where dow = extract(dow from d)::int;
    continue when not found; -- closed that day
    open_m := extract(hour from h.open_time)::int * 60 + extract(minute from h.open_time)::int;
    close_m := extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int;

    for pr in select p.id from public.providers p where p.active order by p.sort loop
      t := open_m;
      while t < close_m loop
        select * into sv from public.services v where v.active order by random() limit 1;
        if random() < 0.55 and t + sv.mins <= close_m
           and not exists (select 1 from public.bookings b
                           where b.date = d and b.status <> 'cancelled' and pr.id = any (b.provider_ids)
                             and b.start_min < t + sv.mins and b.start_min + b.mins > t)
           and not exists (select 1 from public.time_off x
                           where x.date = d and x.status = 'approved' and x.provider_id = pr.id
                             and x.start_min < t + sv.mins and x.end_min > t) then
          select * into c from public.clients cl where cl.is_sample order by random() limit 1;
          insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                                       client_name, client_phone, client_email, client_id, is_sample)
          values (d, t, sv.mins, pr.id, array[pr.id], array[sv.name], 1, sv.price,
                  c.name, c.phone, c.email, c.id, true);
          n := n + 1;
          t := t + ((sv.mins + 14) / 15) * 15;      -- next start on a quarter hour
        else
          t := t + 15 * (1 + floor(random() * 3))::int;
        end if;
      end loop;
    end loop;
  end loop;
  return n;
end;
$$;

-- Front desk buttons (managers only).
create or replace function public.add_sample_week() returns int
language plpgsql volatile security definer set search_path = '' as $$
begin
  if not public.has_role('manager') then raise exception 'not_allowed'; end if;
  return public._add_sample_week();
end;
$$;

create or replace function public.remove_sample_data() returns int
language plpgsql volatile security definer set search_path = '' as $$
declare
  n int;
begin
  if not public.has_role('manager') then raise exception 'not_allowed'; end if;
  delete from public.bookings where is_sample;
  get diagnostics n = row_count;
  delete from public.clients c
  where c.is_sample and c.user_id is null
    and not exists (select 1 from public.bookings b where b.client_id = c.id);
  return n;
end;
$$;

revoke execute on function public._add_sample_week() from public, anon, authenticated;
revoke execute on function public.add_sample_week() from public, anon;
revoke execute on function public.remove_sample_data() from public, anon;
grant execute on function public.add_sample_week() to authenticated;
grant execute on function public.remove_sample_data() to authenticated;

-- one sample week now
select public._add_sample_week() as sample_bookings_added;

-- Which providers do which services.
--
-- * provider_services: one row per (provider, service) a provider is set up,
--   qualified or approved to do. Managers edit it on the front desk's Team tab.
-- * Availability and booking only use providers set up for every service in
--   the visit (each guest gets one provider who does all of their services).
-- * Existing providers start set up for every existing service, so nothing
--   changes until a manager narrows it. New providers and new services start
--   with no one, so nobody is bookable for something until a manager says so.

create table if not exists public.provider_services (
  provider_id text not null references public.providers (id) on delete cascade,
  service_id bigint not null references public.services (id) on delete cascade,
  primary key (provider_id, service_id)
);

insert into public.provider_services (provider_id, service_id)
select p.id, s.id from public.providers p cross join public.services s
where not exists (select 1 from public.provider_services)   -- first run only
on conflict do nothing;

alter table public.provider_services enable row level security;
drop policy if exists "public read" on public.provider_services;
drop policy if exists "manager write" on public.provider_services;
create policy "public read" on public.provider_services for select to anon, authenticated using (true);
create policy "manager write" on public.provider_services for all to authenticated
  using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');
grant select on public.provider_services to anon, authenticated;
grant insert, update, delete on public.provider_services to authenticated;

-- Is this provider set up for every one of these services? (null list = no check)
create or replace function public._does_all(p_provider text, p_services text[]) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_services is null or not exists (
    select 1 from unnest(p_services) as want(name)
    where not exists (
      select 1 from public.provider_services ps
      join public.services sv on sv.id = ps.service_id
      where ps.provider_id = p_provider and sv.name = want.name))
$$;

drop function if exists public.get_availability(date, int, text, int, text[]);
drop function if exists public.get_availability(date, int, text, int);
create function public.get_availability(p_date date, p_mins int, p_provider text, p_guests int, p_services text[] default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  h public.business_hours;
  open_m int; close_m int; earliest int; t int;
  local_now timestamp;
  free text[]; chosen text[]; pid text; ok boolean;
  slots jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  if p_mins is null or p_mins <= 0 or p_mins > 600 or p_guests is null or p_guests < 1 or p_guests > s.max_guests then
    raise exception 'invalid_request';
  end if;

  select * into h from public.business_hours where dow = extract(dow from p_date)::int;
  if not found then
    return jsonb_build_object('closed', true, 'slots', '[]'::jsonb);
  end if;
  open_m := extract(hour from h.open_time)::int * 60 + extract(minute from h.open_time)::int;
  close_m := extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int;

  local_now := now() at time zone s.timezone;
  if p_date < local_now::date or p_date > local_now::date + s.days_ahead then
    earliest := 100000; -- outside the booking window: show the day, nothing open
  elsif p_date = local_now::date then
    earliest := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int + s.min_notice_min;
  else
    earliest := 0;
  end if;

  t := open_m;
  while t + p_mins <= close_m loop
    select coalesce(array_agg(pr.id order by pr.sort, pr.id), '{}') into free
    from public.providers pr
    where pr.active
      and not exists (
        select 1 from public.bookings b
        where b.date = p_date and b.status <> 'cancelled' and pr.id = any (b.provider_ids)
          and b.start_min < t + p_mins and b.start_min + b.mins > t)
      and not exists (
        select 1 from public.time_off x
        where x.date = p_date and x.status = 'approved' and x.provider_id = pr.id
          and x.start_min < t + p_mins and x.end_min > t)
      and public._does_all(pr.id, p_services);

    ok := t >= earliest and cardinality(free) >= p_guests and (p_provider = 'any' or p_provider = any (free));
    chosen := '{}';
    if ok then
      if p_provider <> 'any' then chosen := array[p_provider]; end if;
      foreach pid in array free loop
        exit when cardinality(chosen) >= p_guests;
        if not pid = any (chosen) then chosen := chosen || pid; end if;
      end loop;
    end if;

    slots := slots || jsonb_build_array(jsonb_build_object(
      'time', lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0'),
      'available', ok,
      'providerIds', to_jsonb(chosen)));
    t := t + s.slot_step_min;
  end loop;

  return jsonb_build_object('closed', false, 'slots', slots);
end;
$$;

create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  cid uuid;
  rec public.bookings;
begin
  select * into v from public._visit_from(p);
  if pref <> 'any' and not public._does_all(pref, v.services) then raise exception 'not_qualified'; end if;
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests, v.services) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;
  cid := public._client_for(p, false);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, policy_agreed_at, client_id)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')),
          case when (p ->> 'policyAgreed')::boolean then now() end, cid)
  returning * into rec;
  return to_jsonb(rec) - 'client_id';
end;
$$;

create or replace function public.staff_create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  cid uuid;
  rec public.bookings;
begin
  if not (public.has_role('manager') or public.has_role('reservationist')) then raise exception 'not_allowed'; end if;
  if coalesce((p ->> 'policyAgreed')::boolean, false) is not true then raise exception 'policy_required'; end if;
  select * into v from public._visit_from(p);
  if pref <> 'any' and not public._does_all(pref, v.services) then raise exception 'not_qualified'; end if;
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests, v.services) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;
  cid := public._client_for(p, true);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, booked_by, policy_agreed_at, client_id)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')),
          lower(auth.jwt() ->> 'email'), now(), cid)
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

revoke execute on function public._does_all(text, text[]) from public, anon, authenticated;
revoke execute on function public.get_availability(date, int, text, int, text[]) from public;
grant execute on function public.get_availability(date, int, text, int, text[]) to anon, authenticated;
grant execute on function public.create_booking(jsonb) to anon, authenticated;
grant execute on function public.staff_create_booking(jsonb) to authenticated;

-- Business details editable on the front desk's Business tab (managers).
-- Opening hours (business_hours) and booking rules (settings) were already in
-- the database; this adds name, phone, address and the cancellation policy.

alter table public.settings add column if not exists business_name text not null default 'Buff Beauty Bar';
alter table public.settings add column if not exists phone text not null default '504-522-2833';
alter table public.settings add column if not exists address text not null default '720 Carondelet St, New Orleans, LA 70130';
alter table public.settings add column if not exists cancellation_policy_url text not null default 'https://buffbeautybar.com/cancellation-policy';
alter table public.settings add column if not exists cancellation_window_hours int not null default 24
  check (cancellation_window_hours between 0 and 168);

-- sensible limits on the booking rules managers can now change
alter table public.settings drop constraint if exists settings_rules_valid;
alter table public.settings add constraint settings_rules_valid check (
  slot_step_min in (5, 10, 15, 20, 30, 60)
  and days_ahead between 1 and 365
  and min_notice_min between 0 and 10080
  and max_guests between 1 and 10
);

-- Closed days (holidays and one-off closures), set on the front desk's
-- Business tab. No open times on a closed day, online or for staff;
-- appointments already booked that day stay on the schedule to be moved.

create table if not exists public.closed_dates (
  date date primary key,
  label text not null default '' check (length(label) <= 60),
  created_at timestamptz not null default now()
);

alter table public.closed_dates enable row level security;
drop policy if exists "public read" on public.closed_dates;
drop policy if exists "manager write" on public.closed_dates;
create policy "public read" on public.closed_dates for select to anon, authenticated using (true);
create policy "manager write" on public.closed_dates for all to authenticated
  using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');
grant select on public.closed_dates to anon, authenticated;
grant insert, update, delete on public.closed_dates to authenticated;

-- availability: same as before, plus closed days
drop function if exists public.get_availability(date, int, text, int, text[]);
create function public.get_availability(p_date date, p_mins int, p_provider text, p_guests int, p_services text[] default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  h public.business_hours;
  open_m int; close_m int; earliest int; t int;
  local_now timestamp;
  free text[]; chosen text[]; pid text; ok boolean;
  slots jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  if p_mins is null or p_mins <= 0 or p_mins > 600 or p_guests is null or p_guests < 1 or p_guests > s.max_guests then
    raise exception 'invalid_request';
  end if;

  select * into h from public.business_hours where dow = extract(dow from p_date)::int;
  if not found then
    return jsonb_build_object('closed', true, 'slots', '[]'::jsonb);
  end if;
  if exists (select 1 from public.closed_dates c where c.date = p_date) then   -- holiday / one-off closure
    return jsonb_build_object('closed', true, 'slots', '[]'::jsonb,
      'reason', (select c.label from public.closed_dates c where c.date = p_date));
  end if;
  open_m := extract(hour from h.open_time)::int * 60 + extract(minute from h.open_time)::int;
  close_m := extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int;

  local_now := now() at time zone s.timezone;
  if p_date < local_now::date or p_date > local_now::date + s.days_ahead then
    earliest := 100000; -- outside the booking window: show the day, nothing open
  elsif p_date = local_now::date then
    earliest := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int + s.min_notice_min;
  else
    earliest := 0;
  end if;

  t := open_m;
  while t + p_mins <= close_m loop
    select coalesce(array_agg(pr.id order by pr.sort, pr.id), '{}') into free
    from public.providers pr
    where pr.active
      and not exists (
        select 1 from public.bookings b
        where b.date = p_date and b.status <> 'cancelled' and pr.id = any (b.provider_ids)
          and b.start_min < t + p_mins and b.start_min + b.mins > t)
      and not exists (
        select 1 from public.time_off x
        where x.date = p_date and x.status = 'approved' and x.provider_id = pr.id
          and x.start_min < t + p_mins and x.end_min > t)
      and public._does_all(pr.id, p_services);

    ok := t >= earliest and cardinality(free) >= p_guests and (p_provider = 'any' or p_provider = any (free));
    chosen := '{}';
    if ok then
      if p_provider <> 'any' then chosen := array[p_provider]; end if;
      foreach pid in array free loop
        exit when cardinality(chosen) >= p_guests;
        if not pid = any (chosen) then chosen := chosen || pid; end if;
      end loop;
    end if;

    slots := slots || jsonb_build_array(jsonb_build_object(
      'time', lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0'),
      'available', ok,
      'providerIds', to_jsonb(chosen)));
    t := t + s.slot_step_min;
  end loop;

  return jsonb_build_object('closed', false, 'slots', slots);
end;
$$;

revoke execute on function public.get_availability(date, int, text, int, text[]) from public;
grant execute on function public.get_availability(date, int, text, int, text[]) to anon, authenticated;

-- Holding a time while a client finishes booking online.
--
-- When a client picks a time, it's held for 10 minutes: nobody else can
-- book it online or at the desk. The hold ends when they book, pick another
-- time, release it (the phone button offers this), leave the page, or it
-- expires. Clients identify their own hold with a random token kept in their
-- browser; there's no direct access to the table.

create table if not exists public.slot_holds (
  id uuid primary key default gen_random_uuid(),
  token text not null check (length(token) between 20 and 100),
  date date not null,
  start_min int not null,
  mins int not null check (mins > 0),
  provider_ids text[] not null,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists slot_holds_date_idx on public.slot_holds (date);
create index if not exists slot_holds_token_idx on public.slot_holds (token);
alter table public.slot_holds enable row level security;  -- no policies: functions only

drop function if exists public.get_availability(date, int, text, int, text[]);
drop function if exists public.get_availability(date, int, text, int, text[], text);
create function public.get_availability(p_date date, p_mins int, p_provider text, p_guests int, p_services text[] default null, p_hold_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  h public.business_hours;
  open_m int; close_m int; earliest int; t int;
  local_now timestamp;
  free text[]; chosen text[]; pid text; ok boolean;
  slots jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  if p_mins is null or p_mins <= 0 or p_mins > 600 or p_guests is null or p_guests < 1 or p_guests > s.max_guests then
    raise exception 'invalid_request';
  end if;

  select * into h from public.business_hours where dow = extract(dow from p_date)::int;
  if not found then
    return jsonb_build_object('closed', true, 'slots', '[]'::jsonb);
  end if;
  if exists (select 1 from public.closed_dates c where c.date = p_date) then   -- holiday / one-off closure
    return jsonb_build_object('closed', true, 'slots', '[]'::jsonb,
      'reason', (select c.label from public.closed_dates c where c.date = p_date));
  end if;
  open_m := extract(hour from h.open_time)::int * 60 + extract(minute from h.open_time)::int;
  close_m := extract(hour from h.close_time)::int * 60 + extract(minute from h.close_time)::int;

  local_now := now() at time zone s.timezone;
  if p_date < local_now::date or p_date > local_now::date + s.days_ahead then
    earliest := 100000; -- outside the booking window: show the day, nothing open
  elsif p_date = local_now::date then
    earliest := extract(hour from local_now)::int * 60 + extract(minute from local_now)::int + s.min_notice_min;
  else
    earliest := 0;
  end if;

  t := open_m;
  while t + p_mins <= close_m loop
    select coalesce(array_agg(pr.id order by pr.sort, pr.id), '{}') into free
    from public.providers pr
    where pr.active
      and not exists (
        select 1 from public.bookings b
        where b.date = p_date and b.status <> 'cancelled' and pr.id = any (b.provider_ids)
          and b.start_min < t + p_mins and b.start_min + b.mins > t)
      and not exists (
        select 1 from public.time_off x
        where x.date = p_date and x.status = 'approved' and x.provider_id = pr.id
          and x.start_min < t + p_mins and x.end_min > t)
      and public._does_all(pr.id, p_services)
      and not exists (                                   -- someone else is part-way through booking it
        select 1 from public.slot_holds hh
        where hh.date = p_date and hh.expires_at > now() and pr.id = any (hh.provider_ids)
          and (p_hold_token is null or hh.token <> p_hold_token)
          and hh.start_min < t + p_mins and hh.start_min + hh.mins > t);

    ok := t >= earliest and cardinality(free) >= p_guests and (p_provider = 'any' or p_provider = any (free));
    chosen := '{}';
    if ok then
      if p_provider <> 'any' then chosen := array[p_provider]; end if;
      foreach pid in array free loop
        exit when cardinality(chosen) >= p_guests;
        if not pid = any (chosen) then chosen := chosen || pid; end if;
      end loop;
    end if;

    slots := slots || jsonb_build_array(jsonb_build_object(
      'time', lpad((t / 60)::text, 2, '0') || ':' || lpad((t % 60)::text, 2, '0'),
      'available', ok,
      'providerIds', to_jsonb(chosen)));
    t := t + s.slot_step_min;
  end loop;

  return jsonb_build_object('closed', false, 'slots', slots);
end;
$$;

-- Hold a time. Replaces this visitor's previous hold.
create or replace function public.hold_slot(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  tok text := p ->> 'holdToken';
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  guests int := coalesce((p ->> 'guests')::int, 1);
  svcs text[] := array(select jsonb_array_elements_text(p -> 'services'));
  n int; m int;
  slot jsonb;
  h public.slot_holds;
begin
  if tok is null or length(tok) < 20 or length(tok) > 100 then raise exception 'invalid_request'; end if;
  select count(*), sum(sv.mins) into n, m from public.services sv where sv.active and sv.name = any (svcs);
  if cardinality(svcs) = 0 or n <> cardinality(svcs) then raise exception 'invalid_services'; end if;

  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  delete from public.slot_holds where token = tok or expires_at < now() - interval '1 day';
  -- don't let anyone tie up a whole day with holds
  if (select count(*) from public.slot_holds where date = d and expires_at > now()) >= 40 then raise exception 'too_many_holds'; end if;

  select x into slot
  from jsonb_array_elements(public.get_availability(d, m, pref, guests, svcs, tok) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then raise exception 'slot_taken'; end if;

  insert into public.slot_holds (token, date, start_min, mins, provider_ids, expires_at)
  values (tok, d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, m,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), now() + interval '10 minutes')
  returning * into h;
  return jsonb_build_object('expiresAt', h.expires_at, 'providerIds', to_jsonb(h.provider_ids));
end;
$$;

-- Release this visitor's hold (phone button, leaving the page, changing their mind).
create or replace function public.release_hold(p_token text) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  delete from public.slot_holds where token = p_token;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Front desk: who's mid-booking online (no client details), and releasing a hold.
create or replace function public.list_holds(p_date date) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when public.staff_role() is null then '[]'::jsonb else coalesce((
    select jsonb_agg(jsonb_build_object('id', h.id, 'start', h.start_min, 'mins', h.mins, 'providerIds', h.provider_ids, 'expiresAt', h.expires_at) order by h.start_min)
    from public.slot_holds h where h.date = p_date and h.expires_at > now()), '[]'::jsonb) end
$$;

create or replace function public.staff_release_hold(p_id uuid) returns int
language plpgsql volatile security definer set search_path = '' as $$
declare n int;
begin
  if not (public.has_role('manager') or public.has_role('reservationist')) then raise exception 'not_allowed'; end if;
  delete from public.slot_holds where id = p_id;
  get diagnostics n = row_count;
  return n;
end;
$$;

-- Online booking uses (and then clears) the visitor's own hold.
create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  slot jsonb;
  cid uuid;
  rec public.bookings;
begin
  select * into v from public._visit_from(p);
  if pref <> 'any' and not public._does_all(pref, v.services) then raise exception 'not_qualified'; end if;
  perform pg_advisory_xact_lock(hashtext('buff-booking-' || d::text));
  select x into slot
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests, v.services, nullif(p ->> 'holdToken', '')) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;
  cid := public._client_for(p, false);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, policy_agreed_at, client_id)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')),
          case when (p ->> 'policyAgreed')::boolean then now() end, cid)
  returning * into rec;
  delete from public.slot_holds where token = p ->> 'holdToken';   -- the hold became a booking
  return to_jsonb(rec) - 'client_id';
end;
$$;

revoke execute on function public.get_availability(date, int, text, int, text[], text) from public;
revoke execute on function public.hold_slot(jsonb) from public;
revoke execute on function public.release_hold(text) from public;
revoke execute on function public.list_holds(date) from public, anon;
revoke execute on function public.staff_release_hold(uuid) from public, anon;
grant execute on function public.get_availability(date, int, text, int, text[], text) to anon, authenticated;
grant execute on function public.hold_slot(jsonb) to anon, authenticated;
grant execute on function public.release_hold(text) to anon, authenticated;
grant execute on function public.list_holds(date) to authenticated;
grant execute on function public.staff_release_hold(uuid) to authenticated;
grant execute on function public.create_booking(jsonb) to anon, authenticated;
