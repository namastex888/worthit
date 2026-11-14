import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';
sourceCase(fileURLToPath(new URL('.', import.meta.url)), ({ cli, check, trace }) => {
  check('answered', cli());
  const before = trace().length;
  check('left_out', cli({ hosts: 'none' }));
  assert.ok(!trace().slice(before).some(c => c.command === 'ssh'), 'left-out machine must not be contacted');
});
