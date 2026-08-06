// ------------------------------------------------------------------
// Shared video helpers for Family Clips + Profile Highlights.
// Requires supabase-client.js (sb) and auth.js (toast) to already be
// loaded on the page.
// ------------------------------------------------------------------

// Uploads a File to the public "media" Storage bucket under the given
// folder, and returns its public URL. Throws on failure.
async function uploadMediaFile(file, folder) {
  const cleanName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${folder}/${Date.now()}-${cleanName}`;

  const { error: uploadErr } = await sb.storage.from("media").upload(path, file, {
    cacheControl: "3600",
    upsert: false
  });
  if (uploadErr) throw uploadErr;

  const { data } = sb.storage.from("media").getPublicUrl(path);
  return data.publicUrl;
}

function youtubeEmbedUrl(url) {
  const m = url.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|shorts\/|embed\/))([\w-]{11})/);
  return m ? `https://www.youtube.com/embed/${m[1]}` : null;
}

// Returns an <video> or <iframe> tag for a given video URL, guessing
// the right one from the extension / host.
function renderVideoEmbed(url) {
  const yt = youtubeEmbedUrl(url);
  if (yt) {
    return `<iframe src="${yt}" loading="lazy" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>`;
  }
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(url)) {
    return `<video src="${url}" controls preload="metadata"></video>`;
  }
  return `<video src="${url}" controls preload="metadata"></video>`;
}

