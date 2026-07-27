import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/features/account/components/account-menu";

const configured = {
  url: "https://project.supabase.co",
  publicKey: "sb_publishable_public",
  captchaSiteKey: "captcha-site-key",
};

describe("configured guest account privacy", () => {
  it("does not create an account client until the guest explicitly opens Account", async () => {
    const createClient = vi.fn(() => ({
      auth: {
        getSession: vi.fn(async () => ({ data: { session: null } })),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signInWithOtp: vi.fn(),
        signOut: vi.fn(),
      },
    }));
    const user = userEvent.setup();

    render(<AccountMenu config={configured} createClient={createClient} />);

    expect(screen.getByRole("button", { name: "Account" })).toBeVisible();
    expect(createClient).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Account" }));
    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
  });
});
