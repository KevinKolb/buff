-- Order of the category buttons on the booking page, editable on the
-- front desk's Menu tab. Categories not listed follow in menu order.
alter table public.settings add column if not exists category_order text[] not null default '{}';
update public.settings
set category_order = array['Jewelry', 'Tanning', 'Hair', 'Wax', 'Nails', 'Face']
where id = 1 and category_order = '{}';
