import { NextResponse } from "next/server";

import { getInstagramConfig } from "@/lib/instagram/config";
import { getAccount, getSubscriptions, subscribeAccount, type GraphResult } from "@/lib/instagram/graph";
import { getEffectiveToken } from "@/lib/instagram/store";

export const dynamic = "force-dynamic";

// Статус бота Instagram для страницы настроек. В ответе нет ни токена, ни app secret, ни verify token:
// только флаги «задано» и результаты запросов к Graph API. ?subscribe=1 сначала подписывает аккаунт
// на comments и messages (повторный вызов безопасен), затем подписки читаются заново.
const SUBSCRIBED_FIELDS = ["comments", "messages"];

type Failure = { status: number; code?: number; message?: string };
type FailedResult = Extract<GraphResult<unknown>, { ok: false }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failureOf(res: FailedResult): Failure {
  const out: Failure = { status: res.status };
  if (res.code !== undefined) out.code = res.code;
  if (res.message !== undefined) out.message = res.message;
  return out;
}

// data.data[0].subscribed_fields — список имён полей. Пустой список подписок — []; другая форма ответа — null.
function subscribedFieldsOf(data: unknown): string[] | null {
  if (!isRecord(data) || !Array.isArray(data.data)) return null;
  if (data.data.length === 0) return [];
  const first: unknown = data.data[0];
  if (!isRecord(first) || !Array.isArray(first.subscribed_fields)) return null;
  return first.subscribed_fields.filter((field): field is string => typeof field === "string");
}

export async function GET(req: Request) {
  const cfg = getInstagramConfig();
  const subscribe = new URL(req.url).searchParams.get("subscribe") === "1";
  const token = cfg.accessToken ? await getEffectiveToken(cfg.accessToken) : "";

  let subscribeResult: { ok: true } | ({ ok: false } & Failure) | null = null;
  if (subscribe && token) {
    const res = await subscribeAccount(cfg, token, SUBSCRIBED_FIELDS);
    subscribeResult = res.ok ? { ok: true } : { ok: false, ...failureOf(res) };
  }

  let account: { id: string; username: string } | { error: Failure } | null = null;
  let subscribedFields: string[] | null = null;
  if (token) {
    const [accountRes, subscriptionsRes] = await Promise.all([getAccount(cfg, token), getSubscriptions(cfg, token)]);
    account = accountRes.ok
      ? { id: accountRes.data.user_id, username: accountRes.data.username }
      : { error: failureOf(accountRes) };
    subscribedFields = subscriptionsRes.ok ? subscribedFieldsOf(subscriptionsRes.data) : null;
  }

  return NextResponse.json({
    enabled: cfg.enabled,
    configured: {
      accessToken: cfg.accessToken !== "",
      appSecret: cfg.appSecret !== "",
      verifyToken: cfg.verifyToken !== "",
    },
    whatsappNumber: cfg.whatsappNumber,
    callbackPath: "/api/instagram-webhook",
    account,
    subscribedFields,
    ...(subscribe ? { subscribeResult } : {}),
  });
}
