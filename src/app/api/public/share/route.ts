import { rasterize } from "@/providers/raster";
import { escapeHtml } from "@/production/model";
import { publicRecords } from "@/control/public";
import { applicationRpc } from "@/ingestion/store";
export async function GET(request: Request) {
  const id = new URL(request.url).searchParams.get("id"),
    records = await publicRecords(await applicationRpc()),
    record = id
      ? records.find((r) => r.id === id)
      : records.find((r) => r.kind === "profile");
  if (id && !record) return new Response("Not found", { status: 404 });
  const title = escapeHtml(
      (record?.title ?? "DANIEL / AI APLICADA").slice(0, 48),
    ),
    description = escapeHtml(
      (record?.description ?? "Construir. Probar. Mostrar.").slice(0, 75),
    );
  const r = await rasterize(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630"><rect width="1200" height="630" fill="#f4f1e9"/><rect width="1200" height="16" fill="#172b26"/><g font-family="Arial" fill="#172b26"><text x="72" y="130" font-size="24">DANIEL / AI APLICADA</text><text x="72" y="300" font-size="38">${title}</text><text x="72" y="420" font-size="24">${description}</text></g></svg>`,
  );
  return new Response(Uint8Array.from(r.bytes), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
