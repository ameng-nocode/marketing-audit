"use client";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { startCheckAction } from "@/lib/actions";
import { IconArrow } from "./icons";
import { useLang } from "./lang";
import { Modal } from "./modal";

// Start the check (or run it again from scratch, which replaces the results and the report, so it asks first).
export function StartCheck({ id, again, hasReport }: { id: string; again?: boolean; hasReport?: boolean }) {
  const router = useRouter();
  const { tr } = useLang();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("id", id);
      await startCheckAction(fd);
      setOpen(false);
      router.refresh();
    });
  if (!again) return <button type="button" className="g-btn g-btn-sm" onClick={run} disabled={pending}>{pending ? tr("Starting", "开始中") : tr("Start check", "开始检查")}<IconArrow size={16} /></button>;
  return (
    <>
      <button type="button" className="g-pill" onClick={() => setOpen(true)} disabled={pending}>{pending ? tr("Starting", "开始中") : tr("Run again", "重新检查")}</button>
      <Modal
        open={open}
        title={tr("Run the check again?", "要重新检查吗?")}
        onClose={() => { if (!pending) setOpen(false); }}
        actions={
          <>
            <button type="button" className="g-ghost" onClick={() => setOpen(false)} disabled={pending} autoFocus>{tr("Cancel", "取消")}</button>
            <button type="button" className="g-btn g-btn-sm" onClick={run} disabled={pending}>{pending ? tr("Starting", "开始中") : tr("Run again", "重新检查")}</button>
          </>
        }
      >
        {tr(
          `Every step runs again from the start${hasReport ? ", and the new results replace the current report and its screenshots" : ""}. It takes about 10 minutes. Download the report first if you want to keep this one.`,
          `每个步骤都会从头再跑一次${hasReport ? ", 新的结果会换掉现在的报告和截图" : ""}. 大约要 10 分钟. 想留着这份报告的话, 先下载.`,
        )}
      </Modal>
    </>
  );
}
