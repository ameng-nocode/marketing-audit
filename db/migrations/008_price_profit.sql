-- What they charge and what they keep from one sale, so the report can work out break-even from their own numbers.
-- Price in RM: one price = price_low only. Profit: RM per sale or margin %, either one; both empty = not sure.

alter table audits add column price_low numeric check (price_low > 0);
alter table audits add column price_high numeric check (price_high > 0);
alter table audits add column price_unit text;
alter table audits add column profit_rm numeric check (profit_rm > 0);
alter table audits add column profit_pct numeric check (profit_pct > 0 and profit_pct <= 100);
alter table audits add constraint audits_price_range check (price_high is null or price_low is null or price_high >= price_low);
alter table audits add constraint audits_profit_one check (profit_rm is null or profit_pct is null);

-- What one Ads Manager result is (a chat, a lead form, a purchase ...), and the ROAS when the row shows it.
alter table ads_manager_rows add column result_type text check (result_type in ('chat', 'lead', 'purchase', 'click', 'other'));
alter table ads_manager_rows add column roas numeric;
