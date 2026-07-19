import {
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { create, getNumericDate } from "https://deno.land/x/djwt@v2.9/mod.ts";
import { JwtAuthError, verifyRequiredRole } from "./jwt_auth.ts";

async function tokenForRole(role: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return create(
    { alg: "HS256", typ: "JWT" },
    { role, exp: getNumericDate(60) },
    key,
  );
}

Deno.test("service-role webhook accepts only service_role JWTs", async () => {
  const secret = "test-secret";
  const serviceToken = await tokenForRole("service_role", secret);
  const payload = await verifyRequiredRole(
    `Bearer ${serviceToken}`,
    secret,
    "service_role",
  );
  assertEquals(payload.role, "service_role");

  const anonToken = await tokenForRole("anon", secret);
  await assertRejects(
    () => verifyRequiredRole(`Bearer ${anonToken}`, secret, "service_role"),
    JwtAuthError,
    "role required",
  );
});

Deno.test("service-role webhook rejects missing and tampered tokens", async () => {
  await assertRejects(
    () => verifyRequiredRole(null, "secret", "service_role"),
    JwtAuthError,
    "Unauthorized",
  );
  const valid = await tokenForRole("service_role", "secret");
  const segments = valid.split(".");
  const signatureIndex = Math.floor(segments[2].length / 2);
  const signatureCharacter = segments[2][signatureIndex];
  segments[2] = segments[2].slice(0, signatureIndex) +
    (signatureCharacter === "a" ? "b" : "a") +
    segments[2].slice(signatureIndex + 1);
  const tampered = segments.join(".");
  await assertRejects(
    () => verifyRequiredRole(`Bearer ${tampered}`, "secret", "service_role"),
    JwtAuthError,
    "Invalid token",
  );
});
