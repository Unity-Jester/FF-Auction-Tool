import Link from "next/link";

export default async function DraftPage({
  params,
}: {
  params: Promise<{ draftId: string }>;
}) {
  const { draftId } = await params;

  return (
    <section className="stage draft-shell" aria-labelledby="draft-shell-title">
      <p className="kicker">04 / Draft room</p>
      <h1 id="draft-shell-title">Draft room is next.</h1>
      <p className="draft-shell-copy">
        Your setup and strategy are saved. The live draft workspace is not
        loaded yet; this holding screen keeps you out of a broken route while it
        is prepared.
      </p>
      <div className="draft-shell-actions">
        <Link className="primary-link" href={`/draft/${draftId}/setup`}>
          Review setup
        </Link>
        <Link href={`/draft/${draftId}/strategy`}>Adjust strategy</Link>
      </div>
    </section>
  );
}
