# HelpBot — Project Overview & Roadmap

## What We're Building

A conversational help chatbot for a browser-based video editing app, powered by the Anthropic Claude API. The system has two sides:

**Admin panel** — a private interface where the developer maintains the knowledge base. It accepts uploads of screenshots, screen recordings, voice note transcripts, markdown files, and raw changelog text. Claude processes each input automatically and converts it into a structured knowledge base entry. No manual doc writing required.

**User chatbot** — a public-facing conversational interface where users ask questions about the app in plain language and get accurate, specific answers. The bot answers only from the knowledge base, so it stays grounded in the current state of the app rather than hallucinating generic advice.

The key design principle is that updating the bot's knowledge should be as low-friction as possible. The developer describes what changed — by typing a sentence, pasting release notes, or uploading a screenshot — and Claude does the work of turning that into something the chatbot can use.

---

## Current Architecture

```
Admin panel
├── File upload       → Claude Vision (screenshots) or text extraction
├── Changelog paste   → Claude structures into KB entries
└── Plain description → Claude converts to structured KB entry

Knowledge base
└── Flat list of entries stored in localStorage (browser) or artifact storage

User chatbot
└── Full conversation history + all KB entries injected into system prompt
    → Claude API call on each message
    → Streamed or returned response displayed in chat UI
```

---

## What Could Be Improved

### Knowledge Base & Retrieval

**Smarter retrieval (RAG)**
Right now the entire knowledge base is injected into every prompt. This works well up to ~50 entries but gets expensive and slower as the KB grows. The next step is semantic search: embed each KB entry as a vector, and at query time retrieve only the 3–5 most relevant entries to include. Tools like Pinecone, Supabase pgvector, or even a simple local embedding index make this straightforward.

**Versioned knowledge base**
Add a version tag to each KB entry and a version selector in the chat UI. Users on older versions of the app get answers that match what they're actually seeing, not the latest UI.

**Automatic staleness detection**
Flag KB entries that haven't been updated in N days, or that reference features that have since changed. Could be triggered as part of the changelog ingestion — Claude compares new changelog entries against existing KB entries and highlights conflicts.

**Structured schema per entry**
Rather than freeform text, give each KB entry a defined structure: feature name, location in UI, how to access it, keyboard shortcut, common issues, related features. This makes retrieval more precise and answers more consistent.

---

### Admin Experience

**Voice note transcription**
Currently, audio and video files are saved but require the developer to manually paste a transcript. Adding Whisper (OpenAI) or a similar transcription API would make voice notes fully automatic — record a memo about a new feature while testing it, upload it, done.

**In-app admin widget**
Embed a lightweight admin panel directly inside the video editor (accessible only to the developer). This would let you add KB entries without leaving the app — especially useful for capturing things like "I just moved this button" in the moment.

**Changelog auto-fetch**
Instead of pasting release notes, point the system at a GitHub releases URL or a public Notion changelog page. On a schedule (or triggered by a webhook on deploy), it fetches and ingests new entries automatically. Zero extra steps on ship day.

**Diff-aware updates**
When a new changelog is ingested, Claude compares it against existing KB entries and updates them in place rather than creating duplicates. Keeps the KB clean over time.

**Bulk import**
An importer for existing help documentation — Notion exports, Intercom articles, Zendesk knowledge base exports, or plain markdown folders. Useful for the initial setup phase when there's already a lot of content to bring in.

---

### User Chat Experience

**Streaming responses**
Responses currently appear all at once after processing. Streaming token-by-token (Claude's API supports this) makes the experience feel significantly faster and more conversational.

**Confidence signalling**
When the bot isn't sure, it should say so explicitly — and link to the relevant help article or suggest contacting support. Right now it relies on Claude's natural tendency to hedge; explicit instructions in the system prompt make this more reliable.

**Thumbs up / thumbs down feedback**
A simple feedback button on each response logs which questions the bot handled well and which it didn't. Over time this tells you exactly which KB entries need improving, rather than guessing.

**Suggested follow-up questions**
After each answer, surface 2–3 relevant follow-up questions the user might have. Reduces friction and helps users discover features they didn't know to ask about.

**Session memory**
Currently the conversation history resets on page refresh. Persisting recent sessions means users can pick up where they left off — useful for multi-step tasks like learning a new workflow.

**Onboarding question**
When a user first opens the chat, ask a single question: "What are you trying to do today?" This seeds the conversation with enough context that the first answer is already more relevant.

---

### Deployment & Infrastructure

**Backend proxy for the API key**
The current prototype calls the Anthropic API directly from the browser with a hardcoded key. Before any real deployment, this needs a thin backend (a single serverless function on Vercel, Netlify, or Cloudflare Workers) that holds the key server-side and proxies requests. This is a one-hour job.

**Rate limiting**
Without rate limiting, a single user could run up significant API costs. A simple per-session or per-IP request limit on the backend proxy prevents abuse.

**Dedicated URL**
Deploy the chatbot to a subdomain like `help.yourapp.com` or `chat.yourapp.com`. Easy to share, easy to link to from inside the main app, and keeps the admin panel at a separate protected URL.

**Admin authentication**
The admin panel needs a password or OAuth login before being exposed publicly. Even a simple hardcoded password is a significant improvement over no protection at all.

**Analytics**
Log every question asked (without PII) to understand what users are struggling with. Aggregate views of common questions directly inform both KB improvements and product decisions.

---

### Longer-Term Ideas

**Proactive help**
Rather than waiting for users to ask, the app could detect when a user has been idle on a feature for a while and have the chatbot proactively offer a tip. This requires the context instrumentation approach (where the app pushes state to the chatbot) but can be layered in later.

**Multi-language support**
Claude handles multiple languages well. Adding a language selector or auto-detecting the user's browser language means international users get answers in their own language without any extra content work.

**Integration with support tickets**
When the bot can't answer a question, offer to open a support ticket pre-filled with the conversation history. Reduces friction for the user and gives the support team full context.

**Automated KB testing**
A test suite that runs a set of known questions against the KB and checks that answers are correct and complete. Run it on every KB update to catch regressions before users do.
