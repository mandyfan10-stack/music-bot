import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  revokeOtherSessions,
  runAfterResponse,
  type SessionAdmin,
  type SignOutScope,
} from "./session_revoke.ts";

function fakeAdmin(result: { error: unknown } | Error) {
  const calls: Array<[string, SignOutScope | undefined]> = [];
  const admin: SessionAdmin = {
    signOut(jwt, scope) {
      calls.push([jwt, scope]);
      return result instanceof Error
        ? Promise.reject(result)
        : Promise.resolve(result);
    },
  };
  return { admin, calls };
}

const silent = () => {};

Deno.test("revokes only the other sessions of the new token", async () => {
  const { admin, calls } = fakeAdmin({ error: null });
  assertEquals(await revokeOtherSessions(admin, "new-token", silent), true);
  assertEquals(calls, [["new-token", "others"]]);
});

Deno.test("an auth error is reported but does not throw", async () => {
  const { admin } = fakeAdmin({ error: { message: "session_not_found" } });
  const logged: unknown[] = [];
  const ok = await revokeOtherSessions(
    admin,
    "t",
    (_m, detail) => logged.push(detail),
  );
  assertEquals(ok, false);
  assertEquals(logged, [{ message: "session_not_found" }]);
});

Deno.test("a network failure does not throw", async () => {
  const { admin } = fakeAdmin(new Error("fetch failed"));
  assertEquals(await revokeOtherSessions(admin, "t", silent), false);
});

Deno.test("an empty token never calls the admin API", async () => {
  const { admin, calls } = fakeAdmin({ error: null });
  assertEquals(await revokeOtherSessions(admin, "", silent), false);
  assertEquals(calls.length, 0);
});

Deno.test("runAfterResponse hands the task to EdgeRuntime.waitUntil", async () => {
  const queued: Promise<unknown>[] = [];
  const task = Promise.resolve("done");
  await runAfterResponse(task, { waitUntil: (p) => queued.push(p) });
  assertEquals(queued, [task]);
});

Deno.test("runAfterResponse awaits the task without an edge runtime", async () => {
  let finished = false;
  const task = new Promise<void>((resolve) =>
    setTimeout(() => {
      finished = true;
      resolve();
    }, 0)
  );
  await runAfterResponse(task, undefined);
  assertEquals(finished, true);
});
