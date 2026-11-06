import { sql } from "./db";
import type { Scene, StoryboardDetail, StoryboardSummary } from "./types";

type StoryboardRow = {
  id: string;
  title: string;
  summary: string;
  created_at: Date | string;
  updated_at: Date | string;
  scene_count: string | number;
  total_duration_seconds: string | number | null;
};

type SceneRow = {
  id: string;
  storyboard_id: string;
  position: number;
  description: string;
  duration_seconds: string | number;
  has_image: boolean;
  created_at: Date | string;
  updated_at: Date | string;
};

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toNumber(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

export async function listStoryboards(
  ownerId: string,
  stage: string,
): Promise<StoryboardSummary[]> {
  const rows = await sql<StoryboardRow>(
    `select
       s.id,
       s.title,
       s.summary,
       s.created_at,
       s.updated_at,
       count(c.id)::int as scene_count,
       coalesce(sum(c.duration_seconds), 0) as total_duration_seconds
     from storyboards s
     left join scenes c on c.storyboard_id = s.id
     where s.owner_id = $1 and s.stage = $2
     group by s.id
     order by s.updated_at desc`,
    [ownerId, stage],
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    summary: row.summary,
    sceneCount: toNumber(row.scene_count),
    totalDurationSeconds: toNumber(row.total_duration_seconds),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  }));
}

const MAX_STORYBOARDS_PER_OWNER = 40;
const MAX_SCENES_PER_BOARD = 60;
const MAX_IMAGES_PER_OWNER = 120;

export async function createStoryboard(
  ownerId: string,
  stage: string,
  title: string,
  summary = "",
): Promise<StoryboardSummary> {
  const counts = await sql<{ count: string | number }>(
    `select count(*)::int as count from storyboards where owner_id = $1 and stage = $2`,
    [ownerId, stage],
  );
  if (toNumber(counts[0]?.count) >= MAX_STORYBOARDS_PER_OWNER) {
    throw new Error("limit_reached");
  }

  const rows = await sql<{
    id: string;
    title: string;
    summary: string;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `insert into storyboards (owner_id, stage, title, summary)
     values ($1, $2, $3, $4)
     returning id, title, summary, created_at, updated_at`,
    [ownerId, stage, title.trim() || "Untitled storyboard", summary.trim()],
  );
  const row = rows[0];
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    sceneCount: 0,
    totalDurationSeconds: 0,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function getStoryboardOwned(
  id: string,
  ownerId: string,
  stage: string,
): Promise<StoryboardDetail | null> {
  const boards = await sql<{
    id: string;
    title: string;
    summary: string;
    created_at: Date | string;
    updated_at: Date | string;
  }>(
    `select id, title, summary, created_at, updated_at
     from storyboards
     where id = $1 and owner_id = $2 and stage = $3`,
    [id, ownerId, stage],
  );
  if (boards.length === 0) return null;
  const board = boards[0];
  const scenes = await listScenes(board.id);
  return {
    id: board.id,
    title: board.title,
    summary: board.summary,
    createdAt: toIso(board.created_at),
    updatedAt: toIso(board.updated_at),
    scenes,
  };
}

export async function updateStoryboard(
  id: string,
  ownerId: string,
  stage: string,
  patch: { title?: string; summary?: string },
): Promise<StoryboardDetail | null> {
  const owned = await getStoryboardOwned(id, ownerId, stage);
  if (!owned) return null;

  const title = patch.title?.trim() || owned.title;
  const summary =
    patch.summary === undefined ? owned.summary : patch.summary.trim();

  await sql(
    `update storyboards
     set title = $1, summary = $2, updated_at = now()
     where id = $3 and owner_id = $4 and stage = $5`,
    [title, summary, id, ownerId, stage],
  );
  return getStoryboardOwned(id, ownerId, stage);
}

export async function deleteStoryboard(
  id: string,
  ownerId: string,
  stage: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }>(
    `delete from storyboards
     where id = $1 and owner_id = $2 and stage = $3
     returning id`,
    [id, ownerId, stage],
  );
  return rows.length > 0;
}

function mapScene(row: SceneRow): Scene {
  return {
    id: row.id,
    storyboardId: row.storyboard_id,
    position: row.position,
    description: row.description,
    durationSeconds: toNumber(row.duration_seconds),
    hasImage: Boolean(row.has_image),
    imageUrl: row.has_image
      ? `/api/storyboards/${row.storyboard_id}/scenes/${row.id}/image?v=${encodeURIComponent(toIso(row.updated_at))}`
      : null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function listScenes(storyboardId: string): Promise<Scene[]> {
  const rows = await sql<SceneRow>(
    `select
       id,
       storyboard_id,
       position,
       description,
       duration_seconds,
       (image_bytes is not null) as has_image,
       created_at,
       updated_at
     from scenes
     where storyboard_id = $1
     order by position asc`,
    [storyboardId],
  );
  return rows.map(mapScene);
}

export async function touchStoryboard(storyboardId: string): Promise<void> {
  await sql(`update storyboards set updated_at = now() where id = $1`, [
    storyboardId,
  ]);
}

export async function createScene(
  storyboardId: string,
  ownerId: string,
  stage: string,
  input: { description?: string; durationSeconds?: number } = {},
): Promise<Scene | null> {
  const owned = await getStoryboardOwned(storyboardId, ownerId, stage);
  if (!owned) return null;
  if (owned.scenes.length >= MAX_SCENES_PER_BOARD) {
    throw new Error("limit_reached");
  }

  const nextPosition =
    owned.scenes.length === 0
      ? 1
      : Math.max(...owned.scenes.map((scene) => scene.position)) + 1;

  const rows = await sql<SceneRow>(
    `insert into scenes (storyboard_id, position, description, duration_seconds)
     values ($1, $2, $3, $4)
     returning
       id,
       storyboard_id,
       position,
       description,
       duration_seconds,
       (image_bytes is not null) as has_image,
       created_at,
       updated_at`,
    [
      storyboardId,
      nextPosition,
      input.description?.trim() ?? "",
      Math.max(0, Number(input.durationSeconds ?? 0)),
    ],
  );
  await touchStoryboard(storyboardId);
  return mapScene(rows[0]);
}

export async function updateScene(
  storyboardId: string,
  sceneId: string,
  ownerId: string,
  stage: string,
  patch: { description?: string; durationSeconds?: number; position?: number },
): Promise<Scene | null> {
  const owned = await getStoryboardOwned(storyboardId, ownerId, stage);
  if (!owned) return null;
  const existing = owned.scenes.find((scene) => scene.id === sceneId);
  if (!existing) return null;

  const description =
    patch.description === undefined
      ? existing.description
      : patch.description.trim();
  const durationSeconds =
    patch.durationSeconds === undefined
      ? existing.durationSeconds
      : Math.max(0, Number(patch.durationSeconds));
  const position =
    patch.position === undefined
      ? existing.position
      : Math.max(1, Math.floor(patch.position));

  const rows = await sql<SceneRow>(
    `update scenes
     set description = $1,
         duration_seconds = $2,
         position = $3,
         updated_at = now()
     where id = $4 and storyboard_id = $5
     returning
       id,
       storyboard_id,
       position,
       description,
       duration_seconds,
       (image_bytes is not null) as has_image,
       created_at,
       updated_at`,
    [description, durationSeconds, position, sceneId, storyboardId],
  );
  await touchStoryboard(storyboardId);
  return rows[0] ? mapScene(rows[0]) : null;
}

export async function deleteScene(
  storyboardId: string,
  sceneId: string,
  ownerId: string,
  stage: string,
): Promise<boolean> {
  const owned = await getStoryboardOwned(storyboardId, ownerId, stage);
  if (!owned) return false;

  const rows = await sql<{ id: string; position: number }>(
    `delete from scenes
     where id = $1 and storyboard_id = $2
     returning id, position`,
    [sceneId, storyboardId],
  );
  if (rows.length === 0) return false;

  await sql(
    `update scenes
     set position = position - 1, updated_at = now()
     where storyboard_id = $1 and position > $2`,
    [storyboardId, rows[0].position],
  );
  await touchStoryboard(storyboardId);
  return true;
}

export async function saveSceneImage(
  storyboardId: string,
  sceneId: string,
  ownerId: string,
  stage: string,
  mime: string,
  bytes: Buffer,
): Promise<Scene | null> {
  const owned = await getStoryboardOwned(storyboardId, ownerId, stage);
  if (!owned) return null;
  const target = owned.scenes.find((scene) => scene.id === sceneId);
  if (!target) return null;

  if (!target.hasImage) {
    const imageCounts = await sql<{ count: string | number }>(
      `select count(*)::int as count
       from scenes c
       join storyboards s on s.id = c.storyboard_id
       where s.owner_id = $1 and s.stage = $2 and c.image_bytes is not null`,
      [ownerId, stage],
    );
    if (toNumber(imageCounts[0]?.count) >= MAX_IMAGES_PER_OWNER) {
      throw new Error("limit_reached");
    }
  }

  const rows = await sql<SceneRow>(
    `update scenes
     set image_mime = $1, image_bytes = $2, updated_at = now()
     where id = $3 and storyboard_id = $4
     returning
       id,
       storyboard_id,
       position,
       description,
       duration_seconds,
       (image_bytes is not null) as has_image,
       created_at,
       updated_at`,
    [mime, bytes, sceneId, storyboardId],
  );
  await touchStoryboard(storyboardId);
  return rows[0] ? mapScene(rows[0]) : null;
}

export async function clearSceneImage(
  storyboardId: string,
  sceneId: string,
  ownerId: string,
  stage: string,
): Promise<Scene | null> {
  const owned = await getStoryboardOwned(storyboardId, ownerId, stage);
  if (!owned) return null;
  if (!owned.scenes.some((scene) => scene.id === sceneId)) return null;

  const rows = await sql<SceneRow>(
    `update scenes
     set image_mime = null, image_bytes = null, updated_at = now()
     where id = $1 and storyboard_id = $2
     returning
       id,
       storyboard_id,
       position,
       description,
       duration_seconds,
       (image_bytes is not null) as has_image,
       created_at,
       updated_at`,
    [sceneId, storyboardId],
  );
  await touchStoryboard(storyboardId);
  return rows[0] ? mapScene(rows[0]) : null;
}

export async function getSceneImage(
  storyboardId: string,
  sceneId: string,
  ownerId: string,
  stage: string,
): Promise<{ mime: string; bytes: Buffer } | null> {
  const boards = await sql<{ id: string }>(
    `select id from storyboards where id = $1 and owner_id = $2 and stage = $3`,
    [storyboardId, ownerId, stage],
  );
  if (boards.length === 0) return null;

  const rows = await sql<{ image_mime: string | null; image_bytes: Buffer | Uint8Array | null }>(
    `select image_mime, image_bytes
     from scenes
     where id = $1 and storyboard_id = $2`,
    [sceneId, storyboardId],
  );
  const row = rows[0];
  if (!row?.image_bytes || !row.image_mime) return null;
  const bytes = Buffer.isBuffer(row.image_bytes)
    ? row.image_bytes
    : Buffer.from(row.image_bytes);
  return { mime: row.image_mime, bytes };
}

export async function moveScene(
  storyboardId: string,
  sceneId: string,
  ownerId: string,
  stage: string,
  direction: "up" | "down",
): Promise<StoryboardDetail | null> {
  const owned = await getStoryboardOwned(storyboardId, ownerId, stage);
  if (!owned) return null;
  const index = owned.scenes.findIndex((scene) => scene.id === sceneId);
  if (index < 0) return null;
  const swapWith = direction === "up" ? index - 1 : index + 1;
  if (swapWith < 0 || swapWith >= owned.scenes.length) return owned;

  const a = owned.scenes[index];
  const b = owned.scenes[swapWith];
  // Temporary position to avoid unique constraint collision
  await sql(
    `update scenes set position = $1, updated_at = now() where id = $2`,
    [-a.position, a.id],
  );
  await sql(
    `update scenes set position = $1, updated_at = now() where id = $2`,
    [a.position, b.id],
  );
  await sql(
    `update scenes set position = $1, updated_at = now() where id = $2`,
    [b.position, a.id],
  );
  await touchStoryboard(storyboardId);
  return getStoryboardOwned(storyboardId, ownerId, stage);
}
