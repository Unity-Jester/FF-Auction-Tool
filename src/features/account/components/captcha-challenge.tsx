"use client";

import dynamic from "next/dynamic";

const HCaptcha = dynamic(() => import("@hcaptcha/react-hcaptcha"), {
  ssr: false,
});

export type CaptchaChallengeProps = {
  siteKey: string;
  onVerify(token: string): void;
  onExpire(): void;
};

export function CaptchaChallenge({
  siteKey,
  onVerify,
  onExpire,
}: CaptchaChallengeProps) {
  return (
    <HCaptcha
      sitekey={siteKey}
      size="compact"
      onVerify={onVerify}
      onExpire={onExpire}
      onError={onExpire}
    />
  );
}
