import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-20250514';
const ADMIN_SESSION_ID = 'admin-training-chat';

function buildTrainingSystemPrompt(kbEntries) {
  const kbSection = kbEntries.length
    ? kbEntries.map(e => {
        let block = `### ${e.title}`;
        if (e.feature_name) block += `\nFeature: ${e.feature_name}`;
        if (e.ui_location) block += `\nUI Location: ${e.ui_location}`;
        if (e.how_to_access) block += `\nHow to access: ${e.how_to_access}`;
        if (e.keyboard_shortcut) block += `\nKeyboard shortcut: ${e.keyboard_shortcut}`;
        block += `\n${e.content}`;
        if (e.common_issues) block += `\nCommon issues: ${e.common_issues}`;
        if (e.related_features?.length) block += `\nRelated features: ${e.related_features.join(', ')}`;
        if (e.version) block += `\nVersion: ${e.version}`;
        return block;
      }).join('\n\n---\n\n')
    : 'The knowledge base is empty. No entries have been added yet.';

  return `You are a training assistant for Prism Support. An admin is teaching you how their video editing software works so that the support chatbot can help end users effectively. Your entire current knowledge base is provided below.

BEHAVIOR:
- After the admin describes something, summarize your understanding back to them and ask clarifying follow-up questions.
- Proactively identify gaps in your knowledge: missing keyboard shortcuts, unclear UI locations, features mentioned but not fully documented, workflows that reference undocumented steps, etc.
- When asked "what don't you know?" or similar, audit the knowledge base thoroughly and list specific topics that seem incomplete or missing.
- Suggest related features, edge cases, or common user questions the admin might want to document.
- Be specific about what you DO and DON'T know based on the KB entries below.
- If the admin corrects you, acknowledge the correction clearly and restate your updated understanding.
- Keep track of the conversation context — if the admin has been describing a particular feature, stay focused on that topic until they move on.

IMPORTANT:
- You are NOT answering end-user questions right now. You are helping the admin verify and improve the knowledge base.
- Do not make up features or capabilities. Only reference what is in the knowledge base or what the admin tells you in this conversation.
- When you identify a gap, be specific: instead of "there might be more to know about exports", say "the KB entry for exports mentions MP4 and ProRes but doesn't mention resolution options or bitrate settings — does the app offer those?"

KNOWLEDGE BASE (${kbEntries.length} entries):
${kbSection}`;
}

async function ensureAdminSession() {
  const { data: existing, error: lookupError } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', ADMIN_SESSION_ID)
    .maybeSingle();
  if (lookupError) throw new Error(`Failed to check admin session: ${lookupError.message}`);

  if (!existing) {
    const { error: createError } = await supabase.from('chat_sessions').insert({
      id: ADMIN_SESSION_ID,
      app_version: null,
      language: 'en',
    });
    if (createError) throw new Error(`Failed to create admin session: ${createError.message}`);
  } else {
    const { error: updateError } = await supabase.from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', ADMIN_SESSION_ID);
    if (updateError) throw new Error(`Failed to update admin session: ${updateError.message}`);
  }
}

router.post('/stream', asyncHandler(async (req, res) => {
  const { message } = req.body;
  if (!message?.trim()) throw new Error('Message is required');

  await ensureAdminSession();

  const { error: userMsgError } = await supabase.from('chat_messages').insert({
    session_id: ADMIN_SESSION_ID,
    role: 'user',
    content: message,
  });
  if (userMsgError) throw new Error(`Failed to save user message: ${userMsgError.message}`);

  const { data: kbEntries, error: kbError } = await supabase
    .from('kb_entries')
    .select('title, feature_name, ui_location, how_to_access, keyboard_shortcut, content, common_issues, related_features, version')
    .order('created_at', { ascending: false });
  if (kbError) throw new Error(`Failed to load KB entries: ${kbError.message}`);

  const { data: history, error: historyError } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', ADMIN_SESSION_ID)
    .order('created_at', { ascending: true })
    .limit(50);
  if (historyError) throw new Error(`Failed to load history: ${historyError.message}`);

  const messages = (history || []).map(m => ({ role: m.role, content: m.content }));
  const systemPrompt = buildTrainingSystemPrompt(kbEntries || []);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let fullResponse = '';

  try {
    const stream = anthropic.messages.stream({
      model: MODEL,
      max_tokens: 2000,
      system: systemPrompt,
      messages,
    });

    stream.on('text', (text) => {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
    });

    await stream.finalMessage();

    const { error: saveMsgError } = await supabase.from('chat_messages').insert({
      session_id: ADMIN_SESSION_ID,
      role: 'assistant',
      content: fullResponse,
    });
    if (saveMsgError) {
      console.error('[AdminChat] Failed to save assistant message:', saveMsgError.message);
    }

    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
  }

  res.end();
}));

router.get('/history', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, role, content, created_at')
    .eq('session_id', ADMIN_SESSION_ID)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to load admin chat history: ${error.message}`);
  res.json(data || []);
}));

router.post('/clear', asyncHandler(async (req, res) => {
  const { error: msgError } = await supabase
    .from('chat_messages')
    .delete()
    .eq('session_id', ADMIN_SESSION_ID);
  if (msgError) throw new Error(`Failed to clear admin chat: ${msgError.message}`);

  res.json({ ok: true });
}));

export default router;
