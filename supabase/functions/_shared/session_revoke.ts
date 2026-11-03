// Each /auth call mints a fresh Supabase Auth session. Without cleanup the
// previous sessions (and their never-used refresh tokens) pile up forever, so
// after issuing a new session we revoke the user's other sessions.
//
// Access tokens are self-contained JWTs: PostgREST and Realtime only check
// their signature and exp, so revoking a session does not cut off a device
// that still holds an unexpired access token. That device simply gets a new
// session on its next /auth call.

export type SignOutScope = "global" | "local" | "others";

export type SessionAdmin = {
  signOut(
    jwt: string,
    scope?: SignOutScope,
  ): Promise<{ error: unknown }>;
};

// Best effort: a failure is logged and never blocks the login itself.
export async function revokeOtherSessions(
  admin: SessionAdmin,
  accessToken: string,
  log: (message: string, detail?: unknown) => void = console.warn,
): Promise<boolean> {
  if (!accessToken) return false;
  try {
    const { error } = await admin.signOut(accessToken, "others");
    if (error) {
      log("Revoking previous sessions failed:", error);
      return false;
    }
    return true;
  } catch (error) {
    log("Revoking previous sessions threw:", error);
    return false;
  }
}

type EdgeRuntimeLike = { waitUntil(promise: Promise<unknown>): void };

// Lets the response go out first when the Supabase edge runtime supports it.
export async function runAfterResponse(
  task: Promise<unknown>,
  runtime: EdgeRuntimeLike | undefined = (globalThis as {
    EdgeRuntime?: EdgeRuntimeLike;
  }).EdgeRuntime,
): Promise<void> {
  if (runtime && typeof runtime.waitUntil === "function") {
    runtime.waitUntil(task);
    return;
  }
  await task;
}
