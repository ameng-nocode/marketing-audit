-- Checks 4 to 6 (competitors, call to action, creative) and the report (check 7 in the run list).

alter table audit_steps drop constraint audit_steps_check_no_check;
alter table audit_steps add constraint audit_steps_check_no_check check (check_no between 1 and 7);
alter table shots drop constraint shots_kind_check;
alter table shots add constraint shots_kind_check check (kind in ('page', 'logo', 'ad', 'frames', 'fold'));

-- Ads from the Ad Library: their own (own = true) and competitors' (from the keyword searches).
create table ads (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  step_id bigint not null references audit_steps(id) on delete cascade,
  own boolean not null default false,
  library_id text not null,
  page_name text,
  started_on date,
  versions integer,
  body text,
  cta text,
  search_word text,
  -- AI picks the real competitors and says why
  picked boolean not null default false,
  closest boolean not null default false,
  pick_reason text,
  sells_to text,
  offer text,
  funnel text,
  -- filled when the ad itself is opened
  opened boolean not null default false,
  format text,
  video_seconds numeric,
  full_text text,
  landing_url text,
  page_url text,
  followers text,
  shot_id bigint references shots(id) on delete set null,
  frames_shot_id bigint references shots(id) on delete set null,
  position integer not null default 0,
  unique (audit_id, library_id)
);
create index ads_audit_idx on ads (audit_id, own, position);

-- The ways competitors sell through ads (A offer to store, B video to WhatsApp ...), named by the AI.
create table funnels (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  letter text not null,
  name text not null,
  note text,
  position integer not null default 0
);
create table funnel_steps (
  id bigint generated always as identity primary key,
  funnel_id bigint not null references funnels(id) on delete cascade,
  label text not null,
  position integer not null default 0
);

-- Reel frames saved by the reel dates step, for the hook check.
alter table reels add column frames_shot_id bigint references shots(id) on delete set null;
alter table reels add column caption text;

-- The first 3 seconds of a video (their Reels and ads, competitors' ads), judged by the AI.
create table hooks (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  step_id bigint not null references audit_steps(id) on delete cascade,
  ad_id bigint references ads(id) on delete cascade,
  reel_id bigint references reels(id) on delete cascade,
  own boolean not null,
  frames_shot_id bigint references shots(id) on delete set null,
  shows text,
  rating text not null check (rating in ('strong', 'ok', 'weak')),
  why text,
  fix text,
  position integer not null default 0
);

-- Landing pages: their website and the closest competitor's, desktop and phone, top of the page.
create table landings (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  step_id bigint not null references audit_steps(id) on delete cascade,
  own boolean not null,
  ad_id bigint references ads(id) on delete set null,
  label text not null,
  url text not null,
  http_status integer,
  headline text,
  headline_words integer,
  buttons_above text,
  platform text,
  has_meta boolean,
  has_ga boolean,
  has_whatsapp boolean,
  page_text text,
  desktop_shot_id bigint references shots(id) on delete set null,
  mobile_shot_id bigint references shots(id) on delete set null,
  position integer not null default 0
);
-- The above-the-fold checklist per landing page (headline, offer, button, reviews ...), judged by the AI.
create table landing_checks (
  id bigint generated always as identity primary key,
  landing_id bigint not null references landings(id) on delete cascade,
  item text not null,
  result text not null check (result in ('ok', 'weak', 'none')),
  note text,
  position integer not null default 0
);

-- Rows the AI read from the Ads Manager screenshots.
create table ads_manager_rows (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  upload_id bigint references uploads(id) on delete cascade,
  campaign text not null,
  kind text not null check (kind in ('sales', 'leads', 'traffic', 'engagement', 'hiring', 'other')),
  delivery text,
  spent numeric,
  spent_text text,
  results text,
  result_count numeric,
  cost_per_result text,
  read text,
  position integer not null default 0
);

-- Words the AI wrote for the report, one row per piece (section, key, position).
create table texts (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  section text not null,
  key text not null,
  position integer not null default 0,
  body text not null,
  unique (audit_id, section, key, position)
);

-- The finished report page and anything the text check flagged.
create table reports (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  kind text not null check (kind in ('internal', 'client')),
  html text not null,
  flags text,
  made_at timestamptz not null default now(),
  unique (audit_id, kind)
);

-- Every AI call: what for, which model, how long, what it cost.
create table ai_calls (
  id bigint generated always as identity primary key,
  audit_id bigint references audits(id) on delete cascade,
  task text not null,
  model text not null,
  seconds numeric,
  cost_usd numeric,
  ok boolean not null,
  note text,
  made_at timestamptz not null default now()
);
create index ai_calls_audit_idx on ai_calls (audit_id);
