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
