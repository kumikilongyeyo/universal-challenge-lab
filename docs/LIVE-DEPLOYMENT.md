# Live Deployment

The hosted research build is deployed at:

- https://universal-challenge.hatchable.site
- Hatchable project: `proj_XqJYJiK5GJae`
- Deployment version: `1`

## Hosting model

The live build runs the adaptive fixture lab in the visitor's browser. Learning state is persisted with `localStorage`, so the hosted dashboard does not depend on a long-lived Node process.

Official provider test fixtures are hosted for:

- Google reCAPTCHA v2 test key
- hCaptcha integration-test key
- Cloudflare Turnstile dummy/test keys

AWS WAF, DataDome, HUMAN/PerimeterX, and Akamai remain marked as requiring an owned or explicitly authorized staging environment.

The hosted build intentionally does not expose an arbitrary-target URL runner or production anti-bot bypass endpoint.

## Visibility

The initial Hatchable deployment uses personal visibility. The project owner can switch the app to public visibility from the Hatchable project settings if a no-sign-in public URL is desired.
