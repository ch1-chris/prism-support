import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { randomBytes } from 'crypto';
import { supabase } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

// --- Helpers ---

function slugify(name) {
  return String(name)
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function randomSuffix(len = 6) {
  // Lowercase alphanumeric, unambiguous enough for a readable code.
  return randomBytes(len)
    .toString('base64')
    .replace(/[^a-z0-9]/gi, '')
    .toLowerCase()
    .slice(0, len)
    .padEnd(len, '0');
}

async function generateUniqueSlug(base) {
  const root = slugify(base) || 'brand';
  let candidate = root;
  let attempt = 0;
  // Keep trying until we find a slug not already taken.
  while (true) {
    const { data, error } = await supabase
      .from('brands')
      .select('id')
      .eq('slug', candidate)
      .maybeSingle();
    if (error) throw new Error(`Failed to check slug uniqueness: ${error.message}`);
    if (!data) return candidate;
    attempt += 1;
    candidate = `${root}-${randomSuffix(4)}`;
    if (attempt > 10) throw new Error('Could not generate a unique slug');
  }
}

async function generateUniqueCode(slug) {
  let attempt = 0;
  while (true) {
    const candidate = `${slug}-${randomSuffix(6)}`;
    const { data, error } = await supabase
      .from('brands')
      .select('id')
      .eq('access_code', candidate)
      .maybeSingle();
    if (error) throw new Error(`Failed to check code uniqueness: ${error.message}`);
    if (!data) return candidate;
    attempt += 1;
    if (attempt > 10) throw new Error('Could not generate a unique access code');
  }
}

// --- Public: redeem an access code (sets the brand on the session) ---

const accessLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please try again later.' },
  skip: (req) => req.session?.isAdmin === true,
});

router.post('/access', accessLimiter, asyncHandler(async (req, res) => {
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : '';
  if (!code) throw new Error('Access code is required');

  const { data: brand, error } = await supabase
    .from('brands')
    .select('id, name')
    .eq('access_code', code)
    .maybeSingle();
  if (error) throw new Error(`Failed to verify access code: ${error.message}`);
  if (!brand) return res.status(401).json({ error: 'Invalid access code' });

  req.session.brandId = brand.id;
  res.json({ brand: { id: brand.id, name: brand.name } });
}));

// --- Public: current brand on the session (or null) ---

router.get('/access', asyncHandler(async (req, res) => {
  const brandId = req.session?.brandId;
  if (!brandId) return res.json({ brand: null });

  const { data: brand, error } = await supabase
    .from('brands')
    .select('id, name')
    .eq('id', brandId)
    .maybeSingle();
  if (error) throw new Error(`Failed to load brand: ${error.message}`);

  // Brand was deleted while the session lingered: drop it from the session.
  if (!brand) {
    delete req.session.brandId;
    return res.json({ brand: null });
  }

  res.json({ brand: { id: brand.id, name: brand.name } });
}));

// --- Public: exit the current brand (clears it from the session) ---

router.delete('/access', (req, res) => {
  if (req.session) delete req.session.brandId;
  res.json({ ok: true });
});

// --- Admin: list all brands ---

router.get('/', requireAuth, asyncHandler(async (_req, res) => {
  const { data, error } = await supabase
    .from('brands')
    .select('id, name, slug, access_code, created_at, updated_at')
    .order('name', { ascending: true });
  if (error) throw new Error(`Failed to list brands: ${error.message}`);
  res.json({ brands: data || [] });
}));

// --- Admin: create a brand (auto-generates slug + access code) ---

router.post('/', requireAuth, asyncHandler(async (req, res) => {
  const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
  if (!name) throw new Error('name is required');

  const slug = await generateUniqueSlug(name);

  // Allow the admin to supply a custom code; otherwise generate a readable one.
  let accessCode = typeof req.body?.access_code === 'string' ? req.body.access_code.trim() : '';
  if (accessCode) {
    const { data: existing, error: codeErr } = await supabase
      .from('brands')
      .select('id')
      .eq('access_code', accessCode)
      .maybeSingle();
    if (codeErr) throw new Error(`Failed to check code uniqueness: ${codeErr.message}`);
    if (existing) throw new Error('That access code is already in use');
  } else {
    accessCode = await generateUniqueCode(slug);
  }

  const { data, error } = await supabase
    .from('brands')
    .insert({ name, slug, access_code: accessCode, updated_at: new Date().toISOString() })
    .select('id, name, slug, access_code, created_at, updated_at')
    .single();
  if (error) throw new Error(`Failed to create brand: ${error.message}`);
  res.status(201).json(data);
}));

// --- Admin: update a brand (rename and/or regenerate the access code) ---

router.put('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new Error('Invalid brand id');

  const update = { updated_at: new Date().toISOString() };

  if (req.body?.name !== undefined) {
    const name = String(req.body.name).trim();
    if (!name) throw new Error('name cannot be empty');
    update.name = name;
  }

  if (req.body?.regenerate_code === true) {
    const { data: brand, error: fetchErr } = await supabase
      .from('brands')
      .select('slug')
      .eq('id', id)
      .maybeSingle();
    if (fetchErr) throw new Error(`Failed to load brand: ${fetchErr.message}`);
    if (!brand) throw new Error('Brand not found');
    update.access_code = await generateUniqueCode(brand.slug);
  } else if (typeof req.body?.access_code === 'string' && req.body.access_code.trim()) {
    const accessCode = req.body.access_code.trim();
    const { data: existing, error: codeErr } = await supabase
      .from('brands')
      .select('id')
      .eq('access_code', accessCode)
      .neq('id', id)
      .maybeSingle();
    if (codeErr) throw new Error(`Failed to check code uniqueness: ${codeErr.message}`);
    if (existing) throw new Error('That access code is already in use');
    update.access_code = accessCode;
  }

  const { data, error } = await supabase
    .from('brands')
    .update(update)
    .eq('id', id)
    .select('id, name, slug, access_code, created_at, updated_at')
    .single();
  if (error) throw new Error(`Failed to update brand: ${error.message}`);
  res.json(data);
}));

// --- Admin: delete a brand (cascades to tutorial_brands assignments) ---

router.delete('/:id', requireAuth, asyncHandler(async (req, res) => {
  const id = Number.parseInt(req.params.id, 10);
  if (!Number.isInteger(id)) throw new Error('Invalid brand id');

  const { error } = await supabase.from('brands').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete brand: ${error.message}`);
  res.json({ deleted: id });
}));

export default router;
