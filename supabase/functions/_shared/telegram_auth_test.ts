import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  parseTelegramUser,
  TelegramAuthError,
  verifyTelegramInitData,
} from "./telegram_auth.ts";

async function signedInitData(
  user: Record<string, unknown>,
  authDate: number,
  botToken: string,
): Promise<string> {
  const values = new URLSearchParams({
    auth_date: String(authDate),
    query_id: "test-query",
    user: JSON.stringify(user),
  });
  const check = Array.from(values.keys()).sort()
    .map((key) => `${key}=${values.get(key)}`).join("\n");
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode("WebAppData"),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const secret = await crypto.subtle.sign(
    "HMAC",
    baseKey,
    encoder.encode(botToken),
  );
  const signingKey = await crypto.subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    signingKey,
    encoder.encode(check),
  );
  values.set(
    "hash",
    Array.from(new Uint8Array(signature))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join(""),
  );
  return values.toString();
}

Deno.test("valid Telegram initData is accepted", async () => {
  const now = 1_800_000_000;
  const initData = await signedInitData(
    { id: 123456, username: "tester", first_name: "Test" },
    now,
    "bot-token",
  );
  const user = await verifyTelegramInitData(initData, "bot-token", 300, now);
  assertEquals(user.id, 123456);
  assertEquals(user.username, "tester");
});

Deno.test("stale and future Telegram initData are rejected", async () => {
  const now = 1_800_000_000;
  const stale = await signedInitData({ id: 1 }, now - 301, "bot-token");
  await assertRejects(
    () => verifyTelegramInitData(stale, "bot-token", 300, now),
    TelegramAuthError,
    "expired",
  );
  const future = await signedInitData({ id: 1 }, now + 61, "bot-token");
  await assertRejects(
    () => verifyTelegramInitData(future, "bot-token", 300, now),
    TelegramAuthError,
    "future",
  );
});

Deno.test("tampered Telegram initData is rejected", async () => {
  const now = 1_800_000_000;
  const valid = await signedInitData({ id: 1 }, now, "bot-token");
  const tampered = valid.replace("%22id%22%3A1", "%22id%22%3A2");
  await assertRejects(
    () => verifyTelegramInitData(tampered, "bot-token", 300, now),
    TelegramAuthError,
    "signature",
  );
});

Deno.test("unsafe Telegram IDs are rejected even in parser mode", () => {
  const values = new URLSearchParams({ user: JSON.stringify({ id: -1 }) });
  assertRejects(
    async () => parseTelegramUser(values.toString()),
    TelegramAuthError,
    "user ID",
  );
});
