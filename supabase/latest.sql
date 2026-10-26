-- Buff Beauty Bar: everything after the catch-up file (who does which services,
-- business details, closed days). Safe to run more than once, and whether or not
-- any of these were run before. Does not add sample bookings.
-- Generated from supabase/migrations/ 0800-1000 (edit those, not this).

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
