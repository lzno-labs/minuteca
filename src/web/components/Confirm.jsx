import { createContext, useCallback, useContext, useRef, useState } from "react";
import { useI18n } from "../i18n";
import Dialog from "./Dialog";

const ConfirmContext = createContext(null);

/**
 * In-app confirmation instead of the browser's confirm(): readable in both themes, with the
 * consequence spelled out. const confirm = useConfirm(); if (await confirm({...})) ...
 */
export function ConfirmProvider({ children }) {
  const { t } = useI18n();
  const [ask, setAsk] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setAsk(options);
      }),
    [],
  );
  const close = (value) => {
    resolver.current?.(value);
    resolver.current = null;
    setAsk(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Dialog
        open={Boolean(ask)}
        onClose={() => close(false)}
        title={ask?.title}
        actions={
          <>
            <button type="button" onClick={() => close(false)} className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100">
              {ask?.cancelLabel || t("common.cancel")}
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => close(true)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold text-white ${ask?.danger ? "bg-rose-600 hover:bg-rose-700" : "bg-indigo-600 hover:bg-indigo-700"}`}
            >
              {ask?.confirmLabel}
            </button>
          </>
        }
      >
        {ask?.body && <p>{ask.body}</p>}
      </Dialog>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
