import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { embedAndStoreEntry } from '../embeddings.js';
import { upload } from '../upload.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

const STRUCTURED_PROMPT = `You are extracting information from content about a video editing application.
Return a JSON object with these fields:
- title: short descriptive title
- feature_name: the feature being described (or null)
- ui_location: where in the UI this is found (or null)
- how_to_access: how to access this feature (or null)
- keyboard_shortcut: any keyboard shortcut (or null)
- content: detailed description, instructions, and context
- common_issues: known issues or gotchas (or null)
- related_features: array of related feature names (or empty array)

Return ONLY valid JSON, no markdown fences.`;

// --- List entries ---
router.get('/', asyncHandler(async (req, res) => {
  const { search, source, version, stale, limit = 100, offset = 0 } = req.query;

  let query = supabase
    .from('kb_entries')
    .select('*', { count: 'exact' })
    .order('updated_at', { ascending: false })
    .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);

  if (search) {
    const escaped = search.replace(/[%_\\]/g, '\\$&').replace(/,/g, '');
    query = query.or(`title.ilike.%${escaped}%,content.ilike.%${escaped}%,feature_name.ilike.%${escaped}%`);
  }
  if (source) query = query.eq('source', source);
  if (version) query = query.eq('version', version);
  if (stale === 'true') query = query.eq('is_stale', true);

  const { data, error, count } = await query;
  if (error) throw new Error(`Failed to list entries: ${error.message}`);

  res.json({ entries: data, total: count });
}));

// --- Get single entry ---
router.get('/:id', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('kb_entries')
    .select('*')
    .eq('id', req.params.id)
    .single();

  if (error) throw new Error(`Entry not found: ${error.message}`);
  res.json(data);
}));

// --- Create entry ---
router.post('/', asyncHandler(async (req, res) => {
  const entry = req.body;
  entry.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('kb_entries')
    .insert(entry)
    .select()
    .single();

  if (error) throw new Error(`Failed to create entry: ${error.message}`);

  await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);

  res.status(201).json(data);
}));

// --- Update entry ---
router.put('/:id', asyncHandler(async (req, res) => {
  const updates = req.body;
  updates.updated_at = new Date().toISOString();
  updates.is_stale = false;
  updates.stale_reason = null;

  const { data, error } = await supabase
    .from('kb_entries')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to update entry: ${error.message}`);

  await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);

  res.json(data);
}));

// --- Delete entry ---
router.delete('/:id', asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('kb_entries')
    .delete()
    .eq('id', req.params.id);

  if (error) throw new Error(`Failed to delete entry: ${error.message}`);
  res.json({ ok: true });
}));

// --- Process uploaded file ---
router.post('/process-upload', upload.single('file'), asyncHandler(async (req, res) => {
  const file = req.file;
  if (!file) throw new Error('No file provided');

  const version = req.body.version || 'latest';
  let result;

  if (file.mimetype.startsWith('image/')) {
    result = await processImage(file, version);
  } else if (file.mimetype.startsWith('audio/') || file.mimetype.startsWith('video/')) {
    result = await processAudioVideo(file, version);
  } else if (
    file.mimetype === 'text/plain' ||
    file.mimetype === 'text/markdown' ||
    file.originalname.endsWith('.md') ||
    file.originalname.endsWith('.txt')
  ) {
    result = await processTextFile(file, version);
  } else {
    throw new Error(`Unsupported file type: ${file.mimetype}`);
  }

  res.status(201).json(result);
}));

async function processImage(file, version) {
  const base64 = file.buffer.toString('base64');

  const storagePath = `images/${Date.now()}-${file.originalname}`;
  const { error: uploadError } = await supabase.storage
    .from('helpbot-uploads')
    .upload(storagePath, file.buffer, { contentType: file.mimetype });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage
    .from('helpbot-uploads')
    .getPublicUrl(storagePath);

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: file.mimetype, data: base64 } },
        { type: 'text', text: `This is a screenshot from a video editing app. ${STRUCTURED_PROMPT}` },
      ],
    }],
  });

  const parsed = JSON.parse(response.content[0].text);

  const { data, error } = await supabase
    .from('kb_entries')
    .insert({
      ...parsed,
      related_features: parsed.related_features || [],
      source: 'image_upload',
      version,
      file_url: urlData.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save entry: ${error.message}`);

  await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
  return data;
}

async function processAudioVideo(file, version) {
  const storagePath = `media/${Date.now()}-${file.originalname}`;
  const { error: uploadError } = await supabase.storage
    .from('helpbot-uploads')
    .upload(storagePath, file.buffer, { contentType: file.mimetype });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: urlData } = supabase.storage
    .from('helpbot-uploads')
    .getPublicUrl(storagePath);

  if (!process.env.ELEVENLABS_API_KEY) {
    throw new Error('ELEVENLABS_API_KEY is required to process audio/video files');
  }

  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
  const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

  const audioBlob = new Blob([file.buffer], { type: file.mimetype });
  const transcription = await elevenlabs.speechToText.convert({
    file: audioBlob,
    model_id: 'scribe_v2',
    tag_audio_events: true,
    diarize: true,
  });

  const transcript = transcription.text;

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `This is a transcript of a voice note about a video editing app:\n\n${transcript}\n\n${STRUCTURED_PROMPT}`,
    }],
  });

  const parsed = JSON.parse(response.content[0].text);

  const { data, error } = await supabase
    .from('kb_entries')
    .insert({
      ...parsed,
      related_features: parsed.related_features || [],
      source: 'voice_note',
      version,
      file_url: urlData.publicUrl,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save entry: ${error.message}`);

  await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
  return data;
}

async function processTextFile(file, version) {
  const raw = file.buffer.toString('utf-8');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `This is a text file about a video editing app:\n\n${raw.slice(0, 8000)}\n\n${STRUCTURED_PROMPT}`,
    }],
  });

  const parsed = JSON.parse(response.content[0].text);

  const { data, error } = await supabase
    .from('kb_entries')
    .insert({
      ...parsed,
      related_features: parsed.related_features || [],
      source: 'text_file',
      version,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save entry: ${error.message}`);

  await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
  return data;
}

// --- Process changelog ---
router.post('/process-changelog', asyncHandler(async (req, res) => {
  const { text, version = 'latest' } = req.body;
  if (!text?.trim()) throw new Error('Changelog text is required');

  const { data: existingEntries, error: fetchError } = await supabase
    .from('kb_entries')
    .select('id, title, content, feature_name')
    .limit(200);

  if (fetchError) throw new Error(`Failed to fetch existing entries: ${fetchError.message}`);

  const existingSummary = (existingEntries || [])
    .map(e => `[ID:${e.id}] ${e.title}: ${e.content.slice(0, 100)}`)
    .join('\n');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `These are release notes for a video editing app:\n\n${text.slice(0, 8000)}

EXISTING KB ENTRIES:
${existingSummary}

Instructions:
1. Extract each distinct change into a structured KB entry.
2. For each change, check if an existing KB entry covers the same feature. If so, include its ID in an "update_id" field so we update it instead of creating a duplicate.
3. For any existing entries that conflict with these changes, include them in a "stale_entries" array with their ID and the reason they're stale.

Return a JSON object with:
- "entries": array of entry objects, each with: title, feature_name, ui_location, how_to_access, keyboard_shortcut, content, common_issues, related_features, update_id (or null)
- "stale_entries": array of { id, reason }

Return ONLY valid JSON, no markdown fences.`,
    }],
  });

  const parsed = JSON.parse(response.content[0].text);
  const results = [];

  for (const entry of parsed.entries || []) {
    const { update_id, ...fields } = entry;

    if (update_id) {
      const { data, error } = await supabase
        .from('kb_entries')
        .update({
          ...fields,
          related_features: fields.related_features || [],
          source: 'changelog',
          version,
          is_stale: false,
          stale_reason: null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', update_id)
        .select()
        .single();

      if (error) throw new Error(`Failed to update entry ${update_id}: ${error.message}`);
      await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
      results.push({ ...data, action: 'updated' });
    } else {
      const { data, error } = await supabase
        .from('kb_entries')
        .insert({
          ...fields,
          related_features: fields.related_features || [],
          source: 'changelog',
          version,
          updated_at: new Date().toISOString(),
        })
        .select()
        .single();

      if (error) throw new Error(`Failed to create entry: ${error.message}`);
      await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
      results.push({ ...data, action: 'created' });
    }
  }

  for (const stale of parsed.stale_entries || []) {
    const { error: staleError } = await supabase
      .from('kb_entries')
      .update({ is_stale: true, stale_reason: stale.reason })
      .eq('id', stale.id);

    if (staleError) throw new Error(`Failed to mark entry ${stale.id} as stale: ${staleError.message}`);
  }

  res.json({
    entries: results,
    stale_count: (parsed.stale_entries || []).length,
  });
}));

// --- Process description ---
router.post('/process-description', asyncHandler(async (req, res) => {
  const { text, version = 'latest' } = req.body;
  if (!text?.trim()) throw new Error('Description text is required');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `A developer describes a change or feature for their video editing app:\n\n${text}\n\n${STRUCTURED_PROMPT}`,
    }],
  });

  const parsed = JSON.parse(response.content[0].text);

  const { data, error } = await supabase
    .from('kb_entries')
    .insert({
      ...parsed,
      related_features: parsed.related_features || [],
      source: 'description',
      version,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to save entry: ${error.message}`);

  await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
  res.status(201).json(data);
}));

// --- Bulk import ---
router.post('/bulk-import', upload.array('files', 50), asyncHandler(async (req, res) => {
  const files = req.files;
  if (!files?.length) throw new Error('No files provided');

  const version = req.body.version || 'latest';
  const results = [];
  const errors = [];

  for (const file of files) {
    try {
      if (file.originalname.endsWith('.zip')) {
        const AdmZip = (await import('adm-zip')).default;
        const zip = new AdmZip(file.buffer);
        const entries = zip.getEntries();

        for (const zipEntry of entries) {
          if (zipEntry.isDirectory) continue;
          const name = zipEntry.entryName;
          if (!name.endsWith('.md') && !name.endsWith('.txt')) continue;

          const content = zipEntry.getData().toString('utf-8');
          const response = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 2000,
            messages: [{
              role: 'user',
              content: `This is a help document for a video editing app (${name}):\n\n${content.slice(0, 8000)}\n\n${STRUCTURED_PROMPT}`,
            }],
          });

          const parsed = JSON.parse(response.content[0].text);
          const { data, error } = await supabase
            .from('kb_entries')
            .insert({
              ...parsed,
              related_features: parsed.related_features || [],
              source: 'bulk_import',
              version,
              updated_at: new Date().toISOString(),
            })
            .select()
            .single();

          if (error) throw new Error(error.message);
          await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
          results.push(data);
        }
      } else {
        const content = file.buffer.toString('utf-8');
        const response = await anthropic.messages.create({
          model: MODEL,
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `This is a help document for a video editing app (${file.originalname}):\n\n${content.slice(0, 8000)}\n\n${STRUCTURED_PROMPT}`,
          }],
        });

        const parsed = JSON.parse(response.content[0].text);
        const { data, error } = await supabase
          .from('kb_entries')
          .insert({
            ...parsed,
            related_features: parsed.related_features || [],
            source: 'bulk_import',
            version,
            updated_at: new Date().toISOString(),
          })
          .select()
          .single();

        if (error) throw new Error(error.message);
        await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
        results.push(data);
      }
    } catch (err) {
      errors.push({ file: file.originalname, error: err.message });
    }
  }

  res.json({ imported: results.length, errors });
}));

// --- GitHub changelog auto-fetch ---
router.post('/fetch-changelog', asyncHandler(async (req, res) => {
  const url = req.body.url || process.env.GITHUB_RELEASES_URL;
  if (!url) throw new Error('No GitHub releases URL configured');

  const match = url.match(/github\.com\/([^/]+)\/([^/]+)/);
  if (!match) throw new Error('Invalid GitHub URL format');

  const [, owner, repo] = match;
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases?per_page=5`;

  const ghRes = await fetch(apiUrl, {
    headers: { Accept: 'application/vnd.github.v3+json' },
  });
  if (!ghRes.ok) throw new Error(`GitHub API error: ${ghRes.status}`);

  const releases = await ghRes.json();

  const { data: lastFetchSetting, error: fetchSettingError } = await supabase
    .from('app_settings')
    .select('value, updated_at')
    .eq('key', 'last_github_fetch_id')
    .maybeSingle();
  if (fetchSettingError) throw new Error(`Failed to read fetch state: ${fetchSettingError.message}`);

  const lastFetchedId = lastFetchSetting?.value;
  const newReleases = lastFetchedId
    ? releases.filter(r => r.id.toString() !== lastFetchedId && new Date(r.published_at) > new Date(lastFetchSetting?.updated_at || 0))
    : releases.slice(0, 1);

  if (!newReleases.length) {
    return res.json({ message: 'No new releases found', fetched: 0 });
  }

  const results = [];
  for (const release of newReleases) {
    const text = `${release.name || release.tag_name}\n\n${release.body || ''}`;

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `These are release notes from GitHub for a video editing app:\n\n${text.slice(0, 8000)}\n\n${STRUCTURED_PROMPT}`,
      }],
    });

    const parsed = JSON.parse(response.content[0].text);
    const { data, error } = await supabase
      .from('kb_entries')
      .insert({
        ...parsed,
        related_features: parsed.related_features || [],
        source: 'changelog',
        version: release.tag_name || 'latest',
        updated_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (error) throw new Error(error.message);
    await embedAndStoreEntry(data.id, `${data.title} ${data.content}`);
    results.push(data);
  }

  const { error: upsertError1 } = await supabase
    .from('app_settings')
    .upsert({
      key: 'last_github_fetch_id',
      value: releases[0].id.toString(),
      updated_at: new Date().toISOString(),
    });
  if (upsertError1) throw new Error(`Failed to save fetch state: ${upsertError1.message}`);

  if (req.body.url) {
    const { error: upsertError2 } = await supabase
      .from('app_settings')
      .upsert({
        key: 'github_releases_url',
        value: req.body.url,
        updated_at: new Date().toISOString(),
      });
    if (upsertError2) throw new Error(`Failed to save URL setting: ${upsertError2.message}`);
  }

  res.json({ fetched: results.length, entries: results });
}));

// --- Staleness check ---
router.post('/check-staleness', asyncHandler(async (req, res) => {
  const days = parseInt(process.env.STALENESS_DAYS || '90', 10);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - days);

  const { data, error } = await supabase
    .from('kb_entries')
    .update({
      is_stale: true,
      stale_reason: `Not updated in ${days}+ days`,
    })
    .lt('updated_at', cutoff.toISOString())
    .eq('is_stale', false)
    .select('id');

  if (error) throw new Error(`Staleness check failed: ${error.message}`);

  res.json({ flagged: data?.length || 0 });
}));

// --- Get versions ---
router.get('/meta/versions', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('kb_entries')
    .select('version')
    .not('version', 'is', null);

  if (error) throw new Error(error.message);

  const versions = [...new Set((data || []).map(e => e.version))].sort();
  res.json(versions);
}));

export default router;
