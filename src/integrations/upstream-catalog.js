export const upstreamCatalog = [
  {
    name: 'Captcha-Sonic/playwright-solver',
    url: 'https://github.com/Captcha-Sonic/playwright-solver',
    license: 'MIT',
    importedCode: false,
    usedFor: ['pipeline lifecycle', 'Playwright adapter separation', 'retry/verification structure'],
    note: 'Architecture reference only. Live token/injection solver logic is not vendored.',
  },
  {
    name: 'Bighra13/recaptcha-solver',
    url: 'https://github.com/Bighra13/recaptcha-solver',
    license: 'MIT',
    importedCode: false,
    usedFor: ['headless-test ergonomics', 'health/retry design reference'],
    note: 'Reference only; production reCAPTCHA-solving logic is not bundled.',
  },
  {
    name: 'microsoft/playwright',
    url: 'https://github.com/microsoft/playwright',
    license: 'Apache-2.0',
    importedCode: false,
    usedFor: ['authorized browser automation'],
  },
];
