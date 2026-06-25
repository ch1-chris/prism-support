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
  if (body.is_global !== undefined) out.is_global = Boolean(body.is_global);
  return out;
}

// Replace a tutorial's brand assignments with the provided set.
async function setBrandAssignments(tutorialId, brandIds) {
  const { error: delError } = await supabase
    .from('tutorial_brands')
    .delete()
    .eq('tutorial_id', tutorialId);
  if (delError) throw new Error(`Failed to clear brand assignments: ${delError.message}`);

  const ids = Array.isArray(brandIds)
    ? [...new Set(brandIds.map((n) => Number.parseInt(n, 10)).filter(Number.isInteger))]
    : [];
  if (!ids.length) return ids;

  const rows = ids.map((brand_id) => ({ tutorial_id: tutorialId, brand_id }));
  const { error: insError } = await supabase.from('tutorial_brands').insert(rows);
  if (insError) throw new Error(`Failed to assign brands: ${insError.message}`);
  return ids;
}

async function getBrandIds(tutorialId) {
  const { data, error } = await supabase
    .from('tutorial_brands')
    .select('brand_id')
    .eq('tutorial_id', tutorialId);
  if (error) throw new Error(`Failed to load brand assignments: ${error.message}`);
  return (data || []).map((r) => r.brand_id);
}

// --- Public: list published tutorials (brand-aware) ---
// Anonymous visitors see only global tutorials. A visitor who has redeemed a
// brand access code (session.brandId) also sees that brand's assigned videos.
router.get('/', asyncHandler(async (req, res) => {
  const brandId = req.session?.brandId;

  let query = supabase
    .from('tutorials')
    .select('id, title, description, video_url, thumbnail_url, category, display_order, created_at')
    .eq('published', true);

  let brandTutorialIds = [];
  if (brandId) {
    const { data: links, error: linkError } = await supabase
      .from('tutorial_brands')
      .select('tutorial_id')
      .eq('brand_id', brandId);
    if (linkError) throw new Error(`Failed to load brand assignments: ${linkError.message}`);
    brandTutorialIds = (links || []).map((l) => l.tutorial_id);
  }

  if (brandTutorialIds.length) {
    query = query.or(`is_global.eq.true,id.in.(${brandTutorialIds.join(',')})`);
  } else {
    query = query.eq('is_global', true);
  }

  const { data, error } = await query
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list tutorials: ${error.message}`);
  res.json({ tutorials: data || [] });
}));

// --- Admin: list all (published + drafts) with visibility info ---
router.get('/admin', requireAuth, asyncHandler(async (_req, res) => {
  const { data, error } = await supabase
    .from('tutorials')
    .select('*')
    .order('display_order', { ascending: true })
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list tutorials: ${error.message}`);

  const { data: links, error: linkError } = await supabase
    .from('tutorial_brands')
    .select('tutorial_id, brand_id');
  if (linkError) throw new Error(`Failed to load brand assignments: ${linkError.message}`);

  const byTutorial = new Map();
  for (const link of links || []) {
    if (!byTutorial.has(link.tutorial_id)) byTutorial.set(link.tutorial_id, []);
    byTutorial.get(link.tutorial_id).push(link.brand_id);
  }

  const tutorials = (data || []).map((t) => ({ ...t, brand_ids: byTutorial.get(t.id) || [] }));
  res.json({ tutorials });
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
      is_global: payload.is_global ?? true,
      display_order: payload.display_order ?? 0,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create tutorial: ${error.message}`);

  let brand_ids = [];
  if (req.body.brand_ids !== undefined) {
    brand_ids = await setBrandAssignments(data.id, req.body.brand_ids);
  }

  res.status(201).json({ ...data, brand_ids });
}));

// --- Admin: update tutorial ---
router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new Error('Invalid tutorial id');

  const payload = normalizePayload(req.body);
  const hasBrandIds = req.body.brand_ids !== undefined;
  if (!Object.keys(payload).length && !hasBrandIds) throw new Error('No fields to update');

  let data;
  if (Object.keys(payload).length) {
    const result = await supabase
      .from('tutorials')
      .update({ ...payload, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (result.error) throw new Error(`Failed to update tutorial: ${result.error.message}`);
    data = result.data;
  } else {
    const result = await supabase.from('tutorials').select('*').eq('id', id).single();
    if (result.error) throw new Error(`Tutorial not found: ${result.error.message}`);
    data = result.data;
  }

  let brand_ids;
  if (hasBrandIds) {
    brand_ids = await setBrandAssignments(id, req.body.brand_ids);
  } else {
    brand_ids = await getBrandIds(id);
  }

  res.json({ ...data, brand_ids });
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
