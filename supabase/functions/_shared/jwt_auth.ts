import { verify } from "https://deno.land/x/djwt@v2.9/mod.ts";

export type JwtPayload = {
  role?: string;
  sub?: string;
  [key: string]: unknown;
};

export class JwtAuthError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
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
