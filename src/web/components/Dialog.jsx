import { useEffect, useRef } from "react";

/** Small modal built on <dialog>, so focus and Escape work without extra code. */
export default function Dialog({ open, onClose, title, children, actions }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      className="m-auto w-[min(32rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-xl backdrop:bg-slate-900/40"
    >
      {open && (
        <div className="space-y-4 p-6">
          <h2 className="text-lg font-semibold">{title}</h2>
          <div className="space-y-3 text-sm text-slate-700">{children}</div>
          <div className="flex flex-wrap justify-end gap-2 pt-2">{actions}</div>
        </div>
      )}
    </dialog>
  );
}
