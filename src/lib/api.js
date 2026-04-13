const BASE = '';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json();
}

// --- Auth ---
export const auth = {
  login: (password) => request('/api/auth/login', { method: 'POST', body: JSON.stringify({ password }) }),
  logout: () => request('/api/auth/logout', { method: 'POST' }),
  status: () => request('/api/auth/status'),
};

// --- KB ---
export const kb = {
  list: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/kb${qs ? `?${qs}` : ''}`);
  },
  get: (id) => request(`/api/kb/${id}`),
  create: (entry) => request('/api/kb', { method: 'POST', body: JSON.stringify(entry) }),
  update: (id, entry) => request(`/api/kb/${id}`, { method: 'PUT', body: JSON.stringify(entry) }),
  delete: (id) => request(`/api/kb/${id}`, { method: 'DELETE' }),

  processUpload: (formData) => fetch('/api/kb/process-upload', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  }).then(async (r) => {
    if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || r.status); }
    return r.json();
  }),

  processChangelog: (text, version) =>
    request('/api/kb/process-changelog', { method: 'POST', body: JSON.stringify({ text, version }) }),

  processDescription: (text, version) =>
    request('/api/kb/process-description', { method: 'POST', body: JSON.stringify({ text, version }) }),

  bulkImport: (formData) => fetch('/api/kb/bulk-import', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  }).then(async (r) => {
    if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || r.status); }
    return r.json();
  }),

  fetchChangelog: (url) =>
    request('/api/kb/fetch-changelog', { method: 'POST', body: JSON.stringify({ url }) }),

  checkStaleness: () =>
    request('/api/kb/check-staleness', { method: 'POST' }),

  getVersions: () => request('/api/kb/meta/versions'),
};

// --- Chat ---
export const chat = {
  stream: (message, sessionId, version, language) => {
    return fetch('/api/chat/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, sessionId, version, language }),
    });
  },

  getSession: (sessionId) => request(`/api/chat/sessions/${sessionId}`),

  feedback: (messageId, analyticsId, feedback) =>
    request('/api/chat/feedback', {
      method: 'PATCH',
      body: JSON.stringify({ messageId, analyticsId, feedback }),
    }),

  escalate: (sessionId, summary) =>
    request('/api/chat/escalate', {
      method: 'POST',
      body: JSON.stringify({ sessionId, summary }),
    }),
};

// --- Admin Chat ---
export const adminChat = {
  stream: (message) => {
    return fetch('/api/admin-chat/stream', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message }),
    });
  },

  history: () => request('/api/admin-chat/history'),

  clear: () => request('/api/admin-chat/clear', { method: 'POST' }),
};

// --- Analytics ---
export const analytics = {
  summary: () => request('/api/analytics/summary'),
  unanswered: () => request('/api/analytics/unanswered'),
  questions: (limit) => request(`/api/analytics/questions?limit=${limit || 50}`),
  tickets: (status) => request(`/api/analytics/tickets?status=${status || 'open'}`),
  updateTicket: (id, status) =>
    request(`/api/analytics/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) }),
  getTests: () => request('/api/analytics/tests'),
  createTest: (question, expected_answer) =>
    request('/api/analytics/tests', { method: 'POST', body: JSON.stringify({ question, expected_answer }) }),
  deleteTest: (id) => request(`/api/analytics/tests/${id}`, { method: 'DELETE' }),
  runTests: () => request('/api/analytics/tests/run', { method: 'POST' }),
  getSettings: () => request('/api/analytics/settings'),
  updateSettings: (settings) =>
    request('/api/analytics/settings', { method: 'PUT', body: JSON.stringify(settings) }),
};
