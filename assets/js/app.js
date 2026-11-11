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
  sheet: null, // null | newBoard | editScene | confirmDeleteBoard
  pendingDeleteBoard: null, // { id, title, sceneCount, code }
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

/* ---------- Routing ---------- */

function appBasePath() {
  try {
    const path = new URL(cfg.appBase || '/storyboards/', window.location.origin).pathname;
    return path.endsWith('/') ? path : `${path}/`;
  } catch {
    return '/storyboards/';
  }
}

function boardUrl(slug) {
  const clean = String(slug || '').replace(/^\/+|\/+$/g, '');
  if (!clean) return cfg.appBase || appBasePath();
  try {
    return new URL(`${clean}/`, cfg.appBase || window.location.origin + appBasePath()).href;
  } catch {
    return `${appBasePath()}${encodeURIComponent(clean)}/`;
  }
}

function parseBoardSlugFromLocation() {
  const base = appBasePath();
  let path = window.location.pathname || '/';
  if (!path.endsWith('/')) path += '/';
  if (!path.startsWith(base)) return '';
  const rest = path.slice(base.length).replace(/\/+$/, '');
  if (!rest || rest.includes('/')) return '';
  try {
    return decodeURIComponent(rest);
  } catch {
    return rest;
  }
}

function setDocumentTitle(boardTitle) {
  const app = t.appTitle || 'Storyboards';
  document.title = boardTitle ? `${boardTitle} · ${app}` : app;
}

function applyBoardData(data, { resetUi = true } = {}) {
  state.board = {
    id: data.id,
    title: data.title,
    slug: data.slug || '',
    url: data.url || boardUrl(data.slug),
    aspect_ratio: data.aspect_ratio,
  };
  state.scenes = data.scenes || [];
  if (resetUi) {
    state.view = 'board';
    state.mode = 'list';
    state.sheet = null;
  }
  setDocumentTitle(data.title);
}

function navigateBoardsUrl({ replace = false } = {}) {
  const url = cfg.appBase || appBasePath();
  const hist = { storyboardsView: 'boards' };
  if (replace) {
    history.replaceState(hist, '', url);
  } else {
    history.pushState(hist, '', url);
  }
}

function navigateBoardUrl(slug, { replace = false } = {}) {
  if (!slug) return;
  const url = boardUrl(slug);
  const hist = { storyboardsView: 'board', slug };
  if (replace) {
    history.replaceState(hist, '', url);
  } else {
    history.pushState(hist, '', url);
  }
}

async function goToBoards({ fromHistory = false } = {}) {
  state.view = 'boards';
  state.board = null;
  state.scenes = [];
  state.mode = 'list';
  state.sheet = null;
  setDocumentTitle('');
  if (!fromHistory) {
    navigateBoardsUrl();
  }
  await loadBoards();
}

async function syncViewFromLocation() {
  const slug = parseBoardSlugFromLocation();
  if (slug) {
    if (state.view === 'board' && state.board?.slug === slug) {
      return;
    }
    await openBoardBySlug(slug, { push: false });
    return;
  }
  if (state.view !== 'boards') {
    await goToBoards({ fromHistory: true });
  }
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
  } else if (state.sheet === 'confirmDeleteBoard') {
    root.insertAdjacentHTML('beforeend', renderConfirmDeleteBoard());
  }

  bindEvents();
  if (state.view === 'board' && state.mode === 'list') {
    initSortable();
  }
}

function sceneCountLabel(count) {
  const n = Number(count) || 0;
  if (n === 1) return t.sceneOne;
  return (t.scenesCount || '%d scenes').replace('%d', String(n));
}

function renderBoardsView() {
  const boards = state.boards
    .map(
      (b) => `
        <button type="button" class="sb-board-tile" data-action="open-board" data-id="${b.id}">
          <div class="sb-board-frame ${aspectClass(b.aspect_ratio)}" aria-hidden="true">
            <div class="sb-frame-badges">
              <span class="sb-frame-badge">${esc(b.aspect_ratio)}</span>
              <span class="sb-frame-badge">${esc(formatTotal(b.total_duration_sec || 0))}</span>
            </div>
          </div>
          <div class="sb-board-meta">
            <strong>${esc(b.title)}</strong>
            <p class="sb-board-stats-line">${esc(sceneCountLabel(b.scene_count))}</p>
          </div>
        </button>`
    )
    .join('');

  const addTile = `
    <button type="button" class="sb-board-tile sb-board-add" data-action="new-board">
      <div class="sb-board-frame is-169" aria-hidden="true">
        <span class="sb-frame-placeholder sb-frame-add-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </span>
      </div>
      <div class="sb-board-meta">
        <strong>${esc(t.newBoard)}</strong>
      </div>
    </button>`;

  const list = `<div class="sb-board-list">${boards}${addTile}</div>`;

  return `
    <header class="sb-header">
      <h1>${esc(t.appTitle)}</h1>
    </header>
    <main class="sb-main">${state.loading ? `<p class="sb-loading">…</p>` : list}</main>
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
      <button type="button" class="sb-header-delete" data-action="delete-board" data-id="${board.id}">${esc(t.delete)}</button>
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
  `;
}

function renderSceneList() {
  const aspect = state.board.aspect_ratio;
  const cards = state.scenes
    .map((s) => {
      return `
      <li class="sb-scene-card" data-id="${s.id}">
        <div class="sb-scene-handle" aria-label="Reorder">⠿</div>
        <button type="button" class="sb-scene-tile" data-action="edit-scene" data-id="${s.id}">
          <div class="sb-frame ${aspectClass(aspect)}">
            ${
              s.image_url
                ? `<img src="${esc(s.image_url)}" alt="">`
                : `<span class="sb-frame-placeholder">${esc(t.photo)}</span>`
            }
            <div class="sb-frame-badges">
              <span class="sb-frame-badge role-${esc(s.role)}">${esc(roleLabel(s.role))}</span>
              <span class="sb-frame-badge">${esc(String(s.duration_sec))}s</span>
            </div>
          </div>
          <div class="sb-scene-info">
            <h4>${esc(s.title)}</h4>
            ${s.description ? `<p class="sb-scene-desc">${esc(s.description)}</p>` : ''}
          </div>
        </button>
      </li>`;
    })
    .join('');

  const addTile = `
    <li class="sb-scene-card sb-scene-add">
      <button type="button" class="sb-scene-tile" data-action="add-scene">
        <div class="sb-frame ${aspectClass(aspect)}">
          <span class="sb-frame-placeholder sb-frame-add-icon" aria-hidden="true">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14"/>
            </svg>
          </span>
        </div>
        <div class="sb-scene-info">
          <h4>${esc(t.addScene)}</h4>
        </div>
      </button>
    </li>`;

  return `<ul class="sb-scene-list ${aspectClass(aspect)}" id="sb-sortable">${cards}${addTile}</ul>`;
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

function makeDeleteCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

function renderConfirmDeleteBoard() {
  const pending = state.pendingDeleteBoard;
  if (!pending) return '';

  const count = Number(pending.sceneCount) || 0;
  let scenesLine = '';
  if (count === 1) {
    scenesLine = t.confirmDeleteBoardOneScene;
  } else if (count > 1) {
    scenesLine = (t.confirmDeleteBoardScenes || '%d scenes will be removed.').replace('%d', String(count));
  }

  return `
    <div class="sb-overlay" role="dialog" aria-modal="true" aria-labelledby="sb-delete-board-title">
      <div class="sb-sheet sb-sheet-confirm" data-stop>
        <div class="sb-sheet-top">
          <button type="button" class="sb-sheet-close sb-icon-btn" data-action="cancel-delete-board" aria-label="${esc(t.close)}">✕</button>
        </div>
        <h2 id="sb-delete-board-title">${esc(t.confirmDeleteBoardTitle)}</h2>
        <div class="sb-sheet-confirm-body">
          <p class="sb-confirm-lead"><strong>${esc(pending.title)}</strong></p>
          <p class="sb-confirm-body">${esc(t.confirmDeleteBoardBody)}</p>
          ${scenesLine ? `<p class="sb-confirm-warn">${esc(scenesLine)}</p>` : ''}
          <div class="sb-field">
            <label for="sb-delete-code-input">${esc(t.confirmDeleteCodeLabel)}</label>
            <div class="sb-delete-code-row">
              <span class="sb-delete-code" aria-hidden="true">${esc(pending.code)}</span>
              <input
                id="sb-delete-code-input"
                name="delete_code"
                type="text"
                inputmode="numeric"
                pattern="[0-9]*"
                maxlength="4"
                autocomplete="off"
                autocapitalize="off"
                spellcheck="false"
                placeholder="••••"
              >
            </div>
            <p class="sb-confirm-error" id="sb-delete-code-error" hidden>${esc(t.confirmDeleteCodeMismatch)}</p>
          </div>
          <div class="sb-sheet-actions">
            <button type="button" class="sb-btn" data-action="cancel-delete-board">${esc(t.cancel)}</button>
            <button type="button" class="sb-btn sb-btn-danger" id="sb-confirm-delete-board" data-action="confirm-delete-board" disabled>${esc(t.deleteForever)}</button>
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderNewBoardSheet() {
  const draft = state.boardDraft;
  const aspect = draft.aspect_ratio || '16:9';
  return `
    <div class="sb-overlay" role="dialog" aria-modal="true">
      <div class="sb-sheet" data-stop>
        <div class="sb-sheet-top">
          <button type="button" class="sb-sheet-close sb-icon-btn" data-action="close-sheet" aria-label="${esc(t.close)}">✕</button>
        </div>
        <h2>${esc(t.newBoard)}</h2>
        <form id="sb-new-board-form">
          <div class="sb-field sb-field-text">
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
            <button type="submit" class="sb-btn sb-btn-primary">${esc(t.create)}</button>
          </div>
        </form>
      </div>
    </div>
  `;
}

function currentSceneIndex() {
  if (!state.editingScene?.id) return -1;
  return state.scenes.findIndex((s) => s.id === state.editingScene.id);
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
  const index = currentSceneIndex();
  const total = state.scenes.length;
  const hasNav = !isNew && total > 1 && index >= 0;
  const posLabel = (t.scenePosition || '%1$d / %2$d')
    .replace('%1$d', String(index + 1))
    .replace('%2$d', String(total));

  return `
    <div class="sb-overlay" role="dialog" aria-modal="true">
      <div class="sb-sheet sb-sheet-scene" data-stop>
        <div class="sb-sheet-top">
          ${
            hasNav
              ? `<div class="sb-scene-nav" aria-label="${esc(t.swipeScenes)}">
                  <button type="button" class="sb-icon-btn" data-action="prev-scene" aria-label="${esc(t.previousScene)}" ${index <= 0 ? 'disabled' : ''}>‹</button>
                  <span class="sb-scene-pos">${esc(posLabel)}</span>
                  <button type="button" class="sb-icon-btn" data-action="next-scene" aria-label="${esc(t.nextScene)}" ${index >= total - 1 ? 'disabled' : ''}>›</button>
                </div>`
              : '<span></span>'
          }
          <button type="button" class="sb-sheet-close sb-icon-btn" data-action="close-sheet" aria-label="${esc(t.close)}">✕</button>
        </div>
        <form id="sb-scene-form">
          <div class="sb-sheet-heading">
            <label class="sb-sr-only" for="sb-scene-title">${esc(t.title)}</label>
            <input
              id="sb-scene-title"
              class="sb-scene-title-input"
              name="title"
              maxlength="200"
              value="${esc(scene.title_raw || '')}"
              placeholder="${esc(isNew ? t.addScene : scene.title)}"
              autocomplete="off"
            >
          </div>

          <div class="sb-field sb-field-photo">
            <span class="sb-sr-only">${esc(t.photo)}</span>
            <div class="sb-photo-area">
              <div class="sb-photo-preview ${aspectClass(aspect)}${previewUrl ? ' has-image' : ''}">
                ${previewUrl ? `<img src="${esc(previewUrl)}" alt="">` : '<span class="sb-photo-empty" aria-hidden="true"></span>'}
                <div class="sb-photo-actions">
                  <label class="sb-icon-btn sb-photo-action" aria-label="${esc(previewUrl ? t.changePhoto : t.addPhoto)}" title="${esc(previewUrl ? t.changePhoto : t.addPhoto)}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="3" y="5" width="18" height="14" rx="2"/>
                      <circle cx="8.5" cy="10" r="1.5"/>
                      <path d="M21 16l-5.5-5.5L7 19"/>
                    </svg>
                    <input type="file" id="sb-photo-input" accept="image/*" hidden>
                  </label>
                  ${
                    previewUrl
                      ? `<button type="button" class="sb-icon-btn sb-photo-action" data-action="remove-photo" aria-label="${esc(t.removePhoto)}" title="${esc(t.removePhoto)}">
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                            <path d="M4 7h16"/>
                            <path d="M9 7V5h6v2"/>
                            <path d="M7 7l1 12h8l1-12"/>
                          </svg>
                        </button>`
                      : ''
                  }
                </div>
              </div>
            </div>
          </div>

          <div class="sb-field-row">
            <div class="sb-field">
              <label>${esc(t.role)}</label>
              <div class="sb-segment" id="sb-role-seg">
                <button type="button" data-role="a_roll" class="${scene.role === 'a_roll' ? 'is-active' : ''}">${esc(t.aRoll)}</button>
                <button type="button" data-role="b_roll" class="${scene.role === 'b_roll' ? 'is-active' : ''}">${esc(t.bRoll)}</button>
                <button type="button" data-role="voiceover" class="${scene.role === 'voiceover' ? 'is-active' : ''}">${esc(t.voiceover)}</button>
              </div>
              <input type="hidden" name="role" id="sb-role-input" value="${esc(scene.role)}">
            </div>
            <div class="sb-field sb-field-duration sb-field-text">
              <label for="sb-scene-duration">${esc(t.duration)}</label>
              <input id="sb-scene-duration" name="duration_sec" type="number" min="1" max="600" value="${esc(scene.duration_sec || 3)}">
            </div>
          </div>

          <div class="sb-field sb-field-text">
            <label for="sb-scene-desc">${esc(t.description)}</label>
            <textarea id="sb-scene-desc" name="description" rows="3">${esc(scene.description || '')}</textarea>
            <button type="button" class="sb-premium-btn" ${features.ai_description ? '' : 'disabled aria-disabled="true"'} data-action="ai-desc">
              ${esc(t.generateDesc)}
            </button>
          </div>

          <div class="sb-field sb-field-text">
            <label for="sb-scene-script">${esc(t.script)}</label>
            <textarea id="sb-scene-script" name="script" rows="3">${esc(scene.script || '')}</textarea>
            <div class="sb-premium-inline">
              <button type="button" class="sb-premium-btn" ${features.ai_script ? '' : 'disabled aria-disabled="true"'} data-action="ai-script">
                ${esc(t.generateScript)}
              </button>
              <button type="button" class="sb-premium-btn" ${features.ai_image ? '' : 'disabled aria-disabled="true"'} data-action="ai-image">
                ${esc(t.generateImage)}
              </button>
            </div>
          </div>

          <div class="sb-sheet-actions">
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

async function askDeleteBoard(id) {
  let title = '';
  let sceneCount = 0;

  if (state.board?.id === id) {
    title = state.board.title;
    sceneCount = state.scenes.length;
  } else {
    const listed = state.boards.find((b) => b.id === id);
    title = listed?.title || '';
    try {
      const data = await api.getBoard(id);
      title = data.title || title;
      sceneCount = Array.isArray(data.scenes) ? data.scenes.length : 0;
    } catch {
      // Keep listed title; count may stay 0.
    }
  }

  state.pendingDeleteBoard = {
    id,
    title,
    sceneCount,
    code: makeDeleteCode(),
  };
  // Confirm dialog is not a draft sheet — no history push / discard flow.
  state.sheet = 'confirmDeleteBoard';
  render();

  // Avoid the opening tap from landing on the newly rendered confirm control.
  window.setTimeout(() => {
    const input = document.getElementById('sb-delete-code-input');
    if (input) input.focus();
  }, 50);
}

function syncDeleteConfirmButton() {
  const pending = state.pendingDeleteBoard;
  const input = document.getElementById('sb-delete-code-input');
  const btn = document.getElementById('sb-confirm-delete-board');
  const err = document.getElementById('sb-delete-code-error');
  if (!pending || !input || !btn) return;

  const typed = (input.value || '').replace(/\D/g, '').slice(0, 4);
  if (input.value !== typed) {
    input.value = typed;
  }

  const matches = typed.length === 4 && typed === pending.code;
  btn.disabled = !matches;
  if (err) {
    err.hidden = typed.length < 4 || matches;
  }
}

function discardSheetState() {
  cleanupPendingPhoto();
  state.sheet = null;
  state.pendingDeleteBoard = null;
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
  if (state.sheet) {
    // Android/iOS back while editing — confirm instead of silently losing data.
    closeSheet({ fromPopstate: true });
    return;
  }
  clearSheetHistoryFlag();
  syncViewFromLocation();
}

/* ---------- Events ---------- */

function isDesktopViewport() {
  return window.matchMedia('(min-width: 641px)').matches;
}

function bindOverlayDismiss() {
  const overlay = root.querySelector('.sb-overlay');
  if (!overlay) return;

  overlay.addEventListener('click', (e) => {
    if (e.target !== overlay) return;
    if (!isDesktopViewport()) return;

    if (state.pendingDeleteBoard) {
      state.pendingDeleteBoard = null;
      state.sheet = null;
      render();
      return;
    }

    closeSheet();
  });
}

function bindEvents() {
  root.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', onActionClick);
  });

  bindOverlayDismiss();

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

  const deleteCodeInput = root.querySelector('#sb-delete-code-input');
  if (deleteCodeInput) {
    deleteCodeInput.addEventListener('input', syncDeleteConfirmButton);
    deleteCodeInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        const btn = document.getElementById('sb-confirm-delete-board');
        if (btn && !btn.disabled) {
          btn.click();
        }
      }
    });
  }

  bindSceneSwipe();
}

function bindSceneSwipe() {
  const sheet = root.querySelector('.sb-sheet-scene');
  if (!sheet || state.sheet !== 'editScene' || !state.editingScene?.id) return;
  if (state.scenes.length < 2) return;

  let startX = 0;
  let startY = 0;
  let tracking = false;

  sheet.addEventListener(
    'touchstart',
    (e) => {
      if (e.target.closest('input, textarea, select, button, label.sb-btn, a')) return;
      const touch = e.changedTouches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      tracking = true;
    },
    { passive: true }
  );

  sheet.addEventListener(
    'touchend',
    (e) => {
      if (!tracking) return;
      tracking = false;
      const touch = e.changedTouches[0];
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (Math.abs(dx) < 64) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.15) return;
      // Swipe left → next, swipe right → previous.
      goAdjacentScene(dx < 0 ? 1 : -1);
    },
    { passive: true }
  );
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
    await askDeleteBoard(id);
    return;
  }

  if (action === 'cancel-delete-board') {
    state.pendingDeleteBoard = null;
    state.sheet = null;
    render();
    return;
  }

  if (action === 'confirm-delete-board') {
    e.preventDefault();
    const pending = state.pendingDeleteBoard;
    if (!pending) return;

    const input = document.getElementById('sb-delete-code-input');
    const typed = (input?.value || '').replace(/\D/g, '');
    if (typed !== pending.code) {
      syncDeleteConfirmButton();
      const err = document.getElementById('sb-delete-code-error');
      if (err) err.hidden = false;
      return;
    }

    const id = pending.id;
    const btn = document.getElementById('sb-confirm-delete-board');
    if (btn) btn.disabled = true;

    try {
      await api.deleteBoard(id);
      state.pendingDeleteBoard = null;
      state.sheet = null;
      if (state.view === 'board' && state.board?.id === id) {
        await goToBoards({ fromHistory: false });
        showToast('Deleted');
        return;
      }
      await loadBoards();
      showToast('Deleted');
    } catch (err) {
      showToast(err.message || t.errorGeneric);
      syncDeleteConfirmButton();
    }
    return;
  }

  if (action === 'back') {
    if (state.sheet) {
      closeSheet();
      return;
    }
    if (history.state?.storyboardsView === 'board' || parseBoardSlugFromLocation()) {
      history.back();
      return;
    }
    await goToBoards();
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

  if (action === 'prev-scene') {
    e.preventDefault();
    await goAdjacentScene(-1);
    return;
  }

  if (action === 'next-scene') {
    e.preventDefault();
    await goAdjacentScene(1);
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

async function persistEditingScene() {
  syncFormsIntoState();
  const scene = state.editingScene;
  if (!scene) return null;

  const payload = {
    title: (scene.title_raw || '').trim(),
    description: scene.description || '',
    script: scene.script || '',
    role: scene.role || 'a_roll',
    duration_sec: Number(scene.duration_sec) || 3,
  };

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

  return saved;
}

async function onSaveScene(e) {
  e.preventDefault();
  try {
    await persistEditingScene();
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

async function goAdjacentScene(delta) {
  const index = currentSceneIndex();
  if (index < 0) return;

  const nextIndex = index + delta;
  if (nextIndex < 0 || nextIndex >= state.scenes.length) return;

  const dirty = isSheetDirty();
  if (dirty || state.pendingPhoto || state.removePhoto) {
    try {
      showToast(t.saving || 'Saving…');
      await persistEditingScene();
      cleanupPendingPhoto();
      state.removePhoto = false;
      await refreshBoard({ renderUi: false });
    } catch (err) {
      showToast(err.message || t.errorGeneric);
      return;
    }
  }

  const currentId = state.editingScene?.id;
  let freshIndex = state.scenes.findIndex((s) => s.id === currentId);
  if (freshIndex < 0) freshIndex = index;
  const target = state.scenes[freshIndex + delta];
  if (!target) return;

  cleanupPendingPhoto();
  state.removePhoto = false;
  state.pendingPhoto = null;
  state.editingScene = { ...target };
  state.sceneBaseline = sceneSnapshot(state.editingScene);
  state.sheet = 'editScene';
  render();
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
    draggable: '.sb-scene-card:not(.sb-scene-add)',
    animation: 150,
    ghostClass: 'sb-sortable-ghost',
    delay: 120,
    delayOnTouchOnly: true,
    onEnd: async () => {
      const ids = [...el.querySelectorAll('.sb-scene-card[data-id]')].map((n) => Number(n.dataset.id));
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

async function openBoard(id, { push = true } = {}) {
  setLoading(true);
  try {
    const data = await api.getBoard(id);
    applyBoardData(data);
    if (data.slug) {
      navigateBoardUrl(data.slug, { replace: !push });
    }
  } catch (err) {
    showToast(err.message || t.errorGeneric);
  } finally {
    state.loading = false;
    render();
  }
}

async function openBoardBySlug(slug, { push = false } = {}) {
  setLoading(true);
  try {
    const data = await api.getBoardBySlug(slug);
    applyBoardData(data);
    if (data.slug) {
      navigateBoardUrl(data.slug, { replace: !push });
    }
  } catch (err) {
    showToast(err.message || t.errorGeneric);
    state.view = 'boards';
    state.board = null;
    state.scenes = [];
    state.mode = 'list';
    setDocumentTitle('');
    navigateBoardsUrl({ replace: true });
    try {
      state.boards = await api.listBoards();
    } catch {
      state.boards = [];
    }
  } finally {
    state.loading = false;
    render();
  }
}

async function refreshBoard({ renderUi = true } = {}) {
  if (!state.board) return;
  try {
    const data = await api.getBoard(state.board.id);
    const prevSlug = state.board.slug;
    applyBoardData(data, { resetUi: false });
    if (data.slug && data.slug !== prevSlug) {
      navigateBoardUrl(data.slug, { replace: true });
    }
  } catch (err) {
    showToast(err.message || t.errorGeneric);
  }
  if (renderUi) {
    render();
  }
}

/* ---------- Boot ---------- */

window.addEventListener('popstate', onPopState);
window.addEventListener('beforeunload', (e) => {
  if (state.sheet && isSheetDirty()) {
    e.preventDefault();
    e.returnValue = '';
  }
});

async function boot() {
  const slug = cfg.initialBoardSlug || parseBoardSlugFromLocation();
  if (slug) {
    await openBoardBySlug(slug, { push: false });
    return;
  }
  await loadBoards();
}

boot();
