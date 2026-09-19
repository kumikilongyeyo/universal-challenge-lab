import { chromium } from 'playwright';
import { assertAuthorizedTarget } from '../core/target-policy.js';

/**
 * Launch Chromium only after the target passes the lab authorization policy.
 * The runner is deliberately inspection-first: it exposes page state to adapters,
 * but does not contain provider-token injection or production challenge bypasses.
 */
export class AuthorizedBrowserRunner {
  constructor({ headless = true, launchOptions = {} } = {}) {
    this.headless = headless;
    this.launchOptions = launchOptions;
  }

  async withPage(rawUrl, fn) {
    const target = assertAuthorizedTarget(rawUrl);
    const browser = await chromium.launch({ headless: this.headless, ...this.launchOptions });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
      await page.goto(target.href, { waitUntil: 'domcontentloaded' });
      return await fn(page, target);
    } finally {
      await context.close();
      await browser.close();
    }
  }

  async inspect(rawUrl) {
    return this.withPage(rawUrl, async (page, target) => {
      const surface = await page.evaluate(() => ({
        title: document.title,
        hasTurnstileFixture: Boolean(document.querySelector('.cf-turnstile')),
        hasHCaptchaFixture: Boolean(document.querySelector('.h-captcha')),
        hasLabChallenge: Boolean(document.querySelector('[data-lab-challenge]')),
      }));

      return { url: target.href, ...surface };
    });
  }
}
