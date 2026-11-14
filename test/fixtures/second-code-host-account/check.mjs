import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';
sourceCase(fileURLToPath(new URL('.', import.meta.url)), ({ cli, check, trace }) => {
  check('primary', cli({ accounts: ['coder-a'] }));
  check('both', cli({ accounts: ['coder-a', 'coder-b'] }));
  check('both', cli({ accounts: ['coder-a', 'coder-b'] })); // cached PRs are not counted twice
  check('secondary_alone', cli({ accounts: ['coder-b'], store: 'secondary' }), 'secondary');
  check('both', cli({ accounts: ['coder-b', 'coder-a'], store: 'reversed' }), 'reversed');
  const queries = trace().filter(c => c.command === 'gh' && c.args[0] === 'api');
  for (const author of ['coder-a', 'coder-b']) assert.ok(queries.some(c => c.args.some(a => a.includes(`author:${author} `))), `independent query for ${author}`);
});
