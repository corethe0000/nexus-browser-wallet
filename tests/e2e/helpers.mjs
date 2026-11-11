//shared steps of the Playwright e2e scripts

//the wallet starts locked when the core is already logged in (browser start counts as idle)
export async function unlockIfLocked(page, pin, password) {
  if (!(await page.locator('.lock-icon').isVisible())) {
    return false;
  }
  await page.getByLabel('PIN').fill(pin);
  await page.getByRole('button', { name: 'Unlock' }).click();
  //cores without sessions/validate/pin ask for the password too
  const next = page.locator('.balance-card, input[autocomplete=current-password], .notice.error').first();
  await next.waitFor({ timeout: 60000 });
  if (await page.locator('input[autocomplete=current-password]').isVisible()) {
    await page.getByLabel('Password').fill(password);
    await page.getByLabel('PIN').fill(pin);
    await page.getByRole('button', { name: 'Unlock' }).click();
  }
  await page.locator('.balance-card').waitFor({ timeout: 60000 });
  return true;
}
