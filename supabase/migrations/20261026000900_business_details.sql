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
