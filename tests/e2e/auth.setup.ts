import { expect, test } from "@playwright/test";

import { E2E_CREDENTIALS, STATE_PATH } from "./global-setup";

/**
 * Logs in through the real form (not by injecting a cookie) so the session
 * contract stays covered by the matrix, then saves the storage state every
 * viewport/browser project reuses.
 */
test("sign in through the login form", async ({ page }) => {
  await page.goto("/login");

  await expect(page.getByRole("heading", { name: /welcome back/i })).toBeVisible();
  await page.getByLabel("Username").fill(E2E_CREDENTIALS.username);
  await page.getByLabel("Password").fill(E2E_CREDENTIALS.password);

  await Promise.all([
    page.waitForURL(/\/dashboard/),
    page.getByRole("button", { name: "Sign in" }).click(),
  ]);

  await expect(page.getByRole("heading", { name: /^Dashboard$/ })).toBeVisible();

  await page.context().storageState({ path: STATE_PATH });
});

test("an unauthenticated visitor is redirected to the login page", async ({ page }) => {
  // A fresh context with no stored session: the proxy gate must bounce to /login
  // and remember where the user was heading (MF/SEC behaviour pinned here).
  const context = await page.context().browser()!.newContext({ storageState: undefined });
  const anonymous = await context.newPage();
  await anonymous.goto("/dashboard");
  await expect(anonymous).toHaveURL(/\/login\?next=%2Fdashboard/);
  await context.close();
});
