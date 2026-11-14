import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

// Root keys are scenarios (or named expectations in the adopted saved-days check).
// Reusing one expectation is fine; leaving one untested is not.
export function expectedData(file) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8')), used = new Set();
  const label = path.basename(path.dirname(file));
  assert.ok(data && typeof data === 'object' && !Array.isArray(data), `${label}: expected-data must be an object`);
  return {
    get(key) {
      assert.ok(Object.hasOwn(data, key), `${label}: missing expected-data key ${key}`);
      used.add(key);
      return data[key];
    },
    done() {
      assert.deepEqual(Object.keys(data).filter(key => !used.has(key)), [], `${label}: unused expected-data keys`);
    },
  };
}
