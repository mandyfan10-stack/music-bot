export const MAX_METADATA_BYTES = 2 * 1024 * 1024;
export const METADATA_TIMEOUT_MS = 8_000;
export const MAX_REDIRECTS = 5;

type DnsRecordType = "A" | "AAAA";
export type DnsResolver = (
  hostname: string,
  recordType: DnsRecordType,
) => Promise<string[]>;

function parseIpv4(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return null;
  }
  const numbers = parts.map(Number);
  return numbers.every((part) => part >= 0 && part <= 255) ? numbers : null;
}

function isPrivateIpv4(ip: string): boolean {
  const parts = parseIpv4(ip);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0 && parts[2] === 2) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && parts[2] === 100) ||
    (a === 203 && b === 0 && parts[2] === 113) ||
    a >= 224
  );
}

export function isPrivateIp(rawIp: string): boolean {
  const ip = rawIp.toLowerCase().replace(/^\[|\]$/g, "");
  if (parseIpv4(ip)) return isPrivateIpv4(ip);

  if (ip.startsWith("::ffff:")) {
    const mapped = ip.slice("::ffff:".length);
    return parseIpv4(mapped) ? isPrivateIpv4(mapped) : true;
  }

  return (
    ip === "::" ||
    ip === "::1" ||
    ip.startsWith("fc") ||
    ip.startsWith("fd") ||
    /^fe[89ab]/.test(ip) ||
    ip.startsWith("ff") ||
    ip.startsWith("2001:db8:")
  );
}

export function isIpLiteral(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "");
  return parseIpv4(host) !== null || host.includes(":");
}

export async function isSafePublicUrl(
  urlString: string,
  resolveDns: DnsResolver = (host, type) => Deno.resolveDns(host, type),
): Promise<boolean> {
  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (url.port && url.port !== "80" && url.port !== "443") return false;

    const host = url.hostname.toLowerCase();
    if (
      host === "localhost" || host.endsWith(".localhost") || isIpLiteral(host)
    ) {
      return false;
    }

    const results = await Promise.allSettled([
      resolveDns(host, "A"),
      resolveDns(host, "AAAA"),
    ]);
    const addresses = results.flatMap((result) =>
      result.status === "fulfilled" ? result.value : []
    );
    if (addresses.length === 0) return false;
    return addresses.every((address) => !isPrivateIp(address));
  } catch {
    return false;
  }
}

export type MetadataFetcher = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export async function fetchPublicHtml(
  urlString: string,
  options: {
    resolveDns?: DnsResolver;
    fetcher?: MetadataFetcher;
    headers?: HeadersInit;
    maxRedirects?: number;
  } = {},
): Promise<{ html: string; finalUrl: string }> {
  const resolveDns = options.resolveDns ??
    ((host: string, type: DnsRecordType) => Deno.resolveDns(host, type));
  const fetcher = options.fetcher ?? fetch;
  const maxRedirects = options.maxRedirects ?? MAX_REDIRECTS;
  let currentUrl = urlString;

  for (let redirectCount = 0;; redirectCount++) {
    if (!(await isSafePublicUrl(currentUrl, resolveDns))) {
      throw new Error("Unsafe metadata URL");
    }
    const response = await fetcher(currentUrl, {
      headers: options.headers,
      redirect: "manual",
      signal: AbortSignal.timeout(METADATA_TIMEOUT_MS),
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location) throw new Error("Metadata redirect has no location");
      if (redirectCount >= maxRedirects) {
        throw new Error("Too many metadata redirects");
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Metadata request failed with status ${response.status}`);
    }
    return { html: await readHtmlResponse(response), finalUrl: currentUrl };
  }
}

export async function readHtmlResponse(
  response: Response,
  maxBytes = MAX_METADATA_BYTES,
): Promise<string> {
  const contentType = (response.headers.get("content-type") || "")
    .toLowerCase();
  if (
    !contentType.includes("text/html") &&
    !contentType.includes("application/xhtml+xml")
  ) {
    throw new Error("Unsupported metadata Content-Type");
  }

  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (declaredLength > maxBytes) {
    throw new Error("Metadata response is too large");
  }

  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel("Metadata response is too large");
        throw new Error("Metadata response is too large");
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
