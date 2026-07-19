import {
  assert,
  assertEquals,
  assertRejects,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  fetchPublicHtml,
  isIpLiteral,
  isPrivateIp,
  isSafePublicUrl,
  readHtmlResponse,
} from "./network_security.ts";

Deno.test("private and reserved IPv4 ranges are rejected", () => {
  for (
    const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "100.64.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.18.0.1",
      "203.0.113.1",
      "224.0.0.1",
    ]
  ) {
    assert(isPrivateIp(ip), ip);
  }
  assertEquals(isPrivateIp("8.8.8.8"), false);
});

Deno.test("private, mapped, and documentation IPv6 ranges are rejected", () => {
  for (
    const ip of [
      "::",
      "::1",
      "fc00::1",
      "fd00::1",
      "fe80::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ]
  ) {
    assert(isPrivateIp(ip), ip);
  }
});

Deno.test("IP literals are not accepted as metadata hosts", () => {
  assert(isIpLiteral("127.0.0.1"));
  assert(isIpLiteral("[::1]"));
  assertEquals(isIpLiteral("music.example"), false);
});

Deno.test("URL validation is fail-closed for DNS errors and private answers", async () => {
  const failingResolver = () => Promise.reject(new Error("dns failed"));
  assertEquals(
    await isSafePublicUrl("https://music.example/release", failingResolver),
    false,
  );

  const privateResolver = (_host: string, type: "A" | "AAAA") =>
    Promise.resolve(type === "A" ? ["10.0.0.2"] : ["2001:4860:4860::8888"]);
  assertEquals(
    await isSafePublicUrl("https://music.example/release", privateResolver),
    false,
  );
});

Deno.test("URL validation accepts hosts only when all answers are public", async () => {
  const publicResolver = (_host: string, type: "A" | "AAAA") =>
    Promise.resolve(type === "A" ? ["8.8.8.8"] : ["2001:4860:4860::8888"]);
  assert(
    await isSafePublicUrl("https://music.example/release", publicResolver),
  );
});

Deno.test("HTML reader enforces content type and declared size", async () => {
  await assertRejects(
    () =>
      readHtmlResponse(
        new Response("{}", {
          headers: { "content-type": "application/json" },
        }),
      ),
    Error,
    "Content-Type",
  );
  await assertRejects(
    () =>
      readHtmlResponse(
        new Response("large", {
          headers: {
            "content-type": "text/html",
            "content-length": "100",
          },
        }),
        10,
      ),
    Error,
    "too large",
  );
});

Deno.test("HTML reader caps streamed responses", async () => {
  const response = new Response("12345678901", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  await assertRejects(() => readHtmlResponse(response, 10), Error, "too large");
});
Deno.test("HTML fetch rejects a redirect to a private address", async () => {
  let fetchCount = 0;
  const resolver = (host: string, type: "A" | "AAAA") => {
    if (host === "private.example") {
      return Promise.resolve(type === "A" ? ["127.0.0.1"] : []);
    }
    return Promise.resolve(type === "A" ? ["8.8.8.8"] : []);
  };
  const fetcher = () => {
    fetchCount++;
    return Promise.resolve(
      new Response(null, {
        status: 302,
        headers: { location: "http://private.example/metadata" },
      }),
    );
  };

  await assertRejects(
    () =>
      fetchPublicHtml("https://public.example/release", {
        resolveDns: resolver,
        fetcher,
      }),
    Error,
    "Unsafe metadata URL",
  );
  assertEquals(fetchCount, 1);
});
