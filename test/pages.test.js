import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The app's page is at the site's address, and for a while also at the address
// it had while it was being built. They are the same page but for where they
// point: a control added to one and not the other would only show at one address.
test('the page at the old address is the page at the site\'s address', () => {
  const body = (file) => readFileSync(new URL(file, import.meta.url), 'utf8').split('<body>')[1];
  assert.ok(body('../index.html').includes('id="tools"'));
  assert.equal(body('../next/index.html').replace('src="app.js"', 'src="next/app.js"'), body('../index.html'));
});
