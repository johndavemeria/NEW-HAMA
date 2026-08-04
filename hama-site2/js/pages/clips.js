(async function () {
  await initAuth();

  const staff = isStaff(currentProfile);
  let clips = [];

  function timeAgo(dateStr) {
    const diff = Date.now() - new Date(dateStr).getTime();
    const days = Math.floor(diff / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "1 day ago";
    if (days < 30) return `${days} days ago`;
    const months = Math.floor(days / 30);
    return months === 1 ? "1 month ago" : `${months} months ago`;
  }

  function renderUploadForm() {
    const slot = document.getElementById("upload-slot");
    if (!staff) { slot.innerHTML = ""; return; }
    slot.innerHTML = `
      <div class="upload-form">
        <div class="field-label" style="margin-top:0;">Upload a clip</div>
        <div class="field-row">
          <input type="text" class="field" id="clip-title" placeholder="Title">
          <input type="text" class="field" id="clip-desc" placeholder="Description (optional)">
        </div>
        <label class="field-label">Video file (mp4/webm) — or paste a link below instead</label>
        <input type="file" id="clip-file" accept="video/*">
        <label class="field-label">…or a video link (YouTube, Streamable, etc.)</label>
        <input type="text" class="field" id="clip-url" placeholder="https://...">
        <div style="margin-top:14px;display:flex;align-items:center;gap:12px;">
          <button class="btn btn-primary btn-sm" id="clip-upload-btn">Upload</button>
          <span class="upload-progress" id="clip-progress"></span>
        </div>
      </div>
    `;
    document.getElementById("clip-upload-btn").addEventListener("click", handleUpload);
  }

  async function handleUpload() {
    const title = document.getElementById("clip-title").value.trim();
    const description = document.getElementById("clip-desc").value.trim();
    const file = document.getElementById("clip-file").files[0];
    const pastedUrl = document.getElementById("clip-url").value.trim();
    const progress = document.getElementById("clip-progress");

    if (!title) return toast("Give the clip a title.", 4000);
    if (!file && !pastedUrl) return toast("Choose a video file or paste a link.", 4000);

    const btn = document.getElementById("clip-upload-btn");
    btn.disabled = true;

    try {
      let video_url = pastedUrl;
      if (file) {
        progress.textContent = "Uploading video…";
        video_url = await uploadMediaFile(file, "clips");
      }

      const { error } = await sb.from("family_clips").insert({
        title, description, video_url, uploaded_by: currentProfile.id
      });
      if (error) throw error;

      toast("Clip uploaded.");
      document.getElementById("clip-title").value = "";
      document.getElementById("clip-desc").value = "";
      document.getElementById("clip-url").value = "";
      document.getElementById("clip-file").value = "";
      progress.textContent = "";
      await loadClips();
    } catch (e) {
      toast("Upload failed: " + (e.message || e), 5000);
      progress.textContent = "";
    } finally {
      btn.disabled = false;
    }
  }

  function render() {
    const grid = document.getElementById("clip-grid");
    const empty = document.getElementById("empty-state");
    if (!clips.length) {
      grid.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    grid.innerHTML = clips.map(c => `
      <div class="clip-card" data-id="${c.id}">
        ${renderVideoEmbed(c.video_url)}
        <div class="clip-body">
          <div class="clip-title">${c.title}</div>
          ${c.description ? `<div class="clip-desc">${c.description}</div>` : ""}
          <div class="clip-meta">
            <span>${timeAgo(c.created_at)}</span>
            ${staff ? `<button class="remove-x" data-remove="${c.id}">Remove</button>` : ""}
          </div>
        </div>
      </div>
    `).join("");

    if (staff) {
      grid.querySelectorAll("[data-remove]").forEach(btn => {
        btn.addEventListener("click", async () => {
          if (!confirm("Remove this clip? This can't be undone.")) return;
          const { error } = await sb.from("family_clips").delete().eq("id", btn.dataset.remove);
          if (error) return toast("Could not remove: " + error.message, 5000);
          toast("Clip removed.");
          await loadClips();
        });
      });
    }
  }

  async function loadClips() {
    const { data, error } = await sb.from("family_clips").select("*").order("created_at", { ascending: false });
    if (error) { toast("Could not load clips: " + error.message, 5000); return; }
    clips = data || [];
    render();
  }

  renderUploadForm();
  await loadClips();
})();
