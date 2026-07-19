export type TelegramUserData = {
  id: number;
  username?: string;
  first_name?: string;
};

export class TelegramAuthError extends Error {
  constructor(message: string, public readonly status = 401) {
    super(message);
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function hmac(
  keyData: Uint8Array,
  payload: Uint8Array,
): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", key, payload);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function parseTelegramUser(initData: string): TelegramUserData {
  const rawUser = new URLSearchParams(initData).get("user");
  if (!rawUser) throw new TelegramAuthError("No user in initData");
  let user: TelegramUserData;
  try {
    user = JSON.parse(rawUser);
  } catch {
    throw new TelegramAuthError("Invalid user payload");
  }
  const userId = Number(user.id);
  if (!Number.isSafeInteger(userId) || userId <= 0) {
    throw new TelegramAuthError("Invalid Telegram user ID");
  }
  return { ...user, id: userId };
}

export async function verifyTelegramInitData(
  initData: string,
  botToken: string,
  maxAgeSeconds = 86_400,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<TelegramUserData> {
  const parsed = new URLSearchParams(initData);
  const user = parseTelegramUser(initData);
  const receivedHash = parsed.get("hash");
  if (!receivedHash) throw new TelegramAuthError("Missing hash in initData");

  const rawAuthDate = parsed.get("auth_date");
  if (!rawAuthDate) {
    throw new TelegramAuthError("Missing auth_date in initData");
  }
  const authDate = Number(rawAuthDate);
  if (!Number.isSafeInteger(authDate)) {
    throw new TelegramAuthError("Invalid auth_date in initData");
  }
  if (authDate > nowSeconds + 60) {
    throw new TelegramAuthError("auth_date is in the future");
  }
  if (maxAgeSeconds > 0 && nowSeconds - authDate > maxAgeSeconds) {
    throw new TelegramAuthError("initData expired");
  }

  const dataCheckString = Array.from(parsed.keys())
    .filter((key) => key !== "hash")
    .sort()
    .map((key) => `${key}=${parsed.get(key)}`)
    .join("\n");
  const encoder = new TextEncoder();
  const secretKey = await hmac(
    encoder.encode("WebAppData"),
    encoder.encode(botToken),
  );
  const calculatedHash = toHex(
    await hmac(
      new Uint8Array(secretKey),
      encoder.encode(dataCheckString),
    ),
  );
  if (!constantTimeEqual(calculatedHash, receivedHash)) {
    throw new TelegramAuthError("Invalid Telegram signature");
  }
  return user;
}
