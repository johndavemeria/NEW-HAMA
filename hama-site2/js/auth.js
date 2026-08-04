// ------------------------------------------------------------------
// Shared auth + header logic, included on every page after
// supabase-client.js
// ------------------------------------------------------------------

let currentProfile = null; // the signed-in user's row from public.profiles
let currentSession = null;

function toast(msg, ms = 3200) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function isStaff(profile) {
  return !!profile && (profile.role === "founder" || profile.role === "admin");
}

function discordAvatarFallback(discordId) {
  const idx = discordId ? Number(BigInt(discordId) % 5n) : 0;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

async function signInWithDiscord() {
  await sb.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      scopes: "identify"
    }
  });
}

async function signOut() {
  await sb.auth.signOut();
  currentProfile = null;
  currentSession = null;
  localStorage.removeItem("hama_profile");
  window.location.href = "index.html";
}

// Pull fresh avatar/banner/username straight from Discord's API using
// the OAuth provider token Supabase hands back right after sign-in.
async function fetchDiscordUser(providerToken) {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${providerToken}` }
  });
  if (!res.ok) throw new Error("discord_fetch_failed");
  return res.json();
}

function buildDiscordAssetUrls(du) {
  const avatar_url = du.avatar
    ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.${du.avatar.startsWith("a_") ? "gif" : "png"}?size=256`
    : discordAvatarFallback(du.id);
  const banner_url = du.banner
    ? `https://cdn.discordapp.com/banners/${du.id}/${du.banner}.${du.banner.startsWith("a_") ? "gif" : "png"}?size=600`
    : null;
  return { avatar_url, banner_url };
}

// Runs once right after a fresh OAuth redirect: pulls the Discord
// profile and claims / refreshes / creates the matching row in
// public.profiles. Anyone can sign in — a brand-new account is
// created as a 'pending' visitor and stays that way until a
// founder/admin approves them from the Admin page.
async function claimProfileFromSession(session) {
  if (!session.provider_token) return; // no fresh Discord token this load
  let discordUser;
  try {
    discordUser = await fetchDiscordUser(session.provider_token);
  } catch (e) {
    console.warn("Could not read Discord profile", e);
    return;
  }

  const { avatar_url, banner_url } = buildDiscordAssetUrls(discordUser);
  const display_name = discordUser.global_name || discordUser.username;

  const { data, error } = await sb.rpc("handle_discord_login", {
    p_discord_id: discordUser.id,
    p_discord_username: discordUser.username,
    p_display_name: display_name,
    p_avatar_url: avatar_url,
    p_banner_url: banner_url
  });

  if (error) {
    toast("Sign-in failed: " + error.message, 5000);
    await sb.auth.signOut();
    currentProfile = null;
    return;
  }

  const isNewProfile = !currentProfile;
  currentProfile = data;
  localStorage.setItem("hama_profile", JSON.stringify(data));
  if (isNewProfile) {
    if (data.status === "pending") {
      toast(`Welcome, ${data.display_name}. You're signed in as a visitor — a founder needs to approve you before you can edit your profile or join the family tree.`, 6500);
    } else {
      toast(`Welcome to Hama, ${data.display_name}.`);
    }
  }
}

// True only for approved family members (or staff, who bypass the
// approval workflow entirely). Visitors (pending/denied) fail this.
function isApprovedMember(profile) {
  return !!profile && (profile.status === "approved" || isStaff(profile));
}

// On plain page loads (no fresh provider_token), just re-fetch the
// already-claimed profile so the header can render it.
async function loadOwnProfile(userId) {
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!error && data) {
    currentProfile = data;
    localStorage.setItem("hama_profile", JSON.stringify(data));
  }
}

function renderHeaderAuthState() {
  const slot = document.getElementById("auth-slot");
  if (!slot) return;

  if (currentSession && currentProfile) {
    slot.innerHTML = `
      <a href="profile.html?id=${currentProfile.id}" class="user-chip">
        <img src="${currentProfile.avatar_url || discordAvatarFallback(currentProfile.discord_id)}" alt="">
        <span>${currentProfile.display_name}</span>
      </a>
      <button class="btn btn-ghost btn-sm" id="signout-btn">Sign out</button>
    `;
    document.getElementById("signout-btn").addEventListener("click", signOut);
  } else if (currentSession && !currentProfile) {
    slot.innerHTML = `<button class="btn btn-ghost btn-sm" id="signout-btn">Sign out</button>`;
    document.getElementById("signout-btn").addEventListener("click", signOut);
  } else {
    slot.innerHTML = `<button class="btn btn-discord" id="discord-login-btn">Sign in with Discord</button>`;
    document.getElementById("discord-login-btn").addEventListener("click", signInWithDiscord);
  }

  document.querySelectorAll("[data-requires-auth]").forEach(el => {
    el.style.display = currentProfile ? "" : "none";
  });
  document.querySelectorAll("[data-requires-staff]").forEach(el => {
    el.style.display = isStaff(currentProfile) ? "" : "none";
  });
}

// Call this at the top of every page. Resolves once auth state is known.
async function initAuth() {
  const cached = localStorage.getItem("hama_profile");
  if (cached) currentProfile = JSON.parse(cached);

  const { data: { session } } = await sb.auth.getSession();
  currentSession = session;

  if (session) {
    if (session.provider_token) {
      await claimProfileFromSession(session);
    } else if (!currentProfile || currentProfile.user_id !== session.user.id) {
      await loadOwnProfile(session.user.id);
    }
  } else {
    currentProfile = null;
    localStorage.removeItem("hama_profile");
  }

  renderHeaderAuthState();

  sb.auth.onAuthStateChange(async (event, session) => {
    currentSession = session;
    if (event === "SIGNED_OUT") {
      currentProfile = null;
      localStorage.removeItem("hama_profile");
      renderHeaderAuthState();
    }
    if (event === "SIGNED_IN" && session) {
      await claimProfileFromSession(session);
      renderHeaderAuthState();
    }
  });

  return { session, profile: currentProfile };
}

// ------------------------------------------------------------------
// Shared Steam-style hover preview card. Call attachHoverPreview(el,
// profile) on any card/link that represents a member (explore grid,
// family tree cards, admin table rows, mini-cards…) and it'll show a
// floating mini-profile near the cursor on hover, using the profile
// data already in memory — no extra fetch.
// ------------------------------------------------------------------

let _hoverPreviewEl = null;
let _hoverPreviewTimer = null;

function ordinalGen(n) {
  if (n === 1) return "1st";
  if (n === 2) return "2nd";
  if (n === 3) return "3rd";
  return n ? `${n}th` : "Unplaced";
}

function hoverPreviewBadges(p) {
  const chips = [];
  if (p.status && p.status !== "approved") return `<span class="badge visitor">Visitor</span>`;
  chips.push(`<span class="badge">${ordinalGen(p.generation)} Gen</span>`);
  if (p.role === "founder") chips.push(`<span class="badge founder">Founder</span>`);
  else if (p.role === "admin") chips.push(`<span class="badge admin">Admin</span>`);
  else if (p.badge === "PvP Main") chips.push(`<span class="badge pvp">PvP Main</span>`);
  else chips.push(`<span class="badge hama">Hama</span>`);
  return chips.join("");
}

function getHoverPreviewEl() {
  if (_hoverPreviewEl) return _hoverPreviewEl;
  _hoverPreviewEl = document.createElement("div");
  _hoverPreviewEl.className = "hover-preview-card";
  document.body.appendChild(_hoverPreviewEl);
  return _hoverPreviewEl;
}

function showHoverPreview(profile, x, y) {
  const el = getHoverPreviewEl();
  const avatar = profile.avatar_url || discordAvatarFallback(profile.discord_id);
  el.innerHTML = `
    <div class="hp-banner" style="${profile.banner_url ? `background-image:url('${profile.banner_url}')` : "background:linear-gradient(135deg, var(--accent-soft), var(--surface-2))"}"></div>
    <img class="hp-avatar" src="${avatar}" alt="">
    <div class="hp-name">${profile.display_name}</div>
    <div class="hp-handle">@${profile.discord_username}</div>
    ${profile.bio ? `<div class="hp-bio">"${profile.bio}"</div>` : ""}
    <div class="hp-badges">${hoverPreviewBadges(profile)}</div>
  `;

  const vw = window.innerWidth, vh = window.innerHeight;
  let left = x + 18, top = y + 18;
  if (left + 296 > vw) left = x - 296 - 10;
  if (top + 260 > vh) top = vh - 270;
  el.style.left = `${Math.max(10, left)}px`;
  el.style.top = `${Math.max(10, top)}px`;

  requestAnimationFrame(() => el.classList.add("visible"));
}

function hideHoverPreview() {
  if (_hoverPreviewEl) _hoverPreviewEl.classList.remove("visible");
}

function attachHoverPreview(el, profile) {
  if (!el || !profile) return;
  el.addEventListener("mouseenter", (e) => {
    clearTimeout(_hoverPreviewTimer);
    _hoverPreviewTimer = setTimeout(() => showHoverPreview(profile, e.clientX, e.clientY), 160);
  });
  el.addEventListener("mousemove", (e) => {
    if (_hoverPreviewEl && _hoverPreviewEl.classList.contains("visible")) {
      showHoverPreview(profile, e.clientX, e.clientY);
    }
  });
  el.addEventListener("mouseleave", () => {
    clearTimeout(_hoverPreviewTimer);
    hideHoverPreview();
  });
}
