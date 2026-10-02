/** Web-standard handler shared by the free Supabase Edge runtime and tests. */
export async function deliveryResponse(
  request: Request,
  config: { url: string; key: string },
  send: typeof fetch = fetch,
): Promise<Response> {
  const safe = {
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Robots-Tag": "noindex, nofollow",
  };
  const deny = (status = 404) => new Response(null, { status, headers: safe });
  if (!["GET", "HEAD"].includes(request.method)) return deny(405);
  const match = new URL(request.url).pathname.match(
    /\/brainos-media\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\/([A-Za-z0-9_-]{43})\/asset\.(mp4|jpg|png)$/,
  );
  if (!match) return deny();
  const digest = async (bytes: Uint8Array<ArrayBuffer>) =>
    Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)))
      .map((n) => n.toString(16).padStart(2, "0"))
      .join("");
  const hash = await digest(new TextEncoder().encode(match[2]));
  try {
    const auth = { Authorization: `Bearer ${config.key}`, apikey: config.key };
    const resolve = () =>
      send(config.url + "/rest/v1/rpc/resolve_media_delivery", {
        method: "POST",
        headers: { ...auth, "Content-Type": "application/json" },
        body: JSON.stringify({ p_id: match[1], p_hash: hash }),
        signal: AbortSignal.timeout(15000),
        redirect: "error",
      });
    const check = await resolve();
    if (!check.ok) return deny(503);
    const file = (await check.json()) as {
      bucket: string;
      file_id: string;
      mime: string;
      bytes: number;
      sha256: string;
    } | null;
    if (
      !file ||
      file.bucket !== "brainos-production" ||
      file.file_id.includes("..") ||
      !["video/mp4", "image/png", "image/jpeg"].includes(file.mime) ||
      file.bytes <= 0 ||
      file.bytes > 50000000
    )
      return deny();
    const range = request.headers.get("range");
    if (range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(range)) return deny(416);
    // Bound memory and verify the immutable approved bytes before exposing any.
    const response = await send(
      config.url +
        "/storage/v1/object/authenticated/" +
        file.bucket +
        "/" +
        file.file_id.split("/").map(encodeURIComponent).join("/"),
      {
        method: "GET",
        headers: auth,
        signal: AbortSignal.timeout(60000),
        redirect: "error",
      },
    );
    if (
      !response.ok ||
      Number(response.headers.get("content-length")) > file.bytes ||
      !response.body
    )
      return deny(503);
    const bytes = new Uint8Array(file.bytes),
      reader = response.body.getReader();
    let count = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (count + value.length > file.bytes) {
        await reader.cancel();
        return deny(503);
      }
      bytes.set(value, count);
      count += value.length;
    }
    if (count !== file.bytes || (await digest(bytes)) !== file.sha256)
      return deny(503);
    const recheck = await resolve();
    if (!recheck.ok) return deny(503);
    if (JSON.stringify(await recheck.json()) !== JSON.stringify(file))
      return deny();
    let start = 0,
      end = count - 1;
    if (range) {
      const [left, right] = range.slice(6).split("-");
      if (left) {
        start = Number(left);
        if (right) end = Math.min(Number(right), end);
      } else start = Math.max(0, count - Number(right));
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= count
      )
        return deny(416);
    }
    const headers = new Headers({
      ...safe,
      "Content-Type": file.mime,
      "Accept-Ranges": "bytes",
      ETag: `"${file.sha256}"`,
      "Content-Length": String(end - start + 1),
    });
    if (range) headers.set("Content-Range", `bytes ${start}-${end}/${count}`);
    return new Response(
      request.method === "HEAD" ? null : bytes.subarray(start, end + 1),
      { status: range ? 206 : 200, headers },
    );
  } catch {
    return deny(503);
  }
}
