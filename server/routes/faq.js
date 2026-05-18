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

// Pinned category that always renders second (right after "Getting Started").
// These three Q&As are immune to regeneration: they are inserted verbatim on
// every refresh and must never be modified by Claude.
const GETTING_STARTED_CATEGORY = 'Getting Started';
const FOR_JOURNALISTS_CATEGORY = 'For Journalists';
const FOR_JOURNALISTS_FAQS = [
  {
    question: 'Where does Prism get its facts & materials?',
    answer: `If you're skeptical of AI in Journalism, here's the first thing to know about Prism: it only draws on sources that you direct it to use.  That means trusted services like AP or Reuters, footage you select or upload, articles you import, and research you approve. Once you've added your assets, that's the entire universe Prism works within. It won't pull in outside sources later in the workflow unless you tell it to yourself.  Try asking the Prism Script Agent a question that it can’t answer, and it will simply tell you it doesn’t know. The journalism you feed in is the only journalism that comes out.`,
  },
  {
    question: 'Where does Prism get interview soundbites?',
    answer: `Every sound bite in a Prism script comes directly from real footage you allowed into the project. Prism transcribes your clips, identifies the sound bites, and places them in context in the script. Then if you like, you can preview each one, trim it to exactly the words you want heard, and remove any that don't meet your editorial standards. Prism surfaces the options, but nothing appears in a final output without passing through your review.`,
  },
  {
    question: 'Can I make changes to the Video Edit?',
    answer: `After the script stage, Prism assembles the first pass of the video edit automatically.  But Prism is designed to give you oversight of every step in the process.  So for the next step, you land in the Editing Suite where you can see every shot that was chosen, every B-roll clip that was placed, every music track that was selected. You can swap shots, trim clips, reorder the timeline, change the music, adjust captions.  Or you can ask the Prism Video Agent to do it for you, and then review the results. And over time, Prism can learn the rules that matter to your newsroom. Style Guides let you encode your editorial standards, preferred terminology, and structural conventions, so they're applied automatically every time a script is generated. Pronunciation Guides correct how the AI voice handles names, acronyms, and foreign words. These aren't suggestions to the AI — they're constraints. You write the rules, Prism follows them. Prism does the heavy lifting, but the editorial judgment stays with you.`,
  },
];

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
    .select('id, question, answer, category, source_kb_ids, display_order')
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

Group the questions into between 3 and 6 short, intuitive CATEGORIES that emerge from the content (for example: "Getting Started", "Editing", "Export & Sharing", "Troubleshooting"). Use Title Case. Use the exact same category string for every question that belongs in that category. Within each category, order questions from most common/foundational to more specific.

REQUIRED CATEGORY ORDERING:
- The FIRST category you return MUST be exactly "Getting Started". Beginner/onboarding questions go here.
- Do NOT use the category name "For Journalists" — that category is reserved and managed separately. Do not generate any questions about: where Prism gets its facts/materials/sources, where Prism gets interview soundbites, or whether the user can make changes to the video edit / Editing Suite oversight. Those topics are pinned elsewhere; skip them entirely.
- After "Getting Started", order the remaining categories from most foundational to most advanced.

For every Q&A, include the IDs of the KB entries you used as sources in source_kb_ids.

Return ONLY valid JSON of this exact shape, with no markdown fences:
{
  "faqs": [
    { "category": "string", "question": "string", "answer": "string", "source_kb_ids": [number, ...] }
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

    // Preserve Claude's first-seen category order so the public page renders
    // sections in the order Claude intended (foundational -> advanced).
    const categoryOrder = new Map();
    const rows = faqs.map((f, idx) => {
      if (!f || typeof f.question !== 'string' || typeof f.answer !== 'string') {
        throw new Error(`FAQ entry at index ${idx} is malformed`);
      }
      const question = f.question.trim();
      const answer = f.answer.trim();
      if (!question || !answer) {
        throw new Error(`FAQ entry at index ${idx} has an empty question or answer`);
      }
      const category = typeof f.category === 'string' && f.category.trim()
        ? f.category.trim()
        : null;
      if (category && !categoryOrder.has(category)) {
        categoryOrder.set(category, categoryOrder.size);
      }
      const sources = Array.isArray(f.source_kb_ids)
        ? f.source_kb_ids
            .map((n) => Number.parseInt(n, 10))
            .filter((n) => Number.isInteger(n) && validIds.has(n))
        : [];
      return {
        category,
        question,
        answer,
        source_kb_ids: sources,
        // display_order encodes (categoryIndex * 1000) + indexWithinCategory so
        // a single column orders both the section and the rows inside it.
        _idx: idx,
      };
    });

    // Enforce the required category layout:
    //   slot 0 = "Getting Started" (Claude must have produced it)
    //   slot 1 = "For Journalists" (pinned, injected below)
    //   slot 2..N = every other category Claude returned, in its original order
    if (!categoryOrder.has(GETTING_STARTED_CATEGORY)) {
      throw new Error(`Claude did not return a "${GETTING_STARTED_CATEGORY}" category`);
    }
    if (categoryOrder.has(FOR_JOURNALISTS_CATEGORY)) {
      throw new Error(`Claude returned the reserved category "${FOR_JOURNALISTS_CATEGORY}"`);
    }

    const finalCategoryOrder = new Map();
    finalCategoryOrder.set(GETTING_STARTED_CATEGORY, 0);
    finalCategoryOrder.set(FOR_JOURNALISTS_CATEGORY, 1);
    for (const cat of categoryOrder.keys()) {
      if (cat === GETTING_STARTED_CATEGORY) continue;
      finalCategoryOrder.set(cat, finalCategoryOrder.size);
    }

    // Re-rank Claude's rows using the final category ordering, then their
    // original index within that category.
    const perCategoryCount = new Map();
    for (const row of rows) {
      const catIdx = row.category
        ? finalCategoryOrder.get(row.category)
        : finalCategoryOrder.size;
      const within = perCategoryCount.get(catIdx) ?? 0;
      perCategoryCount.set(catIdx, within + 1);
      row.display_order = catIdx * 1000 + within;
    }
    for (const row of rows) {
      delete row._idx;
    }

    // Inject the pinned "For Journalists" rows. They sit in slot 1 with
    // display_order 1000, 1001, 1002 so they render right after "Getting
    // Started" and before any other Claude-generated category.
    const forJournalistsIdx = finalCategoryOrder.get(FOR_JOURNALISTS_CATEGORY);
    for (let i = 0; i < FOR_JOURNALISTS_FAQS.length; i += 1) {
      const pinned = FOR_JOURNALISTS_FAQS[i];
      rows.push({
        category: FOR_JOURNALISTS_CATEGORY,
        question: pinned.question,
        answer: pinned.answer,
        source_kb_ids: [],
        display_order: forJournalistsIdx * 1000 + i,
      });
    }

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
