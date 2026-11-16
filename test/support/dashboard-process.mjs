// Test-only synchronous spawn fault; successful renders use PR79's executable stub.
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { recordChromeCall } from './chrome-stub.mjs';

const spawnSync = childProcess.spawnSync;
childProcess.spawnSync = (command, args, options) => {
  if (command !== process.env.WORTHIT_TEST_CHROME) return spawnSync(command, args, options);
  assert.equal(options.timeout, 60000, 'dashboard keeps its 60 s deadline');
  if (process.env.FIXTURE_CHROME_MODE === 'throw') {
    recordChromeCall(args);
    throw new Error('synthetic screenshot spawn failure');
  }
  return spawnSync(command, args, options);
};
syncBuiltinESMExports();
