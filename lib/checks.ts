import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { one, q, tx } from "./db";
import type { Lang } from "./i18n";
import { bareUnit, checkFields, checkFile, IMAGE_TYPES, MAX_FILES, normalizeFacebook, normalizeWebsite, parseMoney, parsePct, type FieldErrors } from "./format";

// Screenshots live on disk; the uploads table holds the record. UPLOADS_DIR lets the test copy use its own folder.
export const uploadsDir = () => path.resolve(process.cwd(), process.env.UPLOADS_DIR || path.join(".data", "uploads"));

export type CheckRow = {
  id: string;
  name: string;
  facebook_url: string;
  website: string | null;
  running_ads: string;
  status: string;
  created_at: string;
  shots: number;
};

export type Upload = { id: string; original_name: string; size_bytes: number; mime: string; file: string };

export type Money = { price_low: number | null; price_high: number | null; price_unit: string | null; profit_rm: number | null; profit_pct: number | null };
export type Check = CheckRow & Money & { business_id: string; description: string | null; report_lang: Lang; uploads: Upload[] };

export async function listChecks(): Promise<CheckRow[]> {
  return q<CheckRow>(
    `select a.id::text, b.name, b.facebook_url, b.website, a.running_ads, a.status, a.created_at,
            (select count(*)::int from uploads u where u.audit_id = a.id) as shots
       from audits a join businesses b on b.id = a.business_id
      order by a.created_at desc, a.id desc`,
  );
}

export async function getCheck(id: string): Promise<Check | undefined> {
  if (!/^\d+$/.test(id)) return undefined;
  const c = await one<Omit<Check, "uploads" | "shots">>(
    `select a.id::text, a.business_id::text, b.name, b.facebook_url, b.website, a.description, a.running_ads, a.report_lang, a.status, a.created_at,
            a.price_low::float8 price_low, a.price_high::float8 price_high, a.price_unit, a.profit_rm::float8 profit_rm, a.profit_pct::float8 profit_pct
       from audits a join businesses b on b.id = a.business_id where a.id = $1`,
    [id],
  );
  if (!c) return undefined;
  const uploads = await q<Upload>(
    `select id::text, original_name, size_bytes, mime, file from uploads where audit_id = $1 order by id`,
    [id],
  );
  return { ...c, uploads, shots: uploads.length };
}

export async function getUpload(id: string): Promise<Upload | undefined> {
  if (!/^\d+$/.test(id)) return undefined;
  return one<Upload>(`select id::text, original_name, size_bytes, mime, file from uploads where id = $1`, [id]);
}

export type SaveResult = { id: string; moneyChanged: boolean } | { errors: FieldErrors };

// Create (no id) or edit (id) one check from the form.
export async function saveCheck(fd: FormData, id?: string): Promise<SaveResult> {
  const v = {
    facebook: String(fd.get("facebook") ?? ""),
    name: String(fd.get("name") ?? ""),
    website: String(fd.get("website") ?? ""),
    description: String(fd.get("description") ?? "").trim(),
    running_ads: String(fd.get("running_ads") ?? ""),
    price_low: String(fd.get("price_low") ?? ""),
    price_high: String(fd.get("price_high") ?? ""),
    profit: String(fd.get("profit") ?? ""),
    profit_kind: fd.get("profit_kind") === "pct" ? "pct" : "rm",
  };
  const unit = bareUnit(String(fd.get("price_unit") ?? "")).slice(0, 60) || null;
  // The app's language when the form was sent: error words, and the report language of a new check.
  const lang = fd.get("report_lang") === "zh" ? "zh" : "en";
  const t = (en: string, zh: string) => (lang === "zh" ? zh : en);
  const errors = checkFields(v, lang);
  const yes = v.running_ads === "yes";
  // Screenshots belong to "Running ads = Yes"; any other answer drops them.
  const files = yes ? fd.getAll("files").filter((f): f is File => f instanceof File && f.size > 0) : [];
  const removeIds = new Set(fd.getAll("remove").map(String));

  const existing = id ? (await getCheck(id))?.uploads : [];
  if (id && !existing) return { errors: { name: t("This check no longer exists.", "这个检查已经不在了.") } };
  const toRemove = (existing ?? []).filter((u) => !yes || removeIds.has(u.id));
  const kept = (existing ?? []).length - toRemove.length;

  const fileError = files.map((f) => checkFile(f, lang)).find(Boolean);
  if (fileError) errors.files = fileError;
  else if (kept + files.length > MAX_FILES) errors.files = t(`Up to ${MAX_FILES} screenshots per check.`, `每个检查最多 ${MAX_FILES} 张截图.`);
  if (Object.keys(errors).length) return { errors };

  const facebook = normalizeFacebook(v.facebook)!;
  const website = v.website.trim() ? normalizeWebsite(v.website) : null;
  // Price and profit: empty boxes = not sure (stored as null).
  const lo = v.price_low.trim() ? parseMoney(v.price_low) : null;
  const hi = v.price_high.trim() ? parseMoney(v.price_high) : null;
  const money = {
    price_low: lo, price_high: hi && hi !== lo ? hi : null, price_unit: lo ? unit : null,
    profit_rm: v.profit.trim() && v.profit_kind === "rm" ? parseMoney(v.profit) : null,
    profit_pct: v.profit.trim() && v.profit_kind === "pct" ? parsePct(v.profit) : null,
  };
  let moneyChanged = false;
  const written: string[] = [];
  try {
    const auditId = await tx(async (t) => {
      const [biz] = await t<{ id: string }>(
        `insert into businesses (name, facebook_url, website) values ($1, $2, $3)
         on conflict (facebook_url) do update set name = excluded.name,
           website = case when $4 then excluded.website else coalesce(excluded.website, businesses.website) end,
           updated_at = now()
         returning id::text`,
        [v.name.trim(), facebook, website, !!id],
      );
      let aid = id;
      if (aid) {
        const [old] = await t<{ business_id: string }>(`select business_id::text from audits where id = $1`, [aid]);
        await t(
          `update audits set business_id = $2, description = $3, running_ads = $4, updated_at = now() where id = $1`,
          [aid, biz.id, v.description || null, v.running_ads],
        );
        const [was] = await t<Money>(`select price_low::float8 price_low, price_high::float8 price_high, price_unit, profit_rm::float8 profit_rm, profit_pct::float8 profit_pct from audits where id = $1`, [aid]);
        moneyChanged = (Object.keys(money) as (keyof Money)[]).some((k) => (was[k] ?? null) !== money[k]);
        // A business with no checks left (its Facebook link was changed) goes too.
        if (old && old.business_id !== biz.id) {
          await t(`delete from businesses where id = $1 and not exists (select 1 from audits where business_id = $1)`, [old.business_id]);
        }
      } else {
        const [a] = await t<{ id: string }>(
          `insert into audits (business_id, description, running_ads, report_lang) values ($1, $2, $3, $4) returning id::text`,
          [biz.id, v.description || null, v.running_ads, lang],
        );
        aid = a.id;
      }
      await t(`update audits set price_low = $2, price_high = $3, price_unit = $4, profit_rm = $5, profit_pct = $6 where id = $1`,
        [aid, money.price_low, money.price_high, money.price_unit, money.profit_rm, money.profit_pct]);
      if (toRemove.length) await t(`delete from uploads where id = any($1::bigint[])`, [toRemove.map((u) => u.id)]);
      const dir = path.join(uploadsDir(), aid);
      if (files.length) fs.mkdirSync(dir, { recursive: true });
      for (const f of files) {
        const name = `${crypto.randomUUID()}.${IMAGE_TYPES[f.type]}`;
        const full = path.join(dir, name);
        fs.writeFileSync(full, Buffer.from(await f.arrayBuffer()));
        written.push(full);
        await t(
          `insert into uploads (audit_id, kind, file, original_name, mime, size_bytes) values ($1, 'ads_manager', $2, $3, $4, $5)`,
          [aid, `${aid}/${name}`, f.name.slice(0, 200) || name, f.type, f.size],
        );
      }
      return aid;
    });
    for (const u of toRemove) fs.rmSync(path.join(uploadsDir(), u.file), { force: true });
    return { id: auditId, moneyChanged };
  } catch (e) {
    // The database rolled back, so the files written for it go too.
    for (const f of written) fs.rmSync(f, { force: true });
    throw e;
  }
}

export async function deleteCheck(id: string): Promise<boolean> {
  if (!/^\d+$/.test(id)) return false;
  const gone = await tx(async (t) => {
    const [a] = await t<{ business_id: string }>(`delete from audits where id = $1 returning business_id::text`, [id]);
    if (!a) return false;
    await t(`delete from businesses where id = $1 and not exists (select 1 from audits where business_id = $1)`, [a.business_id]);
    return true;
  });
  if (gone) fs.rmSync(path.join(uploadsDir(), id), { recursive: true, force: true });
  return gone;
}
