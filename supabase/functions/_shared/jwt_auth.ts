import { verify } from "https://deno.land/x/djwt@v2.9/mod.ts";

export type JwtPayload = {
  role?: string;
  sub?: string;
  app_metadata?: {
    telegram_user_id?: string | number;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

// Managed Supabase Auth stores the Telegram ID in app_metadata. Numeric `sub`
// remains a compatibility fallback for legacy application JWTs.
export function getTelegramIdFromClaims(
  claims: JwtPayload | null | undefined,
): string {
  const managedId = claims?.app_metadata?.telegram_user_id;
  if (managedId != null && String(managedId)) return String(managedId);
  return /^\d+$/.test(String(claims?.sub || "")) ? String(claims?.sub) : "";
}

export function requireTelegramUserId(claims: JwtPayload): number {
  const telegramUserId = Number(getTelegramIdFromClaims(claims));
  if (!Number.isSafeInteger(telegramUserId) || telegramUserId <= 0) {
    throw new JwtAuthError("Invalid user token claims", 401);
  }
  return telegramUserId;
}

export class JwtAuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
  }
}

// The Edge gateway must validate the JWT signature before this claim check.
export function requireGatewayVerifiedRole(
  authorization: string | null,
  requiredRole: string,
): JwtPayload {
  if (!authorization?.startsWith("Bearer ")) {
    throw new JwtAuthError("Unauthorized", 401);
  }
  const parts = authorization.slice(7).split(".");
  if (parts.length !== 3) throw new JwtAuthError("Invalid token", 401);
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const bytes = Uint8Array.from(
      atob(padded),
      (character) => character.charCodeAt(0),
    );
    const payload = JSON.parse(new TextDecoder().decode(bytes)) as JwtPayload;
    if (payload.role !== requiredRole) {
      throw new JwtAuthError(`${requiredRole} role required`, 403);
    }
    return payload;
  } catch (error) {
    if (error instanceof JwtAuthError) throw error;
    throw new JwtAuthError("Invalid token", 401);
  }
}

export async function verifyRequiredRole(
  authorization: string | null,
  jwtSecret: string | undefined,
  requiredRole: string,
): Promise<JwtPayload> {
  if (!authorization?.startsWith("Bearer ")) {
    throw new JwtAuthError("Unauthorized", 401);
  }
  if (!jwtSecret) {
    throw new JwtAuthError("JWT verification is not configured", 500);
  }
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(jwtSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  let payload: JwtPayload;
  try {
    payload = await verify(authorization.slice(7), key) as JwtPayload;
  } catch {
    throw new JwtAuthError("Invalid token", 401);
  }
  if (payload.role !== requiredRole) {
    throw new JwtAuthError(`${requiredRole} role required`, 403);
  }
  return payload;
}
