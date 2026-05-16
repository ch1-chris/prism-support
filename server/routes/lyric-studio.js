import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { asyncHandler } from '../middleware/asyncHandler.js';

const router = Router();

const MODEL = 'claude-sonnet-4-6';

const PALETTE_KEYS = ['teal', 'magenta', 'purple', 'orange', 'blue', 'green', 'gold', 'mono'].join(', ');
const STYLE_KEYS = ['karaoke', 'spotlight', 'cascade', 'subtitle', 'mono_callout'].join(', ');

function parseJSON(text) {
  let s = text.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  s = s.replace(/```json|```/g, '').trim();
  return JSON.parse(s);
}

function buildPrompt(script) {
  return `You are designing a lyric / narration video that follows the Channel 1 design system (mono uppercase labels, accent-colored highlights, clean sans display type). Pick the best look for this script.

SCRIPT:
"""
${script}
"""

Choose one option from each list.
- palette: ${PALETTE_KEYS}
- style:   ${STYLE_KEYS}
- mode:    light | dark
- aspect:  16:9 | 9:16 | 1:1 | 4:5
- textScale: s | m | l | xl

Respond ONLY with valid JSON, no markdown fences, no preamble:
{
  "palette": "<key>",
  "style": "<key>",
  "mode": "light|dark",
  "aspect": "16:9|9:16|1:1|4:5",
  "textScale": "s|m|l|xl",
  "mood": "<one short sentence>",
  "reasoning": "<one sentence explaining the pick>"
}`;
}

router.post('/style-suggestion', asyncHandler(async (req, res) => {
  const text = req.body?.text;
  if (typeof text !== 'string' || !text.trim()) {
    res.status(400).json({ error: 'text is required' });
    return;
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    const err = new Error('Server is not configured with ANTHROPIC_API_KEY.');
    err.status = 503;
    throw err;
  }

  const anthropic = new Anthropic({ apiKey });
  const claudeResponse = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1000,
    messages: [{ role: 'user', content: buildPrompt(text.trim()) }],
  });

  const rawText = claudeResponse.content?.filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  if (!rawText) {
    const err = new Error('Claude returned no text content');
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = parseJSON(rawText);
  } catch (_e) {
    const err = new Error(`Claude response was not valid JSON: ${rawText.slice(0, 200)}`);
    err.status = 502;
    throw err;
  }

  res.json(parsed);
}));

export default router;
