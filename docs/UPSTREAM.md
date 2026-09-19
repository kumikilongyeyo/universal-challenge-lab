# Upstream research references

This project studies public open-source solver architectures without bundling their production anti-bot bypass logic.

## Captcha-Sonic/playwright-solver

- License: MIT.
- Useful pattern: a small lifecycle that separates detection, extraction, action, verification, and retries.
- Adopted here: the architecture pattern, reimplemented in `src/browser/pipeline-adapter.js`.
- Not adopted: live token acquisition, challenge image submission, response injection, or arbitrary target automation.

## Bighra13/recaptcha-solver

- License: MIT.
- Useful pattern: headless/browser test ergonomics and retry/health concepts.
- Adopted here: design reference only.
- Not adopted: reCAPTCHA audio/challenge solving.

## Microsoft Playwright

- License: Apache-2.0.
- Used directly as the browser automation dependency.
- `AuthorizedBrowserRunner` applies the target policy before Chromium is launched.

The upstream catalog is machine-readable in `src/integrations/upstream-catalog.js`.
