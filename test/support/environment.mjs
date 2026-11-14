import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

// Resolve executables, never inherit account/config variables or the host's command search path.
export function isolatedEnvironment() {
  const python = spawnSync('/usr/bin/which', ['python3'], { encoding: 'utf8' }).stdout.trim();
  if (!python || !path.isAbsolute(python)) throw new Error('Python 3 is required for fixtures');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'worthit-fixture-'));
  const home = path.join(tmp, 'home'), bin = path.join(tmp, 'bin');
  fs.mkdirSync(bin); fs.mkdirSync(home);
  for (const [name, target] of Object.entries({ node: process.execPath, python3: python, python, which: '/usr/bin/which' })) fs.symlinkSync(target, path.join(bin, name));
  const env = {
    PATH: bin, HOME: home, WORTHIT_HOME: path.join(tmp, 'store'), TMPDIR: tmp,
    CODEX_HOME: path.join(home, '.codex'), CLAUDE_CONFIG_DIR: path.join(home, '.claude'),
    METER_STATE_DIR: path.join(home, '.meter'), XDG_STATE_HOME: path.join(home, '.local/state'),
    XDG_CONFIG_HOME: path.join(home, '.config'), XDG_DATA_HOME: path.join(home, '.local/share'),
    GH_CONFIG_DIR: path.join(home, '.config/gh'), TZ: 'UTC', LANG: 'en_US.UTF-8',
    PYTHONDONTWRITEBYTECODE: '1', WORTHIT_NO_CACHE: '1', USAGE_ACCT_SALT: 'synthetic-fixtures',
  };
  return { tmp, bin, home, python, env, cleanup: () => fs.rmSync(tmp, { recursive: true, force: true }) };
}
