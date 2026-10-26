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
