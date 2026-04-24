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

function uploadWithProgress(url, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress({ loaded: e.loaded, total: e.total });
      }
    };

    xhr.onload = () => {
      const headers = {};
      xhr.getAllResponseHeaders().trim().split('\r\n').forEach((line) => {
        const [key, ...rest] = line.split(': ');
        if (key) headers[key.toLowerCase()] = rest.join(': ');
      });

      resolve(new Response(xhr.responseText, {
        status: xhr.status,
        statusText: xhr.statusText,
        headers,
      }));
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.ontimeout = () => reject(new Error('Upload timed out'));

    xhr.send(formData);
  });
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
  listMedia: () => request('/api/kb/media'),
  removeFile: (id) => request(`/api/kb/${id}/remove-file`, { method: 'POST' }),
  clearStale: (id) => request(`/api/kb/${id}/clear-stale`, { method: 'POST' }),

  processUpload: (formData, onProgress) =>
    uploadWithProgress('/api/kb/process-upload', formData, onProgress).then(async (r) => {
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

  uploadVideo: (formData, onProgress) =>
    uploadWithProgress('/api/kb/upload-video', formData, onProgress).then(async (r) => {
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || r.status); }
      return r.json();
    }),

  processVideo: (body) =>
    request('/api/kb/process-video', { method: 'POST', body: JSON.stringify(body) }),

  getVideoJobStatus: (jobId) =>
    request(`/api/kb/process-video/${jobId}`),

  audit: () => fetch('/api/kb/audit', {
    method: 'POST',
    credentials: 'include',
  }),

  getVersions: () => request('/api/kb/meta/versions'),
};

// --- Chat ---
export const chat = {
  stream: (message, sessionId, version, language, file) => {
    if (file) {
      const formData = new FormData();
      formData.append('message', message);
      formData.append('sessionId', sessionId);
      formData.append('version', version);
      formData.append('language', language);
      formData.append('file', file);
      return fetch('/api/chat/stream', { method: 'POST', credentials: 'include', body: formData });
    }
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
  stream: (message, files) => {
    const formData = new FormData();
    formData.append('message', message || '');
    if (files?.length) {
      for (const file of files) {
        formData.append('files', file);
      }
    }
    return fetch('/api/admin-chat/stream', {
      method: 'POST',
      credentials: 'include',
      body: formData,
    });
  },

  history: () => request('/api/admin-chat/history'),

  clear: () => request('/api/admin-chat/clear', { method: 'POST' }),
};

// --- Tutorials (Gallery) ---
export const tutorials = {
  list: () => request('/api/tutorials'),
  listAdmin: () => request('/api/tutorials/admin'),
  create: (data) => request('/api/tutorials', { method: 'POST', body: JSON.stringify(data) }),
  update: (id, data) => request(`/api/tutorials/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id) => request(`/api/tutorials/${id}`, { method: 'DELETE' }),
  reorder: (items) => request('/api/tutorials/reorder', { method: 'POST', body: JSON.stringify({ items }) }),

  uploadVideo: (formData, onProgress) =>
    uploadWithProgress('/api/tutorials/upload-video', formData, onProgress).then(async (r) => {
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || r.status); }
      return r.json();
    }),

  uploadThumbnail: (formData, onProgress) =>
    uploadWithProgress('/api/tutorials/upload-thumbnail', formData, onProgress).then(async (r) => {
      if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || r.status); }
      return r.json();
    }),
};

// --- FAQ ---
export const faq = {
  list: () => request('/api/faq'),
  refresh: () => fetch('/api/faq/refresh', {
    method: 'POST',
    credentials: 'include',
  }),
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
