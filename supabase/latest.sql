-- Buff Beauty Bar: everything after the catch-up file (who does which services,
-- business details, closed days, holding times while booking, special occasions,
-- specials, service descriptions, provider photos and Instagram, gift cards).
-- Safe to run more than once, and whether or not any of these were run before. Does not add sample bookings.
-- Generated from supabase/migrations/ 0800 onward (edit those, not this).

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

-- "Celebrating something?" — an optional occasion on each booking
-- (birthday, bridal, anniversary…), shown to staff on the front desk.

alter table public.bookings add column if not exists occasion text not null default '' check (length(occasion) <= 60);

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
                               client_name, client_phone, client_email, note, policy_agreed_at, client_id, occasion)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')),
          case when (p ->> 'policyAgreed')::boolean then now() end, cid, left(trim(coalesce(p ->> 'occasion', '')), 60))
  returning * into rec;
  delete from public.slot_holds where token = p ->> 'holdToken';   -- the hold became a booking
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
                               client_name, client_phone, client_email, note, booked_by, policy_agreed_at, client_id, occasion)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, v.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')),
          lower(auth.jwt() ->> 'email'), now(), cid, left(trim(coalesce(p ->> 'occasion', '')), 60))
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

grant execute on function public.create_booking(jsonb) to anon, authenticated;
grant execute on function public.staff_create_booking(jsonb) to authenticated;

-- Specials and flexible pricing.
--
-- Two kinds of special, managed on the front desk's Specials tab:
--   time      a service price that depends on the day of the week, a time
--             window and/or a date range: percent off, dollars off, or a set price
--   quantity  book at least N services in one visit: percent or dollars off
-- Either can be limited to some services (empty list = all services).
--
-- How they combine (no surprises): each service gets the single best
-- time-based price that applies; then the best multi-service discount is
-- taken off the visit. Prices are worked out here, so the booked price is
-- always the advertised one.

create table if not exists public.specials (
  id bigint generated always as identity primary key,
  name text not null check (length(name) between 1 and 60),
  description text not null default '' check (length(description) <= 200),
  kind text not null check (kind in ('time', 'quantity')),
  service_ids bigint[] not null default '{}',
  discount_type text not null check (discount_type in ('percent', 'amount', 'price')),
  discount_value numeric(8, 2) not null check (discount_value >= 0),
  days int[] not null default '{}' check (days <@ array[0, 1, 2, 3, 4, 5, 6]),
  start_time time,
  end_time time,
  start_date date,
  end_date date,
  min_services int not null default 2 check (min_services between 2 and 10),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (discount_type <> 'percent' or discount_value <= 100),
  check (kind = 'time' or discount_type <> 'price'),
  check (start_time is null or end_time is null or end_time > start_time),
  check (start_date is null or end_date is null or end_date >= start_date)
);

alter table public.specials enable row level security;
drop policy if exists "public read" on public.specials;
drop policy if exists "staff read" on public.specials;
drop policy if exists "manager write" on public.specials;
create policy "public read" on public.specials for select to anon using (active);
create policy "staff read" on public.specials for select to authenticated using (active or public.staff_role() = 'manager');
create policy "manager write" on public.specials for all to authenticated
  using (public.staff_role() = 'manager') with check (public.staff_role() = 'manager');
grant select on public.specials to anon, authenticated;
grant insert, update, delete on public.specials to authenticated;

alter table public.bookings add column if not exists discount_note text not null default '';

-- Does a special apply on this date, at this start time?
create or replace function public._special_on(sp public.specials, p_date date, p_start int) returns boolean
language sql stable set search_path = '' as $$
  select sp.active
    and (sp.start_date is null or p_date >= sp.start_date)
    and (sp.end_date is null or p_date <= sp.end_date)
    and (cardinality(sp.days) = 0 or extract(dow from p_date)::int = any (sp.days))
    and (sp.start_time is null or p_start >= extract(hour from sp.start_time)::int * 60 + extract(minute from sp.start_time)::int)
    and (sp.end_time is null or p_start < extract(hour from sp.end_time)::int * 60 + extract(minute from sp.end_time)::int)
$$;

-- Price of one guest's visit. total = what they pay; subtotal = regular price.
create or replace function public._visit_price(p_services text[], p_date date, p_start int,
  out subtotal numeric, out total numeric, out note text)
language plpgsql stable security definer set search_path = '' as $$
declare
  sv record; sp public.specials;
  best numeric; cand numeric; best_name text;
  names text[] := '{}';
  priced jsonb := '[]'::jsonb;     -- [{id, price}] after time-based specials
  in_scope numeric; n int; disc numeric; best_disc numeric := 0; disc_name text;
begin
  subtotal := 0; total := 0;
  for sv in select s.id, s.name, s.price from public.services s where s.name = any (p_services) loop
    subtotal := subtotal + sv.price;
    best := sv.price; best_name := null;
    for sp in select * from public.specials x where x.kind = 'time' loop
      continue when not public._special_on(sp, p_date, p_start);
      continue when cardinality(sp.service_ids) > 0 and not sv.id = any (sp.service_ids);
      cand := case sp.discount_type
        when 'percent' then sv.price * (1 - sp.discount_value / 100)
        when 'amount' then greatest(sv.price - sp.discount_value, 0)
        else sp.discount_value end;
      if cand < best then best := cand; best_name := sp.name; end if;
    end loop;
    best := round(best, 2);
    total := total + best;
    priced := priced || jsonb_build_array(jsonb_build_object('id', sv.id, 'price', best));
    if best_name is not null and not best_name = any (names) then names := names || best_name; end if;
  end loop;

  for sp in select * from public.specials x where x.kind = 'quantity' loop
    continue when not public._special_on(sp, p_date, p_start);
    select count(*), coalesce(sum((e ->> 'price')::numeric), 0) into n, in_scope
    from jsonb_array_elements(priced) e
    where cardinality(sp.service_ids) = 0 or (e ->> 'id')::bigint = any (sp.service_ids);
    continue when n < sp.min_services;
    disc := case sp.discount_type when 'percent' then in_scope * sp.discount_value / 100 else least(sp.discount_value, in_scope) end;
    if disc > best_disc then best_disc := disc; disc_name := sp.name; end if;
  end loop;
  total := greatest(round(total - best_disc, 2), 0);
  if disc_name is not null then names := names || disc_name; end if;
  note := array_to_string(names, ', ');
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
  pr record;
  start_m int := split_part(p ->> 'time', ':', 1)::int * 60 + split_part(p ->> 'time', ':', 2)::int;
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
  select * into pr from public._visit_price(v.services, d, start_m);   -- specials
  cid := public._client_for(p, false);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, discount_note, policy_agreed_at, client_id, occasion)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, pr.total * v.guests,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')), pr.note,
          case when (p ->> 'policyAgreed')::boolean then now() end, cid, left(trim(coalesce(p ->> 'occasion', '')), 60))
  returning * into rec;
  delete from public.slot_holds where token = p ->> 'holdToken';   -- the hold became a booking
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
  pr record;
  start_m int := split_part(p ->> 'time', ':', 1)::int * 60 + split_part(p ->> 'time', ':', 2)::int;
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
  select * into pr from public._visit_price(v.services, d, start_m);   -- specials
  cid := public._client_for(p, true);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, discount_note, booked_by, policy_agreed_at, client_id, occasion)
  values (d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, pr.total * v.guests,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')), pr.note,
          lower(auth.jwt() ->> 'email'), now(), cid, left(trim(coalesce(p ->> 'occasion', '')), 60))
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

revoke execute on function public._special_on(public.specials, date, int) from public, anon, authenticated;
revoke execute on function public._visit_price(text[], date, int) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to anon, authenticated;
grant execute on function public.staff_create_booking(jsonb) to authenticated;

-- Optional description for each service, shown on the Services page.
-- Managers edit it on the Menu tab. Safe to run more than once.
alter table public.services add column if not exists description text;
alter table public.services drop constraint if exists services_description_len;
alter table public.services add constraint services_description_len check (description is null or length(description) <= 600);

-- Provider photos and Instagram.
--
-- * photo: a small picture (resized on the manager's phone to 192 px, stored as
--   a data: URL, so there is no file storage to set up). Managers add it on the
--   front desk's Team tab.
-- * instagram: handle without the @. Clients see an Instagram button beside the
--   provider when booking.
-- Safe to run more than once.

alter table public.providers add column if not exists photo text;
alter table public.providers add column if not exists instagram text;
alter table public.providers drop constraint if exists providers_photo_ok;
alter table public.providers add constraint providers_photo_ok
  check (photo is null or (photo like 'data:image/%' and length(photo) <= 80000));
alter table public.providers drop constraint if exists providers_instagram_ok;
alter table public.providers add constraint providers_instagram_ok
  check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');

-- Gift cards.
--
-- * Clients buy one on the booking page: pick services, then "Gift card" in
--   place of a provider, which skips the date and time. The value is the
--   services' regular price (times guests); specials apply when the visit is booked.
-- * Delivery: email to the recipient, email to the buyer to print, or both.
--   Until an email sender is set up, the confirmation page opens the buyer's own
--   email app with the gift link filled in, and offers a printable gift card.
-- * The code is the secret: anyone with the gift link can see the card (that's
--   the point), nobody can list cards. Staff (managers and reservationists) see
--   every card on the front desk, mark it paid and record what's used.
-- * Until a card processor is set up, cards start unpaid and the front desk
--   takes payment.
-- Safe to run more than once.

create table if not exists public.gift_cards (
  id bigint generated always as identity primary key,
  code text not null unique,
  services text[] not null,
  guests int not null default 1 check (guests between 1 and 10),
  amount numeric(8, 2) not null check (amount > 0),
  used numeric(8, 2) not null default 0,
  status text not null default 'unpaid' check (status in ('unpaid', 'paid', 'void')),
  delivery text not null check (delivery in ('recipient', 'self', 'both')),
  buyer_name text not null,
  buyer_phone text not null,
  buyer_email text not null,
  recipient_name text not null,
  recipient_email text,
  from_name text not null default '',
  message text not null default '',
  staff_note text not null default '',
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  constraint gift_cards_used_ok check (used >= 0 and used <= amount),
  constraint gift_cards_recipient_email check (delivery = 'self' or recipient_email is not null),
  constraint gift_cards_message_len check (length(message) <= 400)
);
create index if not exists gift_cards_created_idx on public.gift_cards (created_at desc);

alter table public.gift_cards enable row level security;
drop policy if exists "staff read" on public.gift_cards;
drop policy if exists "staff update" on public.gift_cards;
create policy "staff read" on public.gift_cards for select to authenticated
  using (public.has_role('manager') or public.has_role('reservationist'));
create policy "staff update" on public.gift_cards for update to authenticated
  using (public.has_role('manager') or public.has_role('reservationist'))
  with check (public.has_role('manager') or public.has_role('reservationist'));
-- staff can change only the status, what's been used and their note; never the value, code or buyer
revoke all on public.gift_cards from anon, authenticated;
grant select on public.gift_cards to authenticated;
grant update (status, used, staff_note, paid_at) on public.gift_cards to authenticated;

-- Buy one. The price comes from the menu here, not from the page.
create or replace function public.buy_gift_card(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  names text[] := array(select jsonb_array_elements_text(coalesce(p -> 'services', '[]'::jsonb)));
  g int := coalesce((p ->> 'guests')::int, 1);
  dlv text := coalesce(p ->> 'delivery', 'self');
  b_name text := trim(coalesce(p #>> '{buyer,name}', ''));
  b_phone text := trim(coalesce(p #>> '{buyer,phone}', ''));
  b_email text := lower(trim(coalesce(p #>> '{buyer,email}', '')));
  r_name text := trim(coalesce(p #>> '{recipient,name}', ''));
  r_email text := nullif(lower(trim(coalesce(p #>> '{recipient,email}', ''))), '');
  total numeric;
  n int;
  rec public.gift_cards;
  v_code text;
begin
  if cardinality(names) = 0 or cardinality(names) > 20 then raise exception 'bad_services'; end if;
  if g < 1 or g > 10 then raise exception 'bad_guests'; end if;
  if dlv not in ('recipient', 'self', 'both') then raise exception 'bad_delivery'; end if;
  if length(b_name) < 2 or length(b_name) > 80 then raise exception 'bad_name'; end if;
  if length(regexp_replace(b_phone, '\D', '', 'g')) < 10 then raise exception 'bad_phone'; end if;
  if b_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then raise exception 'bad_email'; end if;
  if length(r_name) < 1 or length(r_name) > 80 then raise exception 'bad_recipient'; end if;
  if dlv <> 'self' and (r_email is null or r_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$') then raise exception 'bad_recipient_email'; end if;
  if length(coalesce(p ->> 'message', '')) > 400 then raise exception 'bad_message'; end if;

  select sum(s.price), count(*) into total, n from public.services s where s.name = any (names) and s.active;
  if n <> cardinality(names) or total is null or total <= 0 then raise exception 'bad_services'; end if;

  loop
    v_code := 'BUFF-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4)) || '-' || upper(substr(md5(gen_random_uuid()::text), 1, 4));
    exit when not exists (select 1 from public.gift_cards c where c.code = v_code);
  end loop;

  insert into public.gift_cards (code, services, guests, amount, delivery, buyer_name, buyer_phone, buyer_email, recipient_name, recipient_email, from_name, message)
  values (v_code, names, g, total * g, dlv, b_name, b_phone, b_email, r_name, r_email,
          left(trim(coalesce(nullif(p ->> 'from', ''), b_name)), 80), left(trim(coalesce(p ->> 'message', '')), 400))
  returning * into rec;
  return public._gift_public(rec);
end;
$$;

-- What the gift link shows (no buyer contact details).
create or replace function public._gift_public(c public.gift_cards) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_build_object('code', c.code, 'services', to_jsonb(c.services), 'guests', c.guests, 'amount', c.amount,
    'balance', c.amount - c.used, 'valid', c.status <> 'void', 'recipientName', c.recipient_name, 'recipientEmail', c.recipient_email,
    'from', c.from_name, 'message', c.message, 'delivery', c.delivery, 'createdAt', c.created_at)
$$;

create or replace function public.get_gift_card(p_code text) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public._gift_public(c) from public.gift_cards c where c.code = upper(trim(p_code))
$$;

revoke execute on function public.buy_gift_card(jsonb) from public;
revoke execute on function public.get_gift_card(text) from public;
revoke execute on function public._gift_public(public.gift_cards) from public, anon, authenticated;
grant execute on function public.buy_gift_card(jsonb) to anon, authenticated;
grant execute on function public.get_gift_card(text) to anon, authenticated;
