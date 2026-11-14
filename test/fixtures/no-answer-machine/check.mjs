import { fileURLToPath } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';
sourceCase(fileURLToPath(new URL('.', import.meta.url)), ({ cli, check }) => {
  check('never_answered', cli({ offline: true, store: 'cold' }), 'cold');
  check('answered', cli());
  check('no_answer', cli({ offline: true }));
});
