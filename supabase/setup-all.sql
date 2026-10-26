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
