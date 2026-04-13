import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '../db.js';
import { semanticSearch } from '../embeddings.js';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = 'claude-sonnet-4-6';

// --- Dashboard summary ---
router.get('/summary', asyncHandler(async (req, res) => {
  const [entriesResult, staleResult, questionsResult, ticketsResult] = await Promise.all([
    supabase.from('kb_entries').select('*', { count: 'exact', head: true }),
    supabase.from('kb_entries').select('*', { count: 'exact', head: true }).eq('is_stale', true),
    supabase.from('analytics_events').select('*', { count: 'exact', head: true }),
    supabase.from('support_tickets').select('*', { count: 'exact', head: true }).eq('status', 'open'),
  ]);

  if (entriesResult.error) throw new Error(`Failed to count entries: ${entriesResult.error.message}`);
  if (staleResult.error) throw new Error(`Failed to count stale entries: ${staleResult.error.message}`);
  if (questionsResult.error) throw new Error(`Failed to count questions: ${questionsResult.error.message}`);
  if (ticketsResult.error) throw new Error(`Failed to count tickets: ${ticketsResult.error.message}`);

  const { data: sourceData, error: sourceError } = await supabase
    .from('kb_entries')
    .select('source');
  if (sourceError) throw new Error(`Failed to fetch sources: ${sourceError.message}`);

  const bySource = {};
  (sourceData || []).forEach(e => {
    bySource[e.source] = (bySource[e.source] || 0) + 1;
  });

  const { data: recentFeedback, error: feedbackError } = await supabase
    .from('analytics_events')
    .select('feedback, created_at')
    .not('feedback', 'is', null)
    .order('created_at', { ascending: false })
    .limit(50);
  if (feedbackError) throw new Error(`Failed to fetch feedback: ${feedbackError.message}`);

  const thumbsUp = (recentFeedback || []).filter(f => f.feedback === 1).length;
  const thumbsDown = (recentFeedback || []).filter(f => f.feedback === -1).length;

  const { data: dailyQuestions, error: dailyError } = await supabase
    .from('analytics_events')
    .select('created_at')
    .gte('created_at', new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString())
    .order('created_at', { ascending: true });
  if (dailyError) throw new Error(`Failed to fetch daily questions: ${dailyError.message}`);

  const perDay = {};
  (dailyQuestions || []).forEach(q => {
    const day = q.created_at.split('T')[0];
    perDay[day] = (perDay[day] || 0) + 1;
  });

  res.json({
    totalEntries: entriesResult.count,
    staleEntries: staleResult.count,
    totalQuestions: questionsResult.count,
    openTickets: ticketsResult.count,
    bySource,
    feedback: { thumbsUp, thumbsDown },
    questionsPerDay: perDay,
  });
}));

// --- Top unanswered questions ---
router.get('/unanswered', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('analytics_events')
    .select('question, created_at')
    .eq('had_answer', false)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw new Error(error.message);
  res.json(data || []);
}));

// --- Recent questions ---
router.get('/questions', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit || '50', 10);

  const { data, error } = await supabase
    .from('analytics_events')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);
  res.json(data || []);
}));

// --- Support tickets ---
router.get('/tickets', asyncHandler(async (req, res) => {
  const status = req.query.status || 'open';

  let query = supabase
    .from('support_tickets')
    .select('*')
    .order('created_at', { ascending: false });

  if (status !== 'all') query = query.eq('status', status);

  const { data, error } = await query.limit(50);
  if (error) throw new Error(error.message);
  res.json(data || []);
}));

router.patch('/tickets/:id', asyncHandler(async (req, res) => {
  const { status } = req.body;
  const { data, error } = await supabase
    .from('support_tickets')
    .update({ status })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) throw new Error(error.message);
  res.json(data);
}));

// --- KB Test Runner ---
router.get('/tests', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('kb_test_cases')
    .select('*')
    .order('created_at', { ascending: true });

  if (error) throw new Error(error.message);
  res.json(data || []);
}));

router.post('/tests', asyncHandler(async (req, res) => {
  const { question, expected_answer } = req.body;
  if (!question || !expected_answer) throw new Error('question and expected_answer are required');

  const { data, error } = await supabase
    .from('kb_test_cases')
    .insert({ question, expected_answer })
    .select()
    .single();

  if (error) throw new Error(error.message);
  res.status(201).json(data);
}));

router.delete('/tests/:id', asyncHandler(async (req, res) => {
  const { error } = await supabase
    .from('kb_test_cases')
    .delete()
    .eq('id', req.params.id);

  if (error) throw new Error(error.message);
  res.json({ ok: true });
}));

router.post('/tests/run', asyncHandler(async (req, res) => {
  const { data: tests, error: testsError } = await supabase
    .from('kb_test_cases')
    .select('*')
    .order('created_at', { ascending: true });
  if (testsError) throw new Error(`Failed to load test cases: ${testsError.message}`);

  if (!tests?.length) {
    return res.json({ results: [], passed: 0, failed: 0 });
  }

  const results = [];

  for (const test of tests) {
    const kbEntries = await semanticSearch(test.question, { limit: 5 });
    const kbContext = kbEntries.map(e => `${e.title}: ${e.content}`).join('\n\n');

    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: `Based on this knowledge base, answer the question.

KNOWLEDGE BASE:
${kbContext}

QUESTION: ${test.question}

Answer concisely.`,
      }],
    });

    const actual = response.content[0].text;

    const evalResponse = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Does this actual answer contain the key facts from the expected answer?

EXPECTED: ${test.expected_answer}
ACTUAL: ${actual}

Reply with ONLY "pass" or "fail" followed by a brief reason.`,
      }],
    });

    const evalText = evalResponse.content[0].text;
    const passed = evalText.toLowerCase().startsWith('pass');

    const { error: updateError } = await supabase
      .from('kb_test_cases')
      .update({
        last_result: passed ? 'pass' : 'fail',
        last_actual: actual,
        last_run_at: new Date().toISOString(),
      })
      .eq('id', test.id);
    if (updateError) throw new Error(`Failed to update test result: ${updateError.message}`);

    results.push({
      id: test.id,
      question: test.question,
      expected: test.expected_answer,
      actual,
      result: passed ? 'pass' : 'fail',
      reason: evalText,
    });
  }

  res.json({
    results,
    passed: results.filter(r => r.result === 'pass').length,
    failed: results.filter(r => r.result === 'fail').length,
  });
}));

// --- App settings ---
router.get('/settings', asyncHandler(async (req, res) => {
  const { data, error } = await supabase
    .from('app_settings')
    .select('*');
  if (error) throw new Error(`Failed to load settings: ${error.message}`);

  const settings = {};
  (data || []).forEach(s => { settings[s.key] = s.value; });
  res.json(settings);
}));

router.put('/settings', asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body);
  for (const [key, value] of entries) {
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value: String(value), updated_at: new Date().toISOString() });
    if (error) throw new Error(`Failed to save setting "${key}": ${error.message}`);
  }
  res.json({ ok: true });
}));

export default router;
