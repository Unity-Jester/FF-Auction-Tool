"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { parseDraftReference } from "@/integrations/sleeper/parse-draft-reference";

type Discovery = {
  user: { displayName: string };
  season: string;
  drafts: Array<{
    draftId: string;
    status: string;
    metadata?: { name?: string };
  }>;
};

function message(error: unknown) {
  if (error instanceof Error && error.message === "UNSUPPORTED_DRAFT_TYPE")
    return "This is a snake draft. This companion supports auction drafts only.";
  return "We could not find that draft. Check the link or try a Sleeper username.";
}

export function ConnectForm() {
  const router = useRouter();
  const [reference, setReference] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Discovery["drafts"]>([]);
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);
    setDrafts([]);
    try {
      const draftId = parseDraftReference(reference);
      router.push(`/draft/${draftId}/setup`);
    } catch (parseError) {
      if (
        parseError instanceof Error &&
        parseError.message === "Invalid Sleeper draft"
      ) {
        if (!/^[A-Za-z0-9_.-]{1,40}$/.test(reference.trim())) {
          setError("Enter a Sleeper username, draft ID, or draft link.");
          return;
        }
        setLoading(true);
        try {
          const response = await fetch(
            `/api/sleeper/users/${encodeURIComponent(reference.trim())}/drafts`,
          );
          if (!response.ok) throw new Error("discovery");
          const data = (await response.json()) as Discovery;
          setDrafts(data.drafts);
          if (!data.drafts.length)
            setError(
              "No current auction drafts were found. Paste a Sleeper draft link to connect a mock draft.",
            );
        } catch {
          setError(
            "We could not find that username. Check it or paste a Sleeper draft link.",
          );
        } finally {
          setLoading(false);
        }
      } else setError(message(parseError));
    } finally {
      setLoading(false);
    }
  }

  return (
    <form className="connect-form" onSubmit={submit} noValidate>
      <label htmlFor="draft-reference">Sleeper username or draft link</label>
      <div className="input-row">
        <input
          id="draft-reference"
          value={reference}
          onChange={(event) => setReference(event.target.value)}
          placeholder="username, draft ID, or link"
          autoComplete="off"
        />
        <button type="submit" disabled={loading}>
          {loading ? "Connecting…" : "Connect draft"}
        </button>
      </div>
      <p className="form-note">Mock draft? Paste its Sleeper URL directly.</p>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {drafts.length > 0 && (
        <section
          className="draft-results"
          aria-label="Discovered auction drafts"
        >
          <p>Current auctions for this account</p>
          {drafts.map((draft) => {
            const name = draft.metadata?.name || `Auction ${draft.draftId}`;
            return (
              <button
                key={draft.draftId}
                type="button"
                aria-label={`Review ${name}`}
                className="draft-result"
                onClick={() => router.push(`/draft/${draft.draftId}/setup`)}
              >
                <span>{name}</span>
                <span>Review {name}</span>
              </button>
            );
          })}
        </section>
      )}
    </form>
  );
}
