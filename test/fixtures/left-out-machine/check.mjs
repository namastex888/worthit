import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { sourceCase } from '../../support/source-case.mjs';
sourceCase(fileURLToPath(new URL('.', import.meta.url)), ({ cli, check, trace }) => {
  check('answered', cli());
  const before = trace().length;
  check('left_out', cli({ hosts: 'none' }));
  assert.ok(!trace().slice(before).some(c => c.command === 'ssh'), 'left-out machine must not be contacted');
  const withAnswer = trace().length;
  check('left_out_with_answer', cli({ hosts: 'box-c' }));
  assert.deepEqual(trace().slice(withAnswer).filter(c => c.command === 'ssh').map(c => c.args.at(-2)), ['box-c'], 'only the selected third machine answers; saved box-b stays left out');
  check('box_c_control', cli({ hosts: 'box-c', store: 'box-c-control' }), 'box-c-control');
});
