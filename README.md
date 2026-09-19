# Universal Challenge Lab

A local, authorized research harness for studying challenge detection, adapter selection, fallback behavior, browser instrumentation, and official provider test integrations.

> **Scope:** local fixtures, provider-published test credentials, and environments you own or are authorized to test. This repository does not bundle production anti-bot bypass logic.

## What is here

- Confidence-based adapter registry and adaptive fallback strategy.
- EWMA learning from verified success/failure outcomes.
- Local text, semantic-grid, slider-geometry, and SHA-256 proof-of-work fixtures.
- Playwright-based `AuthorizedBrowserRunner` with a target-policy check **before** Chromium launches.
- Reusable browser lifecycle: `detect -> extract -> act -> verify -> retry`.
- Official test fixtures for Google reCAPTCHA v2, hCaptcha, and Cloudflare Turnstile.
- Provider readiness catalog for AWS WAF, DataDome, HUMAN/PerimeterX, and Akamai owned-sandbox work.
- Dashboard, run history, provider matrix, unit tests, and GitHub Actions browser smoke tests.

## Quick start

```bash
npm install
npx playwright install chromium
npm start
# open http://127.0.0.1:4173
```

Run unit tests:

```bash
npm test
```

Inspect an authorized local page in Chromium:

```bash
npm run browser:inspect -- http://127.0.0.1:4173/provider-tests/turnstile.html
```

## Provider readiness

| Provider | Current lab support |
|---|---|
| Google reCAPTCHA v2 | Official automated-test fixture + observer |
| hCaptcha | Official integration-test fixture + observer |
| Cloudflare Turnstile | Official pass/fail/forced-interactive fixtures + observer |
| AWS WAF | Adapter slot; requires an AWS staging system you control |
| DataDome | Adapter slot; requires authorized sandbox/staging |
| HUMAN / PerimeterX | Adapter slot; requires authorized sandbox/staging |
| Akamai Bot Manager | Adapter slot; requires authorized sandbox/staging |

## Upstream research

The lab studies open-source solver projects for architecture patterns. See `docs/UPSTREAM.md`. We reimplemented the useful orchestration ideas behind a strict target gate rather than vendoring live bypass/token-injection code.

## Safety model

The server binds to loopback by default. `AuthorizedBrowserRunner` accepts loopback and `.test` hosts only. Provider pages use published test keys. Production credentials should never be committed.
