-- The business, each check of it, and the Ads Manager screenshots added to a check.

-- One row per Facebook page. The same page entered again = the same business, a new check.
create table businesses (
  id bigint generated always as identity primary key,
  name text not null,
  facebook_url text not null unique,
  website text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One row per marketing check.
create table audits (
  id bigint generated always as identity primary key,
  business_id bigint not null references businesses(id),
  description text,
  running_ads text not null check (running_ads in ('yes', 'no', 'not_sure')),
  status text not null default 'not_started',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index audits_business_idx on audits (business_id);
create index audits_created_idx on audits (created_at desc);

-- Files on disk under UPLOADS_DIR/<audit id>/; this row is the record of each one.
create table uploads (
  id bigint generated always as identity primary key,
  audit_id bigint not null references audits(id) on delete cascade,
  kind text not null check (kind in ('ads_manager')),
  file text not null,
  original_name text not null,
  mime text not null,
  size_bytes integer not null,
  created_at timestamptz not null default now()
);
create index uploads_audit_idx on uploads (audit_id);
