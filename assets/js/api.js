/**
 * REST API client for Storyboards.
 */

import { transcodeFcpZipAudio } from 'storyboards-fcp-zip';

const config = () => window.StoryboardsConfig;

async function request(path, options = {}) {
  const { restUrl, nonce } = config();
  const headers = {
    'X-WP-Nonce': nonce,
    ...(options.headers || {}),
  };

  if (options.body && !(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }

  const res = await fetch(`${restUrl}${path}`, {
    credentials: 'same-origin',
    ...options,
    headers,
  });

  let data = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { message: text };
    }
  }

  if (!res.ok) {
    const message =
      (data && (data.message || data.code)) ||
      config().i18n.errorGeneric;
    const err = new Error(typeof message === 'string' ? message : config().i18n.errorGeneric);
    err.status = res.status;
    err.data = data;
    throw err;
  }

  return data;
}

export const api = {
  listBoards: () => request('/boards'),
  createBoard: (payload) => request('/boards', { method: 'POST', body: payload }),
  getBoard: (id) => request(`/boards/${id}`),
  getBoardBySlug: (slug) => request(`/boards/by-slug/${encodeURIComponent(slug)}`),
  updateBoard: (id, payload) => request(`/boards/${id}`, { method: 'PATCH', body: payload }),
  deleteBoard: (id) => request(`/boards/${id}`, { method: 'DELETE' }),
  listScenes: (boardId) => request(`/boards/${boardId}/scenes`),
  createScene: (boardId, payload) =>
    request(`/boards/${boardId}/scenes`, { method: 'POST', body: payload }),
  updateScene: (id, payload) => request(`/scenes/${id}`, { method: 'PATCH', body: payload }),
  deleteScene: (id) => request(`/scenes/${id}`, { method: 'DELETE' }),
  reorderScenes: (boardId, ids) =>
    request(`/boards/${boardId}/scenes/reorder`, { method: 'POST', body: { ids } }),
  bulkDeleteScenes: (boardId, ids) =>
    request(`/boards/${boardId}/scenes/bulk-delete`, { method: 'POST', body: { ids } }),
  uploadSceneImage: async (sceneId, blob, filename = 'scene.webp') => {
    const form = new FormData();
    form.append('file', blob, filename);
    return request(`/scenes/${sceneId}/image`, { method: 'POST', body: form });
  },
  listAudio: (boardId) => request(`/boards/${boardId}/audio`),
  createAudio: async (boardId, { blob, filename, title, start_sec, duration_sec, track }) => {
    const form = new FormData();
    form.append('file', blob, filename || 'voiceover.webm');
    if (title) form.append('title', title);
    if (start_sec != null) form.append('start_sec', String(start_sec));
    if (duration_sec != null) form.append('duration_sec', String(duration_sec));
    if (track != null) form.append('track', String(track));
    return request(`/boards/${boardId}/audio`, { method: 'POST', body: form });
  },
  updateAudio: (id, payload) => request(`/audio/${id}`, { method: 'PATCH', body: payload }),
  deleteAudio: (id) => request(`/audio/${id}`, { method: 'DELETE' }),

  /**
   * Download NLE export (premiere | fcp | fcp-media).
   * @param {number} boardId
   * @param {'premiere'|'fcp'|'fcp-media'} format
   */
  exportBoard: async (boardId, format) => {
    const { restUrl, nonce, i18n } = config();
    const res = await fetch(
      `${restUrl}/boards/${boardId}/export?format=${encodeURIComponent(format)}`,
      {
        credentials: 'same-origin',
        headers: { 'X-WP-Nonce': nonce },
      }
    );

    if (!res.ok) {
      let message = i18n.errorGeneric;
      try {
        const data = await res.json();
        if (data && data.message) message = data.message;
      } catch {
        /* ignore */
      }
      const err = new Error(message);
      err.status = res.status;
      throw err;
    }

    let blob = await res.blob();
    let filename =
      format === 'fcp-media'
        ? 'storyboard-fcpx.zip'
        : format === 'fcp'
          ? 'storyboard.fcpxml'
          : 'storyboard-premiere.xml';
    const disposition = res.headers.get('Content-Disposition') || '';
    const match = /filename="([^"]+)"/i.exec(disposition);
    if (match && match[1]) filename = match[1];

    // FCP rejects WebM — re-encode Media/_source to WAV before download.
    if (format === 'fcp-media') {
      try {
        blob = await transcodeFcpZipAudio(blob);
      } catch {
        /* ZIP still imports with silent WAV stubs */
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
