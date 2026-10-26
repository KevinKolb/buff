-- Provider photos and Instagram.
--
-- * photo: a small picture (resized on the manager's phone to 192 px, stored as
--   a data: URL, so there is no file storage to set up). Managers add it on the
--   front desk's Team tab.
-- * instagram: handle without the @. Clients see an Instagram button beside the
--   provider when booking.
-- Safe to run more than once.

alter table public.providers add column if not exists photo text;
alter table public.providers add column if not exists instagram text;
alter table public.providers drop constraint if exists providers_photo_ok;
alter table public.providers add constraint providers_photo_ok
  check (photo is null or (photo like 'data:image/%' and length(photo) <= 80000));
alter table public.providers drop constraint if exists providers_instagram_ok;
alter table public.providers add constraint providers_instagram_ok
  check (instagram is null or instagram ~ '^[A-Za-z0-9._]{1,30}$');
