import { BrowserPipelineAdapter } from '../browser/pipeline-adapter.js';

export class TurnstileTestObserver extends BrowserPipelineAdapter {
  constructor() { super({ id: 'turnstile-test-observer', maxRounds: 1 }); }
  async detect(page) {
    const found = await page.locator('.cf-turnstile').count() > 0;
    return { found, confidence: found ? 1 : 0 };
  }
  async extract(page) {
    return page.locator('.cf-turnstile').evaluateAll((nodes) => nodes.map((node) => ({
      sitekey: node.getAttribute('data-sitekey'),
      callback: node.getAttribute('data-callback'),
    })));
  }
  async act() {
    return { attempted: false, mode: 'observe-only' };
  }
  async verify(page) {
    return page.locator('.cf-turnstile').count().then((count) => count > 0);
  }
}

export class HCaptchaTestObserver extends BrowserPipelineAdapter {
  constructor() { super({ id: 'hcaptcha-test-observer', maxRounds: 1 }); }
  async detect(page) {
    const found = await page.locator('.h-captcha').count() > 0;
    return { found, confidence: found ? 1 : 0 };
  }
  async extract(page) {
    return page.locator('.h-captcha').evaluateAll((nodes) => nodes.map((node) => ({
      sitekey: node.getAttribute('data-sitekey'),
      callback: node.getAttribute('data-callback'),
    })));
  }
  async act() {
    return { attempted: false, mode: 'observe-only' };
  }
  async verify(page) {
    return page.locator('.h-captcha').count().then((count) => count > 0);
  }
}
