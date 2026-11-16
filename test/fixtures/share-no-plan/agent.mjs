#!/usr/bin/env node
// A local executable at the real AI CLI boundary; no login, tools or network.
import fs from 'node:fs';

process.stdin.resume();
process.stdin.on('end', () => {
  const usable = process.env.FIXTURE_AGENT_MODE === 'usable';
  fs.appendFileSync(process.env.FIXTURE_AGENT_TRACE, (usable ? 'usable' : 'unusable') + '\n');
  const text = usable ? JSON.stringify({
    text: 'my ai output this week: 100000 tokens. npx worthit',
    headline: '100000', caption: 'output tokens this week',
    facts: [{ label: 'output tokens', value: '100000' }, { label: 'API-priced usage', value: '$20' }],
  }) : 'no usable post';
  console.log(JSON.stringify({ type: 'stream_event', event: {
    type: 'content_block_delta', delta: { type: 'text_delta', text },
  } }));
});
