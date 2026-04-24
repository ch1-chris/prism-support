import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';
const FAQ_META_KEY = 'faq_last_generated_at';
const KB_BATCH_CHAR_BUDGET = 24000; // soft cap per Claude prompt section
const TARGET_FAQ_MIN = 15;
const TARGET_FAQ_MAX = 25;

function parseJSON(text) {
  const stripped = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  return JSON.parse(stripped);
}

async function getLastGeneratedAt() {
  const { data, error } = await supabase
    .from('app_settings')
    .select('value, updated_at')
    .eq('key', FAQ_META_KEY)
    .maybeSingle();
  if (error) throw new Error(`Failed to read faq metadata: ${error.message}`);
  return data?.value || null;
}

async function setLastGeneratedAt(iso) {
  const { error } = await supabase
    .from('app_settings')
    .upsert({ key: FAQ_META_KEY, value: iso, updated_at: new Date().toISOString() });
  if (error) throw new Error(`Failed to write faq metadata: ${error.message}`);
}

// --- Public: list FAQ ---
router.get('/', asyncHandler(async (_req, res) => {
  const { data, error } = await supabase
    .from('faq_entries')
    .select('id, question, answer, source_kb_ids, display_order')
    .order('display_order', { ascending: true })
    .order('id', { ascending: true });

  if (error) throw new Error(`Failed to list faq: ${error.message}`);

  const lastGeneratedAt = await getLastGeneratedAt();

  res.json({
    faqs: data || [],
    last_generated_at: lastGeneratedAt,
  });
}));

// --- Admin: regenerate FAQ from KB (SSE) ---
router.post('/refresh', requireAuth, asyncHandler(async (_req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  function send(obj) {
    res.write(`data: ${JSON.stringify(obj)}\n\n`);
  }

  try {
    send({ type: 'progress', message: 'Loading knowledge base entries...' });

    const { data: entries, error: fetchError } = await supabase
      .from('kb_entries')
      .select('id, title, feature_name, ui_location, how_to_access, keyboard_shortcut, content, common_issues')
      .or('is_stale.is.null,is_stale.eq.false')
      .order('updated_at', { ascending: false });

    if (fetchError) throw new Error(`Failed to load KB: ${fetchError.message}`);
    if (!entries || entries.length === 0) {
      throw new Error('Cannot generate FAQ: knowledge base is empty');
    }

    send({ type: 'progress', message: `Summarizing ${entries.length} KB entries...` });

    // Build a compact textual representation. Truncate per-entry content so a single
    // Claude call fits comfortably in context regardless of KB size.
    const perEntryCharCap = Math.max(
      400,
      Math.floor(KB_BATCH_CHAR_BUDGET / Math.max(entries.length, 1)),
    );

    const summaries = entries.map((e) => {
      const parts = [`[ID:${e.id}] ${e.title}`];
      if (e.feature_name) parts.push(`Feature: ${e.feature_name}`);
      if (e.ui_location) parts.push(`UI: ${e.ui_location}`);
      if (e.how_to_access) parts.push(`Access: ${e.how_to_access}`);
      if (e.keyboard_shortcut) parts.push(`Shortcut: ${e.keyboard_shortcut}`);
      const content = (e.content || '').slice(0, perEntryCharCap);
      parts.push(`Content: ${content}`);
      if (e.common_issues) parts.push(`Issues: ${e.common_issues.slice(0, 200)}`);
      return parts.join(' | ');
    });

    send({ type: 'progress', message: 'Asking Claude to draft FAQ...' });

    const prompt = `You are generating a customer-facing FAQ for a video editing application.

Below are the knowledge base entries. Produce between ${TARGET_FAQ_MIN} and ${TARGET_FAQ_MAX} high-value Q&A pairs that cover the most common, most useful, and most easily misunderstood aspects of the product. Prefer broad, beginner-to-intermediate questions over niche edge cases. Each answer should be self-contained, practical, and concise (1-4 short paragraphs, plain prose; markdown lists are allowed when helpful).

For every Q&A, include the IDs of the KB entries you used as sources in source_kb_ids.

Return ONLY valid JSON of this exact shape, with no markdown fences:
{
  "faqs": [
    { "question": "string", "answer": "string", "source_kb_ids": [number, ...] }
  ]
}

KB ENTRIES:
${summaries.join('\n')}`;

    const claudeResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 8000,
      messages: [{ role: 'user', content: prompt }],
    });

    const rawText = claudeResponse.content?.[0]?.text;
    if (!rawText) throw new Error('Claude returned no text content');

    const parsed = parseJSON(rawText);
    const faqs = Array.isArray(parsed?.faqs) ? parsed.faqs : null;
    if (!faqs || faqs.length === 0) {
      throw new Error('Claude response did not include any faqs');
    }

    const validIds = new Set(entries.map((e) => e.id));
    const rows = faqs.map((f, idx) => {
      if (!f || typeof f.question !== 'string' || typeof f.answer !== 'string') {
        throw new Error(`FAQ entry at index ${idx} is malformed`);
      }
      const question = f.question.trim();
      const answer = f.answer.trim();
      if (!question || !answer) {
        throw new Error(`FAQ entry at index ${idx} has an empty question or answer`);
      }
      const sources = Array.isArray(f.source_kb_ids)
        ? f.source_kb_ids
            .map((n) => Number.parseInt(n, 10))
            .filter((n) => Number.isInteger(n) && validIds.has(n))
        : [];
      return {
        question,
        answer,
        source_kb_ids: sources,
        display_order: idx,
      };
    });

    send({ type: 'progress', message: `Replacing FAQ table with ${rows.length} entries...` });

    // Wipe-and-replace. Fail fast: if delete fails or insert fails, throw.
    const { error: deleteError } = await supabase
      .from('faq_entries')
      .delete()
      .gte('id', 0);
    if (deleteError) throw new Error(`Failed to clear faq_entries: ${deleteError.message}`);

    const { data: inserted, error: insertError } = await supabase
      .from('faq_entries')
      .insert(rows)
      .select();
    if (insertError) throw new Error(`Failed to insert faq_entries: ${insertError.message}`);

    const generatedAt = new Date().toISOString();
    await setLastGeneratedAt(generatedAt);

    send({
      type: 'done',
      count: inserted?.length ?? rows.length,
      last_generated_at: generatedAt,
    });
    res.end();
  } catch (err) {
    send({ type: 'error', message: err.message || String(err) });
    res.end();
  }
}));

export default router;
