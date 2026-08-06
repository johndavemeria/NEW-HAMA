(async function () {
  await initAuth();

  const body = document.getElementById("admin-body");

  if (!isStaff(currentProfile)) {
    body.innerHTML = `
      <div class="access-denied">
        <h1>Founders only</h1>
        <p>This page is for founders and admins. ${currentProfile ? "Your account doesn't have that role." : "Sign in with an account that has founder or admin access."}</p>
      </div>
    `;
    return;
  }

  let allMembers = [];

  function avatarOf(m) {
    return m.avatar_url || `https://cdn.discordapp.com/embed/avatars/0.png`;
  }

  // ---------------- Pending approvals ----------------

  function pendingRowHtml(m) {
    return `
      <div class="pending-row" data-id="${m.id}">
        <div class="admin-member">
          <img src="${avatarOf(m)}" alt="">
          <div>
            <div class="name">${m.display_name}</div>
            <div class="handle">@${m.discord_username}</div>
          </div>
        </div>
        <div class="pending-actions">
          <a class="btn btn-ghost btn-sm" href="${profileUrl(m)}">View</a>
          <button class="btn btn-primary btn-sm f-approve">Approve</button>
          <button class="btn btn-danger btn-sm f-deny">Deny</button>
        </div>
      </div>
    `;
  }

  function renderPending() {
    const pending = allMembers.filter(m => m.status === "pending");
    const wrap = document.getElementById("pending-wrap");

    if (!pending.length) {
      wrap.innerHTML = `<p style="color:var(--muted);font-size:13px;">No one is waiting for review right now.</p>`;
      return;
    }

    wrap.innerHTML = pending.map(pendingRowHtml).join("");

    wrap.querySelectorAll(".pending-row").forEach(row => {
      const id = row.dataset.id;
      row.querySelector(".f-approve").addEventListener("click", () => decide(id, "approved"));
      row.querySelector(".f-deny").addEventListener("click", () => decide(id, "denied"));
    });
  }

  async function decide(id, status) {
    const member = allMembers.find(m => m.id === id);
    const patch = { status };
    if (status === "approved") {
      if (member.generation === null || member.generation === undefined) patch.generation = 2;
      if (member.badge === "Visitor") patch.badge = "Hama";
    }
    const { error } = await sb.from("profiles").update(patch).eq("id", id);
    if (error) return toast("Could not update: " + error.message, 5000);
    toast(status === "approved" ? "Member approved." : "Visitor denied.");
    await loadAll();
  }

  // ---------------- Full member table ----------------

  function rowHtml(m) {
    return `
      <tr data-id="${m.id}">
        <td>
          <div class="admin-member">
            <img src="${avatarOf(m)}" alt="">
            <div>
              <div class="name">${m.display_name}</div>
              <div class="handle">@${m.discord_username}</div>
            </div>
          </div>
        </td>
        <td>
          <select class="f-status">
            <option value="pending" ${m.status === "pending" ? "selected" : ""}>Pending</option>
            <option value="approved" ${m.status === "approved" ? "selected" : ""}>Approved</option>
            <option value="denied" ${m.status === "denied" ? "selected" : ""}>Denied</option>
          </select>
        </td>
        <td>
          <select class="f-role">
            <option value="member" ${m.role === "member" ? "selected" : ""}>Member</option>
            <option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="founder" ${m.role === "founder" ? "selected" : ""}>Founder</option>
          </select>
        </td>
        <td>
          <select class="f-badge">
            <option value="Hama" ${m.badge === "Hama" ? "selected" : ""}>Hama</option>
            <option value="PvP Main" ${m.badge === "PvP Main" ? "selected" : ""}>PvP Main</option>
            <option value="Founder" ${m.badge === "Founder" ? "selected" : ""}>Founder</option>
            <option value="Visitor" ${m.badge === "Visitor" ? "selected" : ""}>Visitor</option>
          </select>
        </td>
        <td><input class="f-generation" type="number" min="1" max="20" value="${m.generation ?? ""}" placeholder="—"></td>
        <td style="text-align:center;"><input class="f-root" type="checkbox" ${m.is_root ? "checked" : ""}></td>
        <td style="text-align:center;"><input class="f-admin" type="checkbox" ${m.is_admin ? "checked" : ""} title="Can open the Admin page and edit the family tree — independent of their Role/Badge."></td>
        <td>
          <div class="admin-row-actions">
            <button class="btn btn-ghost btn-sm f-save">Save</button>
            <a class="btn btn-ghost btn-sm" href="${profileUrl(m)}">View</a>
            <button class="btn btn-danger btn-sm f-delete">Remove</button>
          </div>
        </td>
      </tr>
    `;
  }

  function renderTable(list) {
    const wrap = document.getElementById("table-wrap");
    wrap.innerHTML = `
      <div class="table-scroll">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Status</th>
              <th>Role</th>
              <th>Badge</th>
              <th>Generation</th>
              <th>Root</th>
              <th>Admin&nbsp;Access</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="admin-rows">${list.map(rowHtml).join("")}</tbody>
        </table>
      </div>
    `;
    wireRows();
  }

  function wireRows() {
    document.querySelectorAll("#admin-rows tr").forEach(tr => {
      const id = tr.dataset.id;
      tr.querySelector(".f-save").addEventListener("click", () => saveRow(id, tr));
      tr.querySelector(".f-delete").addEventListener("click", () => deleteRow(id, tr));
    });
  }

  async function saveRow(id, tr) {
    const status = tr.querySelector(".f-status").value;
    const role = tr.querySelector(".f-role").value;
    const badge = tr.querySelector(".f-badge").value;
    const genRaw = tr.querySelector(".f-generation").value;
    const generation = genRaw === "" ? null : parseInt(genRaw, 10);
    const is_root = tr.querySelector(".f-root").checked;
    const is_admin = tr.querySelector(".f-admin").checked;

    if (currentProfile.id === id && currentProfile.is_admin && !is_admin) {
      if (!confirm("This removes your own Admin access — you'll lose access to this page immediately. Continue?")) return;
    }

    const { error } = await sb.from("profiles")
      .update({ status, role, badge, generation, is_root, is_admin })
      .eq("id", id);

    if (error) return toast("Could not save: " + error.message, 5000);
    toast("Profile updated.");
    await loadAll();
  }

  async function deleteRow(id, tr) {
    const name = tr.querySelector(".admin-member .name").textContent;
    if (!confirm(`Remove ${name} from Hama entirely? This also removes them from the family tree and their highlights. This can't be undone.`)) return;
    const { error } = await sb.from("profiles").delete().eq("id", id);
    if (error) return toast("Could not remove: " + error.message, 5000);
    toast("Member removed.");
    await loadAll();
  }

  // ---------------- Shared load ----------------

  function renderShell() {
    body.innerHTML = `
      <div class="admin-section">
        <div class="admin-section-head">
          <div class="section-label">Pending Approvals<span class="count-pill" id="pending-count">0</span></div>
        </div>
        <div id="pending-wrap"></div>
      </div>

      <div class="admin-section">
        <div class="admin-section-head">
          <div class="section-label">All members</div>
          <div class="search-bar" style="margin-bottom:0;min-width:240px;"><input type="text" id="admin-search" placeholder="Search by name or @handle…"></div>
        </div>
        <p style="color:var(--muted);font-size:12px;margin:-6px 0 12px;">Role/Badge is just what shows on a profile. <b>Admin Access</b> is the only thing that unlocks this page and family-tree editing — check it for whoever actually needs it, regardless of their Role.</p>
        <div id="table-wrap"></div>
      </div>
    `;
    document.getElementById("admin-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = !q ? allMembers : allMembers.filter(m =>
        m.display_name.toLowerCase().includes(q) || m.discord_username.toLowerCase().includes(q)
      );
      renderTable(filtered);
    });
  }

  async function loadAll() {
    const { data, error } = await sb.from("profiles").select("*")
      .order("status", { ascending: true })
      .order("generation", { ascending: true, nullsFirst: false })
      .order("display_name", { ascending: true });
    if (error) { toast("Could not load members: " + error.message, 5000); return; }
    allMembers = data || [];

    if (!document.getElementById("pending-wrap")) renderShell();
    document.getElementById("pending-count").textContent = allMembers.filter(m => m.status === "pending").length;
    renderPending();
    renderTable(allMembers);
  }

  renderShell();
  await loadAll();
})();
