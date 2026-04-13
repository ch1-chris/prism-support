import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { semanticSearch } from '../embeddings.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

function buildSystemPrompt(kbEntries, language) {
  const kbSection = kbEntries.length
    ? kbEntries.map(e => {
        let block = `### ${e.title}`;
        if (e.feature_name) block += `\nFeature: ${e.feature_name}`;
        if (e.ui_location) block += `\nLocation: ${e.ui_location}`;
        if (e.how_to_access) block += `\nAccess: ${e.how_to_access}`;
        if (e.keyboard_shortcut) block += `\nShortcut: ${e.keyboard_shortcut}`;
        block += `\n${e.content}`;
        if (e.common_issues) block += `\nCommon issues: ${e.common_issues}`;
        return block;
      }).join('\n\n---\n\n')
    : 'No knowledge base entries available yet.';

  const langInstruction = language && language !== 'en'
    ? `\nIMPORTANT: Respond in the language with code "${language}". Match the user's language.`
    : '';

  return `You are Prism Support, a helpful assistant for a video editing application.

RULES:
- Answer ONLY from the knowledge base below. Do not invent features or instructions.
- Be specific about button locations, menu paths, and keyboard shortcuts.
- If the answer is NOT in the knowledge base, say explicitly: "I don't have information about that in my current knowledge base. You may want to check the latest documentation or contact our support team."
- When you're uncertain, say so clearly rather than guessing.
- Keep answers concise and practical.
- After your answer, generate 2-3 relevant follow-up questions the user might ask.

FORMAT:
- Provide your answer as normal text.
- At the very end of your response, on a new line, add a JSON block with follow-up suggestions:
<!--followups:["Question 1?","Question 2?","Question 3?"]-->
${langInstruction}

KNOWLEDGE BASE:
${kbSection}`;
}

// --- Stream chat ---
router.post('/stream', asyncHandler(async (req, res) => {
  const { message, sessionId, version, language } = req.body;
  if (!message?.trim()) throw new Error('Message is required');
  if (!sessionId) throw new Error('Session ID is required');

  const { data: existingSession, error: lookupError } = await supabase
    .from('chat_sessions')
    .select('id')
    .eq('id', sessionId)
    .maybeSingle();
  if (lookupError) throw new Error(`Failed to check session: ${lookupError.message}`);

  if (!existingSession) {
    const { error: sessionError } = await supabase.from('chat_sessions').insert({
      id: sessionId,
      app_version: version || null,
      language: language || 'en',
    });
    if (sessionError) throw new Error(`Failed to create session: ${sessionError.message}`);
  } else {
    const { error: updateError } = await supabase.from('chat_sessions')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (updateError) throw new Error(`Failed to update session: ${updateError.message}`);
  }

  const { error: userMsgError } = await supabase.from('chat_messages').insert({
    session_id: sessionId,
    role: 'user',
    content: message,
  });
  if (userMsgError) throw new Error(`Failed to save user message: ${userMsgError.message}`);

  const kbEntries = await semanticSearch(message, { version, limit: 5 });
  const kbIds = kbEntries.map(e => e.id);

  const { data: history, error: historyError } = await supabase
    .from('chat_messages')
    .select('role, content')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true })
    .limit(20);
  if (historyError) throw new Error(`Failed to load history: ${historyError.message}`);

  const messages = (history || []).map(m => ({
    role: m.role,
    content: m.content,
  }));

  const systemPrompt = buildSystemPrompt(kbEntries, language);

  const { data: analyticsEntry, error: analyticsError } = await supabase
    .from('analytics_events')
    .insert({
      question: message,
      session_id: sessionId,
      matched_kb: kbIds,
      had_answer: kbEntries.length > 0,
    })
    .select('id')
    .single();
  if (analyticsError) throw new Error(`Failed to log analytics: ${analyticsError.message}`);

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
      max_tokens: 1500,
      system: systemPrompt,
      messages,
    });

    stream.on('text', (text) => {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ type: 'text', content: text })}\n\n`);
    });

    await stream.finalMessage();

    const followUpMatch = fullResponse.match(/<!--followups:(\[.*?\])-->/);
    let followUps = [];
    if (followUpMatch) {
      try {
        followUps = JSON.parse(followUpMatch[1]);
        fullResponse = fullResponse.replace(/<!--followups:\[.*?\]-->/, '').trim();
      } catch (parseErr) {
        console.error('[Chat] Failed to parse follow-ups:', parseErr.message);
      }
    }

    const { error: saveMsgError } = await supabase.from('chat_messages').insert({
      session_id: sessionId,
      role: 'assistant',
      content: fullResponse,
      follow_ups: followUps,
    });
    if (saveMsgError) {
      console.error('[Chat] Failed to save assistant message:', saveMsgError.message);
    }

    res.write(`data: ${JSON.stringify({ type: 'followups', content: followUps })}\n\n`);
    res.write(`data: ${JSON.stringify({ type: 'done', analyticsId: analyticsEntry?.id })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ type: 'error', content: err.message })}\n\n`);
  }

  res.end();
}));

// --- Get session messages ---
router.get('/sessions/:sessionId', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('*')
    .eq('session_id', req.params.sessionId)
    .order('created_at', { ascending: true });

  if (error) throw new Error(`Failed to load session: ${error.message}`);
  res.json(data || []);
}));

// --- Submit feedback ---
router.patch('/feedback', asyncHandler(async (req, res) => {
  const { messageId, analyticsId, feedback } = req.body;

  if (messageId) {
    const { error } = await supabase
      .from('chat_messages')
      .update({ feedback })
      .eq('id', messageId);
    if (error) throw new Error(`Failed to save feedback: ${error.message}`);
  }

  if (analyticsId) {
    const { error: analyticsErr } = await supabase
      .from('analytics_events')
      .update({ feedback })
      .eq('id', analyticsId);
    if (analyticsErr) throw new Error(`Failed to save analytics feedback: ${analyticsErr.message}`);
  }

  res.json({ ok: true });
}));

// --- Create support ticket ---
router.post('/escalate', asyncHandler(async (req, res) => {
  const { sessionId, summary } = req.body;
  if (!sessionId) throw new Error('Session ID is required');

  const { data: messages, error: msgError } = await supabase
    .from('chat_messages')
    .select('role, content, created_at')
    .eq('session_id', sessionId)
    .order('created_at', { ascending: true });
  if (msgError) throw new Error(`Failed to load conversation: ${msgError.message}`);

  const { data: ticket, error } = await supabase
    .from('support_tickets')
    .insert({
      session_id: sessionId,
      conversation: messages || [],
      user_summary: summary || null,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create ticket: ${error.message}`);

  if (process.env.SUPPORT_WEBHOOK_URL) {
    const webhookRes = await fetch(process.env.SUPPORT_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ticket),
    });
    if (!webhookRes.ok) {
      throw new Error(`Support webhook failed with status ${webhookRes.status}`);
    }
  }

  res.status(201).json(ticket);
}));

export default router;
