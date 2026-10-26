-- Buff Beauty Bar: catch-up. Brings a database that has the original setup
-- (init, seed, grants, category order) up to date: roles, staff booking,
-- clients and client logins, sample data, who does which services, business details.
-- Safe to run more than once; each run adds another sample week (managers can remove samples on the front desk).
-- Generated from supabase/migrations/ 0500-0900 (edit those, not this).

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
