# Universal Challenge Lab / Source Beast

Source Beast is the simple front door for Yomu source onboarding: paste a website URL, test it, complete human verification only when the site asks for it, let Yomu re-run the full gauntlet, then publish the source when it passes.

The repository still includes the authorized challenge-lab tooling for adapter research, local fixtures, provider-published test credentials, and environments you own or are authorized to test.

> **Scope:** Source Beast does not add production CAPTCHA or anti-bot bypass logic. When a live source requires an interactive access check, it delegates to Yomu Source Forge's visible assisted Chromium session so the user can complete that check normally, then it reuses the resulting profile for the source gauntlet.

## Source Beast flow

```text
paste website URL
      ↓
Test source
      ↓
Source Forge + Yomu gauntlet
      ↓
   ┌── passed (88+) ────────────────┐
   │                                │
   │                         Add Source
   │                                │
   │                     publish + refresh Yomu
   │
   └── verification required
                ↓
        Open verification
                ↓
      user completes site check
                ↓
        Verify & retry
                ↓
       full gauntlet again
                ↓
            Add Source
```

The Add Source button stays locked until the generated Yomu source reaches Source Forge's STRONG publish threshold of **88+**.

## Running Source Beast with Yomu Source Forge

Source Beast expects Yomu Source Forge to be running locally. The defaults are:

- Source Beast: `http://127.0.0.1:4173`
- Yomu Source Forge: `http://127.0.0.1:8790`
- Yomu app: `https://yomu.yomuread.workers.dev`

Start Yomu Source Forge from the Yomu repository:

```bash
cd tools/source-forge
npm install
npx playwright install chromium
npm start
```

Then start Source Beast from this repository:

```bash
npm install
npx playwright install chromium
npm start
```

Open `http://127.0.0.1:4173`, paste a website URL, and click **Test source**.

For **Add Source** to publish into the extensions repository, configure Source Forge the same way Yomu already expects:

```bash
YOMU_GITHUB_TOKEN=github_pat_...
YOMU_EXTENSIONS_REPO=kumikilongyeyo/yomu-extensions
YOMU_EXTENSIONS_BRANCH=main
YOMU_APP_URL=https://yomu.yomuread.workers.dev
```

The GitHub token stays in the local Source Forge process; Source Beast never sends it to the browser.

Optional Source Beast bridge overrides:

```bash
YOMU_SOURCE_FORGE_URL=http://127.0.0.1:8790
YOMU_APP_URL=https://yomu.yomuread.workers.dev
```

## What is here

- Source Beast workflow state and Yomu Source Forge bridge.
- Confidence-based adapter registry and adaptive fallback strategy.
- EWMA learning from verified success/failure outcomes.
- Local text, semantic-grid, slider-geometry, and SHA-256 proof-of-work fixtures.
- Playwright-based `AuthorizedBrowserRunner` with a target-policy check **before** Chromium launches.
- Reusable browser lifecycle: `detect -> extract -> act -> verify -> retry`.
- Official test fixtures for Google reCAPTCHA v2, hCaptcha, and Cloudflare Turnstile.
- Provider readiness catalog for AWS WAF, DataDome, HUMAN/PerimeterX, and Akamai owned-sandbox work.
- Dashboard, run history, provider matrix, unit tests, and GitHub Actions browser smoke tests.

## Tests

```bash
npm test
npm run check
```

Inspect an authorized local fixture in Chromium:

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

The lab studies open-source solver projects for architecture patterns. See `docs/UPSTREAM.md`. The orchestration ideas are reimplemented behind explicit target and session boundaries rather than vendoring live bypass/token-injection code.

## Safety model

The standalone lab browser runner binds to loopback by default and accepts loopback and `.test` targets only. Live website onboarding is delegated to the existing Yomu Source Forge assisted-session path, which keeps persistent browser profiles locally and performs the actual source gauntlet and publish step.
