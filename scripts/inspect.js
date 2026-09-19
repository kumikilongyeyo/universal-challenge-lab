import { AuthorizedBrowserRunner } from '../src/browser/authorized-browser-runner.js';

const url = process.argv[2] || 'http://127.0.0.1:4173/provider-tests/turnstile.html';
const runner = new AuthorizedBrowserRunner();
const result = await runner.inspect(url);
console.log(JSON.stringify(result, null, 2));
