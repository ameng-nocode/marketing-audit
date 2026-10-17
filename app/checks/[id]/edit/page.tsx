import { notFound } from "next/navigation";
import { Intake } from "@/components/intake";
import { getCheck } from "@/lib/checks";

// Edit opens the flow on the answers screen; Change jumps to the question to fix.
export default async function EditCheck({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getCheck(id);
  if (!c) notFound();
  return (
    <Intake
      id={c.id}
      initial={{
        facebook: c.facebook_url,
        name: c.name,
        website: c.website ?? "",
        description: c.description ?? "",
        price_low: c.price_low ? String(c.price_low) : "",
        price_high: c.price_high ? String(c.price_high) : "",
        price_unit: c.price_unit ?? "",
        profit: c.profit_rm ? String(c.profit_rm) : c.profit_pct ? String(c.profit_pct) : "",
        profit_kind: c.profit_pct ? "pct" : "rm",
        running_ads: c.running_ads,
      }}
      existing={c.uploads.map((u) => ({ id: u.id, name: u.original_name, size: u.size_bytes, src: `/files/${u.id}` }))}
    />
  );
}
