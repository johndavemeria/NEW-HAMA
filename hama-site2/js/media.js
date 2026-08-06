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

// ------------------------------------------------------------------
// Storage cleanup. Call these whenever a row that pointed at an
// uploaded file in the "media" bucket gets deleted or replaced, so
// the file itself doesn't sit around forever and slowly flood
// storage. Safe to call with ANY url — pasted links (YouTube,
// Streamable, Discord CDN, some other image host, etc.) simply aren't
// inside our bucket, so they're quietly skipped; there's nothing to
// remove for those.
// ------------------------------------------------------------------

const MEDIA_PUBLIC_PREFIX = `${SUPABASE_URL}/storage/v1/object/public/media/`;

// Turns a public media URL back into the storage path it was uploaded
// under (e.g. "clips/1723050000000-foo.mp4"), or null if this URL
// doesn't point into our own "media" bucket at all.
function mediaPathFromUrl(url) {
  if (!url || typeof url !== "string" || !url.startsWith(MEDIA_PUBLIC_PREFIX)) return null;
  const path = url.slice(MEDIA_PUBLIC_PREFIX.length).split(/[?#]/)[0];
  return path ? decodeURIComponent(path) : null;
}

// Deletes the underlying file for a single media url, if it's one of
// ours. Never throws — a failed or irrelevant delete shouldn't block
// whatever the caller is really trying to do (removing a row); it
// just warns in the console.
async function deleteMediaFile(url) {
  const path = mediaPathFromUrl(url);
  if (!path) return;
  const { error } = await sb.storage.from("media").remove([path]);
  if (error) console.warn("Could not remove storage file:", path, error);
}

// Batch version — dedupes and skips blanks/non-bucket urls in one go.
// Used where several files need cleaning up together (e.g. removing a
// member wipes their banner, background video, tracks, and highlights
// all at once).
async function deleteMediaFiles(urls) {
  const paths = [...new Set((urls || []).map(mediaPathFromUrl).filter(Boolean))];
  if (!paths.length) return;
  const { error } = await sb.storage.from("media").remove(paths);
  if (error) console.warn("Could not remove storage files:", paths, error);
}
