-- ============================================================
-- Hama — Migration 4: profile background music/video, richer
-- family-tree relationship types, founder-only tree editing,
-- and retiring the old "Tubero" badge.
-- Run this ONCE in Supabase → SQL Editor on your EXISTING project
-- (after schema.sql, migration_2.sql, migration_3.sql).
-- Safe to re-run — everything here is idempotent.
-- ============================================================

-- ---------------------------------------------------------------
-- 1. Profile background music + background video.
--    Both are plain URLs the owner pastes in on their own profile
--    edit panel (an mp3/ogg link for music, an mp4/webm link — or a
--    YouTube link, same rule as Highlights — for video). Nothing
--    here is a privileged field, so the existing
--    protect_privileged_profile_fields trigger and
--    "profiles_self_update" policy already let an approved member
--    set these on their own row with no further changes needed.
-- ---------------------------------------------------------------

alter table public.profiles add column if not exists bg_music_url text;
alter table public.profiles add column if not exists bg_video_url text;

-- ---------------------------------------------------------------
-- 2. Retire the "Tubero" badge. Any existing profile still on it
--    gets moved to "Hama" before the constraint is tightened, so
--    nobody ends up in a state that violates the new check.
-- ---------------------------------------------------------------

update public.profiles set badge = 'Hama' where badge = 'Tubero';

alter table public.profiles drop constraint if exists profiles_badge_check;
alter table public.profiles add constraint profiles_badge_check
  check (badge in ('Hama','PvP Main','Founder','Visitor'));

-- ---------------------------------------------------------------
-- 3. Richer relationship types on the family tree.
--    'spouse' is kept as the underlying value (existing data stays
--    valid) but the site now labels it "In a Relationship". New:
--    'sibling' and 'cousin'.
-- ---------------------------------------------------------------

alter table public.family_relations drop constraint if exists family_relations_relation_type_check;
alter table public.family_relations add constraint family_relations_relation_type_check
  check (relation_type in ('spouse','child','sibling','cousin'));

-- A member can only be linked to the same owner once per relation
-- type (already true for spouse/child via the old unique constraint;
-- this just re-affirms it covers the new types too since it's keyed
-- on relation_type generically).

-- ---------------------------------------------------------------
-- 4. Family tree editing is now founder/admin only, full stop —
--    a 1st-generation root can no longer grow their own branch by
--    themselves, and this applies at every generation, not just
--    generation 1.
-- ---------------------------------------------------------------

drop policy if exists "relations_owner_insert" on public.family_relations;
create policy "relations_owner_insert" on public.family_relations
  for insert with check (public.is_staff(auth.uid()));

drop policy if exists "relations_owner_delete" on public.family_relations;
create policy "relations_owner_delete" on public.family_relations
  for delete using (public.is_staff(auth.uid()));

drop function if exists public.is_root_owner(uuid, uuid);


-- MIGRATION 5 --

-- ============================================================
-- Hama — Migration 5: uploadable, switchable, deletable
-- background music per profile.
-- Run this ONCE in Supabase → SQL Editor, after migration_4.sql.
-- Safe to re-run — everything here is idempotent.
-- ============================================================

-- ---------------------------------------------------------------
-- 1. Table holding every music track a member has uploaded to
--    their own profile (via the "media" Storage bucket, same as
--    Clips/Highlights). profiles.bg_music_url still holds which
--    one is currently the active background track — it now always
--    points at an uploaded file's URL instead of a pasted link.
-- ---------------------------------------------------------------

create table if not exists public.profile_music (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  title text,
  url text not null,
  created_at timestamptz not null default now()
);

alter table public.profile_music enable row level security;

-- Anyone can see a member's track list, same visibility as the
-- profile itself.
drop policy if exists "music_select_all" on public.profile_music;
create policy "music_select_all" on public.profile_music
  for select using (true);

-- Only the profile's own approved-member owner, or a founder/admin,
-- can upload a track to it.
drop policy if exists "music_owner_insert" on public.profile_music;
create policy "music_owner_insert" on public.profile_music
  for insert with check (
    exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.user_id = auth.uid() and p.status = 'approved'
    )
    or public.is_staff(auth.uid())
  );

-- The owner, or any founder/admin, can delete a track (mirrors the
-- Highlights removal rule: own only for members, any for staff).
drop policy if exists "music_owner_delete" on public.profile_music;
create policy "music_owner_delete" on public.profile_music
  for delete using (
    exists (
      select 1 from public.profiles p
      where p.id = profile_id and p.user_id = auth.uid()
    )
    or public.is_staff(auth.uid())
  );

-- ---------------------------------------------------------------
-- 2. Nothing to backfill — profiles.bg_music_url is just a plain
--    URL either way, so any pre-existing pasted link keeps working
--    until the member replaces it with an uploaded track from the
--    new panel on their profile.
-- ---------------------------------------------------------------

-- ============================================================
-- Hama — Migration 6:
--  1. Discord display name now syncs on every login. Previously
--     handle_discord_login only refreshed avatar_url/banner_url for
--     a returning member — a display name changed on Discord was
--     never picked up again after the very first claim.
--  2. Admin access (the Admin page + editing the family tree at any
--     generation) is now its own flag, is_admin, completely separate
--     from the Founder/Admin *badge*. A profile can show "Founder"
--     and still not have Admin access — only whoever has
--     is_admin = true does. Founders keep full visibility in the
--     family tree either way; they just can't edit it unless they're
--     also flagged is_admin.
--  3. Background video gets an explicit type — GIF, YouTube link, or
--     any other direct video file link — instead of only guessing
--     from the URL's file extension.
-- Run this ONCE in Supabase → SQL Editor, after migration_4.sql
-- (which also contains what was labelled "migration 5" inside it).
-- Safe to re-run — everything here is idempotent.
-- ============================================================

-- ---------------------------------------------------------------
-- 1. Sync display_name (alongside avatar/banner) on every login.
-- ---------------------------------------------------------------

create or replace function public.handle_discord_login(
  p_discord_id text,
  p_discord_username text,
  p_display_name text,
  p_avatar_url text,
  p_banner_url text
)
returns public.profiles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_profile public.profiles;
begin
  if v_uid is null then
    raise exception 'not_authenticated';
  end if;

  select * into v_profile from public.profiles where user_id = v_uid;
  if found then
    -- Already-claimed account: keep discord identity, avatar, banner,
    -- AND display name in sync with Discord on every sign-in.
    update public.profiles
      set discord_id = p_discord_id,
          discord_username = p_discord_username,
          display_name = p_display_name,
          avatar_url = p_avatar_url,
          banner_url = p_banner_url
      where user_id = v_uid
      returning * into v_profile;
    return v_profile;
  end if;

  select * into v_profile
    from public.profiles
    where lower(discord_username) = lower(p_discord_username)
      and user_id is null
    limit 1;

  if found then
    update public.profiles
      set user_id = v_uid,
          discord_id = p_discord_id,
          avatar_url = p_avatar_url,
          banner_url = p_banner_url,
          display_name = p_display_name
      where id = v_profile.id
      returning * into v_profile;
    return v_profile;
  end if;

  insert into public.profiles (
    user_id, discord_id, discord_username, display_name,
    avatar_url, banner_url, role, badge, generation, is_root, status
  )
  values (
    v_uid, p_discord_id, p_discord_username, p_display_name,
    p_avatar_url, p_banner_url, 'member', 'Visitor', null, false, 'pending'
  )
  returning * into v_profile;

  return v_profile;
end;
$$;

grant execute on function public.handle_discord_login(text, text, text, text, text) to authenticated;

-- Heads up on staleness: the site can only pull fresh Discord data
-- while it holds a live Discord access token for that member, which
-- only exists for a few days right after they sign in — nothing
-- server-side polls Discord on its own. With the fix above, any page
-- load that still has a valid token refreshes name + avatar + banner
-- together (name used to be skipped entirely), so a member who opens
-- the site every so often stays in sync automatically. A member who's
-- been away a while will pick up their latest name/GIF avatar the
-- next time they sign back in — there's no way around that without
-- running a Discord bot server-side to poll everyone continuously,
-- which is a bigger change than this migration makes.

-- ---------------------------------------------------------------
-- 2. Admin access becomes its own flag, independent of role/badge.
-- ---------------------------------------------------------------

alter table public.profiles add column if not exists is_admin boolean not null default false;

-- One-time backfill so nobody currently relying on staff access loses
-- it the moment this runs: anyone already badged "admin", plus your
-- root founder(s), keep it. Everyone else starts without it — grant
-- Admin access to specific people from the Admin page from here on.
update public.profiles set is_admin = true where role = 'admin' or is_root = true;

create or replace function public.is_staff(uid uuid)
returns boolean
language sql
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where user_id = uid), false);
$$;

-- Lock is_admin down the same way role/badge/generation/is_root/
-- status/user_id already are: only someone who currently has Admin
-- access can grant or revoke it on any row, including their own.
create or replace function public.protect_privileged_profile_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_staff(auth.uid()) then
    new.role       := old.role;
    new.badge      := old.badge;
    new.generation := old.generation;
    new.is_root    := old.is_root;
    new.user_id    := old.user_id;
    new.status     := old.status;
    new.is_admin   := old.is_admin;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------
-- 3. Explicit background video type: gif / youtube / video / auto.
-- ---------------------------------------------------------------

alter table public.profiles add column if not exists bg_video_type text not null default 'auto';

alter table public.profiles drop constraint if exists profiles_bg_video_type_check;
alter table public.profiles add constraint profiles_bg_video_type_check
  check (bg_video_type in ('auto','gif','youtube','video'));

  -- ============================================================
-- Hama — Migration 7: member-customizable profile banner.
--
-- banner_url stays exactly what it was — the live banner pulled from
-- Discord, refreshed on login, null if the member has none set there.
-- This adds a second, member-controlled field, custom_banner_url,
-- that an approved member can set on their own profile (a GIF or any
-- other image link). When it's set, it's shown instead of their
-- Discord banner everywhere on the site — so someone with no Discord
-- banner can still have one here, and someone who does have one can
-- still swap in something else. Leaving it blank falls back to
-- whatever their Discord banner is.
--
-- No RLS changes needed: custom_banner_url isn't in the privileged-
-- field list the protect_privileged_profile_fields trigger locks
-- down, so the existing "profiles_self_update" policy (approved
-- members editing their own row) already covers it, the same way it
-- already covers bio/links/sections/bg_video_url/bg_music_url.
--
-- Run this ONCE in Supabase → SQL Editor, after migration_6.sql.
-- Safe to re-run — idempotent.
-- ============================================================

alter table public.profiles add column if not exists custom_banner_url text;
-- ---------------------------------------------------------------
