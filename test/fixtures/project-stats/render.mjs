// Separate, explicitly slotted visual verification; never run by the fixture gate.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { demoData } from '../../../src/demo.mjs';
import { cardSpec, renderCardImage } from '../../../src/card.mjs';
const D = demoData(), spec = cardSpec('allowance', D);
assert.ok(D.projects.rows.some(r => r.project === 'github.com/acme/app-api'));
assert.ok(!JSON.stringify(spec).includes('github.com/acme/app-api'));
const result = await renderCardImage(spec, new URL('./demo-allowance.png', import.meta.url).pathname);
assert.ok(result.image, result.error);
const bytes = fs.readFileSync(result.image);
console.log(JSON.stringify({ ...result, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) }));
