import { api } from './api.js';
import { compressImage } from './compress.js';

const cfg = window.StoryboardsConfig;
const t = cfg.i18n;
const root = document.getElementById('sb-root');

const state = {
  view: 'boards', // boards | board
  boards: [],
  board: null,
  scenes: [],
  mode: 'list', // list | timeline
  sheet: null, // null | newBoard | editScene
  editingScene: null,
  sceneBaseline: null, // JSON snapshot for dirty checks
  boardDraft: { title: '', aspect_ratio: '16:9' },
  boardBaseline: null,
  pendingPhoto: null, // { blob, filename, previewUrl } | null
  removePhoto: false,
  loading: false,
  toastTimer: null,
  sheetHistoryPushed: false,
};

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function roleLabel(role) {
  if (role === 'b_roll') return t.bRoll;
  if (role === 'voiceover') return t.voiceover;
  return t.aRoll;
}

function aspectClass(aspect) {
  return aspect === '9:16' ? 'is-916' : 'is-169';
}

function totalDuration(scenes) {
  return scenes.reduce((sum, s) => sum + (s.duration_sec || 3), 0);
}

function formatTotal(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m === 0) return `${s}s`;
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function showToast(message) {
  const existing = document.querySelector('.sb-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.className = 'sb-toast';
  el.textContent = message;
  document.body.appendChild(el);
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => el.remove(), 2800);
}

function setLoading(v) {
  state.loading = v;
  render();
}

/* ---------- Render ---------- */

function render() {
  if (state.view === 'boards') {
    root.innerHTML = renderBoardsView();
  } else {
    root.innerHTML = renderBoardView();
  }

  if (state.sheet === 'newBoard') {
    root.insertAdjacentHTML('beforeend', renderNewBoardSheet());
  } else if (state.sheet === 'editScene') {
    root.insertAdjacentHTML('beforeend', renderSceneSheet());
  }

  bindEvents();
  if (state.view === 'board' && state.mode === 'list') {
    initSortable();
  }
}

function renderBoardsView() {
  const list =
    state.boards.length === 0
      ? `<p class="sb-empty">${esc(t.noBoards)}</p>`
      : `<div class="sb-board-list">${state.boards
          .map(
            (b) => `
        <div class="sb-board-item" data-action="open-board" data-id="${b.id}">
          <div class="sb-board-thumb ${aspectClass(b.aspect_ratio)}" aria-hidden="true"></div>
          <div class="sb-board-meta">
            <strong>${esc(b.title)}</strong>
            <span class="sb-badge">${esc(b.aspect_ratio)}</span>
          </div>
          <button type="button" class="sb-board-delete sb-icon-btn" data-action="delete-board" data-id="${b.id}" aria-label="${esc(t.delete)}">✕</button>
        </div>`
          )
          .join('')}</div>`;

  return `
    <header class="sb-header">
      <h1>${esc(t.appTitle)}</h1>
    </header>
    <main class="sb-main">${state.loading ? `<p class="sb-loading">…</p>` : list}</main>
    <button type="button" class="sb-fab" data-action="new-board">${esc(t.newBoard)}</button>
  `;
}

function renderBoardView() {
  const board = state.board;
  if (!board) {
    return `<main class="sb-main"><p class="sb-loading">…</p></main>`;
  }

  const total = totalDuration(state.scenes);
  const body =
    state.mode === 'timeline' ? renderTimeline() : renderSceneList();

  return `
    <header class="sb-header">
      <button type="button" class="sb-icon-btn" data-action="back" aria-label="${esc(t.back)}">←</button>
      <h1>${esc(board.title)}</h1>
      <button type="button" class="sb-icon-btn" data-action="delete-board" data-id="${board.id}" aria-label="${esc(t.delete)}">✕</button>
    </header>
    <main class="sb-main">
      <div class="sb-detail-meta">
        <span class="sb-badge">${esc(board.aspect_ratio)}</span>
        <span class="sb-dur">${esc(t.total)}: ${esc(formatTotal(total))}</span>
        <div class="sb-toggle" role="group" aria-label="View mode">
          <button type="button" data-action="mode" data-mode="list" class="${state.mode === 'list' ? 'is-active' : ''}">${esc(t.list)}</button>
          <button type="button" data-action="mode" data-mode="timeline" class="${state.mode === 'timeline' ? 'is-active' : ''}">${esc(t.timeline)}</button>
        </div>
      </div>
      ${state.loading ? `<p class="sb-loading">…</p>` : body}
    </main>
    ${
      state.mode === 'list'
        ? `<button type="button" class="sb-fab" data-action="add-scene">${esc(t.addScene)}</button>`
        : ''
    }
  `;
}

function renderSceneList() {
  if (!state.scenes.length) {
    return `<p class="sb-empty">${esc(t.noScenes)}</p>`;
  }

  const aspect = state.board.aspect_ratio;
  return `<ul class="sb-scene-list" id="sb-sortable">${state.scenes
    .map((s) => {
      const frame = `
        <div class="sb-frame ${aspectClass(aspect)}">
          ${
            s.image_url
              ? `<img src="${esc(s.image_url)}" alt="">`
              : `<span class="sb-frame-placeholder">${esc(t.photo)}</span>`
          }
        </div>`;
      return `
      <li class="sb-scene-card" data-id="${s.id}">
        <div class="sb-scene-handle" aria-label="Reorder">⠿</div>
        <button type="button" class="sb-scene-body ${aspectClass(aspect)}" data-action="edit-scene" data-id="${s.id}">
          ${frame}
          <div class="sb-scene-info">
            <h3>${esc(s.title)}</h3>
            <div class="sb-chips">
              <span class="sb-role ${esc(s.role)}">${esc(roleLabel(s.role))}</span>
              <span class="sb-dur">${s.duration_sec}s</span>
            </div>
            ${s.description ? `<p class="sb-scene-desc">${esc(s.description)}</p>` : ''}
          </div>
        </button>
      </li>`;
    })
    .join('')}</ul>`;
}

function renderTimeline() {
  if (!state.scenes.length) {
    return `<p class="sb-empty">${esc(t.noScenes)}</p>`;
  }

  const pxPerSec = 28;
  let cursor = 0;
  const placed = state.scenes.map((s) => {
    const dur = s.duration_sec || 3;
    const item = {
      ...s,
      start: cursor,
      dur,
      isDefault: !s.duration_sec,
    };
    cursor += dur;
    return item;
  });

  const width = Math.max(cursor * pxPerSec + 40, 320);
  const lanes = [
    { key: 'a_roll', label: t.laneA },
    { key: 'b_roll', label: t.laneB },
    { key: 'voiceover', label: t.laneVO },
  ];

  const lanesHtml = lanes
    .map((lane) => {
      const clips = placed
        .filter((s) => s.role === lane.key)
        .map(
          (s) => `
          <div class="sb-clip ${esc(s.role)} ${s.isDefault ? 'is-default' : ''}"
               style="left:${s.start * pxPerSec}px;width:${Math.max(s.dur * pxPerSec - 4, 28)}px"
               title="${esc(s.title)} (${s.dur}s)"
               data-action="edit-scene" data-id="${s.id}">
            ${esc(s.title)}
          </div>`
        )
        .join('');
      return `
        <div class="sb-lane">
          <div class="sb-lane-label">${esc(lane.label)}</div>
          <div class="sb-lane-track" style="width:${width}px">${clips}</div>
        </div>`;
    })
    .join('');

  return `
    <div class="sb-timeline-wrap">
      <div class="sb-timeline">${lanesHtml}</div>
    </div>
    <p class="sb-premium-hint" style="margin-top:12px">* ${esc(t.defaultDuration)} = 3s display fallback</p>
  `;
}

function renderNewBoardSheet() {
  const draft = state.boardDraft;
  const aspect = draft.aspect_ratio || '16:9';
  return `
    <div class="sb-overlay" role="dialog" aria-modal="true">
      <div class="sb-sheet" data-stop>
        <div class="sb-sheet-top">
          <div class="sb-sheet-handle"></div>
          <button type="button" class="sb-sheet-close sb-icon-btn" data-action="close-sheet" aria-label="${esc(t.close)}">✕</button>
        </div>
        <h2>${esc(t.newBoard)}</h2>
        <form id="sb-new-board-form">
          <div class="sb-field">
            <label for="sb-board-title">${esc(t.boardTitle)}</label>
            <input id="sb-board-title" name="title" required maxlength="200" autocomplete="off" placeholder="My video" value="${esc(draft.title || '')}">
          </div>
          <div class="sb-field">
            <label>${esc(t.aspectRatio)}</label>
            <div class="sb-segment sb-segment-2" id="sb-aspect-seg">
              <button type="button" data-aspect="16:9" class="${aspect === '16:9' ? 'is-active' : ''}">16:9</button>
              <button type="button" data-aspect="9:16" class="${aspect === '9:16' ? 'is-active' : ''}">9:16</button>
            </div>
            <input type="hidden" name="aspect_ratio" id="sb-aspect-input" value="${esc(aspect)}">
          </div>
          <div class="sb-sheet-actions">
            <button type="button" class="sb-btn" data-action="close-sheet">${esc(t.cancel)}</button>
            <button type="submit" class="sb-btn sb-btn-primary">${esc(t.create)}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function renderSceneSheet() {
  const scene = state.editingScene || {
    id: null,
    title_raw: '',
    description: '',
    script: '',
    role: 'a_roll',
    duration_sec: 3,
    image_url: null,
  };
  const aspect = state.board?.aspect_ratio || '16:9';
  const features = cfg.features || {};
  const previewUrl = state.pendingPhoto?.previewUrl || (!state.removePhoto && scene.image_url) || null;
  const isNew = !scene.id;

  return `
    <div class="sb-overlay" role="dialog" aria-modal="true">
      <div class="sb-sheet" data-stop>
        <div class="sb-sheet-top">
          <div class="sb-sheet-handle"></div>
          <button type="button" class="sb-sheet-close sb-icon-btn" data-action="close-sheet" aria-label="${esc(t.close)}">✕</button>
        </div>
        <h2>${esc(isNew ? t.addScene : scene.title)}</h2>
        <form id="sb-scene-form">
          <div class="sb-field">
            <label>${esc(t.photo)}</label>
            <div class="sb-photo-area">
              <div class="sb-photo-preview ${aspectClass(aspect)}">
                ${previewUrl ? `<img src="${esc(previewUrl)}" alt="">` : ''}
              </div>
              <div class="sb-row-actions">
                <label class="sb-btn">
                  ${esc(previewUrl ? t.changePhoto : t.addPhoto)}
                  <input type="file" id="sb-photo-input" accept="image/*" hidden>
                </label>
                ${
                  previewUrl
                    ? `<button type="button" class="sb-btn" data-action="remove-photo">${esc(t.removePhoto)}</button>`
                    : ''
                }
              </div>
            </div>
          </div>

          <div class="sb-field">
            <label for="sb-scene-title">${esc(t.title)}</label>
            <input id="sb-scene-title" name="title" maxlength="200" value="${esc(scene.title_raw || '')}" placeholder="Scene label">
          </div>

          <div class="sb-field">
            <label>${esc(t.role)}</label>
            <div class="sb-segment" id="sb-role-seg">
              <button type="button" data-role="a_roll" class="${scene.role === 'a_roll' ? 'is-active' : ''}">${esc(t.aRoll)}</button>
              <button type="button" data-role="b_roll" class="${scene.role === 'b_roll' ? 'is-active' : ''}">${esc(t.bRoll)}</button>
              <button type="button" data-role="voiceover" class="${scene.role === 'voiceover' ? 'is-active' : ''}">${esc(t.voiceover)}</button>
            </div>
            <input type="hidden" name="role" id="sb-role-input" value="${esc(scene.role)}">
          </div>

          <div class="sb-field">
            <label for="sb-scene-duration">${esc(t.duration)}</label>
            <input id="sb-scene-duration" name="duration_sec" type="number" min="1" max="600" value="${esc(scene.duration_sec || 3)}">
          </div>

          <div class="sb-field">
            <label for="sb-scene-desc">${esc(t.description)}</label>
            <textarea id="sb-scene-desc" name="description" rows="3">${esc(scene.description || '')}</textarea>
          </div>

          <div class="sb-premium-row">
            <button type="button" class="sb-premium-btn" ${features.ai_description ? '' : 'disabled aria-disabled="true"'} data-action="ai-desc">
              ${esc(t.generateDesc)}
            </button>
            <p class="sb-premium-hint">${esc(features.premium_hint || 'Premium — coming soon')}</p>
          </div>

          <div class="sb-field">
            <label for="sb-scene-script">${esc(t.script)}</label>
            <textarea id="sb-scene-script" name="script" rows="3">${esc(scene.script || '')}</textarea>
          </div>

          <div class="sb-premium-row">
            <button type="button" class="sb-premium-btn" ${features.ai_script ? '' : 'disabled aria-disabled="true"'} data-action="ai-script">
              ${esc(t.generateScript)}
            </button>
            <button type="button" class="sb-premium-btn" ${features.ai_image ? '' : 'disabled aria-disabled="true"'} data-action="ai-image">
              ${esc(t.generateImage)}
            </button>
          </div>

          <div class="sb-sheet-actions">
            <button type="button" class="sb-btn" data-action="close-sheet">${esc(t.cancel)}</button>
            ${
              !isNew
                ? `<button type="button" class="sb-btn sb-btn-danger" data-action="delete-scene" data-id="${scene.id}">${esc(t.delete)}</button>`
                : ''
            }
            <button type="submit" class="sb-btn sb-btn-primary">${esc(t.save)}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

/* ---------- Draft / dirty / history ---------- */

function emptySceneDraft() {
  return {
    id: null,
    title: 'New scene',
    title_raw: '',
    description: '',
    script: '',
    role: 'a_roll',
    duration_sec: 3,
    image_url: null,
    image_id: null,
  };
}

function sceneSnapshot(scene) {
  return JSON.stringify({
    title_raw: scene?.title_raw || '',
    description: scene?.description || '',
    script: scene?.script || '',
    role: scene?.role || 'a_roll',
    duration_sec: Number(scene?.duration_sec) || 3,
    removePhoto: !!state.removePhoto,
    hasPendingPhoto: !!state.pendingPhoto,
  });
}

function boardSnapshot(draft) {
  return JSON.stringify({
    title: (draft?.title || '').trim(),
    aspect_ratio: draft?.aspect_ratio || '16:9',
  });
}

function syncFormsIntoState() {
  const boardForm = root.querySelector('#sb-new-board-form');
  if (boardForm) {
    state.boardDraft = {
      title: boardForm.title.value,
      aspect_ratio: boardForm.aspect_ratio.value || '16:9',
    };
  }

  const sceneForm = root.querySelector('#sb-scene-form');
  if (sceneForm && state.editingScene) {
    state.editingScene = {
      ...state.editingScene,
      title_raw: sceneForm.title.value,
      description: sceneForm.description.value,
      script: sceneForm.script.value,
      role: sceneForm.role.value,
      duration_sec: Number(sceneForm.duration_sec.value) || 3,
    };
  }
}

function isSheetDirty() {
  syncFormsIntoState();
  if (state.sheet === 'newBoard') {
    return boardSnapshot(state.boardDraft) !== state.boardBaseline;
  }
  if (state.sheet === 'editScene') {
    return sceneSnapshot(state.editingScene) !== state.sceneBaseline;
  }
  return false;
}

function pushSheetHistory() {
  if (state.sheetHistoryPushed) return;
  history.pushState({ storyboardsSheet: true }, '');
  state.sheetHistoryPushed = true;
}

function clearSheetHistoryFlag() {
  state.sheetHistoryPushed = false;
}

function openSheet(type) {
  state.sheet = type;
  pushSheetHistory();
  render();
}

function discardSheetState() {
  cleanupPendingPhoto();
  state.sheet = null;
  state.editingScene = null;
  state.sceneBaseline = null;
  state.boardDraft = { title: '', aspect_ratio: '16:9' };
  state.boardBaseline = null;
  state.removePhoto = false;
}

function closeSheet({ force = false, fromPopstate = false } = {}) {
  if (!force && isSheetDirty()) {
    if (!confirm(t.confirmDiscard)) {
      if (fromPopstate) {
        pushSheetHistory();
      }
      return false;
    }
  }

  discardSheetState();
  clearSheetHistoryFlag();
  if (!fromPopstate && history.state?.storyboardsSheet) {
    history.back();
  }
  render();
  return true;
}

function onPopState() {
  if (!state.sheet) {
    clearSheetHistoryFlag();
    return;
  }
  // Android/iOS back while editing — confirm instead of silently losing data.
  closeSheet({ fromPopstate: true });
}

/* ---------- Events ---------- */

function bindEvents() {
  root.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', onActionClick);
  });

  const newBoardForm = root.querySelector('#sb-new-board-form');
  if (newBoardForm) {
    newBoardForm.addEventListener('submit', onCreateBoard);
    newBoardForm.addEventListener('input', syncFormsIntoState);
    root.querySelectorAll('#sb-aspect-seg [data-aspect]').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('#sb-aspect-seg [data-aspect]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        root.querySelector('#sb-aspect-input').value = btn.dataset.aspect;
        syncFormsIntoState();
      });
    });
  }

  const sceneForm = root.querySelector('#sb-scene-form');
  if (sceneForm) {
    sceneForm.addEventListener('submit', onSaveScene);
    sceneForm.addEventListener('input', syncFormsIntoState);
    root.querySelectorAll('#sb-role-seg [data-role]').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('#sb-role-seg [data-role]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        root.querySelector('#sb-role-input').value = btn.dataset.role;
        syncFormsIntoState();
      });
    });
    const photoInput = root.querySelector('#sb-photo-input');
    if (photoInput) {
      photoInput.addEventListener('change', onPhotoSelected);
    }
  }
}

async function onActionClick(e) {
  const el = e.currentTarget;
  const action = el.dataset.action;

  if (action === 'new-board') {
    state.boardDraft = { title: '', aspect_ratio: '16:9' };
    state.boardBaseline = boardSnapshot(state.boardDraft);
    openSheet('newBoard');
    return;
  }

  if (action === 'close-sheet') {
    closeSheet();
    return;
  }

  if (action === 'open-board') {
    e.stopPropagation();
    await openBoard(Number(el.dataset.id));
    return;
  }

  if (action === 'delete-board') {
    e.stopPropagation();
    e.preventDefault();
    const id = Number(el.dataset.id);
    if (!confirm(t.confirmDeleteBoard)) return;
    try {
      await api.deleteBoard(id);
      if (state.view === 'board' && state.board?.id === id) {
        state.view = 'boards';
        state.board = null;
        state.scenes = [];
      }
      await loadBoards();
      showToast('Deleted');
    } catch (err) {
      showToast(err.message || t.errorGeneric);
    }
    return;
  }

  if (action === 'back') {
    if (state.sheet) {
      closeSheet();
      return;
    }
    state.view = 'boards';
    state.board = null;
    state.scenes = [];
    state.mode = 'list';
    await loadBoards();
    return;
  }

  if (action === 'mode') {
    state.mode = el.dataset.mode;
    render();
    return;
  }

  if (action === 'add-scene') {
    cleanupPendingPhoto();
    state.removePhoto = false;
    state.pendingPhoto = null;
    state.editingScene = emptySceneDraft();
    state.sceneBaseline = sceneSnapshot(state.editingScene);
    openSheet('editScene');
    return;
  }

  if (action === 'edit-scene') {
    const id = Number(el.dataset.id);
    const scene = state.scenes.find((s) => s.id === id);
    if (!scene) return;
    cleanupPendingPhoto();
    state.removePhoto = false;
    state.pendingPhoto = null;
    state.editingScene = { ...scene };
    state.sceneBaseline = sceneSnapshot(state.editingScene);
    openSheet('editScene');
    return;
  }

  if (action === 'delete-scene') {
    const id = Number(el.dataset.id);
    if (!confirm(t.confirmDeleteScene)) return;
    try {
      await api.deleteScene(id);
      discardSheetState();
      clearSheetHistoryFlag();
      if (history.state?.storyboardsSheet) {
        history.back();
      }
      await refreshBoard();
      showToast('Deleted');
    } catch (err) {
      showToast(err.message || t.errorGeneric);
    }
    return;
  }

  if (action === 'remove-photo') {
    syncFormsIntoState();
    cleanupPendingPhoto();
    state.pendingPhoto = null;
    state.removePhoto = true;
    render();
    return;
  }

  if (action === 'ai-desc' || action === 'ai-script' || action === 'ai-image') {
    showToast(cfg.features?.premium_hint || 'Premium — coming soon');
  }
}

async function onCreateBoard(e) {
  e.preventDefault();
  syncFormsIntoState();
  const title = state.boardDraft.title.trim();
  const aspect_ratio = state.boardDraft.aspect_ratio;
  if (!title) return;

  try {
    const board = await api.createBoard({ title, aspect_ratio });
    discardSheetState();
    clearSheetHistoryFlag();
    if (history.state?.storyboardsSheet) {
      history.back();
    }
    await openBoard(board.id);
  } catch (err) {
    showToast(err.message || t.errorGeneric);
  }
}

async function onPhotoSelected(e) {
  const file = e.target.files?.[0];
  if (!file) return;

  syncFormsIntoState();

  try {
    showToast(t.compressing);
    const result = await compressImage(file);
    cleanupPendingPhoto();
    state.pendingPhoto = {
      blob: result.blob,
      filename: result.filename,
      previewUrl: URL.createObjectURL(result.blob),
    };
    state.removePhoto = false;
    render();
  } catch (err) {
    showToast(err.message || t.errorGeneric);
  }
}

async function onSaveScene(e) {
  e.preventDefault();
  syncFormsIntoState();
  const scene = state.editingScene;
  const payload = {
    title: (scene.title_raw || '').trim(),
    description: scene.description || '',
    script: scene.script || '',
    role: scene.role || 'a_roll',
    duration_sec: Number(scene.duration_sec) || 3,
  };

  try {
    let saved;
    if (scene.id) {
      if (state.removePhoto && !state.pendingPhoto) {
        payload.image_id = null;
      }
      saved = await api.updateScene(scene.id, payload);
    } else {
      saved = await api.createScene(state.board.id, payload);
    }

    if (state.pendingPhoto) {
      showToast(t.uploading);
      saved = await api.uploadSceneImage(
        saved.id,
        state.pendingPhoto.blob,
        state.pendingPhoto.filename
      );
    }

    discardSheetState();
    clearSheetHistoryFlag();
    if (history.state?.storyboardsSheet) {
      history.back();
    }
    await refreshBoard();
  } catch (err) {
    showToast(err.message || t.errorGeneric);
  }
}

function cleanupPendingPhoto() {
  if (state.pendingPhoto?.previewUrl) {
    URL.revokeObjectURL(state.pendingPhoto.previewUrl);
  }
  state.pendingPhoto = null;
}

function initSortable() {
  const el = document.getElementById('sb-sortable');
  if (!el || typeof Sortable === 'undefined') return;

  Sortable.create(el, {
    handle: '.sb-scene-handle',
    animation: 150,
    ghostClass: 'sb-sortable-ghost',
    delay: 120,
    delayOnTouchOnly: true,
    onEnd: async () => {
      const ids = [...el.querySelectorAll('.sb-scene-card')].map((n) => Number(n.dataset.id));
      try {
        state.scenes = await api.reorderScenes(state.board.id, ids);
      } catch (err) {
        showToast(err.message || t.errorGeneric);
        await refreshBoard();
      }
    },
  });
}

/* ---------- Data ---------- */

async function loadBoards() {
  setLoading(true);
  try {
    state.boards = await api.listBoards();
  } catch (err) {
    showToast(err.message || t.errorGeneric);
    state.boards = [];
  } finally {
    state.loading = false;
    render();
  }
}

async function openBoard(id) {
  setLoading(true);
  try {
    const data = await api.getBoard(id);
    state.board = {
      id: data.id,
      title: data.title,
      aspect_ratio: data.aspect_ratio,
    };
    state.scenes = data.scenes || [];
    state.view = 'board';
    state.mode = 'list';
    state.sheet = null;
  } catch (err) {
    showToast(err.message || t.errorGeneric);
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshBoard() {
  if (!state.board) return;
  try {
    const data = await api.getBoard(state.board.id);
    state.board = {
      id: data.id,
      title: data.title,
      aspect_ratio: data.aspect_ratio,
    };
    state.scenes = data.scenes || [];
  } catch (err) {
    showToast(err.message || t.errorGeneric);
  }
  render();
}

/* ---------- Boot ---------- */

window.addEventListener('popstate', onPopState);
window.addEventListener('beforeunload', (e) => {
  if (state.sheet && isSheetDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

loadBoards();
