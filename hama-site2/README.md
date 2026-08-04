# Hama — setup guide

Plain HTML/CSS/JS site backed by your Supabase project. Discord is the
sign-in method. **Anyone can sign in**, but new sign-ins land as a
**visitor** — only a founder/admin approving them turns them into a real
family member.

Files:
- `index.html`, `explore.html`, `family-tree.html`, `clips.html`,
  `profile.html`, `admin.html` — pages
- `CSS/style.css`, `CSS/img/logo.png` — styling + logo
- `js/supabase-client.js` — connects to your Supabase project
- `js/auth.js` — Discord sign-in logic + the shared hover-preview
  mini-profile card, used on every page
- `js/media.js` — shared video upload/embed helpers (Clips + Highlights)
- `js/pages/*.js` — logic for each page
- `schema.sql` — run this once, on a **brand-new** Supabase project
- `migration_2.sql`, `migration_3.sql`, then `migration_4.sql` — run these
  instead, **in order**, if you already have a project running an older
  version of this site

## 1. Database setup

**Brand new project:** run `schema.sql` only.

**Already running a previous version of this site:**
1. If you've never run `migration_2.sql`, run it first.
2. If you've never run `migration_3.sql` (approval workflow, Clips,
   Highlights), run it next.
3. Then run `migration_4.sql`. This adds:
   - `bg_video_url` / `bg_music_url` on each profile, so a member can set
     a personal background video and theme song on their own page.
   - Two new family-tree relationship types, **Sibling** and **Cousin**,
     alongside the existing **Child** and **In a Relationship** (this was
     called "spouse" under the hood before — same column value, new
     label).
   - Family-tree editing tightened to **founders/admins only, at every
     generation** — a 1st-gen root can no longer grow their own branch by
     themselves; only staff can add or remove a relationship anywhere in
     the tree now.
   - Retires the old **Tubero** badge. Any profile still on it is moved
     to **Hama** automatically before the constraint is tightened.

   It only adds/changes things — your existing members and family tree
   are untouched.

## 2. Create the Storage bucket (for video uploads)

`schema.sql`/`migration_3.sql` add the storage *policies*, but Supabase
requires the bucket itself to be created from the dashboard:

1. Supabase → **Storage** → **New bucket**.
2. Name it exactly `media`.
3. Toggle **Public bucket** ON. Save.

## 3. Create a Discord application (for OAuth) + turn on the provider

See the Discord Developer Portal for a Client ID/Secret, add the Supabase
callback URL as a redirect, then paste both into Supabase →
**Authentication → Providers → Discord**. Add every URL you'll host this
site on to **Authentication → URL Configuration → Redirect URLs**.

**Keep the Client Secret out of any file you share, upload, or commit.**
It only ever needs to be pasted into that Supabase screen.

## 4. Make yourself the first founder

Sign in once with your own Discord account — you'll be created as a
`pending` visitor, same as anyone else. Then, in Supabase's SQL Editor:

```sql
update public.profiles set role = 'founder', badge = 'Founder',
  status = 'approved', generation = 1, is_root = true
where discord_username = 'your-discord-username';
```

From here on, approve/promote everyone else from the **Admin** page — no
more SQL needed.

## 5. Run the site

Static site, no build step:
- VS Code + "Live Server" extension, or
- `python3 -m http.server 5500` from inside the folder, or
- upload as-is to Netlify / Vercel / GitHub Pages / Cloudflare Pages
  (then add that URL to Supabase's Redirect URLs).

## What's new in this pass

- **Personal background video & music.** On the edit panel of their own
  profile, an approved member can paste a direct `.mp4`/`.webm` link (or
  a YouTube link) for a full-bleed, looping background video behind their
  page, and a direct `.mp3`/`.ogg` link for a custom audio player with
  play/pause, seek, and volume — both entirely optional and off by
  default. Every panel on the profile uses a frosted-glass, rounded look
  so the video stays visible behind the content.
- **Rounded, glassy UI throughout.** Every card, panel, button, and modal
  now uses soft corners instead of sharp edges, and the profile page's
  panels are translucent/blurred rather than solid.
- **Hover preview cards.** Hovering any member card — in Explore, the
  Family Tree, or elsewhere — pops up a small Steam-style preview with
  their avatar, banner, bio, and badges, without leaving the page.
- **Richer family tree.** Every generation's cards are now clickable to
  view (and, for founders/admins, edit) that member's relationships —
  spouse/partner, children, **siblings**, and **cousins** — not just
  1st-gen roots. Connector lines between relatives are lightly animated.
  Editing is founder/admin-only at every level.
- **Manufacturing Consent** is now the display font for the big "HAMA"
  hero wordmark on the home page.
- The old **Tubero** badge has been retired site-wide in favor of Hama.

## Who can do what

| Action | Visitor (pending/denied) | Approved member | Founder / Admin |
|---|---|---|---|
| Sign in with Discord | ✅ | ✅ | ✅ |
| Appear in Explore → Visitors tab | ✅ | — | — |
| Appear in Explore → Family Members tab | ❌ | ✅ | ✅ |
| Edit their own bio/links/sections/background video/music | ❌ | ✅ | ✅ |
| Upload their own video highlights | ❌ | ✅ | ✅ |
| View any member's relationships in the Family Tree | ✅ | ✅ | ✅ |
| Add/remove a relationship at any generation | ❌ | ❌ | ✅ |
| Approve/deny visitors | ❌ | ❌ | ✅ |
| Promote/demote anyone's role/badge/generation/root | ❌ | ❌ | ✅ |
| Upload/remove Family Clips | ❌ | ❌ | ✅ |
| Remove any member's highlight | ❌ | own only | ✅ any |
| Remove a member entirely | ❌ | ❌ | ✅ |

## Notes

- Discord banners only show for accounts that have one set (Nitro /
  boosted servers), and animated ones come through as `.gif`
  automatically — same treatment now applies to a member's own uploaded
  background video/avatar assets.
- Background video/music links are just plain URLs the member controls —
  there's no upload for these two specifically (Highlights and Clips
  still support direct file upload to the `media` bucket). If a link goes
  dead or isn't a playable format, that section on their profile just
  quietly doesn't render, without erroring the whole page.
- The links/sections editors use raw JSON for the moment — swap in a
  friendlier form UI later if you want something more polished.
- If a founder demotes their own account, the Admin page warns first
  since it would lock them out immediately.
