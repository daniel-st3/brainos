import { notFound } from "next/navigation";
import { publicRecords } from "@/control/public";
import { applicationRpc } from "@/ingestion/store";
export default async function Build({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const id = (await params).id,
    r = (await publicRecords(await applicationRpc())).find(
      (r) => r.kind === "build" && r.id === id,
    );
  if (!r) notFound();
  return (
    <main id="main-content" className="public-site">
      <h1>{r.title}</h1>
      <p>{r.description}</p>
      <p>{r.body}</p>
      {r.url && (
        <a href={r.url} rel="noopener noreferrer">
          Ver proyecto
        </a>
      )}
    </main>
  );
}
