"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLang } from "./lang";

const TEXT: Record<string, [string, string]> = {
  started: ["Check started", "检查开始了"],
  updated: ["Changes saved", "已保存更改"],
  deleted: ["Check deleted", "检查已删除"],
  rewriting: ["Changes saved. Rewriting the report", "已保存. 正在重写报告"],
};

// Shows the result of the last action (?toast=started), then takes the word out of the address.
export function Toast() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const key = params.get("toast");
  const { tr } = useLang();
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!key || !TEXT[key]) return;
    setMsg(tr(...TEXT[key]));
    const rest = new URLSearchParams(params);
    rest.delete("toast");
    router.replace(rest.size ? `${path}?${rest}` : path, { scroll: false });
  }, [key, params, path, router, tr]);

  useEffect(() => {
    if (!msg) return;
    const t = setTimeout(() => setMsg(null), 3000);
    return () => clearTimeout(t);
  }, [msg]);

  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center px-4">
      {msg && <div className="rounded-full bg-navy px-6 py-3 text-lg font-bold text-panel shadow-lg">{msg}</div>}
    </div>
  );
}
