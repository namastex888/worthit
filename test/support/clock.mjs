// Test-only clock and network guard, loaded in the CLI process before application imports.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
const RealDate = Date, now = RealDate.parse('2026-11-14T12:00:00Z');
globalThis.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
const denied = () => { throw new Error('fixture attempted an unstubbed network call'); };
// Yoga loads its bundled WASM through a data URL even in --json mode.
const localFetch = globalThis.fetch;
globalThis.fetch = (resource, ...args) => String(resource).startsWith('data:') ? localFetch(resource, ...args) : denied();
http.request = http.get = https.request = https.get = denied;
net.Socket.prototype.connect = denied;
