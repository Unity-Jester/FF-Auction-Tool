import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectForm } from "@/features/connect/components/connect-form";
import { draftLoadMessage } from "@/features/connect/draft-load-message";

const push = vi.fn();

vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      {children}
    </QueryClientProvider>
  );
}

afterEach(() => {
  push.mockReset();
  vi.unstubAllGlobals();
});

describe("ConnectForm", () => {
  it("gives a recovery path for a snake draft", () => {
    expect(draftLoadMessage("UNSUPPORTED_DRAFT_TYPE")).toBe(
      "This is a snake draft. This companion supports auction drafts only. Choose an auction draft or return home to connect another one.",
    );
  });

  it("lists auction drafts found through a Sleeper username", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            user: { displayName: "Ada" },
            season: "2026",
            drafts: [
              {
                draftId: "123456789012345678",
                status: "drafting",
                metadata: { name: "Friday auction" },
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );
    const user = userEvent.setup();
    render(<ConnectForm />, { wrapper });

    await user.type(
      screen.getByLabelText("Sleeper username or draft link"),
      "ada",
    );
    await user.click(screen.getByRole("button", { name: "Connect draft" }));

    expect(await screen.findByText("Friday auction")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Review Friday auction" }),
    );
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/draft/123456789012345678/setup"),
    );
  });

  it("takes a pasted Sleeper draft link straight to setup", async () => {
    const user = userEvent.setup();
    render(<ConnectForm />, { wrapper });
    await user.type(
      screen.getByLabelText("Sleeper username or draft link"),
      "https://sleeper.com/draft/nfl/123456789012345678",
    );
    await user.click(screen.getByRole("button", { name: "Connect draft" }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith("/draft/123456789012345678/setup"),
    );
  });

  it("keeps invalid input visible and offers a clear recovery", async () => {
    const user = userEvent.setup();
    render(<ConnectForm />, { wrapper });
    const input = screen.getByLabelText("Sleeper username or draft link");
    await user.type(input, "https://example.com/not-a-draft");
    await user.click(screen.getByRole("button", { name: "Connect draft" }));
    expect(
      await screen.findByText(
        "Enter a Sleeper username, draft ID, or draft link.",
      ),
    ).toBeInTheDocument();
    expect(input).toHaveValue("https://example.com/not-a-draft");
  });

  it("routes a pasted draft ID to setup for an auction check", async () => {
    const user = userEvent.setup();
    render(<ConnectForm />, { wrapper });
    await user.type(
      screen.getByLabelText("Sleeper username or draft link"),
      "123456789012345678",
    );
    await user.click(screen.getByRole("button", { name: "Connect draft" }));
    expect(push).toHaveBeenCalledWith("/draft/123456789012345678/setup");
  });
});
