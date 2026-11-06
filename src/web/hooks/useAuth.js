import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";
import { db } from "../lib/db";

/**
 * The signed-in person (GET /api/me), or null when signed out. undefined while loading.
 * Signing in is an email link (LoginScreen and AccessScreen).
 */
export function useAuth() {
  const [me, setMe] = useState(undefined);
  const [offline, setOffline] = useState(false);

  const reload = useCallback(async () => {
    try {
      setMe(await api("/me"));
      setOffline(false);
    } catch (err) {
      if (err?.status === 401) setMe(null);
      // Offline: keep what we had, so a recording can still start; the server checks again on upload.
      else {
        setOffline(true);
        setMe((m) => (m === undefined ? null : m));
      }
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  /** Also clears this device's unfinished recordings of the account that leaves. */
  const signOut = async () => {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    try {
      await db.delete();
    } catch {
      // Another tab holds the database; it is cleared on its next sign-out.
    }
    window.location.assign("/");
  };

  return { me, loading: me === undefined, offline, reload, signOut };
}
