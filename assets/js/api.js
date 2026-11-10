/**
 * REST API client for Storyboards.
 */

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
  updateBoard: (id, payload) => request(`/boards/${id}`, { method: 'PATCH', body: payload }),
  deleteBoard: (id) => request(`/boards/${id}`, { method: 'DELETE' }),
  listScenes: (boardId) => request(`/boards/${boardId}/scenes`),
  createScene: (boardId, payload) =>
    request(`/boards/${boardId}/scenes`, { method: 'POST', body: payload }),
  updateScene: (id, payload) => request(`/scenes/${id}`, { method: 'PATCH', body: payload }),
  deleteScene: (id) => request(`/scenes/${id}`, { method: 'DELETE' }),
  reorderScenes: (boardId, ids) =>
    request(`/boards/${boardId}/scenes/reorder`, { method: 'POST', body: { ids } }),
  uploadSceneImage: async (sceneId, blob, filename = 'scene.webp') => {
    const form = new FormData();
    form.append('file', blob, filename);
    return request(`/scenes/${sceneId}/image`, { method: 'POST', body: form });
  },
};
