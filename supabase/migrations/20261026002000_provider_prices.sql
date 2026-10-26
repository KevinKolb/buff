-- Provider prices: each provider can charge their own price for a service,
-- higher or lower than the menu price. Set on the Team tab next to each
-- service they do; empty means the menu price.
-- Booking charges each guest their provider's price, with specials applied to
-- it. Gift cards stay at menu prices. Safe to run more than once.

alter table public.provider_services add column if not exists price numeric(8, 2) check (price is null or price >= 0);

drop function if exists public._visit_price(text[], date, int);
-- Price of one guest's visit with a given provider (their own price where they
-- have one, otherwise the menu price). total = what they pay; subtotal = before specials.
create or replace function public._visit_price(p_services text[], p_date date, p_start int, p_provider text default null,
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
  for sv in select s.id, s.name, coalesce(ps.price, s.price) as price
           from public.services s
           left join public.provider_services ps on ps.service_id = s.id and ps.provider_id = p_provider
           where s.name = any (p_services) loop
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
  -- each guest pays their own provider's price, with specials
  select sum(x.total) as total, min(x.note) as note into pr
  from unnest(array(select jsonb_array_elements_text(slot -> 'providerIds'))) as pid,
       lateral public._visit_price(v.services, d, start_m, pid) x;
  cid := public._client_for(p, false);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, discount_note, policy_agreed_at, client_id, occasion, place_id)
  values (d, start_m, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, pr.total,
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
  -- each guest pays their own provider's price, with specials
  select sum(x.total) as total, min(x.note) as note into pr
  from unnest(array(select jsonb_array_elements_text(slot -> 'providerIds'))) as pid,
       lateral public._visit_price(v.services, d, start_m, pid) x;
  cid := public._client_for(p, true);

  insert into public.bookings (date, start_min, mins, provider_pref, provider_ids, services, guests, total,
                               client_name, client_phone, client_email, note, discount_note, booked_by, policy_agreed_at, client_id, occasion, place_id)
  values (d, start_m, v.mins, pref,
          array(select jsonb_array_elements_text(slot -> 'providerIds')), v.services, v.guests, pr.total,
          trim(p #>> '{client,name}'), trim(p #>> '{client,phone}'), lower(trim(p #>> '{client,email}')), trim(coalesce(p #>> '{client,note}', '')), pr.note,
          lower(auth.jwt() ->> 'email'), now(), cid, left(trim(coalesce(p ->> 'occasion', '')), 60), place)
  returning * into rec;
  return to_jsonb(rec);
end;
$$;

revoke execute on function public._visit_price(text[], date, int, text) from public, anon, authenticated;
grant execute on function public.create_booking(jsonb) to anon, authenticated;
grant execute on function public.staff_create_booking(jsonb) to authenticated;
