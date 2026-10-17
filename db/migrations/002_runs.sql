-- Running a check: each run has steps; each step saves facts and screenshots.

alter table businesses add column facebook_page_id text;
alter table audits add column started_at timestamptz;
alter table audits add column finished_at timestamptz;

-- One row per step of a run (website, facebook, instagram ...). Retry resets just that row.
create table audit_steps (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  check_no integer not null check (check_no between 1 and 6),
  key text not null,
  label text not null,
  position integer not null,
  status text not null default 'waiting' check (status in ('waiting', 'running', 'done', 'not_checked', 'skipped', 'failed')),
  note text,
  started_at timestamptz,
  finished_at timestamptz,
  unique (audit_id, key)
);
create index audit_steps_audit_idx on audit_steps (audit_id, position);

-- Screenshot proof. The file lives under UPLOADS_DIR/<audit id>/shots/.
create table shots (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  step_id bigint references audit_steps(id) on delete cascade,
  kind text not null default 'page' check (kind in ('page', 'logo')),
  file text not null,
  caption text not null,
  source_url text,
  created_at timestamptz not null default now()
);
create index shots_audit_idx on shots (audit_id);

-- One fact per row: what was found, its status and the proof behind it.
create table facts (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  step_id bigint not null references audit_steps(id) on delete cascade,
  check_no integer not null check (check_no between 1 and 6),
  key text not null,
  label text not null,
  value text,
  note text,
  status text not null check (status in ('ok', 'none', 'weak', 'info', 'not_checked')),
  source_url text,
  shot_id bigint references shots(id) on delete set null,
  position integer not null default 0,
  created_at timestamptz not null default now()
);
create index facts_audit_idx on facts (audit_id, check_no, position);

-- The newest Facebook Reels: views now, post date filled by the next step.
create table reels (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  step_id bigint not null references audit_steps(id) on delete cascade,
  reel_id text not null,
  url text not null,
  views_text text,
  views integer,
  posted_on date,
  position integer not null,
  unique (audit_id, reel_id)
);
