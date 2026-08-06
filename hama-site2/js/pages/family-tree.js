(async function () {
  await initAuth();

  const loginBtn = document.getElementById("tree-login-btn");
  if (!currentProfile) {
    loginBtn.style.display = "inline-flex";
    loginBtn.addEventListener("click", signInWithDiscord);
  }

  const RELATION_TYPES = [
    { value: "child", label: "Child" },
    { value: "spouse", label: "In a Relationship" },
    { value: "sibling", label: "Sibling" },
    { value: "cousin", label: "Cousin" }
  ];

  let profiles = [];

  // avatar_url is already built by auth.js with the correct .gif
  // extension for animated Discord assets — using it as-is here is
  // what makes avatars animate instead of showing a static frame.
  // Banner goes through effectiveBannerUrl() so a member's own custom
  // banner (set on their profile) takes priority over their Discord one.
  function avatarOf(p) { return p.avatar_url || `https://cdn.discordapp.com/embed/avatars/0.png`; }
  function bannerOf(p) { return effectiveBannerUrl(p); }

  function ordinal(n) {
    if (n === 1) return "1st";
    if (n === 2) return "2nd";
    if (n === 3) return "3rd";
    return `${n}th`;
  }

  function badgeHtml(m) {
    const chips = [`<span class="badge">${ordinal(m.generation)} Generation</span>`];
    if (m.role === "founder") chips.push(`<span class="badge founder">Founder</span>`);
    else if (m.role === "admin") chips.push(`<span class="badge admin">Admin</span>`);
    else if (m.badge === "PvP Main") chips.push(`<span class="badge pvp">PvP Main</span>`);
    else chips.push(`<span class="badge hama">Hama</span>`);
    return chips.join("");
  }

  // Rendered as a div with a CSS background-image (same technique as
  // the hover-preview banner), not an <img> — some browsers cap an
  // <img>'s width via a responsive max-width reset, which was clipping
  // the intentional bleed past the card's padding and cutting off the
  // right edge of the banner.
  function bannerHtml(p, sizeClass) {
    const url = bannerOf(p);
    return url
      ? `<div class="${sizeClass}" style="background-image:url('${url}')"></div>`
      : `<div class="${sizeClass} no-banner"></div>`;
  }

  async function loadAll() {
    const { data, error } = await sb.from("profiles").select("*").eq("status", "approved").order("display_name");
    if (error) { toast("Could not load family tree: " + error.message, 5000); return; }
    profiles = data || [];
  }

  function renderStats() {
    const gen1 = profiles.filter(p => p.generation === 1).length;
    const gens = new Set(profiles.map(p => p.generation)).size;
    document.getElementById("stat-total").textContent = profiles.length;
    document.getElementById("stat-gen1").textContent = gen1;
    document.getElementById("stat-gens").textContent = gens || 0;
  }

  // Every card, at every generation, opens the relations modal now —
  // viewing is open to anyone, editing (adding/removing a relationship
  // from any generation) is gated to founders/admins inside the modal.
  function treeCard(p) {
    return `
      <div class="tree-card" data-id="${p.id}">
        ${bannerHtml(p, "tree-card-banner")}
        <div class="tree-card-body">
          <img class="avatar" src="${avatarOf(p)}" alt="">
          <div class="name">${p.display_name}</div>
          <div class="handle">@${p.discord_username}</div>
          <div class="badge-row">${badgeHtml(p)}</div>
        </div>
      </div>
    `;
  }

  function renderGenerationSections() {
    const wrap = document.getElementById("tree-sections");
    const placed = profiles.filter(p => p.generation !== null && p.generation !== undefined);
    const gens = [...new Set(placed.map(p => p.generation))].sort((a, b) => a - b);

    if (!gens.length) {
      wrap.innerHTML = `<div class="empty-state"><h3>No members placed yet</h3><p>${isStaff(currentProfile) ? "Open any member's card isn't possible yet — approve members, then add them from the Admin page or by placing your first 1st-generation root there." : "Check back once a founder has set up the tree."}</p></div>`;
      return;
    }

    wrap.innerHTML = gens.map((g, i) => {
      const members = placed.filter(p => p.generation === g).sort((a, b) => a.display_name.localeCompare(b.display_name));
      const cards = members.map(treeCard).join("");
      return `
        ${i > 0 ? `<div class="gen-connector"></div>` : ""}
        <div class="gen-section-head">
          <div class="pill-row" style="margin:0;"><div class="pill active">${ordinal(g)} Generation</div></div>
        </div>
        <div class="member-grid">${cards}</div>
      `;
    }).join("");

    wrap.querySelectorAll(".tree-card[data-id]").forEach(card => {
      const p = profiles.find(x => x.id === card.dataset.id);
      card.addEventListener("click", () => openFamilyModal(card.dataset.id));
      attachHoverPreview(card, p);
    });
  }

  function miniCard(p, { removable, onRemove } = {}) {
    return `
      <div class="mini-card" data-id="${p.id}">
        ${bannerHtml(p, "mini-card-banner")}
        <img class="avatar" src="${avatarOf(p)}" alt="">
        <div class="name">${p.display_name}</div>
        <div class="handle">@${p.discord_username}</div>
        <a class="profile-link" href="${profileUrl(p)}">Profile ↗</a>
        ${removable ? `<br><button class="remove-x" data-remove-rel="${onRemove}">Remove</button>` : ""}
      </div>
    `;
  }

  async function openFamilyModal(rootId) {
    const root = profiles.find(p => p.id === rootId);
    if (!root) return;

    const { data: relations, error } = await sb
      .from("family_relations")
      .select("*")
      .eq("owner_id", rootId);
    if (error) { toast("Could not load relations: " + error.message, 5000); return; }

    const rels = relations || [];
    const spouseRel = rels.find(r => r.relation_type === "spouse");
    const childRels = rels.filter(r => r.relation_type === "child");
    const siblingRels = rels.filter(r => r.relation_type === "sibling");
    const cousinRels = rels.filter(r => r.relation_type === "cousin");

    const spouse = spouseRel ? profiles.find(p => p.id === spouseRel.member_id) : null;
    const children = childRels.map(r => profiles.find(p => p.id === r.member_id)).filter(Boolean);
    const siblings = siblingRels.map(r => ({ p: profiles.find(x => x.id === r.member_id), relId: r.id })).filter(x => x.p);
    const cousins = cousinRels.map(r => ({ p: profiles.find(x => x.id === r.member_id), relId: r.id })).filter(x => x.p);

    const editable = isStaff(currentProfile);

    const html = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal">
          <div class="modal-head">
            <div>
              <h2>${root.display_name}'s Family</h2>
              <p>${ordinal(root.generation)} Generation · <a class="profile-link" href="${profileUrl(root)}">View full profile ↗</a></p>
            </div>
            <button class="icon-btn" id="modal-close">✕</button>
          </div>

          <div class="tree-row">
            ${miniCard(root)}
            ${spouse ? `<div class="tree-connector"></div>${miniCard(spouse, { removable: editable, onRemove: spouseRel.id })}` : ""}
          </div>

          ${siblings.length ? `
            <div class="rel-group">
              <div class="rel-group-label">Siblings</div>
              <div class="rel-row">${siblings.map(s => miniCard(s.p, { removable: editable, onRemove: s.relId })).join("")}</div>
            </div>` : ""}

          ${cousins.length ? `
            <div class="rel-group">
              <div class="rel-group-label">Cousins</div>
              <div class="rel-row">${cousins.map(c => miniCard(c.p, { removable: editable, onRemove: c.relId })).join("")}</div>
            </div>` : ""}

          ${children.length ? `<div class="tree-children">${children.map((c, i) => miniCard(c, { removable: editable, onRemove: childRels[i].id })).join("")}</div>` : `<p style="text-align:center;color:var(--muted);font-size:13px;">No children added yet.</p>`}

          ${editable ? `
            <div class="add-form">
              <select id="rel-type">
                ${RELATION_TYPES.filter(rt => rt.value !== "spouse" || !spouse).map(rt => `<option value="${rt.value}">${rt.label}</option>`).join("")}
              </select>
              <select id="link-existing">
                <option value="">— pick an existing member (optional) —</option>
                ${profiles.filter(p => p.id !== root.id).map(p => `<option value="${p.id}">${p.display_name} (@${p.discord_username})</option>`).join("")}
              </select>
              <input type="text" id="new-display-name" placeholder="Or new member's display name">
              <input type="text" id="new-discord-username" placeholder="Their Discord username (lowercase)">
              <button class="btn btn-primary btn-sm" id="add-member-btn">Add</button>
            </div>
          ` : `<p class="staff-note">Only founders and admins can edit the family tree — this view is read-only for you.</p>`}
        </div>
      </div>
    `;

    document.getElementById("modal-root").innerHTML = html;
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });

    document.querySelectorAll("[data-remove-rel]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const relId = btn.dataset.removeRel;
        const { error: delErr } = await sb.from("family_relations").delete().eq("id", relId);
        if (delErr) return toast("Could not remove: " + delErr.message, 4000);
        toast("Removed from family tree.");
        await loadAll();
        renderStats();
        renderGenerationSections();
        openFamilyModal(root.id);
      });
    });

    if (editable) {
      document.getElementById("add-member-btn").addEventListener("click", () => addFamilyMember(root));
    }
  }

  function siblingOrCousinGeneration(root) {
    return root.generation; // siblings/cousins sit at the same generation as the root card
  }

  async function addFamilyMember(root) {
    const relType = document.getElementById("rel-type").value;
    const existingId = document.getElementById("link-existing").value;
    const newName = document.getElementById("new-display-name").value.trim();
    const newHandle = document.getElementById("new-discord-username").value.trim().toLowerCase();

    let memberId = existingId || null;

    const targetGen = relType === "child" ? root.generation + 1 : siblingOrCousinGeneration(root);

    if (memberId) {
      // Linking an existing approved member — keep their generation in sync
      // with where they're being placed in the tree.
      const { error: placeErr } = await sb.from("profiles").update({ generation: targetGen }).eq("id", memberId);
      if (placeErr) return toast("Could not place member: " + placeErr.message, 5000);
    } else {
      if (!newName || !newHandle) {
        return toast("Pick an existing member or fill in both name + Discord username.", 4000);
      }
      const { data: created, error: createErr } = await sb.from("profiles").insert({
        display_name: newName,
        discord_username: newHandle,
        generation: targetGen,
        badge: "Hama",
        status: "approved"
      }).select().single();
      if (createErr) return toast("Could not create member: " + createErr.message, 5000);
      memberId = created.id;
    }

    const { error: relErr } = await sb.from("family_relations").insert({
      owner_id: root.id,
      member_id: memberId,
      relation_type: relType
    });
    if (relErr) return toast("Could not link member: " + relErr.message, 5000);

    toast("Family member added.");
    await loadAll();
    renderStats();
    renderGenerationSections();
    openFamilyModal(root.id);
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
  }

  await loadAll();
  renderStats();
  renderGenerationSections();
})();
