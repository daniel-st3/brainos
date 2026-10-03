import { editor } from "@/server/auth";
import { PublicationReview } from "@/components/publication-review";
export default async function ReviewCandidate({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await editor();
  return <PublicationReview id={(await params).id} />;
}
