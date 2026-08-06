(async function () {
  await initAuth();

  let allMembers = [];
  let activeTab = "family"; // "family" | "visitors"

  function ordinal(n) {
    if (n === 1) return "1st";
    if (n === 2) return "2nd";
    if (n === 3) return "3rd";
    return `${n}th`;
  }

  function badgeHtml(m) {
    if (m.status !== "approved") {
      return `<span class="badge visitor">Visitor</span>`;
    }
    const chips = [`<span class="badge">${ordinal(m.generation || 1)} Generation</span>`];
    if (m.role === "founder") chips.push(`<span class="badge founder">Founder</span>`);
    else if (m.role === "admin") chips.push(`<span class="badge admin">Admin</span>`);
    else if (m.badge === "PvP Main") chips.push(`<span class="badge pvp">PvP Main</span>`);
    else chips.push(`<span class="badge hama">Hama</span>`);
    return chips.join("");
  }

  function currentList() {
    if (activeTab === "family") return allMembers.filter(m => m.status === "approved");
    return allMembers.filter(m => m.status !== "approved");
  }

  function render() {
    const list = currentList();
    const q = document.getElementById("search-input").value.trim().toLowerCase();
    const filtered = !q ? list : list.filter(m =>
      m.display_name.toLowerCase().includes(q) || m.discord_username.toLowerCase().includes(q)
    );

    const grid = document.getElementById("member-grid");
    const empty = document.getElementById("empty-state");
    document.getElementById("visitor-note").style.display = activeTab === "visitors" ? "block" : "none";

    if (filtered.length === 0) {
      grid.innerHTML = "";
      empty.style.display = "block";
      empty.querySelector("h3").textContent = activeTab === "visitors" ? "No visitors right now" : "No members found";
      return;
    }
    empty.style.display = "none";
    grid.innerHTML = filtered.map(m => `
      <a class="member-card" href="${profileUrl(m)}" data-id="${m.id}">
        <img class="avatar" src="${m.avatar_url || `https://cdn.discordapp.com/embed/avatars/0.png`}" alt="">
        <div class="name">${m.display_name}</div>
        <div class="handle">@${m.discord_username}</div>
        <div class="badge-row">${badgeHtml(m)}</div>
      </a>
    `).join("");

    grid.querySelectorAll(".member-card[data-id]").forEach(card => {
      const m = filtered.find(x => x.id === card.dataset.id);
      attachHoverPreview(card, m);
    });
  }

  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .order("generation", { ascending: true, nullsFirst: false })
    .order("display_name", { ascending: true });

  if (error) {
    toast("Could not load members: " + error.message, 5000);
  } else {
    allMembers = data || [];
    render();
  }

  document.getElementById("search-input").addEventListener("input", render);

  document.querySelectorAll(".pill-row .pill").forEach(pill => {
    pill.addEventListener("click", () => {
      activeTab = pill.dataset.tab;
      document.querySelectorAll(".pill-row .pill").forEach(p => p.classList.toggle("active", p === pill));
      render();
    });
  });
})();
