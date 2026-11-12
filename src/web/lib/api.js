/** Calls to the minuteca server (same origin; the session is an HttpOnly cookie). */
import { t } from "../i18n";

export class ApiError extends Error {
  /** detail: what the server can say about a provider's error ("anthropic 400 invalid_request_error"), shown after the message. */
  constructor(code, status, detail) {
    super(detail ? `${messageFor(code, status)} (${detail})` : messageFor(code, status));
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

/** Server error codes to the person's language. */
export function messageFor(code, status) {
  const key = `errors.${code}`;
  const text = t(key);
  return text === key ? t("errors.generic", { status: status || "?" }) : text;
}

export async function api(path, { method = "GET", body, signal } = {}) {
  let res;
  try {
    res = await fetch(`/api${path}`, {
      method,
      signal,
      credentials: "same-origin",
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === "AbortError") throw err;
    throw new ApiError("network", 0);
  }
  const data = await res.json().catch(() => ({}));
  // Slow answers (language models) arrive as 200 with the error's real status in errorStatus.
  if (!res.ok || data.errorStatus) throw new ApiError(data.error || "generic", data.errorStatus || res.status, typeof data.detail === "string" ? data.detail.slice(0, 120) : undefined);
  return data;
}

/**
 * Uploads a file with progress (0..1). XHR, not fetch, because fetch cannot report upload
 * progress. The server stores exactly Content-Length bytes.
 */
export function uploadFile(path, blob, { onProgress, signal, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", `/api${path}`);
    xhr.setRequestHeader("Content-Type", blob.type || "audio/webm");
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve(xhr.response);
      } else reject(new ApiError(xhr.response?.error || "generic", xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("network", 0));
    xhr.onabort = () => reject(new ApiError("cancelled", 0));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}
