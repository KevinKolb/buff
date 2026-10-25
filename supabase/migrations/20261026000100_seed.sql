-- Starting data, copied from js/config.js. After this, edit it in the
-- Supabase table editor: the live site reads menu, hours and providers from here.

insert into public.settings (id, timezone, slot_step_min, days_ahead, min_notice_min, max_guests)
values (1, 'America/Chicago', 15, 30, 60, 3);

insert into public.business_hours (dow, open_time, close_time) values
  (0, '10:00', '17:00'),
  (1, '09:00', '19:00'),
  (2, '09:00', '19:00'),
  (3, '09:00', '19:00'),
  (4, '09:00', '19:00'),
  (5, '09:00', '19:00'),
  (6, '09:00', '18:00');

insert into public.providers (id, name, initials, blurb, sort) values
  ('p1', 'Provider 1', 'P1', 'Hair · Makeup', 0),
  ('p2', 'Provider 2', 'P2', 'Wax · Brows · Lashes', 1),
  ('p3', 'Provider 3', 'P3', 'Nails', 2),
  ('p4', 'Provider 4', 'P4', 'Spray tan · Jewelry', 3);

insert into public.services (cat, name, price, mins, price_note, sort) values
  ('Hair', 'Blow Out', 55, 45, null, 0),
  ('Hair', 'Dry Style', 35, 30, null, 1),
  ('Hair', 'Updo', 70, 60, null, 2),
  ('Hair', 'Styling Add-on', 10, 15, '+', 3),
  ('Hair', 'Conditioning Treatment', 25, 15, null, 4),
  ('Hair', 'Smoothing Treatment', 150, 90, null, 5),
  ('Wax', 'Brow Wax', 25, 15, null, 6),
  ('Wax', 'Brow Tweeze', 25, 15, null, 7),
  ('Wax', 'Bikini', 45, 20, null, 8),
  ('Wax', 'Extended Bikini', 55, 25, null, 9),
  ('Wax', 'Brazilian', 65, 30, null, 10),
  ('Wax', 'Half Leg Lower', 45, 30, null, 11),
  ('Wax', 'Half Leg Upper', 55, 30, null, 12),
  ('Wax', 'Full Leg', 80, 45, null, 13),
  ('Wax', 'Chin and Jaw', 20, 10, null, 14),
  ('Wax', 'Sideburns', 20, 10, null, 15),
  ('Wax', 'Under Arm', 25, 15, null, 16),
  ('Wax', 'Half Arm', 35, 20, null, 17),
  ('Wax', 'Full Arm', 50, 30, null, 18),
  ('Wax', 'Neck', 20, 10, null, 19),
  ('Wax', 'Shoulders', 20, 15, null, 20),
  ('Wax', 'Half Back', 45, 25, null, 21),
  ('Wax', 'Full Back', 75, 40, null, 22),
  ('Nails', 'Manicure', 30, 30, null, 23),
  ('Nails', 'Pedicure', 50, 45, null, 24),
  ('Nails', 'Dazzle Dry Manicure', 45, 45, null, 25),
  ('Nails', 'Dazzle Dry Pedicure', 65, 60, null, 26),
  ('Nails', 'Gel Manicure', 45, 45, null, 27),
  ('Nails', 'Gel Manicure with Removal', 50, 55, null, 28),
  ('Nails', 'Gel Pedicure', 65, 60, null, 29),
  ('Nails', 'Gel Pedicure with Removal', 70, 70, null, 30),
  ('Nails', 'Gel Removal', 10, 15, null, 31),
  ('Nails', 'Dip Manicure', 55, 60, null, 32),
  ('Nails', 'Dip Manicure with Removal', 70, 75, null, 33),
  ('Nails', 'Dip Removal', 20, 20, null, 34),
  ('Face', 'Brow Tint', 25, 15, null, 35),
  ('Face', 'Lash Tint', 25, 20, null, 36),
  ('Face', 'Eyes Only Makeup Application', 45, 30, null, 37),
  ('Face', 'Full Face Makeup Application', 85, 60, null, 38),
  ('Face', 'Strip Lashes', 20, 10, null, 39),
  ('Face', 'Individual Lashes', 40, 20, null, 40),
  ('Tanning', 'Spray Tan', 55, 20, null, 41),
  ('Tanning', 'Basecoat', 10, 5, null, 42),
  ('Tanning', 'Topcoat', 10, 5, null, 43),
  ('Jewelry', 'Permanent Bracelet', 75, 30, null, 44),
  ('Jewelry', 'Permanent Anklet', 90, 30, null, 45),
  ('Jewelry', 'Permanent Necklace', 165, 45, null, 46);
