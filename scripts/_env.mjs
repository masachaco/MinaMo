// Shared settings of the browser tests.
// Chromium: CHROMIUM_PATH, else the one `npx playwright-core install chromium` put in Playwright's cache
// (undefined = let Playwright find it).
import fs from 'node:fs';

export function chromiumPath() {
  const p = process.env.CHROMIUM_PATH;
  if (p && fs.existsSync(p)) return p;
  return undefined;
}
