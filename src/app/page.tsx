import styles from "./page.module.css";
import { ConnectForm } from "@/features/connect/components/connect-form";

export default function HomePage() {
  return (
    <section aria-labelledby="hero-title" className={styles.hero}>
      <p className={styles.eyebrow}>Sleeper / auction companion</p>
      <h1 id="hero-title">Own the room</h1>
      <p className={styles.copy}>
        Bring the draft into focus with a clear, live view of the room.
      </p>
      <ConnectForm />
    </section>
  );
}
