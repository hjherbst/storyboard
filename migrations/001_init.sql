create table if not exists storyboards (
  id uuid primary key default gen_random_uuid(),
  owner_id text not null,
  stage text not null default 'production',
  title text not null,
  summary text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists storyboards_owner_stage_idx
  on storyboards (owner_id, stage, updated_at desc);

create table if not exists scenes (
  id uuid primary key default gen_random_uuid(),
  storyboard_id uuid not null references storyboards (id) on delete cascade,
  position integer not null,
  description text not null default '',
  duration_seconds numeric(10, 2) not null default 0,
  image_mime text,
  image_bytes bytea,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (storyboard_id, position)
);

create index if not exists scenes_storyboard_position_idx
  on scenes (storyboard_id, position);
