import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountMenu } from "@/features/account/components/account-menu";
import { ConnectForm } from "@/features/connect/components/connect-form";

const auth = {
  getSession: vi.fn(async () => ({ data: { session: null } })),
  onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
  signInWithOtp: vi.fn(async () => ({ error: null })),
  signOut: vi.fn(async () => ({ error: null })),
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  vi.clearAllMocks();
});

describe("AccountMenu", () => {
  it("renders nothing without complete public configuration", () => {
    const { container } = render(<AccountMenu config={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers optional email sign-in without blocking guest connection", async () => {
    const user = userEvent.setup();
    render(
      <>
        <AccountMenu
          config={{ url: "https://project.supabase.co", anonKey: "public-key" }}
          createClient={() => ({ auth })}
        />
        <ConnectForm />
      </>,
    );
    expect(screen.getByLabelText("Sleeper username or draft link")).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.type(screen.getByLabelText("Email address"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({
      email: "person@example.com",
      options: expect.objectContaining({
        emailRedirectTo: expect.stringContaining("/auth/callback"),
      }),
    }));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Check your email for a sign-in link.",
    );
  });

  it("does not reveal provider error details", async () => {
    auth.signInWithOtp.mockResolvedValueOnce({
      error: { message: "SMTP password secret-value failed" },
    } as never);
    const user = userEvent.setup();
    render(
      <AccountMenu
        config={{ url: "https://project.supabase.co", anonKey: "public-key" }}
        createClient={() => ({ auth })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.type(screen.getByLabelText("Email address"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not send a sign-in link. You can keep using guest mode.",
    );
    expect(screen.queryByText(/secret-value/)).not.toBeInTheDocument();
  });

  it("keeps guest mode available after a network failure", async () => {
    auth.signInWithOtp.mockRejectedValueOnce(new Error("network secret"));
    const user = userEvent.setup();
    render(
      <AccountMenu
        config={{ url: "https://project.supabase.co", anonKey: "public-key" }}
        createClient={() => ({ auth })}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.type(screen.getByLabelText("Email address"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not send a sign-in link. You can keep using guest mode.",
    );
  });

  it("fails closed when configured client creation is unavailable", () => {
    const { container } = render(
      <AccountMenu
        config={{ url: "javascript:alert(1)", anonKey: "public-key" }}
        createClient={() => { throw new Error("must not run"); }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
