// Exercise the real collector and persistence without bypassing its subprocess statuses.
import fs from 'node:fs';
import { git, buildData, AUDIT } from '../../../src/collect.mjs';
const g = await git({}, () => {});
const data = buildData({ activity: [], this_week: {}, prices: { plan_usd_per_week: {} } }, g, { days: 21 }, { hosts: [], counts: {} });
fs.writeFileSync(process.env.FIXTURE_AUDIT, AUDIT.join('\n'));
console.log(JSON.stringify(data));
