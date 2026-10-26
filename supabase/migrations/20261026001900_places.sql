-- Places: providers can work at more than one location, with travel time between them.
--
-- * places: a shared list of locations (business name and address, plus map
--   coordinates looked up when saved). The business itself is the main place,
--   kept in step with the Business tab.
-- * provider_places: where each provider works, optionally only on some days
--   of the week. A provider with no places works at the main place.
-- * place_travel: travel time between two places, set by hand. Without it,
--   travel is estimated from the map (straight-line distance, city driving,
--   plus 10 minutes to park and set up), or settings.travel_default_min when an
--   address couldn't be found on the map.
-- * Availability and booking take a place. A provider is free at a time only
--   if they work there that day, and there's enough travel time after their
--   appointment before and before their next one (holds count too).
-- * Bookings and holds record the place; no place means the main place.
-- Safe to run more than once.

create table if not exists public.places (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 80),
  address text not null check (length(trim(address)) between 5 and 160),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  is_main boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index if not exists places_one_main on public.places (is_main) where is_main;

create table if not exists public.provider_places (
  provider_id text not null references public.providers (id) on delete cascade,
  place_id bigint not null references public.places (id) on delete cascade,
  days int[] not null default '{}',        -- 0 = Sunday … 6 = Saturday; empty = every day
  primary key (provider_id, place_id)
);

create table if not exists public.place_travel (
  a bigint not null references public.places (id) on delete cascade,
  b bigint not null references public.places (id) on delete cascade,
  minutes int not null check (minutes between 0 and 240),
  primary key (a, b),
  check (a < b)
);

alter table public.settings add column if not exists travel_default_min int not null default 30
  check (travel_default_min between 0 and 240);
alter table public.bookings add column if not exists place_id bigint references public.places (id) on delete set null;
alter table public.slot_holds add column if not exists place_id bigint;

-- the main place, from the business details
insert into public.places (name, address, is_main)
select s.business_name, s.address, true from public.settings s
where s.id = 1 and not exists (select 1 from public.places where is_main);

create or replace function public._sync_main_place() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.business_name is distinct from old.business_name or new.address is distinct from old.address then
    update public.places set name = new.business_name,
      address = new.address,
      lat = case when address = new.address then lat end,     -- new address: find it on the map again
      lng = case when address = new.address then lng end
    where is_main;
  end if;
  return new;
end;
$$;
drop trigger if exists settings_sync_main_place on public.settings;
create trigger settings_sync_main_place after update on public.settings
  for each row execute function public._sync_main_place();

-- ----- who can see and change what -----
alter table public.places enable row level security;
alter table public.provider_places enable row level security;
alter table public.place_travel enable row level security;
drop policy if exists "public read" on public.places;
drop policy if exists "staff add" on public.places;
drop policy if exists "staff change" on public.places;
drop policy if exists "manager remove" on public.places;
drop policy if exists "public read" on public.provider_places;
drop policy if exists "own or manager" on public.provider_places;
drop policy if exists "public read" on public.place_travel;
drop policy if exists "own or manager" on public.place_travel;

-- A provider may change a place only if no other provider works there.
create or replace function public._my_place(p_place bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('manager') or (
    public.staff_provider_id() is not null
    and not exists (select 1 from public.places x where x.id = p_place and x.is_main)
    and exists (select 1 from public.provider_places pp where pp.place_id = p_place and pp.provider_id = public.staff_provider_id())
    and not exists (select 1 from public.provider_places pp where pp.place_id = p_place and pp.provider_id <> public.staff_provider_id()))
$$;
create or replace function public._works_at(p_place bigint) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.has_role('manager') or exists (
    select 1 from public.provider_places pp where pp.place_id = p_place and pp.provider_id = public.staff_provider_id())
$$;

create policy "public read" on public.places for select to anon, authenticated using (true);
create policy "staff add" on public.places for insert to authenticated
  with check (not is_main and (public.has_role('manager') or public.has_role('provider')));
create policy "staff change" on public.places for update to authenticated
  using (public._my_place(id)) with check (public._my_place(id));
create policy "manager remove" on public.places for delete to authenticated
  using (not is_main and public._my_place(id));

create policy "public read" on public.provider_places for select to anon, authenticated using (true);
create policy "own or manager" on public.provider_places for all to authenticated
  using (public.has_role('manager') or provider_id = public.staff_provider_id())
  with check (public.has_role('manager') or provider_id = public.staff_provider_id());

create policy "public read" on public.place_travel for select to anon, authenticated using (true);
create policy "own or manager" on public.place_travel for all to authenticated
  using (public._works_at(a) or public._works_at(b))
  with check (public._works_at(a) or public._works_at(b));

grant select on public.places, public.provider_places, public.place_travel to anon, authenticated;
grant insert, update, delete on public.places, public.provider_places, public.place_travel to authenticated;

-- ----- travel and where providers work -----
create or replace function public._main_place() returns bigint
language sql stable security definer set search_path = '' as $$
  select id from public.places where is_main
$$;

-- Minutes to get from one place to another (same either way).
create or replace function public._travel_min(p_a bigint, p_b bigint) returns int
language plpgsql stable security definer set search_path = '' as $$
declare
  va bigint := coalesce(p_a, public._main_place());
  vb bigint := coalesce(p_b, public._main_place());
  m int; pa public.places; pb public.places; km double precision;
begin
  if va is null or vb is null or va = vb then return 0; end if;
  select t.minutes into m from public.place_travel t where t.a = least(va, vb) and t.b = greatest(va, vb);
  if found then return m; end if;
  select * into pa from public.places where id = va;
  select * into pb from public.places where id = vb;
  if lower(trim(pa.address)) = lower(trim(pb.address)) then return 0; end if;
  if pa.lat is null or pb.lat is null then
    return (select travel_default_min from public.settings where id = 1);
  end if;
  km := 6371 * 2 * asin(sqrt(power(sin(radians(pb.lat - pa.lat) / 2), 2)
        + cos(radians(pa.lat)) * cos(radians(pb.lat)) * power(sin(radians(pb.lng - pa.lng) / 2), 2)));
  -- roads are ~1.3× the straight line; ~30 km/h in town; +10 min to park and set up; round up to 5
  return least(240, (ceil((km * 1.3 / 30 * 60 + 10) / 5) * 5)::int);
end;
$$;

-- Does this provider work at this place on this day?
create or replace function public._works_there(p_provider text, p_place bigint, p_date date) returns boolean
language sql stable security definer set search_path = '' as $$
  select case
    when not exists (select 1 from public.provider_places pp where pp.provider_id = p_provider)
      then coalesce(p_place, public._main_place()) = public._main_place()
    else exists (select 1 from public.provider_places pp
                 where pp.provider_id = p_provider and pp.place_id = coalesce(p_place, public._main_place())
                   and (cardinality(pp.days) = 0 or extract(dow from p_date)::int = any (pp.days)))
  end
$$;

-- Is the provider free from p_start for p_mins at p_place, counting travel to
-- and from their other appointments and holds that day?
create or replace function public._free_at(p_provider text, p_date date, p_start int, p_mins int, p_place bigint, p_hold_token text default null)
returns boolean
language sql stable security definer set search_path = '' as $$
  select not exists (
      select 1 from public.bookings b
      where b.date = p_date and b.status <> 'cancelled' and p_provider = any (b.provider_ids)
        and b.start_min < p_start + p_mins + public._travel_min(p_place, b.place_id)
        and b.start_min + b.mins + public._travel_min(b.place_id, p_place) > p_start)
    and not exists (
      select 1 from public.time_off x
      where x.date = p_date and x.status = 'approved' and x.provider_id = p_provider
        and x.start_min < p_start + p_mins and x.end_min > p_start)
    and not exists (                                   -- someone else is part-way through booking
      select 1 from public.slot_holds hh
      where hh.date = p_date and hh.expires_at > now() and p_provider = any (hh.provider_ids)
        and (p_hold_token is null or hh.token <> p_hold_token)
        and hh.start_min < p_start + p_mins + public._travel_min(p_place, hh.place_id)
        and hh.start_min + hh.mins + public._travel_min(hh.place_id, p_place) > p_start)
$$;

-- ----- availability, holds and booking, now by place -----
drop function if exists public.get_availability(date, int, text, int, text[]);
drop function if exists public.get_availability(date, int, text, int, text[], text);
drop function if exists public.get_availability(date, int, text, int, text[], text, bigint);
create function public.get_availability(p_date date, p_mins int, p_provider text, p_guests int,
  p_services text[] default null, p_hold_token text default null, p_place bigint default null)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  s public.settings;
  h public.business_hours;
  place bigint := coalesce(p_place, public._main_place());
  open_m int; close_m int; earliest int; t int;
  local_now timestamp;
  able text[]; free text[]; chosen text[]; pid text; ok boolean;
  slots jsonb := '[]'::jsonb;
begin
  select * into s from public.settings where id = 1;
  if p_mins is null or p_mins <= 0 or p_mins > 600 or p_guests is null or p_guests < 1 or p_guests > s.max_guests then
    raise exception 'invalid_request';
  end if;
  if p_place is not null and not exists (select 1 from public.places where id = p_place) then raise exception 'invalid_place'; end if;

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

  -- who could do this here today at all
  select coalesce(array_agg(pr.id order by pr.sort, pr.id), '{}') into able
  from public.providers pr
  where pr.active and public._does_all(pr.id, p_services) and public._works_there(pr.id, place, p_date);

  t := open_m;
  while t + p_mins <= close_m loop
    free := '{}';
    if t >= earliest then
      foreach pid in array able loop
        if public._free_at(pid, p_date, t, p_mins, place, p_hold_token) then free := free || pid; end if;
      end loop;
    end if;

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

  return jsonb_build_object('closed', false, 'slots', slots, 'placeId', place);
end;
$$;

create or replace function public.hold_slot(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  tok text := p ->> 'holdToken';
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  guests int := coalesce((p ->> 'guests')::int, 1);
  svcs text[] := array(select jsonb_array_elements_text(p -> 'services'));
  place bigint := coalesce(nullif(p ->> 'place', '')::bigint, public._main_place());
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
  from jsonb_array_elements(public.get_availability(d, m, pref, guests, svcs, tok, place) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then raise exception 'slot_taken'; end if;

  insert into public.slot_holds (token, date, start_min, mins, provider_ids, expires_at, place_id)
  values (tok, d, split_part(tm, ':', 1)::int * 60 + split_part(tm, ':', 2)::int, m,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), now() + interval '10 minutes', place)
  returning * into h;
  return jsonb_build_object('expiresAt', h.expires_at, 'providerIds', to_jsonb(h.provider_ids));
end;
$$;

create or replace function public.create_booking(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  v record;
  d date := (p ->> 'date')::date;
  tm text := p ->> 'time';
  pref text := coalesce(p ->> 'provider', 'any');
  place bigint := coalesce(nullif(p ->> 'place', '')::bigint, public._main_place());
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
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests, v.services, nullif(p ->> 'holdToken', ''), place) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;
  select * into pr from public._visit_price(v.services, d, start_m);   -- specials
  cid := public._client_for(p, false);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, discount_note, policy_agreed_at, client_id, occasion, place_id)
  values (d, start_m, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, pr.total * v.guests,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')), pr.note,
          case when (p ->> 'policyAgreed')::boolean then now() end, cid, left(trim(coalesce(p ->> 'occasion', '')), 60), place)
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
  place bigint := coalesce(nullif(p ->> 'place', '')::bigint, public._main_place());
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
  from jsonb_array_elements(public.get_availability(d, v.mins, pref, v.guests, v.services, null, place) -> 'slots') x
  where x ->> 'time' = tm;
  if slot is null or not (slot ->> 'available')::boolean then
    raise exception 'slot_taken';
  end if;
  select * into pr from public._visit_price(v.services, d, start_m);   -- specials
  cid := public._client_for(p, true);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, discount_note, booked_by, policy_agreed_at, client_id, occasion, place_id)
  values (d, start_m, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, pr.total * v.guests,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')), pr.note,
          lower(auth.jwt() ->> 'email'), now(), cid, left(trim(coalesce(p ->> 'occasion', '')), 60), place)
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

revoke execute on function public._sync_main_place() from public, anon, authenticated;
revoke execute on function public._main_place() from public;
revoke execute on function public._travel_min(bigint, bigint) from public;
revoke execute on function public._works_there(text, bigint, date) from public, anon, authenticated;
revoke execute on function public._free_at(text, date, int, int, bigint, text) from public, anon, authenticated;
revoke execute on function public._my_place(bigint) from public, anon;
revoke execute on function public._works_at(bigint) from public, anon;
revoke execute on function public.get_availability(date, int, text, int, text[], text, bigint) from public;
grant execute on function public._main_place() to anon, authenticated;
grant execute on function public._travel_min(bigint, bigint) to anon, authenticated;
grant execute on function public._my_place(bigint) to authenticated;
grant execute on function public._works_at(bigint) to authenticated;
grant execute on function public.get_availability(date, int, text, int, text[], text, bigint) to anon, authenticated;
grant execute on function public.hold_slot(jsonb) to anon, authenticated;
grant execute on function public.create_booking(jsonb) to anon, authenticated;
grant execute on function public.staff_create_booking(jsonb) to authenticated;
