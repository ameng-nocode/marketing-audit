-- Step 4B: TikTok through Apify when TikTok shows a puzzle. Their newest videos, and every paid Apify run.

create table tiktok_videos (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  step_id bigint not null references audit_steps(id) on delete cascade,
  handle text not null,
  video_id text not null,
  url text not null,
  views integer,
  likes integer,
  posted_on date,
  caption text,
  seconds integer,
  thumb_shot_id bigint references shots(id) on delete set null,
  position integer not null default 0,
  unique (audit_id, video_id)
);

create table apify_runs (
  id bigint generated always as identity primary key,
  audit_id bigint references audits(id) on delete cascade,
  actor text not null,
  target text,
  items integer,
  cost_usd numeric,
  ok boolean not null,
  note text,
  made_at timestamptz not null default now()
);
create index apify_runs_audit_idx on apify_runs (audit_id);
