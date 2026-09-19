# Universal Challenge Lab

A local, authorized research harness for studying challenge detection, adapter selection, fallback behavior, and test-provider integrations.

> **Scope:** this project is deliberately restricted to local fixtures, official provider test credentials, and environments you own or are authorized to test. It is not a universal CAPTCHA bypasser and does not target production third-party sites.

## Goals

- One adapter interface for many challenge *test* types.
- Confidence-based routing instead of giant `if/else` chains.
- Fallback when an adapter fails validation.
- Lightweight policy learning from previous runs.
- Repeatable mutation/batch testing.
- Browser-facing dashboard for inspecting runs.
- Official test-mode pages for Cloudflare Turnstile and hCaptcha.

## Quick start

```bash
npm start
# open http://127.0.0.1:4173
```

Run the test suite:

```bash
npm test
```

## Safety model

The server binds to loopback by default and refuses arbitrary remote targets. Provider integrations use documented test keys only. Any future real-provider adapter should be implemented for a staging system you control and must preserve the target policy in `src/core/target-policy.js`.

## Architecture

```text
fixture/provider test
        |
        v
  challenge descriptor
        |
        v
 adapter registry -----> confidence scores
        |                     |
        +----------> adaptive orchestrator
                            |
                 attempt -> validate -> learn
                            |
                            v
                       run history
```

## Current milestone

`v0.1` focuses on the orchestration skeleton and deterministic local fixtures. Provider test pages are intentionally integration tests, not production solvers.
