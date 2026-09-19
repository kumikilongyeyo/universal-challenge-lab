# Changelog

## 0.3.0 - 2026-09-19

### Added

- Source Beast paste → test → verify-if-needed → re-test → add workflow.
- Bridge to Yomu Source Forge for real source preparation, assisted Chromium sessions, gauntlet scoring, publishing, and Yomu refresh.
- Server-side Source Beast run state so generated descriptors and publish payloads do not live in the browser UI.
- Human-verification handoff that automatically reruns the full Yomu gauntlet after verification succeeds.
- Strict Add Source gate aligned with Source Forge's STRONG publish threshold (88+).
- Source Beast dashboard with four visible stages: Test, Verify, Gauntlet, Add.
- Unit coverage for direct pass, verification/retry, and weak-score lockout flows.

## 0.2.0 - 2026-09-19

### Added

- Authorized Playwright browser runner with target gate before browser launch.
- Generic browser adapter lifecycle: detect → extract → act → verify → retry.
- Upstream research catalog with MIT/Apache-2.0 references and explicit non-vendoring policy.
- Official Google reCAPTCHA v2 test fixture and observer.
- Provider readiness matrix covering reCAPTCHA, hCaptcha, Turnstile, AWS WAF, DataDome, HUMAN/PerimeterX, and Akamai.
- GitHub Actions unit and Chromium smoke-test jobs.

## 0.1.0 - 2026-09-19

### Added

- Local challenge-fixture generator with mutation controls.
- Adapter registry and confidence-based routing.
- Adaptive EWMA policy that learns from validation outcomes.
- Fallback tracing and run-history dashboard.
- SHA-256 proof-of-work fixture and deterministic local fixture adapters.
- Cloudflare Turnstile official test-mode page.
- hCaptcha official integration-test page.
- Target policy that rejects arbitrary public web targets.
- Automated tests for routing, fallback, learning, and target restrictions.
