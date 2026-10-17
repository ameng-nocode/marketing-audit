"use client";
import { useState, useTransition } from "react";
import { deleteCheckAction } from "@/lib/actions";
import { IconTrash } from "./icons";
import { useLang } from "./lang";
import { Modal } from "./modal";

export function DeleteCheck({ id, name, shots }: { id: string; name: string; shots: number }) {
  const { tr } = useLang();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const run = () => {
    const fd = new FormData();
    fd.set("id", id);
    start(() => deleteCheckAction(fd));
  };
  return (
    <>
      <button type="button" className="g-danger" onClick={() => setOpen(true)}>
        <IconTrash size={16} />{tr("Delete", "删除")}
      </button>
      <Modal
        open={open}
        title={tr(`Delete the check for ${name}?`, `删除 ${name} 的检查?`)}
        onClose={() => { if (!pending) setOpen(false); }}
        actions={
          <>
            <button type="button" className="g-ghost" onClick={() => setOpen(false)} disabled={pending} autoFocus>{tr("Cancel", "取消")}</button>
            <button type="button" className="g-danger-solid" onClick={run} disabled={pending}>{tr("Delete check", "删除检查")}</button>
          </>
        }
      >
        {tr(
          `This removes what was entered${shots ? ` and its ${shots === 1 ? "screenshot" : `${shots} screenshots`}` : ""}. It can't be undone.`,
          `填的资料${shots ? `和 ${shots} 张截图` : ""}都会被删掉. 删了就不能拿回来.`,
        )}
      </Modal>
    </>
  );
}
