// Клиент Graph API Instagram (вход через Instagram Business Login). Ничего не бросает:
// любой результат, включая сетевой сбой, возвращается как GraphResult. Токен не попадает в сообщения об ошибках.
import type { InstagramConfig } from "./config";

export type GraphResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; code?: number; subcode?: number; message?: string };

export interface GraphOptions {
  retryDelayMs?: number;
}

type GraphConfig = Pick<InstagramConfig, "graphVersion">;
export type DirectTarget = { userId: string } | { commentId: string };
type Method = "GET" | "POST";

const TIMEOUT_MS = 10000;
const DEFAULT_RETRY_DELAY_MS = 1500;
const REFRESH_URL = "https://graph.instagram.com/refresh_access_token";

function apiBase(cfg: GraphConfig): string {
  return `https://graph.instagram.com/${cfg.graphVersion}/`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function redact(text: string, token: string): string {
  return token ? text.split(token).join("[redacted]") : text;
}

// Ошибка из тела ответа: { error: { message, code, error_subcode } }. Токен из текста вычищается.
function errorResult<T>(status: number, payload: unknown, token: string): GraphResult<T> {
  const error = isRecord(payload) && isRecord(payload.error) ? payload.error : null;
  const result: { ok: false; status: number; code?: number; subcode?: number; message?: string } = { ok: false, status };
  if (error) {
    if (typeof error.code === "number") result.code = error.code;
    if (typeof error.error_subcode === "number") result.subcode = error.error_subcode;
    if (typeof error.message === "string") result.message = redact(error.message, token);
  }
  return result;
}

// Один запрос без повтора. Сетевой сбой или таймаут — status 0.
async function attempt<T>(method: Method, url: string, token: string, body?: unknown): Promise<GraphResult<T>> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (method === "POST") headers["Content-Type"] = "application/json";

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    return { ok: false, status: 0 };
  }

  const payload: unknown = await res.json().catch(() => null);
  return res.ok ? { ok: true, data: payload as T } : errorResult<T>(res.status, payload, token);
}

// Повтор ровно один раз после паузы — при сетевом сбое и ответе 5xx. Ответы 4xx не повторяются.
async function call<T>(
  method: Method,
  url: string,
  token: string,
  body: unknown,
  opts: GraphOptions,
): Promise<GraphResult<T>> {
  const first = await attempt<T>(method, url, token, body);
  if (first.ok || !(first.status === 0 || first.status >= 500)) return first;
  await new Promise<void>((resolve) => setTimeout(resolve, opts.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS));
  return attempt<T>(method, url, token, body);
}

export function replyToComment(
  cfg: GraphConfig,
  token: string,
  commentId: string,
  message: string,
  opts: GraphOptions = {},
): Promise<GraphResult<{ id: string }>> {
  return call("POST", `${apiBase(cfg)}${encodeURIComponent(commentId)}/replies`, token, { message }, opts);
}

// Личное сообщение: по id пользователя или личный ответ на комментарий (comment_id).
export function sendDirect(
  cfg: GraphConfig,
  token: string,
  target: DirectTarget,
  text: string,
  opts: GraphOptions = {},
): Promise<GraphResult<{ recipient_id: string; message_id: string }>> {
  const recipient = "userId" in target ? { id: target.userId } : { comment_id: target.commentId };
  return call("POST", `${apiBase(cfg)}me/messages`, token, { recipient, message: { text } }, opts);
}

export function getAccount(
  cfg: GraphConfig,
  token: string,
  opts: GraphOptions = {},
): Promise<GraphResult<{ user_id: string; username: string }>> {
  return call("GET", `${apiBase(cfg)}me?fields=user_id,username`, token, undefined, opts);
}

export function getSubscriptions(
  cfg: GraphConfig,
  token: string,
  opts: GraphOptions = {},
): Promise<GraphResult<{ data: Array<{ id: string; subscribed_fields: string[] }> }>> {
  return call("GET", `${apiBase(cfg)}me/subscribed_apps`, token, undefined, opts);
}

export function subscribeAccount(
  cfg: GraphConfig,
  token: string,
  fields: string[],
  opts: GraphOptions = {},
): Promise<GraphResult<{ success: boolean }>> {
  const list = fields.map((field) => encodeURIComponent(field)).join(",");
  return call("POST", `${apiBase(cfg)}me/subscribed_apps?subscribed_fields=${list}`, token, undefined, opts);
}

// Продление долгоживущего токена. Адрес без версии API; токен передаётся в query, как требует API.
export function refreshAccessToken(
  token: string,
  opts: GraphOptions = {},
): Promise<GraphResult<{ access_token: string; expires_in: number }>> {
  const url = `${REFRESH_URL}?grant_type=ig_refresh_token&access_token=${encodeURIComponent(token)}`;
  return call("GET", url, token, undefined, opts);
}
