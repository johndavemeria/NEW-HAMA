(async function () {
  await initAuth();

  const layout = document.getElementById("profile-layout");

  // The host rewrites /profile/<discord-username> to this same file
  // (see README, "Pretty profile URLs"), so on a normal visit the
  // username is sitting in the path. Old bookmarked/shared links using
  // profile.html?id=<uuid> still work as a fallback.
  const pathMatch = window.location.pathname.match(/\/profile\/([^/?#]+)/i);
  const username = pathMatch ? decodeURIComponent(pathMatch[1]) : null;
  const id = new URLSearchParams(window.location.search).get("id");

  if (!username && !id) {
    layout.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h3>No profile selected</h3><p>Go back to <a href="/explore.html">Explore</a>.</p></div>`;
    return;
  }

  const { data: profile, error } = username
    ? await sb.from("profiles").select("*").ilike("discord_username", username).maybeSingle()
    : await sb.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error || !profile) {
    layout.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h3>Profile not found</h3><p>This member may not exist. <a href="/explore.html">Back to Explore</a>.</p></div>`;
    return;
  }

  const isOwner = currentProfile && currentProfile.id === profile.id;
  const canEdit = isOwner && profile.status === "approved";
  const avatar = profile.avatar_url || `https://cdn.discordapp.com/embed/avatars/0.png`;
  // banner_url / bg_video_url already carry a .gif or video extension when
  // Discord/the member reports an animated asset — a plain <img>/<video>
  // renders that as live animation, same as static files. custom_banner_url
  // (set on the member's own edit panel) takes priority over Discord's
  // banner_url when both are present.
  const banner = effectiveBannerUrl(profile);

  // ---------------- Background video ----------------
  function ytEmbedForBackground(url) {
    const yt = typeof youtubeEmbedUrl === "function" ? youtubeEmbedUrl(url) : null;
    if (!yt) return null;
    const idMatch = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
    const vid = idMatch ? idMatch[1] : "";
    return `${yt}?autoplay=1&mute=1&loop=1&controls=0&playlist=${vid}`;
  }

  // type is one of "auto" (guess from the URL), "gif", "image" (a
  // static picture), "youtube", or "video" (any direct mp4/webm/etc
  // link). GIFs and plain pictures are both images, not video files —
  // rendering them in a <video> tag (the old behavior) silently shows
  // nothing, which is why animated/picture background choices never
  // actually appeared. Picking "GIF" or "Picture" explicitly, or
  // leaving it on Auto with a URL that looks like an image file, now
  // renders it as an <img> instead.
  function mountBackgroundVideo(url, type) {
    if (!url) return;
    const wrap = document.createElement("div");
    wrap.className = "profile-bg-video-wrap";
    const looksLikeImage = /\.(gif|jpe?g|png|webp|avif)(\?.*)?$/i.test(url);
    const yt = ytEmbedForBackground(url);

    let inner;
    if (type === "gif" || type === "image" || (type === "auto" && looksLikeImage)) {
      inner = `<img src="${url}" alt="" style="width:100%;height:100%;object-fit:cover;">`;
    } else if (type === "youtube" || (type === "auto" && yt)) {
      inner = yt
        ? `<iframe src="${yt}" allow="autoplay" style="width:100%;height:100%;border:0;"></iframe>`
        : `<video src="${url}" autoplay muted loop playsinline></video>`;
    } else {
      inner = `<video src="${url}" autoplay muted loop playsinline></video>`;
    }
    wrap.innerHTML = inner;
    document.body.prepend(wrap);
  }
  mountBackgroundVideo(profile.bg_video_url, profile.bg_video_type || "auto");

  function ordinal(n) {
    if (n === 1) return "1st";
    if (n === 2) return "2nd";
    if (n === 3) return "3rd";
    return n ? `${n}th` : "—";
  }

  function badgeHtml() {
    if (profile.status && profile.status !== "approved") return `<span class="badge visitor">Visitor</span>`;
    const chips = [`<span class="badge">${ordinal(profile.generation)} Generation</span>`];
    if (profile.role === "founder") chips.push(`<span class="badge founder">Founder</span>`);
    else if (profile.role === "admin") chips.push(`<span class="badge admin">Admin</span>`);
    else if (profile.badge === "PvP Main") chips.push(`<span class="badge pvp">PvP Main</span>`);
    else chips.push(`<span class="badge hama">Hama</span>`);
    return chips.join("");
  }

  function linksHtml(links) {
    if (!links || !links.length) return `<p style="color:var(--muted);font-size:13px;">No links added yet.</p>`;
    return links.map(l => `
      <a class="link-row" href="${l.url}" target="_blank" rel="noopener">
        <span>${l.label}</span>
        <span class="lmeta">${l.url.replace(/^https?:\/\//, "")}</span>
      </a>
    `).join("");
  }

  function sectionsHtml(sections) {
    if (!sections || !sections.length) return `<p style="color:var(--muted);font-size:13px;">No custom sections added yet.</p>`;
    return sections.map(s => `
      <div class="panel glass">
        <h3>${s.title}</h3>
        <div class="section-grid">
          ${(s.items || []).map(it => `
            <div class="item-tile"><div class="k">${it.label}</div><div class="v">${it.value}</div></div>
          `).join("")}
        </div>
      </div>
    `).join("");
  }

  // ---------------- Background music player ----------------
  function audioPlayerHtml(url) {
    if (!url) return "";
    return `
      <div class="audio-player" id="audio-player">
        <div class="ap-title">🎵 ${profile.display_name}'s theme</div>
        <div class="ap-row">
          <button class="ap-btn play" id="ap-toggle">▶</button>
          <span class="ap-time" id="ap-current">0:00</span>
          <input type="range" class="ap-seek" id="ap-seek" min="0" max="100" value="0">
          <span class="ap-time" id="ap-duration">0:00</span>
        </div>
        <div class="ap-row" style="margin-top:8px;">
          <span style="font-size:11px;color:var(--muted);">Vol</span>
          <input type="range" class="ap-volume" id="ap-volume" min="0" max="100" value="60">
        </div>
        <audio id="ap-audio" src="${url}" preload="metadata" loop></audio>
      </div>
    `;
  }

  function wireAudioPlayer() {
    const audio = document.getElementById("ap-audio");
    if (!audio) return;
    const toggle = document.getElementById("ap-toggle");
    const seek = document.getElementById("ap-seek");
    const volume = document.getElementById("ap-volume");
    const cur = document.getElementById("ap-current");
    const dur = document.getElementById("ap-duration");

    function fmt(t) {
      if (!isFinite(t)) return "0:00";
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      return `${m}:${s.toString().padStart(2, "0")}`;
    }

    audio.volume = 0.6;
    audio.addEventListener("loadedmetadata", () => { dur.textContent = fmt(audio.duration); });
    audio.addEventListener("timeupdate", () => {
      cur.textContent = fmt(audio.currentTime);
      if (audio.duration) seek.value = (audio.currentTime / audio.duration) * 100;
    });
    audio.addEventListener("play", () => { toggle.textContent = "❚❚"; });
    audio.addEventListener("pause", () => { toggle.textContent = "▶"; });
    toggle.addEventListener("click", () => {
      if (audio.paused) audio.play().catch(() => {});
      else audio.pause();
    });
    seek.addEventListener("input", () => {
      if (audio.duration) audio.currentTime = (seek.value / 100) * audio.duration;
    });
    volume.addEventListener("input", () => { audio.volume = volume.value / 100; });

    // Try to autoplay as soon as the profile opens. Most browsers allow
    // this because navigating here was itself a user gesture; if a
    // browser still blocks it (autoplay policy), we just fail quietly
    // and leave the ▶ button so the visitor can start it with one tap —
    // either way the toggle button is always there to stop it.
    audio.play().catch(() => { toggle.textContent = "▶"; });
  }

  // ---------------- Highlights (profile video highlights) ----------------
  let highlights = [];

  async function loadHighlights() {
    const { data, error: hErr } = await sb.from("profile_highlights").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false });
    if (!hErr) highlights = data || [];
  }

  function highlightsHtml() {
    if (!highlights.length) return `<p style="color:var(--muted);font-size:13px;">No video highlights yet.</p>`;
    return `<div class="clip-grid">${highlights.map(h => `
      <div class="highlight-card" data-id="${h.id}">
        ${renderVideoEmbed(h.video_url)}
        <div class="clip-body">
          <div class="clip-title">${h.title}</div>
          <div class="clip-meta">
            <span></span>
            ${(isOwner || isStaff(currentProfile)) ? `<button class="remove-x" data-remove-highlight="${h.id}">Remove</button>` : ""}
          </div>
        </div>
      </div>
    `).join("")}</div>`;
  }

  function wireHighlightButtons() {
    document.querySelectorAll("[data-remove-highlight]").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm("Remove this highlight?")) return;
        const highlight = highlights.find(h => h.id === btn.dataset.removeHighlight);
        const { error: delErr } = await sb.from("profile_highlights").delete().eq("id", btn.dataset.removeHighlight);
        if (delErr) return toast("Could not remove: " + delErr.message, 4000);
        // Also clear the uploaded file out of the "media" bucket (no-op
        // if this highlight was a pasted link instead of an upload).
        if (highlight) await deleteMediaFile(highlight.video_url);
        toast("Highlight removed.");
        await loadHighlights();
        document.getElementById("highlights-view").innerHTML = highlightsHtml();
        wireHighlightButtons();
      });
    });
  }

  await loadHighlights();

  // ---------------- Background music (uploaded tracks) ----------------
  let musicTracks = [];

  async function loadMusicTracks() {
    const { data, error: mErr } = await sb.from("profile_music").select("*").eq("profile_id", profile.id).order("created_at", { ascending: false });
    if (!mErr) musicTracks = data || [];
  }

  function musicListHtml() {
    if (!musicTracks.length) return `<p style="color:var(--muted);font-size:13px;">No uploaded tracks yet.</p>`;
    return musicTracks.map(t => {
      const active = profile.bg_music_url === t.url;
      return `
        <div class="music-row ${active ? "active" : ""}" data-id="${t.id}">
          <div class="music-row-info">
            <span class="music-row-title">🎵 ${t.title || "Untitled track"}</span>
            ${active ? `<span class="badge hama">Playing</span>` : ""}
          </div>
          <div class="music-row-actions">
            ${(canEdit && !active) ? `<button class="btn btn-ghost btn-sm" data-use-track="${t.id}">Set as background</button>` : ""}
            ${(canEdit || isStaff(currentProfile)) ? `<button class="remove-x" data-remove-track="${t.id}">Delete</button>` : ""}
          </div>
        </div>
      `;
    }).join("");
  }

  function refreshMusicPanel() {
    document.getElementById("music-view").innerHTML = musicListHtml();
    wireMusicButtons();
    const slot = document.getElementById("audio-player-slot");
    if (slot) {
      slot.innerHTML = audioPlayerHtml(profile.bg_music_url);
      wireAudioPlayer();
    }
  }

  function wireMusicButtons() {
    document.querySelectorAll("[data-use-track]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const track = musicTracks.find(t => t.id === btn.dataset.useTrack);
        if (!track) return;
        const { error: updErr } = await sb.from("profiles").update({ bg_music_url: track.url }).eq("id", profile.id);
        if (updErr) return toast("Could not switch track: " + updErr.message, 5000);
        profile.bg_music_url = track.url;
        toast("Background music updated.");
        refreshMusicPanel();
      });
    });
    document.querySelectorAll("[data-remove-track]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const track = musicTracks.find(t => t.id === btn.dataset.removeTrack);
        if (!track) return;
        if (!confirm("Delete this track? This can't be undone.")) return;
        const { error: delErr } = await sb.from("profile_music").delete().eq("id", track.id);
        if (delErr) return toast("Could not delete: " + delErr.message, 5000);
        // Music tracks are always uploads (there's no "paste a link"
        // option for them), so this always clears real storage.
        await deleteMediaFile(track.url);
        if (profile.bg_music_url === track.url) {
          await sb.from("profiles").update({ bg_music_url: null }).eq("id", profile.id);
          profile.bg_music_url = null;
        }
        toast("Track deleted.");
        await loadMusicTracks();
        refreshMusicPanel();
      });
    });
  }

  await loadMusicTracks();

  // ---------------- Friendly links / sections editor ----------------
  // Replaces the old raw-JSON textareas with plain add/remove rows so
  // members don't need to know JSON syntax to edit their profile.
  function escapeAttr(str) {
    return String(str ?? "")
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Deep-copied working state; only written back to Supabase on Save.
  let editLinks = JSON.parse(JSON.stringify(profile.links || []));
  let editSections = JSON.parse(JSON.stringify(profile.sections || []));

  function renderLinksEditor() {
    const wrap = document.getElementById("links-editor");
    if (!wrap) return;
    wrap.innerHTML = !editLinks.length
      ? `<p class="editor-empty">No links yet. Add one below.</p>`
      : editLinks.map((l, i) => `
        <div class="repeater-row" data-index="${i}">
          <input type="text" class="field link-label" placeholder="Label (e.g. Discord)" value="${escapeAttr(l.label)}">
          <input type="text" class="field link-url" placeholder="https://..." value="${escapeAttr(l.url)}">
          <button type="button" class="icon-btn-sm remove-link" title="Remove link">✕</button>
        </div>
      `).join("");

    wrap.querySelectorAll(".repeater-row").forEach(row => {
      const i = Number(row.dataset.index);
      row.querySelector(".link-label").addEventListener("input", e => { editLinks[i].label = e.target.value; });
      row.querySelector(".link-url").addEventListener("input", e => { editLinks[i].url = e.target.value; });
      row.querySelector(".remove-link").addEventListener("click", () => { editLinks.splice(i, 1); renderLinksEditor(); });
    });
  }

  function renderSectionsEditor() {
    const wrap = document.getElementById("sections-editor");
    if (!wrap) return;
    wrap.innerHTML = !editSections.length
      ? `<p class="editor-empty">No custom sections yet. Add one below.</p>`
      : editSections.map((s, si) => `
        <div class="section-editor-card" data-sindex="${si}">
          <div class="section-editor-head">
            <input type="text" class="field section-title" placeholder="Section title (e.g. Loadout)" value="${escapeAttr(s.title)}">
            <button type="button" class="icon-btn-sm remove-section" title="Remove section">✕</button>
          </div>
          <div class="section-items">
            ${(s.items || []).map((it, ii) => `
              <div class="repeater-row" data-sindex="${si}" data-iindex="${ii}">
                <input type="text" class="field item-label" placeholder="Label" value="${escapeAttr(it.label)}">
                <input type="text" class="field item-value" placeholder="Value" value="${escapeAttr(it.value)}">
                <button type="button" class="icon-btn-sm remove-item" title="Remove item">✕</button>
              </div>
            `).join("")}
          </div>
          <button type="button" class="btn btn-ghost btn-sm add-item-btn" data-sindex="${si}">+ Add item</button>
        </div>
      `).join("");

    wrap.querySelectorAll(".section-editor-card").forEach(card => {
      const si = Number(card.dataset.sindex);
      card.querySelector(".section-title").addEventListener("input", e => { editSections[si].title = e.target.value; });
      card.querySelector(".remove-section").addEventListener("click", () => { editSections.splice(si, 1); renderSectionsEditor(); });
      card.querySelector(".add-item-btn").addEventListener("click", () => {
        if (!editSections[si].items) editSections[si].items = [];
        editSections[si].items.push({ label: "", value: "" });
        renderSectionsEditor();
      });
      card.querySelectorAll(".repeater-row").forEach(row => {
        const ii = Number(row.dataset.iindex);
        row.querySelector(".item-label").addEventListener("input", e => { editSections[si].items[ii].label = e.target.value; });
        row.querySelector(".item-value").addEventListener("input", e => { editSections[si].items[ii].value = e.target.value; });
        row.querySelector(".remove-item").addEventListener("click", () => { editSections[si].items.splice(ii, 1); renderSectionsEditor(); });
      });
    });
  }

  layout.innerHTML = `
    <div>
      <div class="profile-card glass">
        ${banner ? `<img class="profile-banner" src="${banner}" alt="">` : `<div class="profile-banner"></div>`}
        <div class="body">
          <img class="profile-avatar" src="${avatar}" alt="">
          <div class="pname">${profile.display_name}</div>
          <div class="phandle">@${profile.discord_username}</div>
          <div class="pbio" id="bio-display">${profile.bio ? `"${profile.bio}"` : ""}</div>
          <div class="badge-row">${badgeHtml()}</div>
          <div class="profile-stats">
            <div><b>${(profile.links || []).length}</b><span>LINKS</span></div>
            <div><b>${(profile.sections || []).length}</b><span>SECTIONS</span></div>
          </div>
          <div id="audio-player-slot">${audioPlayerHtml(profile.bg_music_url)}</div>
          ${isOwner ? `<button class="btn btn-ghost btn-sm" id="edit-toggle" style="width:100%;margin-top:16px;">Edit profile</button>` : ""}
          ${isOwner && !canEdit ? `<p class="staff-note" style="margin-top:10px;">Your profile isn't approved yet — a founder needs to approve you before you can edit it.</p>` : ""}
        </div>
      </div>
    </div>

    <div>
      <div class="panel glass">
        <h3>About Me</h3>
        <div id="about-view">${profile.bio || "No bio yet."}</div>
      </div>

      <div class="panel glass">
        <h3>Official Links</h3>
        <div id="links-view">${linksHtml(profile.links)}</div>
      </div>

      <div id="sections-view">${sectionsHtml(profile.sections)}</div>

      <div class="panel glass">
        <h3>Background Music</h3>
        <div id="music-view">${musicListHtml()}</div>
        ${canEdit ? `
          <div class="field-row" style="margin-top:16px;">
            <input type="text" class="field" id="music-title" placeholder="Track title (optional)">
          </div>
          <input type="file" id="music-file" accept="audio/*" style="margin:10px 0;">
          <div style="display:flex;align-items:center;gap:12px;">
            <button class="btn btn-primary btn-sm" id="music-upload-btn">Upload track</button>
            <span class="upload-progress" id="music-progress"></span>
          </div>
        ` : ""}
      </div>

      <div class="panel glass">
        <h3>Video Highlights</h3>
        <div id="highlights-view">${highlightsHtml()}</div>
        ${canEdit ? `
          <div class="field-row" style="margin-top:16px;">
            <input type="text" class="field" id="hl-title" placeholder="Highlight title">
            <input type="text" class="field" id="hl-url" placeholder="Video link (YouTube etc.)">
          </div>
          <input type="file" id="hl-file" accept="video/*" style="margin:10px 0;">
          <div class="editable-notice" style="margin-top:-4px;margin-bottom:6px;">Uploaded video files must be 50MB or smaller — for anything bigger, paste a link instead.</div>
          <button class="btn btn-primary btn-sm" id="hl-upload-btn">Add highlight</button>
        ` : ""}
      </div>

      ${canEdit ? `<div class="panel glass" id="edit-panel" style="display:none;">
        <h3>Edit your profile</h3>
        <div class="editable-notice">Changes save straight to Supabase and are visible to everyone.</div>

        <label class="field-label">Bio</label>
        <textarea class="field" id="edit-bio" rows="2">${profile.bio || ""}</textarea>

        <label class="field-label">Banner image (GIF or any other image link)</label>
        <input type="text" class="field" id="edit-banner" value="${profile.custom_banner_url || ""}" placeholder="https://... — leave blank to use your Discord banner">
        <label class="field-label" style="margin-top:8px;">…or upload a GIF/image directly</label>
        <input type="file" id="edit-banner-file" accept="image/*" style="margin:6px 0;">
        <div class="editable-notice" style="margin-top:6px;">${profile.banner_url ? "You have a Discord banner — this overrides it when filled in." : "You don't have a Discord banner — set one here to have one on your profile."} Uploading a file takes priority over the link above.</div>

        <label class="field-label">Background type</label>
        <select class="field" id="edit-bg-video-type">
          <option value="auto" ${(!profile.bg_video_type || profile.bg_video_type === "auto") ? "selected" : ""}>Auto-detect</option>
          <option value="image" ${profile.bg_video_type === "image" ? "selected" : ""}>Picture</option>
          <option value="gif" ${profile.bg_video_type === "gif" ? "selected" : ""}>GIF</option>
          <option value="youtube" ${profile.bg_video_type === "youtube" ? "selected" : ""}>YouTube link</option>
          <option value="video" ${profile.bg_video_type === "video" ? "selected" : ""}>Video file link (mp4/webm/etc.)</option>
        </select>
        <label class="field-label">Background link</label>
        <input type="text" class="field" id="edit-bg-video" value="${profile.bg_video_url || ""}" placeholder="https://...">
        <label class="field-label" style="margin-top:8px;">…or upload a picture, GIF, or video file directly</label>
        <input type="file" id="edit-bg-video-file" accept="video/*,image/*" style="margin:6px 0;">
        <div class="editable-notice" style="margin-top:6px;">Uploading a file takes priority over the link above, and the type is set automatically (picture vs. GIF vs. video).</div>

        <label class="field-label">Links</label>
        <div class="repeater" id="links-editor"></div>
        <button type="button" class="btn btn-ghost btn-sm add-row-btn" id="add-link-btn">+ Add link</button>

        <label class="field-label">Custom sections</label>
        <div class="repeater" id="sections-editor"></div>
        <button type="button" class="btn btn-ghost btn-sm add-row-btn" id="add-section-btn">+ Add section</button>

        <div style="margin-top:16px;display:flex;align-items:center;gap:12px;">
          <button class="btn btn-primary btn-sm" id="save-btn">Save changes</button>
          <span class="upload-progress" id="save-progress"></span>
        </div>
      </div>` : ""}
    </div>
  `;

  wireAudioPlayer();
  wireHighlightButtons();

  if (isOwner) {
    const editToggle = document.getElementById("edit-toggle");
    if (editToggle) {
      editToggle.addEventListener("click", () => {
        const panel = document.getElementById("edit-panel");
        if (!panel) return;
        panel.style.display = panel.style.display === "none" ? "block" : "none";
      });
    }
  }

  if (canEdit) {
    renderLinksEditor();
    renderSectionsEditor();
    document.getElementById("add-link-btn").addEventListener("click", () => {
      editLinks.push({ label: "", url: "" });
      renderLinksEditor();
    });
    document.getElementById("add-section-btn").addEventListener("click", () => {
      editSections.push({ title: "", items: [] });
      renderSectionsEditor();
    });

    document.getElementById("save-btn").addEventListener("click", async () => {
      const saveBtn = document.getElementById("save-btn");
      const progress = document.getElementById("save-progress");
      saveBtn.disabled = true;

      // Remember what was there before, so that once the save succeeds
      // we can clear out whichever uploaded file is no longer
      // referenced anywhere (replaced with a different file/link, or
      // the field was cleared entirely) — otherwise every re-upload
      // just leaves the previous one behind in the bucket.
      const oldBannerUrl = profile.custom_banner_url;
      const oldBgVideoUrl = profile.bg_video_url;

      try {
        // Drop rows the member left blank rather than saving empty entries.
        const links = editLinks
          .map(l => ({ label: (l.label || "").trim(), url: (l.url || "").trim() }))
          .filter(l => l.label || l.url);
        const sections = editSections
          .map(s => ({
            title: (s.title || "").trim(),
            items: (s.items || [])
              .map(it => ({ label: (it.label || "").trim(), value: (it.value || "").trim() }))
              .filter(it => it.label || it.value)
          }))
          .filter(s => s.title || s.items.length);

        const bio = document.getElementById("edit-bio").value.trim();

        let custom_banner_url = document.getElementById("edit-banner").value.trim() || null;
        const bannerFile = document.getElementById("edit-banner-file").files[0];
        if (bannerFile) {
          progress.textContent = "Uploading banner…";
          custom_banner_url = await uploadMediaFile(bannerFile, "banners");
        }

        let bg_video_url = document.getElementById("edit-bg-video").value.trim() || null;
        let bg_video_type = document.getElementById("edit-bg-video-type").value;
        const bgFile = document.getElementById("edit-bg-video-file").files[0];
        if (bgFile) {
          progress.textContent = "Uploading background…";
          bg_video_url = await uploadMediaFile(bgFile, "bg-video");
          bg_video_type = bgFile.type === "image/gif"
            ? "gif"
            : bgFile.type.startsWith("image/")
              ? "image"
              : "video";
        }

        progress.textContent = "Saving…";
        const { error: updErr } = await sb.from("profiles")
          .update({ bio, links, sections, custom_banner_url, bg_video_url, bg_video_type })
          .eq("id", profile.id);

        if (updErr) { toast("Could not save: " + updErr.message, 5000); return; }

        // Now that the new values are safely saved, clear out whatever
        // old uploaded file they replaced (a fresh upload, a pasted
        // link, or just clearing the field to remove it entirely all
        // count as "replaced"). No-op for anything that was a pasted
        // external link rather than an upload.
        if (oldBannerUrl && oldBannerUrl !== custom_banner_url) await deleteMediaFile(oldBannerUrl);
        if (oldBgVideoUrl && oldBgVideoUrl !== bg_video_url) await deleteMediaFile(oldBgVideoUrl);

        toast("Profile saved.");
        setTimeout(() => window.location.reload(), 800);
      } catch (e) {
        toast("Could not save: " + (e.message || e), 5000);
      } finally {
        saveBtn.disabled = false;
        progress.textContent = "";
      }
    });

    document.getElementById("music-upload-btn").addEventListener("click", async () => {
      const title = document.getElementById("music-title").value.trim();
      const file = document.getElementById("music-file").files[0];
      const progress = document.getElementById("music-progress");
      if (!file) return toast("Choose an audio file to upload.", 4000);

      const btn = document.getElementById("music-upload-btn");
      btn.disabled = true;
      try {
        progress.textContent = "Uploading…";
        const url = await uploadMediaFile(file, "music");
        const { error: insErr } = await sb.from("profile_music").insert({
          profile_id: profile.id,
          title: title || file.name.replace(/\.[^/.]+$/, ""),
          url
        });
        if (insErr) throw insErr;

        // If this is the member's first track, make it the active one
        // automatically — otherwise uploading music silently does
        // nothing audible until they separately hit "Set as background".
        if (!profile.bg_music_url) {
          const { error: activateErr } = await sb.from("profiles").update({ bg_music_url: url }).eq("id", profile.id);
          if (!activateErr) profile.bg_music_url = url;
        }

        toast("Track uploaded.");
        document.getElementById("music-title").value = "";
        document.getElementById("music-file").value = "";
        progress.textContent = "";
        await loadMusicTracks();
        refreshMusicPanel();
      } catch (e) {
        toast("Could not upload track: " + (e.message || e), 5000);
        progress.textContent = "";
      } finally {
        btn.disabled = false;
      }
    });

    document.getElementById("hl-upload-btn").addEventListener("click", async () => {
      const title = document.getElementById("hl-title").value.trim();
      const pastedUrl = document.getElementById("hl-url").value.trim();
      const file = document.getElementById("hl-file").files[0];
      if (!title) return toast("Give the highlight a title.", 4000);
      if (!file && !pastedUrl) return toast("Choose a video file or paste a link.", 4000);

      // Highlights specifically are capped at 50MB when uploaded as a
      // file — paste a link instead for anything bigger. This only
      // applies here; Clips and other uploads are unaffected.
      const HL_MAX_BYTES = 50 * 1024 * 1024;
      if (file && file.size > HL_MAX_BYTES) {
        return toast(`That file is ${(file.size / (1024 * 1024)).toFixed(1)}MB — highlight uploads are capped at 50MB. Paste a video link instead.`, 6000);
      }

      const btn = document.getElementById("hl-upload-btn");
      btn.disabled = true;
      try {
        let video_url = pastedUrl;
        if (file) video_url = await uploadMediaFile(file, "highlights");
        const { error: insErr } = await sb.from("profile_highlights").insert({
          profile_id: profile.id, title, video_url
        });
        if (insErr) throw insErr;
        toast("Highlight added.");
        await loadHighlights();
        document.getElementById("highlights-view").innerHTML = highlightsHtml();
        wireHighlightButtons();
        document.getElementById("hl-title").value = "";
        document.getElementById("hl-url").value = "";
        document.getElementById("hl-file").value = "";
      } catch (e) {
        toast("Could not add highlight: " + (e.message || e), 5000);
      } finally {
        btn.disabled = false;
      }
    });
  }
})();
