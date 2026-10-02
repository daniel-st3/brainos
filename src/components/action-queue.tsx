import Link from "next/link";
export function ActionQueue({
  items,
}: {
  items: {
    id: string;
    title: string;
    detail: string;
    href: string;
    kind: string;
  }[];
}) {
  return (
    <section className="action-queue">
      <h2>
        My Actions <span>{items.length}</span>
      </h2>
      {items.length === 0 ? (
        <p>No pending decisions.</p>
      ) : (
        items.map((item) => (
          <Link
            className="action-card"
            href={item.href}
            key={`${item.kind}:${item.id}`}
          >
            <span className="eyebrow">{item.kind}</span>
            <h3>{item.title}</h3>
            <p>{item.detail}</p>
            <span>Open review →</span>
          </Link>
        ))
      )}
    </section>
  );
}
