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

function FakeCaptcha({
  onVerify,
}: {
  onVerify: (token: string) => void;
  onExpire: () => void;
}) {
  return (
    <button type="button" onClick={() => onVerify("verified-captcha-token")}>
      Complete CAPTCHA
    </button>
  );
}

const configured = {
  url: "https://project.supabase.co",
  publicKey: "sb_publishable_public",
  captchaSiteKey: "captcha-site-key",
};

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

afterEach(() => {
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("AccountMenu", () => {
  it("renders nothing without complete public configuration", () => {
    const { container } = render(<AccountMenu config={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("fails closed when CAPTCHA configuration is absent", () => {
    const { container } = render(
      <AccountMenu
        config={{
          url: "https://project.supabase.co",
          publicKey: "sb_publishable_public",
        }}
        createClient={() => ({ auth })}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("offers optional email sign-in without blocking guest connection", async () => {
    window.history.replaceState({}, "", "/?draft=123#saved");
    const user = userEvent.setup();
    render(
      <>
        <AccountMenu
          config={configured}
          createClient={() => ({ auth })}
          CaptchaComponent={FakeCaptcha}
        />
        <ConnectForm />
      </>,
    );
    expect(screen.getByLabelText("Sleeper username or draft link")).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.type(screen.getByLabelText("Email address"), "person@example.com");
    expect(screen.getByRole("button", { name: "Email me a sign-in link" }))
      .toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Complete CAPTCHA" }));
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(auth.signInWithOtp).toHaveBeenCalledWith(expect.objectContaining({
      email: "person@example.com",
      options: expect.objectContaining({
        emailRedirectTo: expect.stringContaining("/auth/callback"),
        captchaToken: "verified-captcha-token",
      }),
    }));
    const latestSignIn = auth.signInWithOtp.mock.calls.at(-1) as unknown as
      | [{ options: { emailRedirectTo: string } }]
      | undefined;
    const callback = new URL(latestSignIn?.[0].options.emailRedirectTo ?? "");
    expect(callback.searchParams.get("next")).toBe("/?draft=123#saved");
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
        config={configured}
        createClient={() => ({ auth })}
        CaptchaComponent={FakeCaptcha}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.type(screen.getByLabelText("Email address"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Complete CAPTCHA" }));
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
        config={configured}
        createClient={() => ({ auth })}
        CaptchaComponent={FakeCaptcha}
      />,
    );
    await user.click(screen.getByRole("button", { name: "Account" }));
    await user.type(screen.getByLabelText("Email address"), "person@example.com");
    await user.click(screen.getByRole("button", { name: "Complete CAPTCHA" }));
    await user.click(screen.getByRole("button", { name: "Email me a sign-in link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "We could not send a sign-in link. You can keep using guest mode.",
    );
  });

  it("fails closed when configured client creation is unavailable", () => {
    const { container } = render(
      <AccountMenu
        config={{
          url: "javascript:alert(1)",
          publicKey: "sb_publishable_public",
          captchaSiteKey: "captcha-site-key",
        }}
        createClient={() => { throw new Error("must not run"); }}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("opens a generic callback error and removes only the auth marker", async () => {
    window.history.replaceState({}, "", "/?draft=123&auth=error#saved");
    render(
      <AccountMenu
        config={configured}
        createClient={() => ({ auth })}
        CaptchaComponent={FakeCaptcha}
      />,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That sign-in link could not be used. Request a new one or keep using guest mode.",
    );
    expect(screen.getByRole("button", { name: "Account" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/?draft=123#saved");
  });

  it("removes realistic Supabase auth-error details from the URL fragment", async () => {
    window.history.replaceState(
      { preserved: true },
      "",
      "/#error=access_denied&error_code=otp_expired&error_description=provider-secret-detail",
    );
    render(
      <AccountMenu
        config={configured}
        createClient={() => ({ auth })}
        CaptchaComponent={FakeCaptcha}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That sign-in link could not be used. Request a new one or keep using guest mode.",
    );
    expect(screen.queryByText(/provider-secret-detail/)).not.toBeInTheDocument();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/");
    expect(window.history.state).toEqual({ preserved: true });
  });

  it("preserves unrelated query and fragment values while removing auth-error details", async () => {
    window.history.replaceState(
      {},
      "",
      "/?draft=123&auth=profile#error=access_denied&error_code=otp_expired&section=saved",
    );
    render(
      <AccountMenu
        config={configured}
        createClient={() => ({ auth })}
        CaptchaComponent={FakeCaptcha}
      />,
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "That sign-in link could not be used.",
    );
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/?draft=123&auth=profile#section=saved");
  });

  it("leaves an ordinary application hash untouched", async () => {
    window.history.replaceState({}, "", "/?draft=123#section");
    render(
      <AccountMenu
        config={configured}
        createClient={() => ({ auth })}
        CaptchaComponent={FakeCaptcha}
      />,
    );
    await Promise.resolve();

    expect(screen.queryByText("That sign-in link could not be used."))
      .not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Account" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/?draft=123#section");
  });

  it("does not consume a callback error marker when the account client is unavailable", async () => {
    window.history.replaceState({}, "", "/?draft=123&auth=error#saved");
    const { container } = render(
      <AccountMenu
        config={configured}
        createClient={() => { throw new Error("client unavailable"); }}
        CaptchaComponent={FakeCaptcha}
      />,
    );
    await Promise.resolve();

    expect(container).toBeEmptyDOMElement();
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/?draft=123&auth=error#saved");
  });
});
