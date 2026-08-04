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