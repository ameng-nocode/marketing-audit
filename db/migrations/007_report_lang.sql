-- The report in English or 中文 (大马华语). The language picked at the start, and the words per language.

alter table audits add column report_lang text not null default 'en' check (report_lang in ('en', 'zh'));

alter table texts add column lang text not null default 'en' check (lang in ('en', 'zh'));
alter table texts drop constraint texts_audit_id_section_key_position_key;
alter table texts add constraint texts_audit_lang_key unique (audit_id, lang, section, key, position);

alter table funnels add column lang text not null default 'en' check (lang in ('en', 'zh'));

alter table reports add column lang text not null default 'en' check (lang in ('en', 'zh'));
alter table reports drop constraint reports_audit_id_kind_key;
alter table reports add constraint reports_audit_kind_lang_key unique (audit_id, kind, lang);
