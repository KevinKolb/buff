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
