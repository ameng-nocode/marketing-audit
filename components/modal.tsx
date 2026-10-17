"use client";
import { useEffect, useRef } from "react";

// The app's own pop-up (never the browser's confirm). Esc and a click outside cancel.
// The safe button gets focus first, never the destructive one.
export function Modal({ open, title, children, actions, onClose }: {
  open: boolean;
  title: string;
  children?: React.ReactNode;
  actions: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="modal g-card w-full max-w-md p-0 text-navy backdrop:bg-scrim"
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
    >
      <div className="flex flex-col gap-3 p-8">
        <h2 className="text-xl font-extrabold">{title}</h2>
        {children && <div className="text-lg font-medium text-navy-2">{children}</div>}
        <div className="mt-4 flex justify-end gap-2">{actions}</div>
      </div>
    </dialog>
  );
}
