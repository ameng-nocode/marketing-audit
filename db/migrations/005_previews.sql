-- Step 4: a first-frame picture for every Reel, and each ad's own picture (cut out of the Ad Library box).
alter table shots drop constraint shots_kind_check;
alter table shots add constraint shots_kind_check check (kind in ('page', 'logo', 'ad', 'frames', 'fold', 'thumb', 'creative'));
alter table reels add column thumb_shot_id bigint references shots(id) on delete set null;
alter table ads add column creative_shot_id bigint references shots(id) on delete set null;
