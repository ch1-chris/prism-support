import { Router } from 'express';
import { readFileSync, createReadStream, unlinkSync, statSync, existsSync } from 'fs';
import { resolve, join } from 'path';
import { tmpdir } from 'os';
import { randomUUID } from 'crypto';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { embedAndStoreEntry } from '../embeddings.js';
import { upload, videoUpload } from '../upload.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { extractFrames, readFrameAsBase64, getFramesForSegment, cleanupFrames, ensureTmpDir } from '../frames.js';

const router = Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';
const BUCKET = 'helpbot-uploads';

function extractStoragePath(fileUrl) {
  const marker = `/object/public/${BUCKET}/`;
  const idx = fileUrl.indexOf(marker);
  if (idx === -1) return null;
  return fileUrl.slice(idx + marker.length);
}

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

async function createEntry(parsed, source, version, fileUrl) {
  const { data, error } = await supabase
    .from('kb_entries')
    .insert({
      ...parsed,
      related_features: parsed.related_features || [],
      source,
      version,
      file_url: fileUrl || null,
      updated_at: new Date().toISOString(),
    })
    .select()
    .single();
  if (error) throw new Error(`Failed to create entry: ${error.message}`);
  return { entry: data, action: 'created', staleCount: 0 };
}

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

// --- List entries with files ---
router.get('/media', asyncHandler(async (req, res) => {
  const { data, error, count } = await supabase
    .from('kb_entries')
    .select('id, title, source, file_url, version, created_at, updated_at', { count: 'exact' })
    .not('file_url', 'is', null)
    .order('created_at', { ascending: false });

  if (error) throw new Error(`Failed to list media: ${error.message}`);
  res.json({ entries: data || [], total: count });
}));

// --- Delete storage file from an entry ---
router.post('/:id/remove-file', asyncHandler(async (req, res) => {
  const { data: entry, error: fetchError } = await supabase
    .from('kb_entries')
    .select('id, file_url')
    .eq('id', req.params.id)
    .single();

  if (fetchError) throw new Error(`Entry not found: ${fetchError.message}`);
  if (!entry.file_url) throw new Error('Entry has no file attached');

  const storagePath = extractStoragePath(entry.file_url);
  if (storagePath) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove([storagePath]);
    if (removeError) throw new Error(`Storage removal failed: ${removeError.message}`);
  }

  const { error: updateError } = await supabase
    .from('kb_entries')
    .update({ file_url: null })
    .eq('id', req.params.id);

  if (updateError) throw new Error(`Failed to clear file_url: ${updateError.message}`);

  res.json({ ok: true });
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

// --- Clear stale flag ---
router.post('/:id/clear-stale', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('kb_entries')
    .update({ is_stale: false, stale_reason: null })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) throw new Error(`Failed to clear stale flag: ${error.message}`);
  res.json(data);
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
  const { data: entry, error: fetchError } = await supabase
    .from('kb_entries')
    .select('id, file_url')
    .eq('id', req.params.id)
    .single();

  if (fetchError) throw new Error(`Entry not found: ${fetchError.message}`);

  if (entry.file_url) {
    const storagePath = extractStoragePath(entry.file_url);
    if (storagePath) {
      const { error: removeError } = await supabase.storage
        .from(BUCKET)
        .remove([storagePath]);
      if (removeError) console.error(`[Delete] Storage cleanup failed for ${storagePath}:`, removeError.message);
    }
  }

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
  const result = await createEntry(parsed, 'image_upload', version, urlData.publicUrl);
  await embedAndStoreEntry(result.entry.id, `${result.entry.title} ${result.entry.content}`);
  return result.entry;
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
    modelId: 'scribe_v2',
    tagAudioEvents: true,
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
  const result = await createEntry(parsed, 'voice_note', version, urlData.publicUrl);
  await embedAndStoreEntry(result.entry.id, `${result.entry.title} ${result.entry.content}`);
  return result.entry;
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
  const result = await createEntry(parsed, 'text_file', version, null);
  await embedAndStoreEntry(result.entry.id, `${result.entry.title} ${result.entry.content}`);
  return result.entry;
}

// --- Upload video file (phase 1) ---
const MAX_STORAGE_UPLOAD_BYTES = 1024 * 1024 * 1024;

router.post('/upload-video', videoUpload.single('file'), asyncHandler(async (req, res) => {
  ensureTmpDir();
  const file = req.file;
  if (!file) throw new Error('No video file provided');

  const videoPath = file.path;
  const fileSize = statSync(videoPath).size;

  let fileUrl = null;
  if (fileSize <= MAX_STORAGE_UPLOAD_BYTES) {
    const storagePath = `media/${Date.now()}-${file.originalname}`;
    const videoBuffer = readFileSync(videoPath);
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, videoBuffer, { contentType: file.mimetype });
    if (uploadError) {
      console.error(`[Video] Storage upload skipped (${uploadError.message})`);
    } else {
      const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
      fileUrl = urlData.publicUrl;
    }
  }

  res.json({ fileUrl, tmpPath: videoPath });
}));

// --- Process tutorial video (phase 2, async with polling) ---
const videoJobs = new Map();
const JOB_TTL_MS = 30 * 60 * 1000;

router.post('/process-video', asyncHandler(async (req, res) => {
  const { tmpPath, fileUrl, version = 'latest', mimetype } = req.body;
  if (!tmpPath) throw new Error('tmpPath is required');
  if (!process.env.ELEVENLABS_API_KEY) throw new Error('ELEVENLABS_API_KEY is required');

  const expectedPrefix = join(tmpdir(), 'prism-uploads');
  const resolved = resolve(tmpPath);
  if (!resolved.startsWith(expectedPrefix)) {
    throw new Error('Invalid tmpPath');
  }
  if (!existsSync(resolved)) {
    throw new Error('Video file not found — it may have been cleaned up. Please re-upload.');
  }

  const jobId = randomUUID();
  videoJobs.set(jobId, { status: 'processing', progress: null, entries: [], error: null });

  runVideoProcessing(jobId, resolved, fileUrl, version, mimetype || 'video/mp4');

  res.json({ jobId });
}));

router.get('/process-video/:jobId', asyncHandler(async (req, res) => {
  const job = videoJobs.get(req.params.jobId);
  if (!job) throw new Error('Job not found');

  res.json(job);

  if (job.status === 'done' || job.status === 'error') {
    setTimeout(() => videoJobs.delete(req.params.jobId), 60000);
  }
}));

async function runVideoProcessing(jobId, videoPath, fileUrl, version, mimetype) {
  const job = videoJobs.get(jobId);
  let framesDir = null;

  try {
    job.progress = { step: 'transcribing', message: 'Transcribing audio and extracting frames...' };

    const [transcription, frameResult] = await Promise.all([
      transcribeVideo(videoPath, mimetype),
      extractFrames(videoPath),
    ]);

    framesDir = frameResult.outDir;
    const allFrames = frameResult.frames;
    const transcript = transcription.text;

    job.progress = { step: 'transcribed', message: `Transcribed ${transcript.length} characters, extracted ${allFrames.length} frames` };

    job.progress = { step: 'segmenting', message: 'Identifying topics in the video...' };

    const segmentResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `This is a transcript of a tutorial video about a video editing application.
Identify the distinct topics, features, or workflows demonstrated.
Split the transcript into segments, one per topic.

Return a JSON array where each element has:
- "title": short topic title
- "start_seconds": approximate start time in the video (based on position in transcript)
- "end_seconds": approximate end time
- "transcript": the relevant transcript text for that topic

If the transcript only covers one topic, return a single-element array.
Return ONLY valid JSON, no markdown fences.

TRANSCRIPT:
${transcript}`,
      }],
    });

    const segments = JSON.parse(segmentResponse.content[0].text);
    job.progress = { step: 'segmented', message: `Identified ${segments.length} topic${segments.length !== 1 ? 's' : ''}` };

    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i];
      job.progress = {
        step: 'structuring',
        message: `Analyzing topic ${i + 1} of ${segments.length}: ${seg.title}`,
        current: i + 1,
        total: segments.length,
      };

      const segFrames = getFramesForSegment(allFrames, seg.start_seconds, seg.end_seconds, 8);

      const contentBlocks = [];
      for (const frame of segFrames) {
        const base64 = readFrameAsBase64(frame.path);
        contentBlocks.push({
          type: 'image',
          source: { type: 'base64', media_type: 'image/jpeg', data: base64 },
        });
      }

      const visionContext = segFrames.length > 0
        ? `This is a segment from a tutorial video about a video editing application.
Below are ${segFrames.length} screenshots from this segment alongside the transcript.
Analyze BOTH the visual content (UI elements, menus, buttons, panels visible on screen) AND the spoken content to create a thorough documentation entry.
Pay special attention to button labels, menu paths, panel layouts, and any UI details visible in the screenshots.`
        : `This is a segment from a tutorial video about a video editing application.`;

      contentBlocks.push({
        type: 'text',
        text: `${visionContext}

TRANSCRIPT FOR THIS SEGMENT ("${seg.title}"):
${seg.transcript}

${STRUCTURED_PROMPT}`,
      });

      const structureResponse = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 2000,
        messages: [{ role: 'user', content: contentBlocks }],
      });

      const parsed = JSON.parse(structureResponse.content[0].text);
      const result = await createEntry(parsed, 'tutorial_video', version, fileUrl);
      await embedAndStoreEntry(result.entry.id, `${result.entry.title} ${result.entry.content}`);
      job.entries.push(result.entry);
    }

    job.status = 'done';
    job.progress = { step: 'done', message: `Created ${job.entries.length} entries` };
  } catch (err) {
    job.status = 'error';
    job.error = err.message;
  } finally {
    cleanupFrames(framesDir);
    try { unlinkSync(videoPath); } catch { /* best-effort */ }
    setTimeout(() => videoJobs.delete(jobId), JOB_TTL_MS);
  }
}

async function transcribeVideo(videoPath, mimetype) {
  const { ElevenLabsClient } = await import('@elevenlabs/elevenlabs-js');
  const elevenlabs = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

  return elevenlabs.speechToText.convert({
    file: createReadStream(videoPath),
    modelId: 'scribe_v2',
    tagAudioEvents: true,
    diarize: true,
  });
}

// --- Process changelog ---
router.post('/process-changelog', asyncHandler(async (req, res) => {
  const { text, version = 'latest' } = req.body;
  if (!text?.trim()) throw new Error('Changelog text is required');

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `These are release notes for a video editing app:\n\n${text.slice(0, 8000)}

Extract each distinct change into a structured KB entry.

Return a JSON object with:
- "entries": array of entry objects, each with: title, feature_name, ui_location, how_to_access, keyboard_shortcut, content, common_issues, related_features

Return ONLY valid JSON, no markdown fences.`,
    }],
  });

  const parsed = JSON.parse(response.content[0].text);
  const results = [];

  for (const fields of parsed.entries || []) {
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

  res.json({ entries: results });
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
  const result = await createEntry(parsed, 'description', version, null);
  await embedAndStoreEntry(result.entry.id, `${result.entry.title} ${result.entry.content}`);
  res.status(201).json(result.entry);
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

// --- Cleanup expired uploaded files (5-day retention) ---

const FILE_RETENTION_DAYS = 5;

export async function cleanupExpiredFiles() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - FILE_RETENTION_DAYS);

  const { data: entries, error } = await supabase
    .from('kb_entries')
    .select('id, file_url')
    .not('file_url', 'is', null)
    .lt('created_at', cutoff.toISOString());

  if (error) throw new Error(`Cleanup query failed: ${error.message}`);
  if (!entries?.length) return { deleted: 0 };

  const cleanable = entries.filter((e) => !e.file_url.includes('/images/'));
  if (!cleanable.length) return { deleted: 0, skipped: entries.length };

  const storagePaths = cleanable
    .map((e) => extractStoragePath(e.file_url))
    .filter(Boolean);

  if (storagePaths.length > 0) {
    const { error: removeError } = await supabase.storage
      .from(BUCKET)
      .remove(storagePaths);
    if (removeError) throw new Error(`Storage cleanup failed: ${removeError.message}`);
  }

  const ids = cleanable.map((e) => e.id);
  const { error: updateError } = await supabase
    .from('kb_entries')
    .update({ file_url: null })
    .in('id', ids);
  if (updateError) throw new Error(`Failed to clear file_url: ${updateError.message}`);

  console.log(`[Cleanup] Deleted ${storagePaths.length} expired files from storage`);
  return { deleted: storagePaths.length };
}

router.post('/cleanup-files', asyncHandler(async (_req, res) => {
  const result = await cleanupExpiredFiles();
  res.json(result);
}));

// --- KB audit: scan for duplicates and contradictions ---
const AUDIT_BATCH_SIZE = 40;

router.post('/audit', asyncHandler(async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  send({ type: 'progress', message: 'Fetching knowledge base entries...' });

  const { data: allEntries, error } = await supabase
    .from('kb_entries')
    .select('id, title, feature_name, content, source, version, created_at, updated_at, is_stale')
    .order('updated_at', { ascending: false });

  if (error) throw new Error(`Failed to fetch entries: ${error.message}`);
  if (!allEntries || allEntries.length === 0) {
    send({ type: 'done', duplicates: [], contradictions: [], clean: true, total: 0 });
    res.end();
    return;
  }

  send({ type: 'progress', message: `Analyzing ${allEntries.length} entries for duplicates and contradictions...` });

  const summaries = allEntries.map(e =>
    `[ID:${e.id}] (updated: ${e.updated_at}) ${e.title}${e.feature_name ? ` | Feature: ${e.feature_name}` : ''} | Source: ${e.source} | Content: ${e.content.slice(0, 200)}`
  );

  const allDuplicates = [];
  const allContradictions = [];

  for (let i = 0; i < summaries.length; i += AUDIT_BATCH_SIZE) {
    const batch = summaries.slice(i, i + AUDIT_BATCH_SIZE);
    const batchNum = Math.floor(i / AUDIT_BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(summaries.length / AUDIT_BATCH_SIZE);

    send({ type: 'progress', message: `Scanning batch ${batchNum}/${totalBatches}...` });

    const auditResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      messages: [{
        role: 'user',
        content: `Review these knowledge base entries for a video editing application.
Identify:
1. DUPLICATES: entries covering the same feature/topic (list both IDs)
2. CONTRADICTIONS: entries that give conflicting information (list both IDs and explain the conflict)
3. For each conflict, indicate which entry is more recent (by updated date) and should be kept.

ENTRIES:
${batch.join('\n')}

Return a JSON object:
{
  "duplicates": [{ "keep_id": N, "remove_id": N, "reason": "..." }],
  "contradictions": [{ "keep_id": N, "stale_id": N, "conflict": "..." }],
  "clean": true/false
}

Return ONLY valid JSON, no markdown fences.`,
      }],
    });

    const batchResult = JSON.parse(auditResponse.content[0].text);
    allDuplicates.push(...(batchResult.duplicates || []));
    allContradictions.push(...(batchResult.contradictions || []));
  }

  let flaggedCount = 0;
  for (const c of allContradictions) {
    if (c.stale_id) {
      const { error: flagError } = await supabase
        .from('kb_entries')
        .update({ is_stale: true, stale_reason: c.conflict })
        .eq('id', c.stale_id);
      if (flagError) console.error(`[Audit] Failed to flag entry ${c.stale_id}:`, flagError.message);
      else flaggedCount++;
    }
  }

  send({
    type: 'done',
    duplicates: allDuplicates,
    contradictions: allContradictions,
    flagged: flaggedCount,
    total: allEntries.length,
    clean: allDuplicates.length === 0 && allContradictions.length === 0,
  });

  res.end();
}));

export default router;
