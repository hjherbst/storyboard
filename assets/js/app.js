import { api } from 'storyboards-api';
import { compressImage } from './compress.js';

const cfg = window.StoryboardsConfig;
const t = cfg.i18n;
const root = document.getElementById('sb-root');
const canManage = !!cfg.canManage;
const readOnly = !canManage;

const state = {
  view: 'boards', // boards | board
  boards: [],
  board: null,
  scenes: [],
  mode: 'list', // list | timeline
  selectMode: false,
  selectedSceneIds: [],
  selectAnchorId: null, // last plain-clicked scene for Shift+range select
  sheet: null, // null | newBoard | editBoard | editScene | editAudio | confirmDeleteBoard
  boardMenuOpen: false,
  pendingDeleteBoard: null, // { id, title, sceneCount, code }
  editingScene: null,
  sceneBaseline: null, // JSON snapshot for dirty checks
  editingAudio: null,
  audioBaseline: null,
  boardDraft: { title: '', aspect_ratio: '16:9' },
  boardBaseline: null,
  pendingPhoto: null, // { blob, filename, previewUrl } | null
  removePhoto: false,
  loading: false,
  toastTimer: null,
  sheetHistoryPushed: false,
  mediaFrame: null,
  audio: [],
  recording: false,
  mediaRecorder: null,
  recordChunks: [],
  recordStartedAt: 0,
  recordInsertSec: 0,
  recordInsertTrack: 1,
  recordRaf: null,
  recordMaxTimer: null,
  recordMime: '',
  recordAnalyser: null,
  recordAnalyserData: null,
  recordLivePeaks: [],
  playheadSec: 0,
  playing: false,
  playRaf: null,
  playAnchorPerf: 0,
  playAnchorSec: 0,
  playPreviewId: null,
  playbackAudioEls: new Map(),
  /** Timeline horizontal zoom: 1 = 24s fill the viewport width. */
  timelineZoom: 1,
};

const AUDIO_MAX_SEC = 20;
const AUDIO_BITRATE = 48000; // ~120 KB for 20s Opus — well under 1 MB
const INSERT_TILE_SEC = 1;
const AUDIO_TRACKS = [1, 2];
const LANE_LABEL_PX = 52; // 3.25rem @ 16px — keep playhead aligned with tracks
const TIMELINE_BASE_SEC = 24; // seconds visible at zoom = 1
const TIMELINE_ZOOM_MIN = 0.4;
const TIMELINE_ZOOM_MAX = 4;
let timelinePinching = false;
const waveformCache = new Map(); // clipId -> number[] peaks 0..1
let waveformAudioCtx = null;
/** Pending two-step insert on touch devices: { lane, track, sec, ghost }. */
let pendingLaneInsert = null;

function isCoarsePointer() {
  return window.matchMedia('(hover: none), (pointer: coarse)').matches;
}

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
  return scenes
    .filter((s) => (s.role || 'a_roll') === 'a_roll')
    .reduce((sum, s) => sum + (s.duration_sec || 3), 0);
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
    is_public: !!data.is_public,
  };
  state.scenes = data.scenes || [];
  state.audio = data.audio || [];
  if (resetUi) {
    stopPlayback({ keepHead: true });
    disposePlaybackAudio();
    state.view = 'board';
    state.mode = 'list';
    state.sheet = null;
    state.selectMode = false;
    state.selectedSceneIds = [];
    state.selectAnchorId = null;
    state.boardMenuOpen = false;
    state.playheadSec = 0;
  } else {
    // Drop selections that no longer exist after refresh.
    const alive = new Set(state.scenes.map((s) => Number(s.id)));
    state.selectedSceneIds = state.selectedSceneIds.filter((id) => alive.has(id));
    if (state.selectAnchorId != null && !alive.has(Number(state.selectAnchorId))) {
      state.selectAnchorId = null;
    }
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
  stopPlayback({ keepHead: true });
  disposePlaybackAudio();
  state.view = 'boards';
  state.board = null;
  state.scenes = [];
  state.audio = [];
  state.mode = 'list';
  state.selectMode = false;
  state.selectedSceneIds = [];
  state.selectAnchorId = null;
  state.boardMenuOpen = false;
  state.sheet = null;
  state.playheadSec = 0;
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

function getTimelineScrollLeft() {
  const wrap = document.getElementById('sb-timeline-wrap');
  return wrap ? wrap.scrollLeft : 0;
}

function restoreTimelineScrollLeft(left) {
  const wrap = document.getElementById('sb-timeline-wrap');
  if (!wrap || left == null) return;
  wrap.scrollLeft = left;
}

function render() {
  const keepTimelineScroll =
    state.view === 'board' && state.mode === 'timeline' && !state.selectMode;
  const timelineScroll = keepTimelineScroll ? getTimelineScrollLeft() : 0;

  if (state.view === 'boards') {
    root.innerHTML = renderBoardsView();
  } else {
    root.innerHTML = renderBoardView();
  }

  if (state.sheet === 'newBoard') {
    root.insertAdjacentHTML('beforeend', renderNewBoardSheet());
  } else if (state.sheet === 'editBoard') {
    root.insertAdjacentHTML('beforeend', renderEditBoardSheet());
  } else if (state.sheet === 'editScene') {
    root.insertAdjacentHTML('beforeend', renderSceneSheet());
  } else if (state.sheet === 'editAudio') {
    root.insertAdjacentHTML('beforeend', renderAudioSheet());
  } else if (state.sheet === 'confirmDeleteBoard') {
    root.insertAdjacentHTML('beforeend', renderConfirmDeleteBoard());
  }

  document.body.classList.toggle(
    'sb-timeline-mode',
    state.view === 'board' && state.mode === 'timeline' && !state.selectMode
  );

  bindEvents();
  if (canManage && state.view === 'board' && state.mode === 'list' && !state.selectMode) {
    initSortable();
  }
  if (state.view === 'board' && state.mode === 'timeline' && !state.selectMode) {
    initTimelineInteractions();
    restoreTimelineScrollLeft(timelineScroll);
    hydrateAudioWaveforms();
  }
  bindBoardMenuDismiss();
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

  const addTile = canManage
    ? `
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
    </button>`
    : '';

  const list = `<div class="sb-board-list">${boards}${addTile}</div>`;

  return `
    <header class="sb-header">
      <h1>${esc(t.appTitle)}</h1>
      ${readOnly ? `<span class="sb-view-only">${esc(t.viewOnly)}</span>` : ''}
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
  const viewMode = state.selectMode ? 'list' : state.mode;
  const body = viewMode === 'timeline' ? renderTimeline() : renderSceneList();

  const selectToggle = canManage && state.scenes.length
    ? `<button
        type="button"
        class="sb-select-toggle ${state.selectMode ? 'is-active' : ''}"
        data-action="toggle-select-mode"
      >${esc(state.selectMode ? t.doneSelecting : t.selectScenes)}</button>`
    : '';

  const viewToggle = state.selectMode
    ? ''
    : `<div class="sb-toggle" role="group" aria-label="View mode">
        <button type="button" data-action="mode" data-mode="list" class="${state.mode === 'list' ? 'is-active' : ''}">${esc(t.list)}</button>
        <button type="button" data-action="mode" data-mode="timeline" class="${state.mode === 'timeline' ? 'is-active' : ''}">${esc(t.timeline)}</button>
      </div>`;

  const boardMenu = canManage
    ? `<div class="sb-menu ${state.boardMenuOpen ? 'is-open' : ''}">
        <button
          type="button"
          class="sb-icon-btn sb-menu-trigger"
          data-action="toggle-board-menu"
          aria-expanded="${state.boardMenuOpen ? 'true' : 'false'}"
          aria-haspopup="true"
          aria-label="${esc(t.boardMenu || 'Board options')}"
          title="${esc(t.boardMenu || 'Board options')}"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="5" r="1.6" fill="currentColor"/>
            <circle cx="12" cy="12" r="1.6" fill="currentColor"/>
            <circle cx="12" cy="19" r="1.6" fill="currentColor"/>
          </svg>
        </button>
        <div class="sb-menu-panel" role="menu">
          <button
            type="button"
            class="sb-public-toggle ${board.is_public ? 'is-on' : ''}"
            data-action="toggle-public"
            role="switch"
            aria-checked="${board.is_public ? 'true' : 'false'}"
            title="${esc(board.is_public ? t.publicHint : t.makePublic)}"
          >
            <span class="sb-public-toggle-label">${esc(t.publicBoard)}</span>
            <span class="sb-public-toggle-track" aria-hidden="true"><span class="sb-public-toggle-thumb"></span></span>
          </button>
          <button type="button" class="sb-menu-item" data-action="rename-board" role="menuitem">
            ${esc(t.renameBoard || 'Rename')}
          </button>
          <button type="button" class="sb-menu-item" data-action="export-premiere" data-id="${board.id}" role="menuitem">
            ${esc(t.exportPremiere || 'Export Premiere')}
          </button>
          <button type="button" class="sb-menu-item" data-action="export-fcp" data-id="${board.id}" role="menuitem">
            ${esc(t.exportFcp || 'Export Final Cut')}
          </button>
          <button type="button" class="sb-menu-item" data-action="export-fcp-media" data-id="${board.id}" role="menuitem">
            ${esc(t.exportFcpMedia || 'Export Final Cut + Media')}
          </button>
          <button type="button" class="sb-menu-item is-danger" data-action="delete-board" data-id="${board.id}" role="menuitem">
            ${esc(t.delete)}
          </button>
        </div>
      </div>`
    : `<span class="sb-view-only">${esc(t.viewOnly)}</span>`;

  const backLink = canManage
    ? `<button type="button" class="sb-nav-back" data-action="back">${esc(t.back)}</button>`
    : '';

  return `
    <header class="sb-header sb-header-board">
      <div class="sb-header-main">
        ${
          canManage
            ? `<button type="button" class="sb-board-title sb-board-title-btn" data-action="rename-board" title="${esc(t.renameBoard || 'Rename')}">${esc(board.title)}</button>`
            : `<h4 class="sb-board-title">${esc(board.title)}</h4>`
        }
        <div class="sb-header-meta">
          <span class="sb-badge">${esc(board.aspect_ratio)}</span>
          <span class="sb-dur">${esc(t.total)}: ${esc(formatTotal(total))}</span>
        </div>
      </div>
      <div class="sb-header-end">${backLink}${boardMenu}</div>
      <div class="sb-header-tools">
        ${viewToggle}
        ${selectToggle}
      </div>
    </header>
    <main class="sb-main ${state.selectMode || state.recording ? 'has-bulk-bar' : ''}">
      ${state.loading ? `<p class="sb-loading">…</p>` : body}
      ${state.selectMode ? renderBulkBar() : ''}
      ${state.recording ? renderRecordingBar() : ''}
    </main>
  `;
}

function isSceneSelected(id) {
  return state.selectedSceneIds.includes(Number(id));
}

function renderBulkBar() {
  const count = state.selectedSceneIds.length;
  const allSelected = state.scenes.length > 0 && count === state.scenes.length;
  const label = (t.selectedCount || '%d selected').replace('%d', String(count));

  return `
    <div class="sb-bulk-bar" role="toolbar" aria-label="${esc(t.selectScenes)}">
      <span class="sb-bulk-count">${esc(label)}</span>
      <div class="sb-bulk-actions">
        <button type="button" class="sb-btn" data-action="${allSelected ? 'deselect-all-scenes' : 'select-all-scenes'}">
          ${esc(allSelected ? t.deselectAll : t.selectAll)}
        </button>
        <button
          type="button"
          class="sb-btn sb-btn-danger"
          data-action="bulk-delete-scenes"
          ${count ? '' : 'disabled'}
        >${esc(t.deleteSelected)}</button>
      </div>
    </div>
  `;
}

function renderRecordingBar() {
  return `
    <div class="sb-bulk-bar is-recording" role="status" aria-live="polite" aria-label="${esc(t.recording)}">
      <div class="sb-rec-bulk-info">
        <span class="sb-recording-dot" aria-hidden="true"></span>
        <span class="sb-recording-label">
          <span class="sb-rec-elapsed">0.0</span>/${AUDIO_MAX_SEC} sec
        </span>
      </div>
      <div class="sb-recording-meter" aria-hidden="true">
        <div class="sb-recording-meter-fill"></div>
      </div>
      <button
        type="button"
        class="sb-btn sb-rec-stop"
        data-action="stop-record"
        aria-label="${esc(t.stopRecording)}"
        title="${esc(t.stopRecording)}"
      >
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
          <rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor" />
        </svg>
      </button>
    </div>
  `;
}

function renderSceneList() {
  const aspect = state.board.aspect_ratio;
  const selecting = state.selectMode && canManage;
  const cards = state.scenes
    .map((s) => {
      const selected = isSceneSelected(s.id);
      return `
      <li class="sb-scene-card role-${esc(s.role)}${selected ? ' is-selected' : ''}" data-id="${s.id}">
        ${
          selecting
            ? `<label class="sb-scene-check">
                <input type="checkbox" data-action="toggle-scene-select" data-id="${s.id}" ${selected ? 'checked' : ''} />
                <span class="sb-sr-only">${esc(t.selectScenes)}</span>
              </label>`
            : canManage
              ? `<div class="sb-scene-handle" aria-label="Reorder">⠿</div>`
              : ''
        }
        <button type="button" class="sb-scene-tile" data-action="${
          selecting ? 'toggle-scene-select' : canManage ? 'edit-scene' : 'view-scene'
        }" data-id="${s.id}">
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
            <p class="sb-scene-title">${esc(s.title)}</p>
          </div>
        </button>
      </li>`;
    })
    .join('');

  const addTile =
    canManage && !selecting
      ? `
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
          <p class="sb-scene-title">${esc(t.addScene)}</p>
        </div>
      </button>
    </li>`
      : '';

  const sortableAttr = canManage && !selecting ? 'id="sb-sortable"' : '';
  return `<ul class="sb-scene-list ${aspectClass(aspect)} ${selecting ? 'is-selecting' : ''}" ${sortableAttr}>${cards}${addTile}</ul>`;
}

function clampTimelineZoom(z) {
  const n = Number(z);
  if (!Number.isFinite(n)) return 1;
  return Math.min(TIMELINE_ZOOM_MAX, Math.max(TIMELINE_ZOOM_MIN, n));
}

function timelinePxPerSec() {
  const w = Math.max(window.innerWidth || 360, 320);
  return (w / TIMELINE_BASE_SEC) * clampTimelineZoom(state.timelineZoom);
}

function layoutARoll() {
  let cursor = 0;
  return state.scenes
    .filter((s) => s.role === 'a_roll')
    .map((s) => {
      const dur = Math.max(1, Number(s.duration_sec) || 3);
      const item = { ...s, start: cursor, dur };
      cursor += dur;
      return item;
    });
}

function layoutBRoll() {
  return state.scenes
    .filter((s) => s.role === 'b_roll')
    .map((s) => ({
      ...s,
      start: Math.max(0, Number(s.start_sec) || 0),
      dur: Math.max(1, Number(s.duration_sec) || 3),
    }));
}

function rangesOverlap(a0, a1, b0, b1) {
  return a0 < b1 && a1 > b0;
}

/** Place B-roll without overlapping other B-rolls; prefer start nearest to desired. */
function resolveBRollStart(desiredStart, dur, excludeId = null) {
  const length = Math.max(1, Number(dur) || 1);
  const others = layoutBRoll()
    .filter((b) => Number(b.id) !== Number(excludeId))
    .sort((a, b) => a.start - b.start);

  let start = Math.max(0, Math.round(Number(desiredStart) || 0));

  const overlaps = (s) =>
    others.some((o) => rangesOverlap(s, s + length, o.start, o.start + o.dur));

  if (!overlaps(start)) return start;

  const candidates = [0];
  for (const o of others) {
    candidates.push(o.start + o.dur);
    candidates.push(Math.max(0, o.start - length));
  }
  candidates.sort((a, b) => Math.abs(a - start) - Math.abs(b - start) || a - b);

  for (const c of candidates) {
    const s = Math.max(0, Math.round(c));
    if (!overlaps(s)) return s;
  }

  const last = others[others.length - 1];
  return last ? last.start + last.dur : 0;
}

/**
 * Initial B-roll start: centered under the A-roll that precedes this new clip
 * in scene order (last A-roll when appending from the editor).
 */
function defaultBRollStart(durationSec) {
  const dur = Math.max(1, Number(durationSec) || 3);
  const aLayout = layoutARoll();
  let anchor = null;
  for (const s of state.scenes) {
    if (s.role === 'a_roll') {
      const hit = aLayout.find((a) => Number(a.id) === Number(s.id));
      if (hit) anchor = hit;
    }
  }
  if (!anchor && aLayout.length) {
    anchor = aLayout[aLayout.length - 1];
  }

  const desired = anchor
    ? Math.max(0, Math.round(anchor.start + (anchor.dur - dur) / 2))
    : 0;

  return resolveBRollStart(desired, dur, null);
}

function layoutAudio(track = null) {
  return (state.audio || [])
    .filter((a) => (track == null ? true : Number(a.track || 1) === Number(track)))
    .map((a) => ({
      ...a,
      track: Number(a.track) === 2 ? 2 : 1,
      start: Math.max(0, Number(a.start_sec) || 0),
      dur: Math.max(1, Number(a.duration_sec) || 1),
    }));
}

function timelineEndSec() {
  const ends = [
    ...layoutARoll().map((c) => c.start + c.dur),
    ...layoutBRoll().map((c) => c.start + c.dur),
    ...layoutAudio().map((c) => c.start + c.dur),
  ];
  if (state.recording) {
    ends.push(Number(state.recordInsertSec || 0) + AUDIO_MAX_SEC);
  }
  return Math.max(24, ...(ends.length ? ends : [0]), 24);
}

function clampPlayhead(sec) {
  const end = Math.max(0, timelineEndSec());
  const n = Number(sec) || 0;
  if (n < 0) return 0;
  if (n > end) return end;
  return n;
}

/** Visible composition at time T: B-roll wins when present, else A-roll. */
function clipAtTime(sec) {
  const t = Number(sec) || 0;
  const b = layoutBRoll().find((c) => t >= c.start && t < c.start + c.dur);
  if (b) return b;
  return layoutARoll().find((c) => t >= c.start && t < c.start + c.dur) || null;
}

function formatPlayheadTime(sec) {
  const total = Math.max(0, Math.floor(Number(sec) || 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function laneLabelPx() {
  const timeline = document.querySelector('.sb-timeline');
  if (timeline) {
    const raw = getComputedStyle(timeline).getPropertyValue('--sb-lane-label').trim();
    if (raw.endsWith('rem')) {
      const rem = parseFloat(raw) || 3.25;
      const root = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      return rem * root;
    }
    const px = parseFloat(raw);
    if (!Number.isNaN(px) && px > 0) return px;
  }
  return LANE_LABEL_PX;
}

function playheadLeftPx(sec = state.playheadSec) {
  return laneLabelPx() + clampPlayhead(sec) * timelinePxPerSec();
}

function filmstripFrames(clip, pxPerSec) {
  const frames = [];
  for (let i = 0; i < clip.dur; i += 1) {
    frames.push(`
      <span class="sb-frame-cell" style="width:${pxPerSec}px">
        ${
          clip.image_url
            ? `<img src="${esc(clip.image_url)}" alt="" draggable="false">`
            : `<span class="sb-frame-empty"></span>`
        }
      </span>`);
  }
  return frames.join('');
}

function hashSeed(value) {
  const str = String(value ?? '');
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function seededPeaks(seed, count) {
  let x = hashSeed(seed) || 1;
  const peaks = [];
  for (let i = 0; i < count; i += 1) {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    const n = (x % 1000) / 1000;
    // Soft speech-like envelope: quieter edges, varied mid section.
    const env = 0.35 + 0.65 * Math.sin((Math.PI * (i + 0.5)) / count);
    peaks.push(Math.max(0.08, Math.min(1, (0.25 + n * 0.75) * env)));
  }
  return peaks;
}

function peaksToWavePath(peaks, width, height) {
  if (!peaks.length || width < 2) return '';
  const mid = height / 2;
  const maxAmp = mid * 0.92;
  let d = `M 0 ${mid}`;
  for (let i = 0; i < peaks.length; i += 1) {
    const x = (i / Math.max(1, peaks.length - 1)) * width;
    const y = mid - peaks[i] * maxAmp;
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  for (let i = peaks.length - 1; i >= 0; i -= 1) {
    const x = (i / Math.max(1, peaks.length - 1)) * width;
    const y = mid + peaks[i] * maxAmp;
    d += ` L ${x.toFixed(2)} ${y.toFixed(2)}`;
  }
  return `${d} Z`;
}

function renderWaveformSvg(peaks, width, height = 28, { live = false } = {}) {
  const w = Math.max(8, Math.round(width));
  const h = Math.max(16, height);
  const path = peaksToWavePath(peaks, w, h);
  return `
    <svg class="sb-audio-wave${live ? ' is-live' : ''}" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" preserveAspectRatio="none" aria-hidden="true">
      <path d="${path}" fill="currentColor"></path>
    </svg>`;
}

function barCountForWidth(widthPx) {
  return Math.max(16, Math.min(160, Math.round(widthPx / 3)));
}

async function decodeAudioPeaks(url, bars) {
  const res = await fetch(url, { credentials: 'same-origin' });
  if (!res.ok) throw new Error('waveform fetch failed');
  const raw = await res.arrayBuffer();
  if (!waveformAudioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) throw new Error('no audio context');
    waveformAudioCtx = new AC();
  }
  if (waveformAudioCtx.state === 'suspended') {
    try {
      await waveformAudioCtx.resume();
    } catch {
      /* ignore */
    }
  }
  const audioBuf = await waveformAudioCtx.decodeAudioData(raw.slice(0));
  const channel = audioBuf.getChannelData(0);
  const block = Math.max(1, Math.floor(channel.length / bars));
  const peaks = [];
  for (let i = 0; i < bars; i += 1) {
    let max = 0;
    const start = i * block;
    const end = Math.min(channel.length, start + block);
    for (let j = start; j < end; j += 1) {
      const v = Math.abs(channel[j]);
      if (v > max) max = v;
    }
    peaks.push(max);
  }
  const peak = Math.max(...peaks, 0.0001);
  return peaks.map((p) => Math.max(0.05, p / peak));
}

function hydrateAudioWaveforms() {
  root.querySelectorAll('[data-wave-id]').forEach(async (host) => {
    const id = host.dataset.waveId;
    const url = host.dataset.waveUrl || '';
    const width = parseFloat(host.dataset.waveWidth) || 80;
    const bars = barCountForWidth(width);
    if (!id || !url) return;

    const cacheKey = `${id}:${bars}`;
    if (waveformCache.has(cacheKey)) {
      host.innerHTML = renderWaveformSvg(waveformCache.get(cacheKey), width);
      return;
    }
    try {
      const peaks = await decodeAudioPeaks(url, bars);
      waveformCache.set(cacheKey, peaks);
      if (host.isConnected) {
        host.innerHTML = renderWaveformSvg(peaks, width);
      }
    } catch {
      /* keep seeded placeholder */
    }
  });
}

function renderFilmstripClip(clip, { draggable = false, kind = 'scene' } = {}) {
  const px = timelinePxPerSec();
  const action = kind === 'audio'
    ? (canManage ? 'edit-audio' : 'view-audio')
    : canManage
      ? 'edit-scene'
      : 'view-scene';
  const dragAttr = draggable && canManage
    ? `data-drag="${kind}" data-id="${clip.id}"`
    : '';
  const title = kind === 'audio' ? clip.title : clip.title;
  const widthPx = clip.dur * px;
  let body = filmstripFrames(clip, px);
  if (kind === 'audio') {
    const bars = barCountForWidth(widthPx);
    const cacheKey = `${clip.id}:${bars}`;
    const peaks = waveformCache.get(cacheKey) || seededPeaks(clip.id, bars);
    body = `<span class="sb-audio-wave-host" data-wave-id="${esc(String(clip.id))}" data-wave-url="${esc(clip.url || '')}" data-wave-width="${widthPx}">${renderWaveformSvg(peaks, widthPx)}</span>`;
  }
  // 1px gutter so abutting clips stay visually separated.
  const boxWidth = Math.max(4, widthPx - 1);
  return `
    <div class="sb-film-clip ${kind === 'audio' ? 'is-audio' : `role-${esc(clip.role || '')}`}${draggable ? ' is-draggable' : ''}"
         style="left:${clip.start * px}px;width:${boxWidth}px"
         title="${esc(title)} (${clip.dur}s)"
         data-action="${action}"
         data-id="${clip.id}"
         data-start="${clip.start}"
         data-dur="${clip.dur}"
         ${dragAttr}>
      <div class="sb-film-strip">${body}</div>
      <span class="sb-film-label">${esc(title)}</span>
    </div>`;
}

function laneInsertTile(kind, label) {
  if (!canManage || state.recording) return '';
  return `<div class="sb-lane-insert sb-lane-insert-${esc(kind)}" aria-hidden="true" title="${esc(label)}" data-insert-label="${esc(label)}">
      <span class="sb-lane-insert-plus" aria-hidden="true">+</span>
      <span class="sb-lane-insert-label">${esc(label)}</span>
    </div>`;
}

function laneAddButton(lane, track = 1) {
  if (!canManage || state.recording) return '';
  const label =
    lane === 'audio'
      ? t.recordAudio || 'Record'
      : t.addAtPlayhead || 'Add at playhead';
  return `<button type="button"
      class="sb-lane-add"
      data-action="lane-add"
      data-insert-lane="${esc(lane)}"
      data-audio-track="${track}"
      aria-label="${esc(label)}"
      title="${esc(label)}">+</button>`;
}

function renderTimeline() {
  const px = timelinePxPerSec();
  const end = Math.max(timelineEndSec(), 24);
  const width = Math.ceil(end * px);
  const aClips = layoutARoll().map((c) => renderFilmstripClip(c, { draggable: false, kind: 'scene' })).join('');
  const bClips = layoutBRoll().map((c) => renderFilmstripClip(c, { draggable: true, kind: 'scene' })).join('');
  const canInsert = canManage && !state.recording;

  const ticks = [];
  for (let s = 0; s <= end; s += 6) {
    ticks.push(`<span class="sb-tick is-major" style="left:${s * px}px" data-sec="${s}"><em>${s}s</em></span>`);
  }

  const liveRecSec = state.recording
    ? Math.min(
        AUDIO_MAX_SEC,
        Math.max(0.15, (Date.now() - state.recordStartedAt) / 1000)
      )
    : 0;

  const audioLanes = AUDIO_TRACKS.map((track) => {
    const clips = layoutAudio(track)
      .map((c) => renderFilmstripClip(c, { draggable: true, kind: 'audio' }))
      .join('');
    const livePeaks = state.recordLivePeaks?.length
      ? state.recordLivePeaks
      : seededPeaks('live', barCountForWidth(Math.max(px, liveRecSec * px)));
    const liveClip =
      state.recording && Number(state.recordInsertTrack) === Number(track)
        ? `<div class="sb-film-clip is-audio is-recording" id="sb-recording-clip"
             style="left:${state.recordInsertSec * px}px;width:${liveRecSec * px}px"
             data-start="${state.recordInsertSec}" data-dur="${liveRecSec}"
             title="${esc(t.voiceOver || 'Voice over')}">
            <div class="sb-film-strip"><span class="sb-audio-wave-host" id="sb-recording-wave">${renderWaveformSvg(livePeaks, Math.max(px, liveRecSec * px), 28, { live: true })}</span></div>
            <span class="sb-film-label">${esc(t.voiceOver || 'Voice over')} <em class="sb-rec-clip-time">0.0/${AUDIO_MAX_SEC}</em></span>
          </div>`
        : '';
    const label = track === 2 ? (t.laneAudio2 || '2') : (t.laneAudio || '1');
    return `
      <div class="sb-lane sb-lane-audio">
        <div class="sb-lane-label">
          <span>${esc(label)}</span>
          ${laneAddButton('audio', track)}
        </div>
        <div class="sb-lane-track is-audio${canInsert ? ' is-insertable' : ''}" style="width:${width}px" data-insert-lane="audio" data-audio-track="${track}">
          ${clips}
          ${liveClip}
          ${laneInsertTile('audio', t.voiceOver || 'Voice over')}
        </div>
      </div>`;
  }).join('');

  const headSec = clampPlayhead(state.playheadSec);
  const headLeft = playheadLeftPx(headSec);
  const playLabel = state.playing ? (t.pausePreview || 'Pause') : (t.playPreview || 'Play');
  const playhead = `
    <div class="sb-playhead" id="sb-playhead" style="left:${headLeft}px">
      <button type="button" class="sb-playhead-btn${state.playing ? ' is-playing' : ''}" data-action="toggle-playback" aria-label="${esc(playLabel)}" title="${esc(playLabel)}">
        ${playbackIconSvg(state.playing)}
      </button>
      <span class="sb-playhead-line" aria-hidden="true"></span>
    </div>`;

  return `
    <div class="sb-timeline-block">
      <div class="sb-timeline-wrap" id="sb-timeline-wrap">
        <div class="sb-timeline" style="--sb-sec:${px}px;--sb-lane-label:${LANE_LABEL_PX}px;width:${width + LANE_LABEL_PX}px">
          <div class="sb-ruler-row">
            <button type="button" class="sb-ruler-start" data-scrub-start="1" title="${esc(t.playFromStart || 'Play from start')}" aria-label="${esc(t.playFromStart || 'Play from start')}"></button>
            <div class="sb-ruler is-scrub" style="width:${width}px" data-scrub="1" title="${esc(t.setPlayhead || 'Set playhead')}">${ticks.join('')}</div>
          </div>
          <div class="sb-lane sb-lane-broll">
            <div class="sb-lane-label">
              <span>${esc(t.laneB)}</span>
              ${laneAddButton('b_roll')}
            </div>
            <div class="sb-lane-track is-broll${canInsert ? ' is-insertable' : ''}" style="width:${width}px" data-insert-lane="b_roll">
              ${bClips || ''}
              ${laneInsertTile('b_roll', t.bRoll || 'B-Roll')}
            </div>
          </div>
          <div class="sb-lane sb-lane-aroll">
            <div class="sb-lane-label">
              <span>${esc(t.laneA)}</span>
              ${laneAddButton('a_roll')}
            </div>
            <div class="sb-lane-track is-aroll${canInsert ? ' is-insertable' : ''}" style="width:${width}px" data-insert-lane="a_roll">
              ${aClips}
              ${laneInsertTile('a_roll', t.aRoll || 'A-Roll')}
            </div>
          </div>
          ${audioLanes}
          ${playhead}
        </div>
      </div>
      ${renderPreviewStage(headSec)}
    </div>
  `;
}

function playbackIconSvg(playing) {
  if (playing) {
    return `<svg class="sb-playhead-icon" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="5" width="3.5" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="3.5" height="14" rx="1" fill="currentColor"/></svg>`;
  }
  return `<svg class="sb-playhead-icon is-play" width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6.8v10.4c0 .7.8 1.1 1.4.7l7.2-5.2c.5-.4.5-1.1 0-1.5L10.4 6.1C9.8 5.7 9 6.1 9 6.8z" fill="currentColor"/></svg>`;
}

function playerEndSec() {
  const aEnd = layoutARoll().reduce((max, c) => Math.max(max, c.start + c.dur), 0);
  return Math.max(1, aEnd || timelineEndSec());
}

function renderPreviewStage(sec = state.playheadSec) {
  const aspect = state.board?.aspect_ratio || '16:9';
  const clip = clipAtTime(sec);
  const title = clip?.title || (t.previewEmpty || 'No scene at playhead');
  const end = playerEndSec();
  const progress = Math.min(100, (clampPlayhead(sec) / end) * 100);
  const playLabel = state.playing ? (t.pausePreview || 'Pause') : (t.playPreview || 'Play');
  const img = clip?.image_url
    ? `<img src="${esc(clip.image_url)}" alt="" draggable="false">`
    : `<span class="sb-preview-empty">${esc(clip ? t.photo : (t.previewEmpty || '—'))}</span>`;

  return `
    <section class="sb-player" aria-label="${esc(t.preview || 'Preview')}">
      <div class="sb-player-stage ${aspectClass(aspect)}" id="sb-preview-stage" data-clip-id="${clip ? esc(String(clip.id)) : ''}">
        ${img}
        <button
          type="button"
          class="sb-player-overlay-play${state.playing ? ' is-playing' : ''}"
          data-action="toggle-playback"
          aria-label="${esc(playLabel)}"
          title="${esc(playLabel)}"
        >${playbackIconSvg(state.playing)}</button>
      </div>
      <div class="sb-player-chrome">
        <button
          type="button"
          class="sb-player-btn${state.playing ? ' is-playing' : ''}"
          data-action="toggle-playback"
          aria-label="${esc(playLabel)}"
          title="${esc(playLabel)}"
        >${playbackIconSvg(state.playing)}</button>
        <div
          class="sb-player-scrub"
          id="sb-player-scrub"
          data-player-scrub="1"
          role="slider"
          aria-valuemin="0"
          aria-valuemax="${end}"
          aria-valuenow="${Math.round(sec)}"
          aria-label="${esc(t.setPlayhead || 'Set playhead')}"
        >
          <div class="sb-player-scrub-track">
            <div class="sb-player-scrub-fill" id="sb-player-scrub-fill" style="width:${progress}%"></div>
          </div>
        </div>
        <span class="sb-player-time" id="sb-preview-time">${esc(formatPlayheadTime(sec))} / ${esc(formatPlayheadTime(end))}</span>
      </div>
      <div class="sb-player-caption">
        <span class="sb-player-title" id="sb-preview-title">${esc(title)}</span>
      </div>
    </section>
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

function renderEditBoardSheet() {
  const draft = state.boardDraft;
  return `
    <div class="sb-overlay" role="dialog" aria-modal="true">
      <div class="sb-sheet" data-stop>
        <div class="sb-sheet-top">
          <button type="button" class="sb-sheet-close sb-icon-btn" data-action="close-sheet" aria-label="${esc(t.close)}">✕</button>
        </div>
        <h2>${esc(t.renameBoard || 'Rename')}</h2>
        <form id="sb-edit-board-form">
          <div class="sb-field sb-field-text">
            <label for="sb-edit-board-title">${esc(t.boardTitle)}</label>
            <input id="sb-edit-board-title" name="title" required maxlength="200" autocomplete="off" value="${esc(draft.title || '')}">
          </div>
          <div class="sb-sheet-actions">
            <button type="submit" class="sb-btn sb-btn-primary">${esc(t.save)}</button>
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
  const previewUrl = state.pendingPhoto?.previewUrl || (!state.removePhoto && scene.image_url) || null;
  const isNew = !scene.id;
  const index = currentSceneIndex();
  const total = state.scenes.length;
  const hasNav = !isNew && total > 1 && index >= 0;
  const posLabel = (t.scenePosition || '%1$d / %2$d')
    .replace('%1$d', String(index + 1))
    .replace('%2$d', String(total));
  const navHtml = hasNav
    ? `<div class="sb-scene-nav" aria-label="${esc(t.swipeScenes)}">
        <button type="button" class="sb-icon-btn" data-action="prev-scene" aria-label="${esc(t.previousScene)}" ${index <= 0 ? 'disabled' : ''}>‹</button>
        <span class="sb-scene-pos">${esc(posLabel)}</span>
        <button type="button" class="sb-icon-btn" data-action="next-scene" aria-label="${esc(t.nextScene)}" ${index >= total - 1 ? 'disabled' : ''}>›</button>
      </div>`
    : '<span></span>';

  if (readOnly) {
    return `
      <div class="sb-overlay" role="dialog" aria-modal="true">
        <div class="sb-sheet sb-sheet-scene" data-stop>
          <div class="sb-sheet-top">
            ${navHtml}
            <button type="button" class="sb-sheet-close sb-icon-btn" data-action="close-sheet" aria-label="${esc(t.close)}">✕</button>
          </div>
          <div class="sb-sheet-confirm-body">
            <div class="sb-sheet-heading">
              <h2 class="sb-scene-title-input" style="font-size:var(--wp--preset--font-size--x-large,1.75rem);font-weight:600;margin:0;">${esc(scene.title || scene.title_raw || '')}</h2>
            </div>
            <div class="sb-field sb-field-photo">
              <div class="sb-photo-area">
                <div class="sb-photo-preview ${aspectClass(aspect)}${previewUrl ? ' has-image' : ''}">
                  ${previewUrl ? `<img src="${esc(previewUrl)}" alt="">` : '<span class="sb-photo-empty" aria-hidden="true"></span>'}
                </div>
              </div>
            </div>
            <p class="sb-view-meta">${esc(roleLabel(scene.role))} · ${esc(String(scene.duration_sec || 3))}s</p>
            ${
              scene.description
                ? `<div class="sb-field"><label>${esc(t.description)}</label><p class="sb-view-text">${esc(scene.description)}</p></div>`
                : ''
            }
            ${
              scene.script
                ? `<div class="sb-field"><label>${esc(t.script)}</label><p class="sb-view-text">${esc(scene.script)}</p></div>`
                : ''
            }
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="sb-overlay" role="dialog" aria-modal="true">
      <div class="sb-sheet sb-sheet-scene" data-stop>
        <div class="sb-sheet-top">
          ${navHtml}
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
                    <input type="file" id="sb-photo-input" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" hidden>
                  </label>
                  <label class="sb-icon-btn sb-photo-action sb-photo-action-camera" aria-label="${esc(t.takePhoto)}" title="${esc(t.takePhoto)}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M4 8h3l1.5-2h7L17 8h3v11H4z"/>
                      <circle cx="12" cy="13.5" r="3.25"/>
                    </svg>
                    <input type="file" id="sb-photo-camera" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" capture="environment" hidden>
                  </label>
                  <button type="button" class="sb-icon-btn sb-photo-action" data-action="pick-media" aria-label="${esc(t.chooseFromLibrary)}" title="${esc(t.chooseFromLibrary)}">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <rect x="3" y="4" width="7" height="7" rx="1"/>
                      <rect x="14" y="4" width="7" height="7" rx="1"/>
                      <rect x="3" y="13" width="7" height="7" rx="1"/>
                      <rect x="14" y="13" width="7" height="7" rx="1"/>
                    </svg>
                  </button>
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
          </div>

          <div class="sb-field sb-field-text">
            <label for="sb-scene-script">${esc(t.script)}</label>
            <textarea id="sb-scene-script" name="script" rows="3">${esc(scene.script || '')}</textarea>
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

function renderAudioSheet() {
  const clip = state.editingAudio;
  if (!clip) return '';

  const trackLabel =
    Number(clip.track) === 2 ? (t.laneAudio2 || '2') : (t.laneAudio || '1');
  const meta = `${t.voiceOver || 'Voice over'} · ${trackLabel} · ${clip.duration_sec || 1}s`;

  if (readOnly) {
    return `
      <div class="sb-overlay" role="dialog" aria-modal="true">
        <div class="sb-sheet sb-sheet-scene sb-sheet-audio" data-stop>
          <div class="sb-sheet-top">
            <span></span>
            <button type="button" class="sb-sheet-close sb-icon-btn" data-action="close-sheet" aria-label="${esc(t.close)}">✕</button>
          </div>
          <div class="sb-sheet-confirm-body">
            <div class="sb-sheet-heading">
              <h2 class="sb-scene-title-input" style="font-size:var(--wp--preset--font-size--x-large,1.75rem);font-weight:600;margin:0;">${esc(clip.title || '')}</h2>
            </div>
            <p class="sb-view-meta">${esc(meta)}</p>
            ${
              clip.url
                ? `<div class="sb-field"><audio class="sb-audio-player" controls src="${esc(clip.url)}" preload="metadata"></audio></div>`
                : ''
            }
          </div>
        </div>
      </div>
    `;
  }

  return `
    <div class="sb-overlay" role="dialog" aria-modal="true">
      <div class="sb-sheet sb-sheet-scene sb-sheet-audio" data-stop>
        <div class="sb-sheet-top">
          <span></span>
          <button type="button" class="sb-sheet-close sb-icon-btn" data-action="close-sheet" aria-label="${esc(t.close)}">✕</button>
        </div>
        <form id="sb-audio-form">
          <div class="sb-sheet-heading">
            <label class="sb-sr-only" for="sb-audio-title">${esc(t.title)}</label>
            <input
              id="sb-audio-title"
              class="sb-scene-title-input"
              name="title"
              maxlength="200"
              value="${esc(clip.title || '')}"
              placeholder="${esc(t.voiceOver || 'Voice over')}"
              autocomplete="off"
            >
          </div>
          <p class="sb-view-meta">${esc(meta)}</p>
          ${
            clip.url
              ? `<div class="sb-field"><audio class="sb-audio-player" controls src="${esc(clip.url)}" preload="metadata"></audio></div>`
              : ''
          }
          <div class="sb-field">
            <label>${esc(t.laneAudio || 'Track')}</label>
            <div class="sb-segment" id="sb-audio-track-seg">
              <button type="button" data-audio-track-opt="1" class="${Number(clip.track) !== 2 ? 'is-active' : ''}">${esc(t.laneAudio || '1')}</button>
              <button type="button" data-audio-track-opt="2" class="${Number(clip.track) === 2 ? 'is-active' : ''}">${esc(t.laneAudio2 || '2')}</button>
            </div>
            <input type="hidden" name="track" id="sb-audio-track-input" value="${Number(clip.track) === 2 ? 2 : 1}">
          </div>
          <div class="sb-sheet-actions">
            <button type="button" class="sb-btn sb-btn-danger" data-action="delete-audio" data-id="${clip.id}">${esc(t.delete)}</button>
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

function audioSnapshot(clip) {
  return JSON.stringify({
    title: (clip?.title || '').trim(),
    track: Number(clip?.track) === 2 ? 2 : 1,
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

  const editBoardForm = root.querySelector('#sb-edit-board-form');
  if (editBoardForm) {
    state.boardDraft = {
      ...state.boardDraft,
      title: editBoardForm.title.value,
      aspect_ratio: state.board?.aspect_ratio || state.boardDraft.aspect_ratio || '16:9',
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

  const audioForm = root.querySelector('#sb-audio-form');
  if (audioForm && state.editingAudio) {
    state.editingAudio = {
      ...state.editingAudio,
      title: audioForm.title.value,
      track: Number(audioForm.track?.value) === 2 ? 2 : 1,
    };
  }
}

function isSheetDirty() {
  if (readOnly) return false;
  syncFormsIntoState();
  if (state.sheet === 'newBoard' || state.sheet === 'editBoard') {
    return boardSnapshot(state.boardDraft) !== state.boardBaseline;
  }
  if (state.sheet === 'editScene') {
    return sceneSnapshot(state.editingScene) !== state.sceneBaseline;
  }
  if (state.sheet === 'editAudio') {
    return audioSnapshot(state.editingAudio) !== state.audioBaseline;
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
  state.editingAudio = null;
  state.audioBaseline = null;
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

function bindBoardMenuDismiss() {
  if (!state.boardMenuOpen) return;
  const menu = root.querySelector('.sb-menu');
  if (!menu) return;

  const onPointerDown = (e) => {
    if (menu.contains(e.target)) return;
    document.removeEventListener('pointerdown', onPointerDown, true);
    if (!state.boardMenuOpen) return;
    state.boardMenuOpen = false;
    render();
  };

  // Defer so the opening click does not immediately close the menu.
  setTimeout(() => {
    document.addEventListener('pointerdown', onPointerDown, true);
  }, 0);
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

  const editBoardForm = root.querySelector('#sb-edit-board-form');
  if (editBoardForm) {
    editBoardForm.addEventListener('submit', onRenameBoard);
    editBoardForm.addEventListener('input', syncFormsIntoState);
    const titleInput = editBoardForm.querySelector('[name="title"]');
    titleInput?.focus();
    titleInput?.select();
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
    const cameraInput = root.querySelector('#sb-photo-camera');
    if (cameraInput) {
      cameraInput.addEventListener('change', onPhotoSelected);
    }
  }

  const audioForm = root.querySelector('#sb-audio-form');
  if (audioForm) {
    audioForm.addEventListener('submit', onSaveAudio);
    audioForm.addEventListener('input', syncFormsIntoState);
    root.querySelectorAll('#sb-audio-track-seg [data-audio-track-opt]').forEach((btn) => {
      btn.addEventListener('click', () => {
        root.querySelectorAll('#sb-audio-track-seg [data-audio-track-opt]').forEach((b) => b.classList.remove('is-active'));
        btn.classList.add('is-active');
        root.querySelector('#sb-audio-track-input').value = btn.dataset.audioTrackOpt;
        syncFormsIntoState();
      });
    });
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

  const manageOnly = new Set([
    'new-board',
    'delete-board',
    'add-scene',
    'edit-scene',
    'delete-scene',
    'remove-photo',
    'pick-media',
    'toggle-public',
    'rename-board',
    'toggle-board-menu',
    'toggle-select-mode',
    'toggle-scene-select',
    'select-all-scenes',
    'deselect-all-scenes',
    'bulk-delete-scenes',
    'stop-record',
    'edit-audio',
    'delete-audio',
    'lane-add',
    'export-premiere',
    'export-fcp',
    'export-fcp-media',
  ]);
  if (readOnly && manageOnly.has(action)) {
    return;
  }

  if (action === 'lane-add') {
    e.stopPropagation();
    if (state.recording) return;
    const lane = el.dataset.insertLane || 'a_roll';
    const trackIndex = Number(el.dataset.audioTrack) === 2 ? 2 : 1;
    const sec = Math.round(clampPlayhead(state.playheadSec));
    // Explicit + on A/B: insert immediately at playhead.
    if (lane !== 'audio') {
      commitLaneInsert(lane, sec, trackIndex);
      return;
    }
    // Audio: place a confirm marker first so recording never starts by surprise.
    const wrap = document.getElementById('sb-timeline-wrap');
    const trackEl = wrap?.querySelector(
      `.sb-lane-track[data-insert-lane="audio"][data-audio-track="${trackIndex}"]`
    );
    const ghost = trackEl?.querySelector('.sb-lane-insert');
    if (!ghost || !trackEl) {
      commitLaneInsert(lane, sec, trackIndex);
      return;
    }
    const px = timelinePxPerSec();
    const tileW = Math.max(1, px * INSERT_TILE_SEC);
    wrap.querySelectorAll('.sb-lane-insert').forEach((g) => {
      if (g === ghost) return;
      g.classList.remove('is-visible', 'is-pending');
      g.setAttribute('aria-hidden', 'true');
    });
    ghost.style.width = `${tileW}px`;
    ghost.style.left = `${sec * px}px`;
    ghost.dataset.startSec = String(sec);
    ghost.classList.add('is-visible', 'is-pending');
    ghost.setAttribute('aria-hidden', 'false');
    const label = ghost.querySelector('.sb-lane-insert-label');
    if (label) {
      label.textContent = t.tapToConfirmRecord || 'Tap again to record';
    }
    pendingLaneInsert = { lane, track: trackIndex, sec, ghost };
    return;
  }

  if (action === 'stop-record') {
    stopAudioRecording();
    return;
  }

  if (action === 'toggle-board-menu') {
    state.boardMenuOpen = !state.boardMenuOpen;
    render();
    return;
  }

  if (action === 'toggle-playback') {
    e.stopPropagation();
    togglePlayback();
    return;
  }

  if (action === 'edit-audio' || action === 'view-audio') {
    if (el.dataset.didDrag === '1') {
      el.dataset.didDrag = '0';
      return;
    }
    const id = Number(el.dataset.id);
    const clip = (state.audio || []).find((a) => Number(a.id) === id);
    if (!clip) return;
    state.editingAudio = { ...clip, track: Number(clip.track) === 2 ? 2 : 1 };
    state.audioBaseline = audioSnapshot(state.editingAudio);
    openSheet('editAudio');
    return;
  }

  if (action === 'delete-audio') {
    const id = Number(el.dataset.id || state.editingAudio?.id);
    if (!id) return;
    if (!confirm(t.deleteAudio || 'Delete recording?')) return;
    try {
      await api.deleteAudio(id);
      state.audio = (state.audio || []).filter((a) => Number(a.id) !== id);
      closeSheet({ force: true });
      showToast(t.deleted || 'Deleted');
    } catch (err) {
      showToast(err.message || t.errorGeneric);
    }
    return;
  }

  if (action === 'toggle-select-mode') {
    state.selectMode = !state.selectMode;
    state.selectedSceneIds = [];
    state.selectAnchorId = null;
    if (state.selectMode) {
      state.mode = 'list';
    }
    render();
    return;
  }

  if (action === 'toggle-scene-select') {
    e.preventDefault();
    e.stopPropagation();
    const id = Number(el.dataset.id);
    if (!id) return;

    const ids = state.scenes.map((s) => Number(s.id));
    const clickIndex = ids.indexOf(id);
    if (clickIndex < 0) return;

    if (e.shiftKey && state.selectAnchorId != null) {
      const anchorIndex = ids.indexOf(Number(state.selectAnchorId));
      if (anchorIndex >= 0) {
        const from = Math.min(anchorIndex, clickIndex);
        const to = Math.max(anchorIndex, clickIndex);
        const range = ids.slice(from, to + 1);
        const selected = new Set(state.selectedSceneIds);
        range.forEach((rangeId) => selected.add(rangeId));
        state.selectedSceneIds = [...selected];
        render();
        return;
      }
    }

    if (isSceneSelected(id)) {
      state.selectedSceneIds = state.selectedSceneIds.filter((x) => x !== id);
    } else {
      state.selectedSceneIds = [...state.selectedSceneIds, id];
    }
    state.selectAnchorId = id;
    render();
    return;
  }

  if (action === 'select-all-scenes') {
    state.selectedSceneIds = state.scenes.map((s) => Number(s.id));
    state.selectAnchorId = state.selectedSceneIds[0] ?? null;
    render();
    return;
  }

  if (action === 'deselect-all-scenes') {
    state.selectedSceneIds = [];
    state.selectAnchorId = null;
    render();
    return;
  }

  if (action === 'bulk-delete-scenes') {
    await bulkDeleteSelectedScenes();
    return;
  }

  if (action === 'mode' && state.selectMode) {
    // View mode is locked while selecting.
    return;
  }

  if (action === 'new-board') {
    state.boardDraft = { title: '', aspect_ratio: '16:9' };
    state.boardBaseline = boardSnapshot(state.boardDraft);
    openSheet('newBoard');
    return;
  }

  if (action === 'toggle-public') {
    if (!state.board?.id) return;
    try {
      const next = !state.board.is_public;
      const updated = await api.updateBoard(state.board.id, { is_public: next });
      state.board = {
        ...state.board,
        is_public: !!updated.is_public,
        slug: updated.slug || state.board.slug,
        url: updated.url || state.board.url,
      };
      render();
      if (next) {
        const url = state.board.url || boardUrl(state.board.slug);
        try {
          if (url) await navigator.clipboard.writeText(url);
          showToast(t.linkCopied);
        } catch {
          showToast(t.publicHint);
        }
      }
    } catch (err) {
      showToast(err.message || t.errorGeneric);
    }
    return;
  }

  if (action === 'rename-board') {
    e.stopPropagation();
    e.preventDefault();
    if (!state.board?.id) return;
    state.boardMenuOpen = false;
    state.boardDraft = {
      title: state.board.title || '',
      aspect_ratio: state.board.aspect_ratio || '16:9',
    };
    state.boardBaseline = boardSnapshot(state.boardDraft);
    openSheet('editBoard');
    return;
  }

  if (action === 'copy-board-link') {
    const url = state.board?.url || boardUrl(state.board?.slug);
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast(t.linkCopied);
    } catch {
      showToast(url);
    }
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

  if (action === 'export-premiere' || action === 'export-fcp' || action === 'export-fcp-media') {
    e.stopPropagation();
    e.preventDefault();
    state.boardMenuOpen = false;
    render();
    const id = Number(el.dataset.id || state.board?.id);
    const format =
      action === 'export-fcp-media' ? 'fcp-media' : action === 'export-fcp' ? 'fcp' : 'premiere';
    try {
      showToast(t.saving || '…');
      await api.exportBoard(id, format);
      showToast(t.exportDone || 'Export downloaded');
    } catch (err) {
      showToast(err.message || t.errorGeneric);
    }
    return;
  }

  if (action === 'delete-board') {
    e.stopPropagation();
    e.preventDefault();
    state.boardMenuOpen = false;
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
    // In-app back always returns to the boards overview (not browser history),
    // so deep-linked board URLs don't leave the Storyboards app.
    await goToBoards();
    return;
  }

  if (action === 'mode') {
    stopPlayback({ keepHead: true });
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

  if (action === 'edit-scene' || action === 'view-scene') {
    if (el.dataset.didDrag === '1') {
      el.dataset.didDrag = '0';
      return;
    }
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

  if (action === 'pick-media') {
    e.preventDefault();
    openWpMediaLibrary();
    return;
  }

}

async function bulkDeleteSelectedScenes() {
  if (!state.board?.id || !state.selectedSceneIds.length) return;
  const count = state.selectedSceneIds.length;
  const message = (t.confirmDeleteSelected || 'Delete %d selected scenes? This cannot be undone.').replace(
    '%d',
    String(count)
  );
  if (!confirm(message)) return;

  try {
    setLoading(true);
    const result = await api.bulkDeleteScenes(state.board.id, state.selectedSceneIds);
    state.scenes = result.scenes || [];
    state.selectedSceneIds = [];
    state.selectAnchorId = null;
    if (!state.scenes.length) {
      state.selectMode = false;
    }
    showToast(t.scenesDeleted || 'Scenes deleted');
    render();
  } catch (err) {
    showToast(err.message || t.errorGeneric);
    await refreshBoard();
  } finally {
    setLoading(false);
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

async function onRenameBoard(e) {
  e.preventDefault();
  if (!state.board?.id) return;
  syncFormsIntoState();
  const title = (state.boardDraft.title || '').trim();
  if (!title) return;

  const prevSlug = state.board.slug;
  try {
    const updated = await api.updateBoard(state.board.id, { title });
    state.board = {
      ...state.board,
      title: updated.title || title,
      slug: updated.slug || state.board.slug,
      url: updated.url || state.board.url,
    };
    state.boards = state.boards.map((b) =>
      b.id === state.board.id
        ? { ...b, title: state.board.title, slug: state.board.slug, url: state.board.url }
        : b
    );
    setDocumentTitle(state.board.title);
    discardSheetState();
    clearSheetHistoryFlag();
    if (history.state?.storyboardsSheet) {
      history.back();
    }
    if (state.board.slug && state.board.slug !== prevSlug) {
      navigateBoardUrl(state.board.slug, { replace: true });
    }
    render();
    showToast(t.boardRenamed || t.saved || 'Saved');
  } catch (err) {
    showToast(err.message || t.errorGeneric);
  }
}

function isAllowedImageFile(file) {
  if (!file) return false;
  const type = String(file.type || '').toLowerCase();
  const name = String(file.name || '').toLowerCase();

  if (type.startsWith('video/') || /\.(mp4|mov|m4v|webm|avi|mkv|mpeg|mpg|3gp)$/i.test(name)) {
    return false;
  }

  if (type && ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(type)) {
    return true;
  }

  // Some devices omit MIME — allow by extension only for still photos.
  if (!type && /\.(jpe?g|png|webp)$/i.test(name)) {
    return true;
  }

  return ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'].includes(type);
}

async function applyPhotoFile(file) {
  if (!file) return;

  if (!isAllowedImageFile(file)) {
    showToast(t.imagesOnly || t.errorGeneric);
    return;
  }

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

async function onPhotoSelected(e) {
  const input = e.target;
  const file = input.files?.[0];
  if (!file) return;
  await applyPhotoFile(file);
  input.value = '';
}

function openWpMediaLibrary() {
  if (!window.wp?.media) {
    showToast(t.mediaLibraryUnavailable || t.errorGeneric);
    return;
  }

  syncFormsIntoState();

  if (!state.mediaFrame) {
    state.mediaFrame = window.wp.media({
      title: t.mediaLibraryTitle || t.chooseFromLibrary,
      button: { text: t.useSelectedPhoto || t.save },
      library: { type: 'image' },
      multiple: false,
    });

    state.mediaFrame.on('uploader:ready', () => {
      const uploader = state.mediaFrame?.uploader?.uploader;
      if (!uploader?.setOption) return;
      uploader.setOption('filters', {
        mime_types: [{ title: 'Images', extensions: 'jpg,jpeg,png,webp' }],
      });
      uploader.setOption('multi_selection', false);
    });

    state.mediaFrame.on('select', async () => {
      const attachment = state.mediaFrame.state().get('selection').first()?.toJSON();
      if (!attachment) return;

      const mime = String(attachment.mime || attachment.type || '').toLowerCase();
      if (mime.startsWith('video/') || (mime && !mime.startsWith('image/'))) {
        showToast(t.imagesOnly || t.errorGeneric);
        return;
      }

      const url =
        attachment.sizes?.large?.url ||
        attachment.sizes?.full?.url ||
        attachment.url;
      if (!url) {
        showToast(t.errorGeneric);
        return;
      }

      try {
        showToast(t.compressing);
        const res = await fetch(url, { credentials: 'same-origin' });
        if (!res.ok) throw new Error(t.errorGeneric);
        const blob = await res.blob();
        if (String(blob.type || '').toLowerCase().startsWith('video/')) {
          showToast(t.imagesOnly || t.errorGeneric);
          return;
        }
        const name = attachment.filename || attachment.name || 'library.jpg';
        const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
        await applyPhotoFile(file);
      } catch (err) {
        showToast(err.message || t.errorGeneric);
      }
    });
  }

  state.mediaFrame.open();
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
    const original = state.scenes.find((s) => s.id === scene.id);
    if (payload.role === 'b_roll') {
      if (original && original.role !== 'b_roll') {
        payload.start_sec = defaultBRollStart(payload.duration_sec);
      } else {
        const desired =
          scene.start_sec != null
            ? Number(scene.start_sec)
            : Number(original?.start_sec) || 0;
        payload.start_sec = resolveBRollStart(desired, payload.duration_sec, scene.id);
      }
    }
    saved = await api.updateScene(scene.id, payload);
  } else {
    if (payload.role === 'b_roll') {
      payload.start_sec = defaultBRollStart(payload.duration_sec);
    }
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

async function onSaveAudio(e) {
  e.preventDefault();
  if (!state.editingAudio?.id) return;
  syncFormsIntoState();
  const title = (state.editingAudio.title || '').trim() || (t.voiceOver || 'Voice over');
  const track = Number(state.editingAudio.track) === 2 ? 2 : 1;
  try {
    showToast(t.saving);
    const updated = await api.updateAudio(state.editingAudio.id, { title, track });
    state.audio = (state.audio || []).map((a) =>
      Number(a.id) === Number(updated.id) ? { ...a, ...updated } : a
    );
    discardSheetState();
    clearSheetHistoryFlag();
    if (history.state?.storyboardsSheet) {
      history.back();
    }
    render();
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

function initTimelineInteractions() {
  const wrap = document.getElementById('sb-timeline-wrap');
  if (!wrap) return;

  if (canManage) {
    wrap.querySelectorAll('[data-drag]').forEach((clip) => {
      clip.addEventListener('pointerdown', onTimelineDragStart);
    });
    initLaneInsert(wrap);
  }
  initPlayheadScrub(wrap);
  initTimelinePinchZoom(wrap);
  initPlayerControls();
}

/**
 * Pinch (mobile) / ctrl+wheel (desktop) to change seconds width.
 * Keeps the pinch midpoint (or cursor) anchored while zooming.
 */
function initTimelinePinchZoom(wrap) {
  let pinch = null; // { dist0, zoom0, anchorSec, anchorX }

  const touchDist = (a, b) => Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  const touchMidX = (a, b) => (a.clientX + b.clientX) / 2;

  const zoomAnchorAt = (clientX) => {
    const rect = wrap.getBoundingClientRect();
    const anchorX = clientX - rect.left;
    const px = timelinePxPerSec();
    const label = laneLabelPx();
    const contentX = wrap.scrollLeft + anchorX;
    const anchorSec = Math.max(0, (contentX - label) / Math.max(1e-6, px));
    return { anchorSec, anchorX };
  };

  const applyPinchZoom = (nextZoom, anchor) => {
    const z = clampTimelineZoom(nextZoom);
    if (Math.abs(z - state.timelineZoom) < 0.0005) return;
    state.timelineZoom = z;
    applyTimelineZoomLive(wrap, anchor);
  };

  wrap.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches.length !== 2) return;
      const d0 = Math.max(1, touchDist(e.touches[0], e.touches[1]));
      const mid = touchMidX(e.touches[0], e.touches[1]);
      timelinePinching = true;
      wrap.classList.add('is-pinching');
      pinch = {
        dist0: d0,
        zoom0: clampTimelineZoom(state.timelineZoom),
        ...zoomAnchorAt(mid),
      };
    },
    { passive: true }
  );

  wrap.addEventListener(
    'touchmove',
    (e) => {
      if (!pinch || e.touches.length !== 2) return;
      e.preventDefault();
      const d = Math.max(1, touchDist(e.touches[0], e.touches[1]));
      // Keep the midpoint under the fingers while zooming.
      const rect = wrap.getBoundingClientRect();
      pinch.anchorX = touchMidX(e.touches[0], e.touches[1]) - rect.left;
      applyPinchZoom(pinch.zoom0 * (d / pinch.dist0), pinch);
    },
    { passive: false }
  );

  const endPinch = () => {
    if (!pinch && !timelinePinching) return;
    pinch = null;
    timelinePinching = false;
    wrap.classList.remove('is-pinching');
    // Full re-render settles waveforms / insert tiles at the new scale.
    render();
  };

  wrap.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) endPinch();
  });
  wrap.addEventListener('touchcancel', endPinch);

  wrap.addEventListener(
    'wheel',
    (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const factor = Math.exp(-e.deltaY * 0.01);
      applyPinchZoom(state.timelineZoom * factor, zoomAnchorAt(e.clientX));
      clearTimeout(wrap._zoomWheelTimer);
      wrap._zoomWheelTimer = setTimeout(() => render(), 140);
    },
    { passive: false }
  );

  // iOS Safari page-zoom gestures on the timeline.
  wrap.addEventListener('gesturestart', (e) => e.preventDefault());
  wrap.addEventListener('gesturechange', (e) => e.preventDefault());
}

/** Live-update clip geometry after zoom without destroying the timeline DOM. */
function applyTimelineZoomLive(wrap, anchor) {
  const timeline = wrap.querySelector('.sb-timeline');
  if (!timeline) return;

  const px = timelinePxPerSec();
  const end = Math.max(timelineEndSec(), TIMELINE_BASE_SEC);
  const width = Math.ceil(end * px);
  const label = laneLabelPx();

  timeline.style.setProperty('--sb-sec', `${px}px`);
  timeline.style.width = `${width + label}px`;

  timeline.querySelectorAll('.sb-lane-track, .sb-ruler').forEach((el) => {
    el.style.width = `${width}px`;
  });

  timeline.querySelectorAll('.sb-film-clip[data-start]').forEach((clip) => {
    const start = Number(clip.dataset.start) || 0;
    const dur = Math.max(0.15, Number(clip.dataset.dur) || 1);
    const widthPx = dur * px;
    clip.style.left = `${start * px}px`;
    clip.style.width = `${Math.max(4, widthPx - (clip.id === 'sb-recording-clip' ? 0 : 1))}px`;
    clip.querySelectorAll('.sb-frame-cell').forEach((cell) => {
      cell.style.width = `${px}px`;
    });
  });

  timeline.querySelectorAll('.sb-tick[data-sec]').forEach((tick) => {
    tick.style.left = `${Number(tick.dataset.sec) * px}px`;
  });

  const head = document.getElementById('sb-playhead');
  if (head) head.style.left = `${playheadLeftPx()}px`;

  const tileW = Math.max(1, px * INSERT_TILE_SEC);
  timeline.querySelectorAll('.sb-lane-insert').forEach((ghost) => {
    if (ghost.classList.contains('is-visible') || ghost.style.width) {
      ghost.style.width = `${tileW}px`;
    }
  });

  if (anchor) {
    wrap.scrollLeft = Math.max(0, anchor.anchorSec * px + label - anchor.anchorX);
  }
}

function initPlayheadScrub(wrap) {
  const timeline = wrap.querySelector('.sb-timeline');
  if (!timeline) return;

  const scrubFromEvent = (e) => {
    if (e.target.closest('.sb-playhead-btn')) return;
    if (e.target.closest('.sb-film-clip')) return;
    if (e.target.closest('[data-insert-lane]')) return;
    if (e.target.closest('[data-scrub-start]')) return;
    const scrub = e.target.closest('[data-scrub]');
    if (!scrub) return;
    e.preventDefault();
    const rect = scrub.getBoundingClientRect();
    const x = Math.min(Math.max(0, e.clientX - rect.left), Math.max(0, rect.width));
    const sec = clampPlayhead(x / timelinePxPerSec());
    setPlayhead(sec, { stop: true });
  };

  wrap.querySelectorAll('[data-scrub]').forEach((el) => {
    el.addEventListener('pointerdown', scrubFromEvent);
  });

  wrap.querySelectorAll('[data-scrub-start]').forEach((el) => {
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      setPlayhead(0, { stop: true });
      startPlayback();
    });
  });
}

function initPlayerControls() {
  const scrub = document.getElementById('sb-player-scrub');
  if (!scrub) return;

  const seekFromEvent = (e) => {
    const rect = scrub.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / Math.max(1, rect.width)));
    setPlayhead(ratio * playerEndSec(), { stop: true });
  };

  scrub.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    scrub.setPointerCapture?.(e.pointerId);
    seekFromEvent(e);
    const onMove = (ev) => seekFromEvent(ev);
    const onUp = (ev) => {
      scrub.releasePointerCapture?.(ev.pointerId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  });
}

function setPlayhead(sec, { stop = false, renderPreview = true } = {}) {
  if (stop && state.playing) stopPlayback({ keepHead: true });
  state.playheadSec = clampPlayhead(sec);
  const head = document.getElementById('sb-playhead');
  if (head) head.style.left = `${playheadLeftPx(state.playheadSec)}px`;
  if (renderPreview) updatePreviewFrame(state.playheadSec);
  syncPlaybackAudio(state.playheadSec, state.playing);
}

function updatePreviewFrame(sec) {
  const clip = clipAtTime(sec);
  const stage = document.getElementById('sb-preview-stage');
  const timeEl = document.getElementById('sb-preview-time');
  const titleEl = document.getElementById('sb-preview-title');
  const fill = document.getElementById('sb-player-scrub-fill');
  const scrub = document.getElementById('sb-player-scrub');
  const end = playerEndSec();
  const clipId = clip ? String(clip.id) : '';
  const progress = Math.min(100, (clampPlayhead(sec) / end) * 100);

  if (timeEl) timeEl.textContent = `${formatPlayheadTime(sec)} / ${formatPlayheadTime(end)}`;
  if (titleEl) titleEl.textContent = clip?.title || (t.previewEmpty || 'No scene at playhead');
  if (fill) fill.style.width = `${progress}%`;
  if (scrub) scrub.setAttribute('aria-valuenow', String(Math.round(sec)));

  if (!stage) return;
  if (stage.dataset.clipId === clipId) return;
  stage.dataset.clipId = clipId;
  state.playPreviewId = clip ? clip.id : null;

  const media = clip?.image_url
    ? `<img src="${esc(clip.image_url)}" alt="" draggable="false">`
    : `<span class="sb-preview-empty">${esc(clip ? t.photo : (t.previewEmpty || '—'))}</span>`;
  const playLabel = state.playing ? (t.pausePreview || 'Pause') : (t.playPreview || 'Play');
  stage.innerHTML = `${media}
    <button
      type="button"
      class="sb-player-overlay-play${state.playing ? ' is-playing' : ''}"
      data-action="toggle-playback"
      aria-label="${esc(playLabel)}"
      title="${esc(playLabel)}"
    >${playbackIconSvg(state.playing)}</button>`;
  const overlayBtn = stage.querySelector('.sb-player-overlay-play');
  if (overlayBtn) overlayBtn.addEventListener('click', onActionClick);
}

function ensurePlaybackAudio(clip) {
  if (!clip?.url) return null;
  const id = String(clip.id);
  let el = state.playbackAudioEls.get(id);
  if (!el) {
    el = new Audio(clip.url);
    el.preload = 'auto';
    state.playbackAudioEls.set(id, el);
  }
  return el;
}

function syncPlaybackAudio(sec, playing) {
  const tNow = Number(sec) || 0;
  const active = new Set();
  for (const clip of layoutAudio()) {
    const id = String(clip.id);
    const el = ensurePlaybackAudio(clip);
    if (!el) continue;
    const inRange = tNow >= clip.start && tNow < clip.start + clip.dur;
    if (playing && inRange) {
      active.add(id);
      const offset = Math.max(0, tNow - clip.start);
      if (el.paused) {
        try {
          el.currentTime = offset;
          void el.play();
        } catch {
          /* autoplay / seek can fail — ignore */
        }
      } else if (Math.abs(el.currentTime - offset) > 0.35) {
        try {
          el.currentTime = offset;
        } catch {
          /* ignore */
        }
      }
    } else if (!el.paused) {
      el.pause();
    }
  }
  if (!playing) {
    state.playbackAudioEls.forEach((el) => {
      if (!el.paused) el.pause();
    });
  }
}

function tickPlayback(now) {
  if (!state.playing) {
    state.playRaf = null;
    return;
  }
  const elapsed = (now - state.playAnchorPerf) / 1000;
  const next = clampPlayhead(state.playAnchorSec + elapsed);
  state.playheadSec = next;
  const head = document.getElementById('sb-playhead');
  if (head) head.style.left = `${playheadLeftPx(next)}px`;
  updatePreviewFrame(next);
  syncPlaybackAudio(next, true);

  if (next >= timelineEndSec() - 0.001) {
    stopPlayback({ keepHead: true });
    return;
  }
  state.playRaf = requestAnimationFrame(tickPlayback);
}

function startPlayback() {
  if (state.recording) return;
  if (!state.scenes.length && !(state.audio || []).length) return;
  if (state.playheadSec >= timelineEndSec() - 0.05) {
    state.playheadSec = 0;
  }
  state.playing = true;
  state.playAnchorPerf = performance.now();
  state.playAnchorSec = state.playheadSec;
  syncPlaybackAudio(state.playheadSec, true);
  refreshPlayheadButtons();
  state.playRaf = requestAnimationFrame(tickPlayback);
}

function stopPlayback({ keepHead = false } = {}) {
  state.playing = false;
  if (state.playRaf) {
    cancelAnimationFrame(state.playRaf);
    state.playRaf = null;
  }
  syncPlaybackAudio(state.playheadSec, false);
  if (!keepHead) {
    /* playhead stays where it is */
  }
  refreshPlayheadButtons();
}

function refreshPlayheadButtons() {
  const playLabel = state.playing ? (t.pausePreview || 'Pause') : (t.playPreview || 'Play');
  document
    .querySelectorAll('.sb-playhead-btn, .sb-player-btn, .sb-player-overlay-play')
    .forEach((btn) => {
      btn.innerHTML = playbackIconSvg(state.playing);
      btn.setAttribute('aria-label', playLabel);
      btn.setAttribute('title', playLabel);
      btn.classList.toggle('is-playing', !!state.playing);
    });
}

function togglePlayback() {
  if (state.playing) stopPlayback({ keepHead: true });
  else startPlayback();
}

function disposePlaybackAudio() {
  state.playbackAudioEls.forEach((el) => {
    try {
      el.pause();
      el.removeAttribute('src');
      el.load();
    } catch {
      /* ignore */
    }
  });
  state.playbackAudioEls.clear();
}

function clearPendingLaneInsert() {
  pendingLaneInsert = null;
}

function commitLaneInsert(lane, sec, trackIndex = 1) {
  clearPendingLaneInsert();
  if (lane === 'audio') {
    startAudioRecording(sec, trackIndex);
    return;
  }
  if (lane === 'b_roll') {
    insertBRollAt(sec);
    return;
  }
  if (lane === 'a_roll') {
    insertARollAt(sec);
  }
}

function initLaneInsert(wrap) {
  if (state.recording) return;
  const px = timelinePxPerSec();
  const tileW = Math.max(1, px * INSERT_TILE_SEC);
  const coarse = isCoarsePointer();
  const ghosts = [...wrap.querySelectorAll('.sb-lane-insert')];

  const restoreGhostLabel = (ghost) => {
    const label = ghost.querySelector('.sb-lane-insert-label');
    if (label && ghost.dataset.insertLabel) {
      label.textContent = ghost.dataset.insertLabel;
    }
    ghost.classList.remove('is-pending');
  };

  const hideAllGhosts = (except = null) => {
    ghosts.forEach((g) => {
      if (g === except) return;
      g.classList.remove('is-visible', 'is-pending');
      g.setAttribute('aria-hidden', 'true');
      restoreGhostLabel(g);
    });
    if (!except) clearPendingLaneInsert();
  };

  const showGhost = (ghost, sec, { pending = false, lane = 'audio' } = {}) => {
    hideAllGhosts(ghost);
    ghost.style.width = `${tileW}px`;
    ghost.style.left = `${Math.max(0, sec) * px}px`;
    ghost.dataset.startSec = String(Math.max(0, sec));
    ghost.classList.add('is-visible');
    ghost.setAttribute('aria-hidden', 'false');
    const label = ghost.querySelector('.sb-lane-insert-label');
    if (pending && label) {
      ghost.classList.add('is-pending');
      label.textContent =
        lane === 'audio'
          ? t.tapToConfirmRecord || 'Tap again to record'
          : t.tapToConfirmInsert || 'Tap again to add';
    } else {
      restoreGhostLabel(ghost);
    }
  };

  const secFromClientX = (trackEl, clientX) => {
    const rect = trackEl.getBoundingClientRect();
    const x = Math.min(Math.max(0, clientX - rect.left), Math.max(0, rect.width - 1));
    return Math.max(0, Math.round(x / px));
  };

  hideAllGhosts();

  wrap.querySelectorAll('[data-insert-lane]').forEach((trackEl) => {
    const ghost = trackEl.querySelector('.sb-lane-insert');
    if (!ghost) return;
    ghost.style.width = `${tileW}px`;
    const lane = trackEl.dataset.insertLane || 'audio';
    const trackIndex = Number(trackEl.dataset.audioTrack) === 2 ? 2 : 1;

    if (!coarse) {
      trackEl.addEventListener('pointerenter', (e) => {
        if (e.target.closest('.sb-film-clip')) {
          hideAllGhosts();
          return;
        }
        showGhost(ghost, secFromClientX(trackEl, e.clientX), { lane });
      });
      trackEl.addEventListener('pointerleave', (e) => {
        const next = e.relatedTarget;
        if (next && trackEl.contains(next)) return;
        if (pendingLaneInsert?.ghost === ghost) return;
        ghost.classList.remove('is-visible', 'is-pending');
        ghost.setAttribute('aria-hidden', 'true');
        restoreGhostLabel(ghost);
      });
      trackEl.addEventListener('pointermove', (e) => {
        if (e.target.closest('.sb-film-clip')) {
          hideAllGhosts();
          return;
        }
        showGhost(ghost, secFromClientX(trackEl, e.clientX), { lane });
      });
    }

    trackEl.addEventListener('click', (e) => {
      if (state.recording) return;
      if (e.target.closest('.sb-film-clip')) return;
      e.preventDefault();

      // Second tap on the pending ghost confirms insert/record.
      if (
        coarse &&
        pendingLaneInsert &&
        pendingLaneInsert.ghost === ghost &&
        (e.target === ghost || ghost.contains(e.target))
      ) {
        commitLaneInsert(
          pendingLaneInsert.lane,
          pendingLaneInsert.sec,
          pendingLaneInsert.track
        );
        hideAllGhosts();
        return;
      }

      const sec = secFromClientX(trackEl, e.clientX);

      // Touch devices: first tap only reveals the + marker.
      if (coarse) {
        pendingLaneInsert = { lane, track: trackIndex, sec, ghost };
        showGhost(ghost, sec, { pending: true, lane });
        return;
      }

      hideAllGhosts();
      commitLaneInsert(lane, sec, trackIndex);
    });
  });
}

/**
 * Insert a new A-roll scene at the snapped timeline second (sort order).
 * @param {number} sec
 */
async function insertARollAt(sec) {
  if (!state.board?.id) return;
  const at = Math.max(0, Math.round(Number(sec) || 0));
  const aLayout = layoutARoll();
  let beforeId = null;
  for (let i = 0; i < aLayout.length; i++) {
    const c = aLayout[i];
    if (at < c.start + c.dur) {
      beforeId = at <= c.start + c.dur / 2 ? c.id : aLayout[i + 1]?.id ?? null;
      break;
    }
  }

  try {
    showToast(t.saving || '…');
    const created = await api.createScene(state.board.id, {
      title: '',
      role: 'a_roll',
      duration_sec: 3,
      description: '',
      script: '',
    });

    const ids = (state.scenes || [])
      .map((s) => Number(s.id))
      .filter((id) => id !== Number(created.id));

    let insertAt = ids.length;
    if (beforeId != null) {
      const idx = ids.indexOf(Number(beforeId));
      insertAt = idx >= 0 ? idx : ids.length;
    } else if (aLayout.length) {
      const lastA = aLayout[aLayout.length - 1];
      const idx = ids.indexOf(Number(lastA.id));
      insertAt = idx >= 0 ? idx + 1 : ids.length;
    }
    ids.splice(insertAt, 0, Number(created.id));

    state.scenes = await api.reorderScenes(state.board.id, ids);
    const scene = state.scenes.find((s) => Number(s.id) === Number(created.id)) || created;
    state.editingScene = { ...scene };
    state.sceneBaseline = sceneSnapshot(state.editingScene);
    state.pendingPhoto = null;
    state.removePhoto = false;
    openSheet('editScene');
    render();
  } catch (err) {
    showToast(err.message || t.errorGeneric);
    await refreshBoard();
  }
}

/**
 * Insert a new B-roll scene at start_sec.
 * @param {number} sec
 */
async function insertBRollAt(sec) {
  if (!state.board?.id) return;
  const desired = Math.max(0, Math.round(Number(sec) || 0));
  const durationSec = 3;
  const startSec = resolveBRollStart(desired, durationSec, null);

  try {
    showToast(t.saving || '…');
    const created = await api.createScene(state.board.id, {
      title: '',
      role: 'b_roll',
      duration_sec: durationSec,
      start_sec: startSec,
      description: '',
      script: '',
    });
    state.scenes = [...(state.scenes || []), created];
    state.editingScene = { ...created };
    state.sceneBaseline = sceneSnapshot(state.editingScene);
    state.pendingPhoto = null;
    state.removePhoto = false;
    openSheet('editScene');
    render();
  } catch (err) {
    showToast(err.message || t.errorGeneric);
    await refreshBoard();
  }
}

function audioTrackAtPoint(clientY) {
  const tracks = [...document.querySelectorAll('[data-audio-track]')];
  for (const trackEl of tracks) {
    const rect = trackEl.getBoundingClientRect();
    if (clientY >= rect.top && clientY <= rect.bottom) {
      return Number(trackEl.dataset.audioTrack) === 2 ? 2 : 1;
    }
  }
  // Snap to nearest audio track when dragging between/near lanes.
  let best = null;
  let bestDist = Infinity;
  for (const trackEl of tracks) {
    const rect = trackEl.getBoundingClientRect();
    const mid = (rect.top + rect.bottom) / 2;
    const dist = Math.abs(clientY - mid);
    if (dist < bestDist) {
      bestDist = dist;
      best = Number(trackEl.dataset.audioTrack) === 2 ? 2 : 1;
    }
  }
  return best;
}

function onTimelineDragStart(e) {
  if (!canManage || timelinePinching || (e.button != null && e.button !== 0)) return;
  const clip = e.currentTarget;
  const kind = clip.dataset.drag;
  const id = Number(clip.dataset.id);
  if (!kind || !id) return;

  const px = timelinePxPerSec();
  const startX = e.clientX;
  const startY = e.clientY;
  const originLeft = parseFloat(clip.style.left) || 0;
  const originTrack =
    kind === 'audio'
      ? Number(clip.closest('[data-audio-track]')?.dataset.audioTrack) === 2
        ? 2
        : 1
      : null;
  let moved = false;
  let hoverTrack = originTrack;
  clip.setPointerCapture?.(e.pointerId);
  clip.classList.add('is-dragging');

  const onMove = (ev) => {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    const nextLeft = Math.max(0, originLeft + dx);
    const snapped = Math.round(nextLeft / px) * px;
    clip.style.left = `${snapped}px`;

    if (kind === 'audio') {
      const nextTrack = audioTrackAtPoint(ev.clientY) || originTrack;
      hoverTrack = nextTrack;
      const home = clip.closest('[data-audio-track]');
      const homeTrack = Number(home?.dataset.audioTrack) === 2 ? 2 : 1;
      if (nextTrack && nextTrack !== homeTrack) {
        const target = document.querySelector(`[data-audio-track="${nextTrack}"]`);
        if (target && clip.parentElement !== target) {
          target.appendChild(clip);
        }
      } else if (home && clip.parentElement !== home && nextTrack === homeTrack) {
        home.appendChild(clip);
      }
      document.querySelectorAll('[data-audio-track]').forEach((el) => {
        el.classList.toggle('is-drop-target', Number(el.dataset.audioTrack) === Number(nextTrack));
      });
    }
  };

  const onUp = async (ev) => {
    clip.releasePointerCapture?.(ev.pointerId);
    clip.classList.remove('is-dragging');
    document.querySelectorAll('[data-audio-track].is-drop-target').forEach((el) => {
      el.classList.remove('is-drop-target');
    });
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);

    if (!moved) return;
    clip.dataset.didDrag = '1';
    let startSec = Math.max(0, Math.round((parseFloat(clip.style.left) || 0) / px));
    const dropTrack =
      kind === 'audio'
        ? audioTrackAtPoint(ev.clientY) || hoverTrack || originTrack
        : null;

    try {
      if (kind === 'scene') {
        const scene = state.scenes.find((s) => Number(s.id) === id);
        const dur = Math.max(1, Number(scene?.duration_sec) || 3);
        if (scene?.role === 'b_roll') {
          startSec = resolveBRollStart(startSec, dur, id);
        }
        const updated = await api.updateScene(id, { start_sec: startSec });
        state.scenes = state.scenes.map((s) => (s.id === id ? { ...s, ...updated } : s));
      } else if (kind === 'audio') {
        const payload = { start_sec: startSec };
        if (dropTrack && dropTrack !== originTrack) {
          payload.track = dropTrack;
        }
        const updated = await api.updateAudio(id, payload);
        state.audio = state.audio.map((a) => (a.id === id ? { ...a, ...updated } : a));
      }
      render();
    } catch (err) {
      showToast(err.message || t.errorGeneric);
      await refreshBoard();
    }
  };

  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onUp);
}

function pickAudioRecorderMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/aac',
    'audio/ogg;codecs=opus',
  ];
  for (const mime of candidates) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return '';
}

function extForAudioMime(mime) {
  const m = String(mime || '').toLowerCase();
  if (m.includes('mp4') || m.includes('aac') || m.includes('m4a')) return 'm4a';
  if (m.includes('ogg')) return 'ogg';
  if (m.includes('mpeg') || m.includes('mp3')) return 'mp3';
  return 'webm';
}

function clearRecordingTimers() {
  if (state.recordRaf) {
    cancelAnimationFrame(state.recordRaf);
    state.recordRaf = null;
  }
  if (state.recordMaxTimer) {
    clearTimeout(state.recordMaxTimer);
    state.recordMaxTimer = null;
  }
}

function sampleLiveRecordingPeak() {
  if (!state.recordAnalyser || !state.recordAnalyserData) return 0.12;
  state.recordAnalyser.getByteTimeDomainData(state.recordAnalyserData);
  let max = 0;
  for (let i = 0; i < state.recordAnalyserData.length; i += 1) {
    const v = Math.abs(state.recordAnalyserData[i] - 128) / 128;
    if (v > max) max = v;
  }
  return Math.max(0.08, Math.min(1, max * 1.35));
}

function tickRecordingMeter() {
  if (!state.recording) {
    state.recordRaf = null;
    return;
  }
  const elapsedMs = Math.min(AUDIO_MAX_SEC * 1000, Date.now() - state.recordStartedAt);
  const sec = elapsedMs / 1000;
  const progress = elapsedMs / (AUDIO_MAX_SEC * 1000);
  const bar = document.querySelector('.sb-bulk-bar.is-recording');
  if (bar) {
    const elapsedEl = bar.querySelector('.sb-rec-elapsed');
    const fill = bar.querySelector('.sb-recording-meter-fill');
    if (elapsedEl) elapsedEl.textContent = sec.toFixed(1);
    if (fill) fill.style.transform = `scaleX(${progress})`;
  }

  const live = document.getElementById('sb-recording-clip');
  if (live) {
    const px = timelinePxPerSec();
    const widthSec = Math.max(0.15, sec);
    const widthPx = widthSec * px;
    live.dataset.dur = String(widthSec);
    live.style.width = `${widthPx}px`;
    const timeEl = live.querySelector('.sb-rec-clip-time');
    if (timeEl) timeEl.textContent = `${sec.toFixed(1)}/${AUDIO_MAX_SEC}`;

    const bars = barCountForWidth(widthPx);
    const peak = sampleLiveRecordingPeak();
    let peaks = state.recordLivePeaks || [];
    if (peaks.length < bars) {
      peaks = [...peaks, ...Array(bars - peaks.length).fill(0.1)];
    }
    // Map elapsed progress into peak slots so the waveform grows with the clip.
    const idx = Math.min(bars - 1, Math.floor(progress * (bars - 1)));
    peaks[idx] = Math.max(peaks[idx] || 0.1, peak);
    // Soft decay for neighboring slots keeps the shape readable.
    if (idx > 0) peaks[idx - 1] = Math.max(peaks[idx - 1] * 0.92, peak * 0.55);
    state.recordLivePeaks = peaks.slice(0, bars);
    const host = document.getElementById('sb-recording-wave');
    if (host) {
      host.innerHTML = renderWaveformSvg(state.recordLivePeaks, widthPx, 28, { live: true });
    }
  }

  state.recordRaf = requestAnimationFrame(tickRecordingMeter);
}

async function startAudioRecording(insertSec = 0, track = 1) {
  if (state.recording) return;
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
    showToast(t.micUnsupported || t.errorGeneric);
    return;
  }

  stopPlayback({ keepHead: true });

  const startSec = Math.max(0, Math.round(Number(insertSec) || 0));
  const trackIndex = Number(track) === 2 ? 2 : 1;

  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const mime = pickAudioRecorderMime();
    const options = mime
      ? { mimeType: mime, audioBitsPerSecond: AUDIO_BITRATE }
      : { audioBitsPerSecond: AUDIO_BITRATE };
    let recorder;
    try {
      recorder = new MediaRecorder(stream, options);
    } catch {
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    }

    state.recordChunks = [];
    state.recordStartedAt = Date.now();
    state.recordInsertSec = startSec;
    state.recordInsertTrack = trackIndex;
    state.recordMime = recorder.mimeType || mime || 'audio/webm';
    state.mediaRecorder = recorder;
    state.recording = true;
    state.recordLivePeaks = [];
    clearRecordingTimers();

    try {
      if (!waveformAudioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) waveformAudioCtx = new AC();
      }
      if (waveformAudioCtx) {
        if (waveformAudioCtx.state === 'suspended') {
          await waveformAudioCtx.resume();
        }
        const source = waveformAudioCtx.createMediaStreamSource(stream);
        const analyser = waveformAudioCtx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        state.recordAnalyser = analyser;
        state.recordAnalyserData = new Uint8Array(analyser.fftSize);
      }
    } catch {
      state.recordAnalyser = null;
      state.recordAnalyserData = null;
    }

    recorder.ondataavailable = (ev) => {
      if (ev.data && ev.data.size > 0) state.recordChunks.push(ev.data);
    };
    recorder.onstop = async () => {
      clearRecordingTimers();
      state.recordAnalyser = null;
      state.recordAnalyserData = null;
      state.recordLivePeaks = [];
      stream.getTracks().forEach((tr) => tr.stop());
      const elapsedMs = Math.max(500, Date.now() - state.recordStartedAt);
      const durationSec = Math.min(
        AUDIO_MAX_SEC,
        Math.max(1, Math.round(elapsedMs / 1000))
      );
      const insertAt = state.recordInsertSec;
      const insertTrack = state.recordInsertTrack === 2 ? 2 : 1;
      const blobType = recorder.mimeType || state.recordMime || 'audio/webm';
      const blob = new Blob(state.recordChunks, { type: blobType });
      state.recordChunks = [];
      state.mediaRecorder = null;
      state.recording = false;
      state.recordInsertSec = 0;
      state.recordInsertTrack = 1;
      state.recordMime = '';
      render();

      if (!state.board?.id || blob.size < 1) return;
      if (blob.size > 1048576) {
        showToast(t.audioTooLarge || t.errorGeneric);
        return;
      }
      try {
        if (typeof api.createAudio !== 'function') {
          showToast(t.errorGeneric);
          return;
        }
        showToast(t.uploading);
        const ext = extForAudioMime(blobType);
        const clip = await api.createAudio(state.board.id, {
          blob,
          filename: `voiceover-${Date.now()}.${ext}`,
          title: t.voiceOver || 'Voice over',
          start_sec: insertAt,
          duration_sec: durationSec,
          track: insertTrack,
        });
        state.audio = [...(state.audio || []), clip];
        showToast(t.audioSaved || 'Recording saved');
        render();
      } catch (err) {
        showToast(err.message || t.errorGeneric);
      }
    };

    recorder.start(250);
    render();
    state.recordRaf = requestAnimationFrame(tickRecordingMeter);
    state.recordMaxTimer = setTimeout(() => {
      stopAudioRecording();
    }, AUDIO_MAX_SEC * 1000);
  } catch {
    clearRecordingTimers();
    state.recording = false;
    state.recordInsertSec = 0;
    state.recordInsertTrack = 1;
    state.recordAnalyser = null;
    state.recordAnalyserData = null;
    state.recordLivePeaks = [];
    showToast(t.micDenied || t.errorGeneric);
    render();
  }
}

function stopAudioRecording() {
  clearRecordingTimers();
  const rec = state.mediaRecorder;
  if (!rec || rec.state === 'inactive') {
    state.recording = false;
    state.recordInsertSec = 0;
    state.recordInsertTrack = 1;
    state.recordAnalyser = null;
    state.recordAnalyserData = null;
    state.recordLivePeaks = [];
    render();
    return;
  }
  if (rec.state === 'recording' || rec.state === 'paused') {
    rec.stop();
  }
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
    if (readOnly) {
      state.view = 'board';
      state.board = null;
      state.scenes = [];
      setDocumentTitle('');
    } else {
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
let timelineResizeTimer = null;
window.addEventListener('resize', () => {
  if (state.view !== 'board' || state.mode !== 'timeline') return;
  clearTimeout(timelineResizeTimer);
  timelineResizeTimer = setTimeout(() => render(), 120);
});

/** Block iOS Safari page pinch-zoom (viewport user-scalable is ignored there). */
function lockMobilePageZoom() {
  const block = (e) => e.preventDefault();
  document.addEventListener('gesturestart', block, { passive: false });
  document.addEventListener('gesturechange', block, { passive: false });
  document.addEventListener('gestureend', block, { passive: false });
}

async function boot() {
  lockMobilePageZoom();
  const slug = cfg.initialBoardSlug || parseBoardSlugFromLocation();
  if (slug) {
    await openBoardBySlug(slug, { push: false });
    return;
  }
  await loadBoards();
}

boot();
