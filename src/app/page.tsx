export default function HomePage() {
  return (
    <section aria-labelledby="hero-title" className="hero">
      <p className="eyebrow">Auction intelligence for Sleeper</p>
      <h1 id="hero-title">Own the room</h1>
      <p className="hero-copy">
        Bring the draft into focus with a clear, live view of the room.
      </p>
      <form className="connect-form">
        <label htmlFor="draft-reference">Sleeper username or draft link</label>
        <input id="draft-reference" name="draftReference" />
        <button type="submit">Connect draft</button>
      </form>
    </section>
  );
}
