import styles from "./page.module.css";

export default function HomePage() {
  return (
    <section aria-labelledby="hero-title" className={styles.hero}>
      <p className={styles.eyebrow}>Auction intelligence for Sleeper</p>
      <h1 id="hero-title">Own the room</h1>
      <p className={styles.copy}>
        Bring the draft into focus with a clear, live view of the room.
      </p>
      <form className={styles.connectForm}>
        <label htmlFor="draft-reference">Sleeper username or draft link</label>
        <input id="draft-reference" name="draftReference" />
        <button type="submit">Connect draft</button>
      </form>
    </section>
  );
}
