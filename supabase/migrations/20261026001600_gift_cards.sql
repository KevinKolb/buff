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
