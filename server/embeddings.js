import { supabase } from './db.js';

const VOYAGE_API_KEY = process.env.VOYAGE_API_KEY;
const EMBEDDING_ENABLED = !!VOYAGE_API_KEY;

if (EMBEDDING_ENABLED) {
  console.log('[Embeddings] Voyage AI semantic search enabled');
} else {
  console.log('[Embeddings] Voyage AI not configured — using PostgreSQL full-text search only');
}

export async function generateEmbedding(text) {
  if (!EMBEDDING_ENABLED) return null;

  const response = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${VOYAGE_API_KEY}`,
    },
    body: JSON.stringify({ input: [text], model: 'voyage-3' }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Voyage AI embedding failed (${response.status}): ${body}`);
  }

  const result = await response.json();
  return result.data[0].embedding;
}

export async function semanticSearch(queryText, { version = null, limit = 5 } = {}) {
  if (!EMBEDDING_ENABLED) {
    return fullTextSearch(queryText, { version, limit });
  }

  const embedding = await generateEmbedding(queryText);

  const filterVersion = (version && version !== 'all') ? version : null;

  const { data, error } = await supabase
    .rpc('match_kb_entries', {
      query_embedding: embedding,
      match_count: limit,
      filter_version: filterVersion,
    });

  if (error) throw new Error(`Semantic search failed: ${error.message}`);

  const ftsResults = await fullTextSearch(queryText, { version, limit });

  return deduplicateResults(data || [], ftsResults, limit);
}

export async function fullTextSearch(queryText, { version = null, limit = 5 } = {}) {
  const searchTerms = queryText
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(t => t.length > 1)
    .join(' | ');

  if (!searchTerms) return [];

  let query = supabase
    .from('kb_entries')
    .select('*')
    .textSearch('title_content_fts', searchTerms, { type: 'plain', config: 'english' });

  if (version && version !== 'all') {
    query = query.in('version', [version, 'latest']);
  }

  const { data, error } = await query.limit(limit);
  if (error) throw new Error(`Full-text search failed: ${error.message}`);

  return data || [];
}

function deduplicateResults(semanticResults, ftsResults, limit) {
  const seen = new Set();
  const merged = [];

  for (const entry of semanticResults) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      merged.push(entry);
    }
  }

  for (const entry of ftsResults) {
    if (!seen.has(entry.id)) {
      seen.add(entry.id);
      merged.push(entry);
    }
  }

  return merged.slice(0, limit);
}

export async function embedAndStoreEntry(entryId, text) {
  if (!EMBEDDING_ENABLED) return;

  const embedding = await generateEmbedding(text);
  if (!embedding) throw new Error(`Failed to generate embedding for entry ${entryId}`);

  const { error } = await supabase
    .from('kb_entries')
    .update({ embedding })
    .eq('id', entryId);

  if (error) throw new Error(`Failed to store embedding: ${error.message}`);
}
