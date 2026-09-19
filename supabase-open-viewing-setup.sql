-- ============================================================================
-- MPC Cricket App -- "Open Viewing + Device-Code Scorer" upgrade
-- ============================================================================
-- Run this once, in the Supabase SQL Editor, AFTER the original setup from
-- the README (kv_store, app_roles, profiles) already exists.
--
-- What this adds:
--   1. Anyone who opens the app link can view every match -- live and
--      completed -- with no login and no password.
--   2. On first visit, a person is asked for their name (a friendly label
--      only -- it grants no access on its own).
--   3. Admin sees a live "Who's Here" list and can promote any one of them
--      to Scorer right from their device, with no password ever created or
--      shared. Under the hood this uses a private per-device access code
--      (Supabase's built-in anonymous sign-in), invisible to everyone.
--   4. Admin's own login is completely unchanged -- still email + password,
--      via the existing app_roles table.
--
-- ONE-TIME MANUAL STEP (do this in the Supabase dashboard, not SQL):
--   Authentication -> Settings -> turn ON "Allow anonymous sign-ins".
--   Without this, the app falls back to requiring everyone to log in, same
--   as before this upgrade.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. device_roles -- one row per anonymous device/session ("who's here")
-- ----------------------------------------------------------------------------
create table if not exists device_roles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  role text not null default 'viewer',
  last_seen timestamptz default now()
);
alter table device_roles enable row level security;

-- Any signed-in session (including an anonymous one) can read the list --
-- needed so Admin's "Who's Here" panel works, and so a device can read its
-- own current role after being promoted.
drop policy if exists "authenticated can read device_roles" on device_roles;
create policy "authenticated can read device_roles" on device_roles
  for select using (auth.role() = 'authenticated');

-- A device can create its own row, always starting as a viewer -- it can
-- never insert itself in as a scorer.
drop policy if exists "users create their own presence" on device_roles;
create policy "users create their own presence" on device_roles
  for insert with check (auth.uid() = id and role = 'viewer');

-- A device can update its own row (name, heartbeat). The trigger below
-- stops this path from ever being used to self-promote.
drop policy if exists "users update their own presence" on device_roles;
create policy "users update their own presence" on device_roles
  for update using (auth.uid() = id);

-- Admins (checked the same way as everywhere else in this app -- by email,
-- against app_roles) can update ANY device's row, which is how a promotion
-- to Scorer actually happens.
drop policy if exists "admins can update any device_roles row" on device_roles;
create policy "admins can update any device_roles row" on device_roles
  for update using (
    exists (select 1 from app_roles where email = auth.email() and role = 'admin')
  );

-- Safety net: even though the "own row" update policy above only checks
-- WHO is updating (not WHAT), this trigger makes sure a role change only
-- ever sticks when the person making it is a real admin. A viewer heartbeat
-- or name change can never accidentally (or deliberately) grant itself
-- Scorer access.
create or replace function protect_device_role() returns trigger as $$
begin
  if NEW.role is distinct from OLD.role then
    if not exists (select 1 from app_roles where email = auth.email() and role = 'admin') then
      NEW.role := OLD.role;
    end if;
  end if;
  NEW.last_seen := coalesce(NEW.last_seen, OLD.last_seen, now());
  return NEW;
end;
$$ language plpgsql;

drop trigger if exists trg_protect_device_role on device_roles;
create trigger trg_protect_device_role
  before update on device_roles
  for each row execute function protect_device_role();

-- ----------------------------------------------------------------------------
-- 2. kv_store -- tighten writes to Scorers/Admins only, from EITHER a real
--    account (app_roles) OR a promoted anonymous device (device_roles).
--    Reads stay open to everyone signed in, which anonymous visitors now
--    always are, so match/team/stats viewing needs no login at all.
-- ----------------------------------------------------------------------------
drop policy if exists "Logged-in users can write" on kv_store;
drop policy if exists "Logged-in users can update" on kv_store;
drop policy if exists "Scorers and admins can write match data, others write the rest" on kv_store;
drop policy if exists "Scorers and admins can update match data, others update the rest" on kv_store;
drop policy if exists "Scorers and admins can write" on kv_store;
drop policy if exists "Scorers and admins can update" on kv_store;

create policy "Scorers and admins can write" on kv_store
  for insert with check (
    exists (select 1 from app_roles where email = auth.email() and role in ('scorer', 'admin'))
    or exists (select 1 from device_roles where id = auth.uid() and role in ('scorer', 'admin'))
  );

create policy "Scorers and admins can update" on kv_store
  for update using (
    exists (select 1 from app_roles where email = auth.email() and role in ('scorer', 'admin'))
    or exists (select 1 from device_roles where id = auth.uid() and role in ('scorer', 'admin'))
  );

-- kv_store's existing read policy ("Logged-in users can read", auth.role() =
-- 'authenticated') already covers anonymous sign-ins too -- Supabase marks
-- them 'authenticated' as well, just with is_anonymous = true. No change
-- needed there.

-- ============================================================================
-- After running this: open your app's link in a private/incognito window
-- with nobody logged in. You should be able to browse every match without
-- signing in at all. Then, as Admin, open Home -> Manage Access to see that
-- visit appear under "Who's Here" and promote it to Scorer.
-- ============================================================================
