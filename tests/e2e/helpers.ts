import { expect, type Page } from "@playwright/test";

export const MOCK_DRAFT_ID = "1234567890";

export async function setFixture(
  page: Page,
  step = 0,
  state: "online" | "offline" | "stale-projections" = "online",
) {
  const response = await page.request.get(
    `/api/e2e/fixtures?step=${step}&state=${state}`,
  );
  expect(response.status()).toBe(204);
}

export async function enterDraftRoom(page: Page) {
  await setFixture(page);
  await page.goto("/");
  await page.getByLabel("Sleeper username or draft link").fill(
    `https://sleeper.com/draft/nfl/${MOCK_DRAFT_ID}`,
  );
  await page.getByRole("button", { name: "Connect draft" }).click();
  await expect(page).toHaveURL(new RegExp(`/draft/${MOCK_DRAFT_ID}/setup$`));
  await page.getByRole("button", { name: "Set strategy" }).click();
  await expect(page).toHaveURL(new RegExp(`/draft/${MOCK_DRAFT_ID}/strategy$`));
  await page.getByRole("button", { name: "Stars and scrubs" }).click();
  await expect(page.getByText("Aggressive early spending")).toBeVisible();
  await page.getByRole("button", { name: "Enter draft room" }).click();
  await expect(page).toHaveURL(new RegExp(`/draft/${MOCK_DRAFT_ID}$`));
  await page.getByRole("button", { name: /^Team 1/ }).click();
  await expect(page.getByText("Auction Companion")).toBeVisible();
}

export function captureConsoleErrors(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      !/Failed to load resource:.*(?:502|Bad Gateway)/.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return errors;
}
