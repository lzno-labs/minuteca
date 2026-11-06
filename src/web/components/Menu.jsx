import { useEffect, useId, useRef, useState } from "react";

/**
 * A button that opens a small list of actions. Closes on Escape, on a click outside and after an
 * action. Items: { label, icon, onClick, href, danger, hidden } or "divider".
 */
export default function Menu({ label, icon: Icon, children, items, align = "right", buttonClassName = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const id = useId();

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const onKey = (e) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const visible = items.filter((i) => i && !i.hidden);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={() => setOpen((o) => !o)}
        className={
          buttonClassName ||
          "inline-flex items-center gap-1.5 rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300"
        }
      >
        {Icon && <Icon className="h-4 w-4" />}
        {children}
      </button>
      {open && (
        <div
          id={id}
          role="menu"
          className={`absolute z-40 mt-1 min-w-56 overflow-hidden rounded-xl border border-slate-200 bg-surface py-1 shadow-lg ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {visible.map((item, i) =>
            item === "divider" ? (
              <div key={`d${i}`} className="my-1 border-t border-slate-100" role="separator" />
            ) : item.content ? (
              <div key={i} className="px-3 py-2 text-sm text-slate-600">
                {item.content}
              </div>
            ) : (
              <button
                key={i}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false);
                  item.onClick?.();
                }}
                className={`flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm disabled:opacity-50 ${
                  item.danger ? "text-rose-700 hover:bg-rose-50" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {item.icon && <item.icon className="h-4 w-4 shrink-0" />}
                {item.label}
              </button>
            ),
          )}
        </div>
      )}
    </div>
  );
}
