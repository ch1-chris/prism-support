import { Router } from 'express';
import { supabase } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const BUCKET = 'helpbot-uploads';

function sanitizeFilename(name) {
  return name
    .normalize('NFKD')
    .replace(/[^\w.\-]/g, '_')
    .replace(/_{2,}/g, '_');
}

// Tutorial files live under tutorials/* in storage.
// `cleanupExpiredFiles` in routes/kb.js scans kb_entries.file_url only,
// so tutorial assets are never purged by that job.
function extractStoragePath(fileUrl) {
  if (!fileUrl) return null;
  const marker = `/object/public/${BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return fileUrl.slice(idx + marker.length);
}

async function removeStorageObject(fileUrl) {
  const path = extractStoragePath(fileUrl);
  if (!path) return;
  const { error } = await supabase.storage.from(BUCKET).remove([path]);
  if (error) throw new Error(`Failed to remove storage object ${path}: ${error.message}`);
}

function normalizePayload(body) {
  const out = {};
  if (body.title !== undefined) out.title = String(body.title).trim();
  if (body.description !== undefined) out.description = body.description ? String(body.description) : null;
  if (body.video_url !== undefined) out.video_url = String(body.video_url).trim();
  if (body.thumbnail_url !== undefined) out.thumbnail_url = body.thumbnail_url ? String(body.thumbnail_url) : null;
  if (body.category !== undefined) out.category = body.category ? String(body.category).trim() : null;
  if (body.display_order !== undefined) out.display_order = Number.parseInt(body.display_order, 10) || 0;
  if (body.published !== undefined) out.published = Boolean(body.published);
  return out;
}

// --- Public: list published tutorials ---
router.get('/', asyncHandler(async (_req, res) => {
  const { data, error } = await supabase
    .from('tutorials')
    .select('id, title, description, video_url, thumbnail_url, category, display_order, created_at')
    .eq('published', true)
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list tutorials: ${error.message}`);
  res.json({ tutorials: data || [] });
}));

// --- Admin: list all (published + drafts) ---
router.get('/admin', requireAuth, asyncHandler(async (_req, res) => {
  const { data, error } = await supabase
    .from('tutorials')
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list tutorials: ${error.message}`);
  res.json({ tutorials: data || [] });
}));

// --- Admin: create tutorial (metadata only; file uploads use dedicated endpoints) ---
router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const payload = normalizePayload(req.body);
  if (!payload.title) throw new Error('title is required');
  if (!payload.video_url) throw new Error('video_url is required');

  const { data, error } = await supabase
    .from('tutorials')
    .insert({
      ...payload,
      published: payload.published ?? true,
      display_order: payload.display_order ?? 0,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create tutorial: ${error.message}`);
  res.status(201).json(data);
}));

// --- Admin: update tutorial ---
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new Error('Invalid tutorial id');

  const payload = normalizePayload(req.body);
  if (!Object.keys(payload).length) throw new Error('No fields to update');

  const { data, error } = await supabase
    .from('tutorials')
    .update({ ...payload, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update tutorial: ${error.message}`);
  res.json(data);
}));

// --- Admin: delete tutorial (and its storage objects) ---
router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new Error('Invalid tutorial id');

  const { data: existing, error: fetchError } = await supabase
    .from('tutorials')
    .select('id, video_url, thumbnail_url')
    .eq('id', id)
    .single();
  if (fetchError) throw new Error(`Tutorial not found: ${fetchError.message}`);

  if (existing.video_url) await removeStorageObject(existing.video_url);
  if (existing.thumbnail_url) await removeStorageObject(existing.thumbnail_url);

  const { error: deleteError } = await supabase.from('tutorials').delete().eq('id', id);
  if (deleteError) throw new Error(`Failed to delete tutorial: ${deleteError.message}`);

  res.json({ deleted: id });
}));

// --- Admin: bulk reorder ---
router.post('/reorder', requireAuth, asyncHandler(async (req, res) => {
  const items = req.body?.items;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error('items array is required');
  }

  for (const item of items) {
    const id = Number.parseInt(item.id, 10);
    const order = Number.parseInt(item.display_order, 10);
    if (!Number.isInteger(id) || !Number.isInteger(order)) {
      throw new Error('Each item requires integer id and display_order');
    }
    const { error } = await supabase
      .from('tutorials')
      .update({ display_order: order, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw new Error(`Failed to reorder tutorial ${id}: ${error.message}`);
  }

  res.json({ updated: items.length });
}));

// --- Admin: sign a direct upload URL for a tutorial video ---
// The browser PUTs the file straight to Supabase Storage using the returned
// signedUrl; bytes never go through this server (and so never through the
// hosting edge proxy, which has a much smaller body size limit).
router.post('/upload-video/sign', requireAuth, asyncHandler(async (req, res) => {
  const { filename, contentType } = req.body || {};
  if (!filename || typeof filename !== 'string') {
    throw new Error('filename is required');
  }
  if (!contentType || typeof contentType !== 'string' || !contentType.startsWith('video/')) {
    throw new Error('contentType must be a video/* MIME type');
  }

  const path = `tutorials/${Date.now()}-${sanitizeFilename(filename)}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`Failed to sign upload URL: ${error.message}`);

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  res.json({ uploadUrl: data.signedUrl, publicUrl: urlData.publicUrl, path });
}));

// --- Admin: sign a direct upload URL for a tutorial thumbnail ---
router.post('/upload-thumbnail/sign', requireAuth, asyncHandler(async (req, res) => {
  const { filename, contentType } = req.body || {};
  if (!filename || typeof filename !== 'string') {
    throw new Error('filename is required');
  }
  if (!contentType || typeof contentType !== 'string' || !contentType.startsWith('image/')) {
    throw new Error('contentType must be an image/* MIME type');
  }

  const path = `tutorials/thumbnails/${Date.now()}-${sanitizeFilename(filename)}`;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error) throw new Error(`Failed to sign upload URL: ${error.message}`);

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(path);
  res.json({ uploadUrl: data.signedUrl, publicUrl: urlData.publicUrl, path });
}));

export default router;
