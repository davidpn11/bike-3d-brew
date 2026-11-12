import { type Page, expect, test } from './test';

const SHOTS = process.env.PROTO_SHOTS; // set to a directory to save the review screenshots

const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/proto-${name}.png` });
};

test.describe('proto: customer screens', () => {
  test('bike page lists components and upgrades; a row tap sets the active area', async ({ page }) => {
    await page.goto('/proto.html#bike?bike=aero-r1');
    await expect(page.getByRole('heading', { name: 'Aero R1 · 2026' })).toBeVisible();
    await expect(page.getByText('from $4,299')).toBeVisible();
    await expect(page.getByText('Sizes 49–61 — ask us to find yours')).toBeVisible();
    await expect(page.locator('.p-bike .row[data-kind="component"]')).toHaveCount(6);
    await expect(page.locator('.p-bike .row[data-kind="upgrade"]')).toHaveCount(3);
    await expect(page.locator('.p-bike .poster')).toHaveCount(0); // 3D is ready
    const fork = page.locator('.p-bike .row[data-area="hs-fork"][data-kind="component"]');
    await fork.click();
    await expect(fork).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.p-bike [aria-current="true"]')).toHaveCount(1);
    await expect(page.locator('.p-bike .present-card header strong')).toHaveText('Fork'); // the presenter really flew there
    await expect(page.getByText('Key specs')).toBeVisible();
    await shot(page, 'bike-page');
  });

  test('Talk to a salesperson: sheet, text consent line, confirmation', async ({ page }) => {
    await page.goto('/proto.html#bike?bike=aero-r1');
    await page.locator('.p-bike .row[data-kind="upgrade"]').first().click();
    await page.getByRole('button', { name: 'Talk to a salesperson' }).click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Message' })).toHaveValue(/Ultegra/);
    await expect(sheet.locator('.consent')).toBeHidden();
    await sheet.getByLabel('Text message').check();
    await expect(sheet.getByText('Reply STOP to opt out')).toBeVisible();
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet.getByRole('alert')).toContainText('name');
    await sheet.getByRole('textbox', { name: 'Name' }).fill('Sam');
    await sheet.getByRole('textbox', { name: 'Email or mobile' }).fill('sam@example.com');
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet.getByRole('alert')).toContainText('mobile');
    await sheet.getByRole('textbox', { name: 'Email or mobile' }).fill('(512) 555-0199');
    await shot(page, 'contact-sheet');
    await sheet.getByRole('button', { name: 'Send' }).click();
    await expect(sheet.getByRole('status')).toContainText('Thanks, Sam.');
    await expect(sheet.getByRole('link', { name: /512/ })).toHaveAttribute('href', 'tel:+15125550142');
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('contact tab shows the sheet inline', async ({ page }) => {
    await page.goto('/proto.html#contact');
    await expect(page.getByRole('heading', { name: /Talk to Brew Cycles about the Aero R1/ })).toBeVisible();
  });

  test('show customer: area buttons, compare, QR and Done reset', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto('/proto.html#show');
    const areas = page.locator('.p-show .areas');
    await expect(areas.getByRole('button')).toHaveCount(7);
    await expect(areas.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'true');
    await areas.getByRole('button', { name: 'Drivetrain' }).click();
    await expect(areas.getByRole('button', { name: 'Drivetrain' })).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('.p-show .card').first()).toContainText('Shimano 105 Di2');
    await expect(page.locator('.p-show .card').first()).toContainText('Upgrade: Shimano Ultegra Di2 +$900');
    await page.getByRole('button', { name: 'Next area' }).first().click();
    await expect(areas.getByRole('button', { name: 'Cockpit' })).toHaveAttribute('aria-current', 'true');
    await page.getByRole('button', { name: 'Compare' }).click();
    await expect(page.locator('.p-show .panel')).toHaveCount(2);
    await expect(areas.getByRole('button', { name: 'Cockpit' })).toHaveAttribute('aria-current', 'true');
    await expect(page.getByText('Camera sync comes with real captures.')).toBeVisible();
    await page.getByRole('button', { name: 'QR' }).click();
    await expect(page.locator('.p-show .qr')).toContainText('#bike?bike=aero-r1');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await shot(page, 'show-compare');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.p-show .panel')).toHaveCount(1);
    await expect(page.locator('.p-show .qr')).toBeHidden();
    await expect(areas.getByRole('button', { name: 'Overview' })).toHaveAttribute('aria-current', 'true');
  });

  test('window mode loops across live bikes', async ({ page }) => {
    await page.goto('/proto.html#show?window=1&ms=1500');
    const slide = page.locator('.p-show .slide');
    await expect(slide).toHaveAttribute('data-bike', 'aero-r1');
    await expect(slide).toHaveAttribute('data-bike', 'endurance-cf7');
    await expect(page.getByText(/Leaving needs a PIN/)).toBeVisible();
  });

  test('phone and laptop layouts do not scroll sideways', async ({ page }) => {
    for (const [w, hgt] of [[390, 844], [1440, 900]] as const) {
      await page.setViewportSize({ width: w, height: hgt });
      await page.goto('/proto.html#bike?bike=aero-r1');
      await expect(page.getByRole('button', { name: 'Talk to a salesperson' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await shot(page, `bike-page-${w}`);
    }
  });
});
