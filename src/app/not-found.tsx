import Link from "next/link";
export default function NotFound() {
  return (
    <div className="empty">
      <h1>Story not found.</h1>
      <p>This link does not point to a story in your newsroom.</p>
      <Link href="/inbox" className="button">
        Open inbox
      </Link>
    </div>
  );
}
