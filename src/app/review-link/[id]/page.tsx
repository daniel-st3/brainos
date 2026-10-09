import { EmailReview } from "@/components/review-link";
export const metadata = {
  referrer: "no-referrer",
  robots: { index: false, follow: false },
};
export default async function ReviewLink({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return <EmailReview id={(await params).id} />;
}
