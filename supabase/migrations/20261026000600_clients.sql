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
