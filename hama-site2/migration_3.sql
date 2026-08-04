-- ============================================================
-- Hama — Migration 3: approval queue, visitors, family clips,
-- and profile video highlights.
-- Run this ONCE in Supabase → SQL Editor on your EXISTING project
-- (after schema.sql / migration_2.sql have already been run).
-- Safe to re-run — everything here is idempotent.
-- ============================================================

-- ---------------------------------------------------------------
-- 1. Approval workflow: every profile now has a status.
--    - 'approved' = full family member (can be placed in the tree,
--      can edit their own bio/links/sections/highlights)
--    - 'pending'  = just signed in, awaiting a founder's decision.
--                   Shown only in the "Visitors" section of Explore.
--                   Cannot edit their profile.
--    - 'denied'   = a founder reviewed and rejected them. Same
--                   restrictions as pending, just off the review queue.
--                   A founder can still flip them back to approved later.
-- ---------------------------------------------------------------

-- Add the column without a default first, so we can backfill existing
-- rows as 'approved' before any default/constraint applies to new rows.
alter table public.profiles add column if not exists status text;
update public.profiles set status = 'approved' where status is null;
alter table public.profiles alter column status set default 'pending';
alter table public.profiles alter column status set not null;

alter table public.profiles drop constraint if exists profiles_status_check;
alter table public.profiles add constraint profiles_status_check
  check (status in ('pending','approved','denied'));

-- Visitors don't have a generation yet — allow null, and stop forcing
-- a default of 2 (a founder assigns generation on approval/placement).
alter table public.profiles alter column generation drop not null;
alter table public.profiles alter column generation drop default;

-- New visitors get a distinct badge.
alter table public.profiles drop constraint if exists profiles_badge_check;
alter table public.profiles add constraint profiles_badge_check
  check (badge in ('Hama','Tubero','PvP Main','Founder','Visitor'));

-- ---------------------------------------------------------------
-- 2. Lock self-editing to approved members only. The existing
--    protect_privileged_profile_fields trigger already stops a
--    non-staff user from changing role/badge/generation/is_root/
--    user_id — now it also protects `status` itself, and the update
--    policy below stops pending/denied visitors from editing
--    anything on their own row (bio/links/sections) at all.
-- ---------------------------------------------------------------

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
  end if;
  return new;
end;
$$;

drop policy if exists "profiles_self_update" on public.profiles;
create policy "profiles_self_update" on public.profiles
  for update
  using (auth.uid() = user_id and status = 'approved')
  with check (auth.uid() = user_id and status = 'approved');

-- ---------------------------------------------------------------
-- 3. New sign-ins land as 'pending' visitors instead of instant
--    members. Already-claimed accounts are unaffected.
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
    update public.profiles
      set discord_id = p_discord_id,
          discord_username = p_discord_username,
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
          display_name = coalesce(nullif(display_name, ''), p_display_name)
      where id = v_profile.id
      returning * into v_profile;
    return v_profile;
  end if;

  -- Brand-new sign-in with no pre-registered row: create them as a
  -- pending visitor. A founder/admin has to approve them from the
  -- Admin page before they become a real family member.
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

-- ---------------------------------------------------------------
-- 4. Family Clips — a public gallery. Only founders/admins can
--    upload or remove clips; everyone can view.
-- ---------------------------------------------------------------

create table if not exists public.family_clips (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  description   text default '',
  video_url     text not null,
  uploaded_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);

alter table public.family_clips enable row level security;

drop policy if exists "clips_public_read" on public.family_clips;
create policy "clips_public_read" on public.family_clips
  for select using (true);

drop policy if exists "clips_staff_insert" on public.family_clips;
create policy "clips_staff_insert" on public.family_clips
  for insert with check (public.is_staff(auth.uid()));

drop policy if exists "clips_staff_delete" on public.family_clips;
create policy "clips_staff_delete" on public.family_clips
  for delete using (public.is_staff(auth.uid()));

-- ---------------------------------------------------------------
-- 5. Profile video highlights — personal clips on a member's own
--    profile. Only approved family members can upload to their OWN
--    profile; visitors can't upload anywhere; anyone can view.
-- ---------------------------------------------------------------

create table if not exists public.profile_highlights (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null references public.profiles(id) on delete cascade,
  title         text not null,
  video_url     text not null,
  created_at    timestamptz not null default now()
);

alter table public.profile_highlights enable row level security;

drop policy if exists "highlights_public_read" on public.profile_highlights;
create policy "highlights_public_read" on public.profile_highlights
  for select using (true);

drop policy if exists "highlights_owner_insert" on public.profile_highlights;
create policy "highlights_owner_insert" on public.profile_highlights
  for insert with check (
    public.is_staff(auth.uid())
    or exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and status = 'approved'
    )
  );

drop policy if exists "highlights_owner_delete" on public.profile_highlights;
create policy "highlights_owner_delete" on public.profile_highlights
  for delete using (
    public.is_staff(auth.uid())
    or exists (
      select 1 from public.profiles
      where id = profile_id and user_id = auth.uid() and status = 'approved'
    )
  );

-- ---------------------------------------------------------------
-- 6. Storage bucket for uploaded video files.
--    You must ALSO create the bucket itself from the dashboard:
--    Storage → New bucket → name it exactly  media  → toggle "Public
--    bucket" ON → Save. (Bucket creation isn't available from SQL on
--    most Supabase projects, only the policies below are.)
-- ---------------------------------------------------------------

drop policy if exists "media_public_read" on storage.objects;
create policy "media_public_read" on storage.objects
  for select using (bucket_id = 'media');

-- Only approved family members or staff may upload into the bucket
-- (visitors are signed in but blocked here too, not just in the UI).
drop policy if exists "media_family_upload" on storage.objects;
create policy "media_family_upload" on storage.objects
  for insert with check (
    bucket_id = 'media'
    and (
      public.is_staff(auth.uid())
      or exists (select 1 from public.profiles where user_id = auth.uid() and status = 'approved')
    )
  );

drop policy if exists "media_owner_delete" on storage.objects;
create policy "media_owner_delete" on storage.objects
  for delete using (bucket_id = 'media' and owner = auth.uid());