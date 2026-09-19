# Provider test fixtures

The project includes browser-facing fixtures for provider-published **test credentials only**.

## Cloudflare Turnstile

`public/provider-tests/turnstile.html` contains three official dummy-sitekey scenarios:

- always-pass visible widget
- always-fail visible widget
- forced interactive widget for manual/visual testing

The forced-interactive fixture is deliberately not paired with an automated solver. It exists to verify layout, callbacks, loading states, and browser instrumentation.

## hCaptcha

`public/provider-tests/hcaptcha.html` uses hCaptcha's published always-pass integration-test sitekey. It never presents a normal challenge and is intended for deterministic E2E testing.

## Rule

Never replace these test values with production credentials in the repository. Real credentials belong in environment variables on an owned staging deployment, and the target policy must remain enabled.
