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
