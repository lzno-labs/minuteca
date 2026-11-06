import { useEffect, useState } from "react";
import { AlertTriangle, ArrowLeft, Loader2, ShieldCheck, Trash2, UserPlus, Users } from "lucide-react";
import { api } from "../lib/api";

const listUsers = () => api("/users").then((d) => d.users);
const saveUser = (email, role) => api("/users", { method: "POST", body: { email, role } }).then((d) => d.users);
const removeUser = (email) => api(`/users/${encodeURIComponent(email)}`, { method: "DELETE" }).then((d) => d.users);
import { useI18n } from "../i18n";

const ROLES = ["member", "admin"];

/** Admin-only screen to manage who can sign in and transcribe. */
export default function UsersPanel({ currentEmail, onBack }) {
  const { t, locale } = useI18n();
  const [users, setUsers] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null); // email being changed, or "add"
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("member");

  useEffect(() => {
    listUsers().then(setUsers, (err) => setError(err.message));
  }, []);

  const run = async (key, fn) => {
    setBusy(key);
    setError(null);
    try {
      setUsers(await fn());
      return true;
    } catch (err) {
      setError(err.message);
      return false;
    } finally {
      setBusy(null);
    }
  };

  const add = async (e) => {
    e.preventDefault();
    if (await run("add", () => saveUser(email.trim(), role))) {
      setEmail("");
      setRole("member");
    }
  };

  const input =
    "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200";

  return (
    <div className="space-y-5">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800"
      >
        <ArrowLeft className="h-4 w-4" /> {t("users.back")}
      </button>

      <header>
        <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight text-slate-900">
          <Users className="h-6 w-6 text-slate-500" /> {t("users.title")}
        </h1>
        <p className="mt-1 text-sm text-slate-600">{t("users.subtitle")}</p>
      </header>

      <form onSubmit={add} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm font-medium text-slate-700">
            {t("users.email")}
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("users.emailPlaceholder")}
              autoComplete="off"
              className={input}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium text-slate-700">
            {t("users.role")}
            <select value={role} onChange={(e) => setRole(e.target.value)} className={input}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {t(`users.roles.${r}`)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            disabled={busy === "add"}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {busy === "add" ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
            {t("users.add")}
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-500">{t("users.hint")}</p>
      </form>

      {error && (
        <p role="alert" className="flex items-center gap-2 rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </p>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white shadow-sm">
        {users === null ? (
          <p className="flex items-center justify-center gap-2 p-6 text-sm text-slate-500">
            {error ? null : (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {t("users.loading")}
              </>
            )}
          </p>
        ) : users.length === 0 ? (
          <p className="p-6 text-center text-sm text-slate-500">{t("users.empty")}</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {users.map((u) => {
              const self = u.email === currentEmail?.toLowerCase();
              return (
                <li key={u.email} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between sm:px-5">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 truncate text-sm font-medium text-slate-900">
                      {u.role === "admin" && <ShieldCheck className="h-4 w-4 shrink-0 text-indigo-600" />}
                      <span className="truncate">{u.email}</span>
                      {self && <span className="text-xs font-normal text-slate-500">({t("users.you")})</span>}
                    </div>
                    {u.addedBy && (
                      <div className="text-xs text-slate-500">
                        {t("users.addedBy", { email: u.addedBy })}
                        {u.addedAt && ` · ${new Date(u.addedAt).toLocaleDateString(locale)}`}
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <select
                      value={u.role}
                      disabled={self || u.fixed || busy === u.email}
                      onChange={(e) => run(u.email, () => saveUser(u.email, e.target.value))}
                      aria-label={t("users.role")}
                      className="rounded-md border border-slate-300 bg-white px-2 py-1 text-sm disabled:opacity-60"
                    >
                      {ROLES.map((r) => (
                        <option key={r} value={r}>
                          {t(`users.roles.${r}`)}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      disabled={self || u.fixed || busy === u.email}
                      onClick={() => {
                        if (confirm(t("users.removeConfirm", { email: u.email }))) run(u.email, () => removeUser(u.email));
                      }}
                      className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 disabled:invisible"
                      aria-label={t("users.remove", { email: u.email })}
                      title={t("users.remove", { email: u.email })}
                    >
                      {busy === u.email ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
