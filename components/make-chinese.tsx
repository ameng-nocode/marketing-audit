"use client";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { makeChineseAction } from "@/lib/actions";
import { useLang } from "./lang";

// Shown when the app is in 中文 but this check only has the English report. One click: the AI writes it, the run panel shows the progress.
export function MakeChinese({ id }: { id: string }) {
  const router = useRouter();
  const { tr } = useLang();
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await makeChineseAction(fd);
      router.refresh();
    });
  return (
    <div className="g-card flex flex-wrap items-center gap-4 p-6">
      <div className="flex-1">
        <div className="text-xl font-extrabold">{tr("中文 report not written yet", "中文报告还没写")}</div>
        <div className="text-base font-medium text-navy-2">{tr("Below is the English one. The AI writes the 中文 one from the same findings. Takes about 5 minutes.", "下面是英文版. AI 会用同样的检查结果写中文版, 大约 5 分钟.")}</div>
      </div>
      <button type="button" className="g-btn g-btn-sm" onClick={run} disabled={pending}>{pending ? tr("Starting", "开始中") : tr("Write the 中文 report", "写中文报告")}</button>
    </div>
  );
}
