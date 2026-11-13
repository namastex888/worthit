#!/usr/bin/env node
// worthit — what your AI coding subscription is really worth. One command, everything local.
//   npx worthit                 three questions, live scan, dashboard, then a question bar (ctrl+c exits)
//   npx worthit --json          no UI: prints the week's data as JSON (for agents and scripts)
//   worthit get [section] · worthit days [--since D --until D --group day|week|month --by total|tool|model] · worthit sql "SELECT …" · worthit schema · worthit --skill
//   worthit --demo (the whole run on sample data) · worthit install-skill (adds the agent skill to your coding agents)
//   --git yes|no   --ai claude|codex|omp|dsh|no   --days 21   --hosts all|none|a,b (saved ssh machines to include)   --ask "question"   --no-files
// Writes ./<date>-worthit.md, ./<date>-worthit.png (when Chrome is installed) and ./<date>-worthit-audit.log.
process.removeAllListeners('warning'); process.on('warning', () => {});
import '../src/quiet.mjs';
import React, { useState, useEffect, useRef } from 'react';
import crypto from 'node:crypto';
import { render, Box, Text, Static, useApp, useInput, useStdin } from 'ink';
import { PassThrough } from 'node:stream';
import { z } from 'zod';
import { defineCatalog, createSpecStreamCompiler } from '@json-render/core';
import { schema } from '@json-render/ink/schema';
import { createRenderer } from '@json-render/ink';
import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { blocks, C, W, bar, fg, bold, d, m, w, pad, lpad, len, strip, grad, fmtTok, usd } from '../src/draw.mjs';
import { scan, analyse, git, buildData, audit, AUDIT, has, tilde, ROOT, HOME, sshHosts, savedHosts, saveHosts } from '../src/collect.mjs';
import { query, run as runQuery, QUERY_COMMANDS } from '../src/query.mjs';
import { startPet, petLines, petSummary, PET_W } from '../src/pet.mjs';
import { demoHosts, demoScan, demoGit, demoPricing, demoData, demoSpec, demoAnswer, demoPet } from '../src/demo.mjs';

const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const h = React.createElement, argv = process.argv.slice(2);
const flag = k => argv.includes(k), arg = (k, dflt) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : dflt; };
if (flag('--version') || flag('-v')) { console.log(VERSION); process.exit(0); }
if (argv[0] && !argv[0].startsWith('-') && !['get', 'days', 'sql', 'schema', 'install-skill'].includes(argv[0])) { console.error(`worthit: unknown command "${argv[0]}". Try: worthit --help`); process.exit(2); }
if (await query(argv)) process.exit(0);        // get / days / sql / schema / --skill: answered from the local store, no scan
// from here on a scan would start: never from inside another worthit run (lookups above stay allowed)
if (process.env.WORTHIT_RUNNING) { console.error('worthit: started from inside another worthit run; stopping.'); process.exit(2); }
process.env.WORTHIT_RUNNING = '1';        // inherited by every program this run starts
if (flag('--help') || flag('-h')) { console.log(fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 8).map(l => l.replace(/^\/\/ ?/, '')).join('\n')); process.exit(0); }
const JSON_MODE = flag('--json'), ASK = arg('--ask'), F_GIT = arg('--git'), F_AI = arg('--ai'), DAYS = +arg('--days', 21), F_HOSTS = arg('--hosts'), DEMO = flag('--demo'), NO_FILES = flag('--no-files') || DEMO, FRESH = flag('--fresh');
// the agent skill (skills/worthit/SKILL.md in this package and in the repo): installed into the person's coding agents with the skills CLI
const SKILL_CMD = ['npx', '-y', 'skills', 'add', 'namastex888/worthit', '-s', 'worthit', '-g', '-y'], SETTINGS_FILE = path.join(HOME, 'settings.json');
const settings = () => { try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); } catch { return {}; } };
const saveSettings = patch => { try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...settings(), ...patch })); } catch { /* not fatal */ } };
if (argv[0] === 'install-skill') { const r = spawnSync(SKILL_CMD[0], SKILL_CMD.slice(1), { stdio: 'inherit' }); if (r.status === 0) saveSettings({ skill: 'installed', skill_at: new Date().toISOString() }); process.exit(r.status ?? 1); }
const TTY = !!process.stdin.isTTY && !JSON_MODE;
const AGENTS = [{ id: 'claude', cli: 'claude', label: 'Claude Sonnet 5.5', model: 'claude-sonnet-5-5' }, { id: 'codex', cli: 'codex', label: 'GPT-6.1 Sol', model: 'gpt-6.1-sol' },
  { id: 'omp', cli: 'omp', label: 'omp', model: 'omp · your default model', via: 'omp -p, your default model' }, { id: 'dsh', cli: 'dsh', label: 'dsh', model: 'dsh headless', via: 'dsh headless, your DeepSeek profile' }].filter(a => has(a.cli));
const STAMP = (() => { const t = new Date(); return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0'); })();
let DATA = null;
const DETECTED = DEMO ? demoHosts : sshHosts(), SAVED = DEMO ? ['build-box'] : savedHosts();      // other machines: --hosts all | none | a,b; without the flag, the remembered choice (or the question)
let HOSTS = F_HOSTS == null ? (SAVED || []) : F_HOSTS === 'all' ? DETECTED.map(x => x.alias) : F_HOSTS === 'none' ? [] : F_HOSTS.split(',').filter(Boolean);
// Saved report: when nothing the report is built from has changed, the model is not asked again.
const REPORT_FILE = path.join(HOME, 'report-cache.json');
// "Same data" means: same day, same ranking, level, streak and events, and no headline number moved by more than 2%.
// (An exact match would never hit while agents are working: every new request changes the totals a little.)
const reportKey = agent => { const D = DATA, t = D.totals || {}, g = D.git || {}, nums = { output_tokens: t.output_tokens, api_value_usd: t.api_value_usd, merged_prs: g.merged_prs, commits: g.commits, usd_per_merged_pr: g.usd_per_merged_pr };
  for (const p of D.plans) nums['plan_' + p.key] = p.usd_per_full_week;
  for (const x of D.waste) nums['unused_' + x.account] = x.unused_usd;
  const exact = crypto.createHash('sha256').update(JSON.stringify([D.week.to, D.machines, D.plans.map(p => p.key + p.proof), (D.events || []).map(e => e.date + e.title), D.game && [D.game.level, D.game.streak_days], agent.id, agent.model, SYSTEM])).digest('hex');
  return { exact, nums }; };
const sameReport = (a, b) => !!a && !!a.nums && a.exact === b.exact && Object.keys({ ...a.nums, ...b.nums }).every(k => { const x = +a.nums[k] || 0, y = +b.nums[k] || 0; return Math.abs(x - y) <= Math.max(1, 0.02 * Math.abs(x)); });
const readReport = () => { try { return JSON.parse(fs.readFileSync(REPORT_FILE, 'utf8')); } catch { return null; } };
const saveReport = (key, agent, spec, n) => { try { fs.mkdirSync(HOME, { recursive: true }); fs.writeFileSync(REPORT_FILE, JSON.stringify({ key, at: new Date().toISOString(), agent: agent.model, n, spec })); audit('write', tilde(REPORT_FILE) + '  (this report, reused while the data stays the same)'); } catch { /* not fatal */ } };
const forModel = () => { const { heat, ...rest } = DATA; return JSON.stringify({ ...rest, busiest: heat.note }); };   // the hourly grid is drawn by the harness

// ---------------------------------------------------------------- headless: --json
if (JSON_MODE) {
  if (DEMO) { console.log(JSON.stringify({ worthit: VERSION, ...demoData() }, null, 1)); process.exit(0); }
  const cfg = { days: DAYS, hosts: HOSTS, git: F_GIT !== 'no' };
  const tick = (label, p) => { if (process.stderr.isTTY) process.stderr.write(`\r\x1b[K${label} ${p.pct == null ? '' : Math.round(p.pct * 100) + '%'} ${String(p.detail || '').slice(0, 90)}`); };
  try {
    const gP = cfg.git ? git(cfg, () => {}) : null, s = await scan(cfg, p => tick('scanning', p)), report = await analyse(s.runDir), g = gP ? await gP : null;
    if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
    console.log(JSON.stringify({ worthit: VERSION, ...buildData(report, g, cfg, s) }, null, 1)); process.exit(0);
  } catch (e) { console.error('\nworthit: ' + e.message); process.exit(1); }
}

// ---------------------------------------------------------------- catalog: the only things the agent can place
const none = z.object({}), text = z.object({ text: z.string() }), def = (props, description, slots = []) => ({ props, slots, description });
const catalog = defineCatalog(schema, { actions: {}, components: {
  Stack: def(none, 'The root. Stacks its children top to bottom.', ['default']),
  Row: def(none, 'Puts exactly two children side by side. Only these pairs fit: LevelCard + PlanRanking, or Heatmap + LimitTrend.', ['default']),
  Verdict: def(text, 'One bold headline sentence with a gold arrow. You write the text, at most 95 characters.'),
  Tiles: def(none, 'KPI tiles (tokens out, API value used, and with git data PRs shipped and cost per PR) with change vs the previous 7 days and sparklines. Drawn from the data. No props.'),
  LevelCard: def(none, 'The player card: level, XP bar, day streak, personal bests, next badge. Drawn from the data. No props.'),
  PlanRanking: def(none, 'Ranks the plans by $ of API usage per full weekly limit, with bars, the multiple of the plan price and the proof level. Drawn from the data. No props.'),
  Receipts: def(none, 'One panel per plan showing how its number was calculated, step by step. Drawn from the data. No props.'),
  Heatmap: def(none, 'Seven days by 24 hours of output tokens: when the user worked. Drawn from the data. No props.'),
  LimitTrend: def(none, 'Weekly limit over the last weeks as columns, and for each plan whether the limit moved (the provider\'s doing). Drawn from the data. No props.'),
  Events: def(none, 'Table of this week\'s provider events: resets, limit changes, model launches. Drawn from the data. No props.'),
  Months: def(none, 'Month by month table per plan: days tracked, API value actually used, how many times the monthly plan price that is, the measured weekly limit, merged PRs and commits. Drawn from the data. No props.'),
  ModelMix: def(none, 'Two line charts: each model\'s share of output tokens week by week (with the change vs last week), and open-weight vs closed models with tokens, API value and dollars per million output. Drawn from the data. No props.'),
  WasteTable: def(none, 'Per account: limit, share used, dollars left unused, and whether that was the cap or the user spending less. Drawn from the data. No props.'),
  Summary: def(text, 'Executive summary panel. You write the text: three short sentences.'),
  Chart: def(z.object({ title: z.string(), subtitle: z.string().optional(), unit: z.string().optional(), note: z.string().optional(),
    items: z.array(z.object({ label: z.string(), value: z.number(), color: z.string().optional(), note: z.string().optional() })) }),
    'A horizontal bar chart for anything the ready blocks do not show. unit "$" for dollars, or a suffix such as "×" or "%". A label that starts with a plan name takes that plan\'s color. At most 12 items.'),
  Facts: def(z.object({ items: z.array(z.object({ label: z.string(), value: z.string(), note: z.string().optional() })) }), 'A row of up to four small tiles: label, big value, short note.'),
  Note: def(text, 'One or two plain sentences of context or caveat.'),
} });
const COMMON = [
  'Output ONLY JSONL patches, one JSON object per line. No code fences, no prose, no blank lines.',
  'The first patch sets /root to a Stack. Then add elements in top-to-bottom order, a parent (with its full children list) before its children.',
  'Blocks with no props draw themselves from the data. Never restate their numbers in other blocks.',
  'Any number you write must be copied exactly from the data. To compare plans use usd_per_full_week and times_plan_price; never divide priced_usd yourself.',
  'Do not use $state references. Keep ids short.'];
const SYSTEM = catalog.prompt({ system: 'You compose the "Your week" terminal dashboard for worthit, a tool that tells a developer what their AI coding subscriptions were really worth this week and how productive they were. You place ready-made blocks and write two pieces of text.',
  customRules: [...COMMON,
    'Use exactly this order: Verdict, Tiles, Row(LevelCard, PlanRanking), Receipts, Row(Heatmap, LimitTrend), WasteTable, Months, ModelMix, Events, Summary.',
    'Verdict: which plan gave the most this week and by how much. If "plans" is empty, make it about the week\'s output instead.',
    'Summary: three short sentences, direct and a little playful. Say whether the last 7 days were more or less productive than the 7 before, what carried them, and the one thing to do next (use allowance that is about to reset, protect the streak, reach the next level). If the data has no "git" key, do not mention PRs or cost per PR.'] });
const ASK_SYSTEM = catalog.prompt({ system: 'You answer questions about a developer\'s AI subscription usage for worthit. You always answer visually, by placing blocks.',
  customRules: [...COMMON,
    'Start with a Verdict that answers the question directly. Then one or two blocks that prove it: prefer a ready block that already shows it (PlanRanking, Receipts, WasteTable, LimitTrend, Heatmap, Tiles, LevelCard); otherwise a Chart or Facts with values copied from the data. A Note is optional.',
    'DATA covers the last 7 days in detail. For other dates or finer history (per day, per week, per month, per model, per tool) you may look it up in the local store first: reply with ONLY one to three lines of the form `QUERY: worthit <command>` and nothing else. You then receive the results and draw the answer, putting looked-up values into a Chart or Facts block.',
    'Lookup commands: `get <section>` (a section of DATA) · `days [--since YYYY-MM-DD] [--until YYYY-MM-DD] [--group day|week|month] [--by total|tool|model] [--tool claude|codex|google|omp|dsh] [--model <part of the id>]` · `sql "SELECT ..."` over day_provider(day, provider, api_usd, output_tokens, requests), day_model(day, model, provider, output_tokens, api_usd), day(day, prs, commits), plan_value(day, provider, plan, usd_per_full_week, times_plan_price, proof).',
    'If neither DATA nor a lookup can answer the question, say in the Verdict what is missing and show the closest block.'] });

const safe = (type, props) => { try { return blocks[type](DATA, props || {}); } catch (e) { return ['  ' + type + ': could not draw (' + String(e.message).slice(0, 60) + ')']; } };
const registry = { Stack: ({ children }) => h(Box, { flexDirection: 'column' }, children), Row: ({ children }) => h(Box, { flexDirection: 'row', gap: 1 }, children) };
for (const t of Object.keys(blocks)) registry[t] = ({ element }) => h(Text, { wrap: 'truncate-end' }, safe(t, element.props).join('\n'));
const InkRenderer = createRenderer(catalog, registry);
class Guard extends React.Component { constructor(p) { super(p); this.state = { e: null }; } static getDerivedStateFromError(e) { return { e }; }
  render() { return this.state.e ? h(Text, { dimColor: true }, '  (waiting for the next patch)') : this.props.children; } }
function ready(spec) {               // a streamed spec can name children that have not arrived yet: draw only what exists
  if (!spec || !spec.root || !spec.elements || !spec.elements[spec.root]) return null;
  const el = {}; for (const [k, v] of Object.entries(spec.elements)) if (v && v.type && registry[v.type]) el[k] = { ...v, props: v.props || {}, children: (v.children || []).filter(c => spec.elements[c] && registry[spec.elements[c].type]) };
  return el[spec.root] ? { ...spec, elements: el } : null;
}
const View = ({ spec, k }) => { const r = ready(spec); return r ? h(Guard, { key: k }, h(InkRenderer, { spec: r, state: {} })) : null; };
// the same spec as plain lines, for the image and the .md
function specLines(spec) {
  const r = ready(spec); if (!r) return [];
  const one = id => { const e = r.elements[id]; if (e.type === 'Stack') return e.children.flatMap(one);
    if (e.type === 'Row') { const cols = e.children.map(one), hh = Math.max(0, ...cols.map(c => c.length)); return Array.from({ length: hh }, (_, i) => cols.map(c => pad(c[i] || '', Math.max(...c.map(len)))).join(' ')); }
    return safe(e.type, e.props); };
  return one(r.root);
}
function builtin() {                 // the dashboard without any model: data tables only, no written conclusions
  const E = { root: { type: 'Stack', children: ['t', 'r1', 'rc', 'r2', 'ws', 'mo', 'mx', 'ev'] },
    t: { type: 'Tiles' }, r1: { type: 'Row', children: ['l', 'p'] }, l: { type: 'LevelCard' }, p: { type: 'PlanRanking' }, rc: { type: 'Receipts' }, r2: { type: 'Row', children: ['hm', 'lt'] }, hm: { type: 'Heatmap' }, lt: { type: 'LimitTrend' }, ws: { type: 'WasteTable' }, ev: { type: 'Events' }, mo: { type: 'Months' }, mx: { type: 'ModelMix' } };
  for (const e of Object.values(E)) { e.children = e.children || []; e.props = e.props || {}; }
  return { root: 'root', elements: E };
}

// ---------------------------------------------------------------- one model call -> patches, plus a one-line trace of what the agent is doing
const tail = (s, n) => { s = s.replace(/\s+/g, ' ').trim(); const cut = Math.max(s.lastIndexOf('. ', s.length - 3), s.lastIndexOf('? ', s.length - 3)); s = cut > 0 && s.length - cut > 12 ? s.slice(cut + 2) : s; return s.length > n ? '…' + s.slice(-n + 1) : s; };
function feed({ system, user, agent }, onPatch, onStatus, onDone) {
  const compiler = createSpecStreamCompiler(); let buf = '', n = 0, think = ''; const t0 = Date.now();
  const line = l => { l = l.trim(); if (!l.startsWith('{')) return; try { const { result, newPatches } = compiler.push(l + '\n'); if (newPatches.length) { n += newPatches.length;
    const v = JSON.parse(l).value, what = v && v.type ? 'placing ' + v.type + (v.props && v.props.text ? ': ' + String(v.props.text).slice(0, 60) : v.props && v.props.title ? ': ' + v.props.title : '') : null;
    onPatch(structuredClone(result), n); if (what) onStatus('drawing', what); } } catch { /* a bad line is skipped */ } };
  let raw = ''; const text = t => { raw += t; buf += t; let i; while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); } };
  const end = err => { if (buf) line(buf); audit('agent', `${agent.cli} finished: ${err ? 'failed: ' + err : n + ' patches'} in ${((Date.now() - t0) / 1000).toFixed(1)}s`); onDone({ n, secs: ((Date.now() - t0) / 1000).toFixed(1), err, raw }); };
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'worthit-'));
  let out = '', errs = ''; const lines = fn => c => { out += c; let i; while ((i = out.indexOf('\n')) >= 0) { const l = out.slice(0, i); out = out.slice(i + 1); try { fn(JSON.parse(l)); } catch { /* not json */ } } };
  let p, pending = Promise.resolve();
  if (agent.id === 'codex') {       // codex has no system-prompt flag and sends each message whole: prepend the rules, then draw line by line
    audit('agent', `codex exec --json -m ${agent.model} -c model_reasoning_effort="medium" -s read-only   (${system.length + user.length} characters sent on stdin, shown below)`);
    p = spawn('codex', ['exec', '--json', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only', '-m', agent.model, '-c', 'model_reasoning_effort="medium"'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    p.stdin.end(system + '\n\n' + user);
    p.stdout.on('data', lines(o => { const it = o.item || {};
      if (o.type === 'item.completed' && it.type === 'agent_message') for (const l of String(it.text).split('\n')) pending = pending.then(() => new Promise(r => { text(l + '\n'); setTimeout(r, 40); }));
      else if (it.type === 'reasoning' && it.text) onStatus('thinking', tail(String(it.text).replace(/\*\*/g, ''), W - 8));
      else if (it.type === 'command_execution') onStatus('using a tool', tail(String(it.command || ''), W - 8));
      else if (o.type === 'error') errs += String(o.message || ''); }));
  } else if (agent.id === 'omp') {  // omp streams text and thinking deltas as JSON events; no tools, no skills, no project context
    audit('agent', `omp -p --mode json --no-session --no-tools --thinking medium (your default model)   (${system.length + user.length} characters sent, shown below)`);
    p = spawn('omp', ['-p', '--mode', 'json', '--no-session', '--no-tools', '--no-skills', '--no-rules', '--no-context-files', '--no-extensions', '--no-title', '--thinking', 'medium', '--system-prompt', system], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    p.stdin.end(user);
    p.stdout.on('data', lines(o => { const ev = o.assistantMessageEvent || {};
      if (o.type === 'message_update' && ev.type === 'text_delta') text(ev.delta || '');
      else if (o.type === 'message_update' && ev.type === 'thinking_delta') { think += ev.delta || ''; onStatus('thinking', tail(think, W - 8)); }
      else if (o.type === 'message_start' && o.message && o.message.role === 'assistant' && o.message.model) onStatus('asking ' + o.message.model, 'answering');
      else if (o.type === 'error') errs += String(o.message || o.error || ''); }));
  } else if (agent.id === 'dsh') {  // dsh headless prints the final answer whole and has no system-prompt flag: prepend the rules, then draw line by line
    audit('agent', `dsh headless --approval-policy never -   (${system.length + user.length} characters sent on stdin, shown below)`);
    p = spawn('dsh', ['headless', '--approval-policy', 'never', '-'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    p.stdin.end(system + '\n\n' + user); let all = '';
    p.stdout.on('data', c => { all += c; });
    p.stdout.on('end', () => { for (const l of all.split('\n')) pending = pending.then(() => new Promise(r => { text(l + '\n'); setTimeout(r, 40); })); });
  } else {
    audit('agent', `claude -p --model ${agent.model} --effort medium --tools "" (no tools)   (${system.length + user.length} characters sent, shown below)`);
    p = spawn('claude', ['-p', '--model', agent.model, '--effort', 'medium', '--output-format', 'stream-json', '--include-partial-messages', '--verbose',
      '--system-prompt', system, '--tools', '', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', 'project'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    p.stdin.end(user);
    p.stdout.on('data', lines(o => { const ev = o.type === 'stream_event' ? o.event || {} : {}, dl = ev.type === 'content_block_delta' ? ev.delta : null;
      if (dl && dl.type === 'text_delta') text(dl.text);
      else if (dl && dl.type === 'thinking_delta') { think += dl.thinking || ''; onStatus('thinking', tail(think, W - 8)); }
      else if (ev.type === 'content_block_start' && ev.content_block && ev.content_block.type === 'tool_use') onStatus('using a tool', ev.content_block.name);
      else if (o.type === 'result' && o.is_error) errs += String(o.result || ''); }));
  }
  for (const l of (user).split('\n')) audit('sent', l.length > 4000 ? l.slice(0, 4000) + ` … (${l.length} characters)` : l);
  onStatus('asking ' + agent.label, 'sending the week\'s data');
  p.stderr.on('data', c => { errs += c; });
  p.on('close', code => pending.then(() => end(code || (!n && errs.trim()) ? (errs.trim().split('\n').filter(l => !/^Warning:/.test(l)).pop() || agent.cli + ' exited ' + code).slice(0, 160) : null)));
  p.on('error', e => end('could not start ' + agent.cli + ': ' + e.message));
}

// ---------------------------------------------------------------- files: one .md, one image, one audit log, in the current folder
function ansiHtml(lines) {
  const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;'); let st = { c: null, b: false, i: false }, o = '';
  for (const part of lines.join('\n').split(/(\x1b\[[0-9;]*m)/)) { const mm = /^\x1b\[([0-9;]*)m$/.exec(part);
    if (!mm) { if (part) o += `<span style="${st.c ? `color:rgb(${st.c});` : ''}${st.b ? 'font-weight:700;' : ''}${st.i ? 'font-style:italic;' : ''}">${esc(part)}</span>`; continue; }
    const c = mm[1]; if (c.startsWith('38;2;')) st.c = c.split(';').slice(2, 5).join(','); else if (c === '39') st.c = null; else if (c === '1') st.b = true; else if (c === '22') st.b = false; else if (c === '3') st.i = true; else if (c === '23') st.i = false; }
  return `<!doctype html><meta charset="utf-8"><body style="margin:0;background:#0b0b0d"><pre style="margin:28px 32px;font:15px/1.24 Menlo,'DejaVu Sans Mono',monospace;color:#b4b4ae">${o}</pre>`;
}
const LOGO = (() => { const F = { W: ['█   █', '█   █', '█ █ █', '██ ██', '█   █'], O: ['█████', '█   █', '█   █', '█   █', '█████'], R: ['████ ', '█   █', '████ ', '█  █ ', '█   █'], T: ['█████', '  █  ', '  █  ', '  █  ', '  █  '], H: ['█   █', '█   █', '█████', '█   █', '█   █'], I: ['███', ' █ ', ' █ ', ' █ ', '███'] };
  return [0, 1, 2, 3, 4].map(r => ' ' + grad([...'WORTHIT'].map(ch => [...F[ch][r]].map(x => x + x).join('')).join('  '), C.cl, C.pink, C.go)); })();
function writeFiles(spec) {
  if (NO_FILES) return [];
  const out = [], dash = specLines(spec), head = [...LOGO, ' ' + m('what your AI coding subscription is really worth') + d(`  ·  7 days to ${DATA.week.to}  ·  ${DATA.machines} machine${DATA.machines > 1 ? 's' : ''}  ·  v${VERSION}`), ''];
  const el = spec.elements || {}, txt = t => (Object.values(el).find(e => e.type === t) || { props: {} }).props.text || '';
  const md = [`# worthit · ${STAMP}`, '', ...(txt('Verdict') ? [`> ${txt('Verdict')}`, ''] : []), '## Which plan gave more', '', '| Plan | $ per full weekly limit | × plan price | Proof | How it was read |', '|---|---|---|---|---|',
    ...DATA.plans.map(p => `| ${p.plan} | ${usd(p.usd_per_full_week)} | ${p.times_plan_price}× | ${p.proof} | ${p.meter}; ${usd(p.priced_usd)} priced ÷ ${p.fraction_of_week} weekly limits; ${p.models} |`), ...(DATA.plans.length ? [] : ['| (no finished weekly limit in the scanned days) | | | | |']), '',
    '## Last 7 days', '', `- Output tokens: ${fmtTok(DATA.totals.output_tokens)}${DATA.totals.output_tokens_change_pct == null ? '' : ` (${DATA.totals.output_tokens_change_pct >= 0 ? '+' : ''}${DATA.totals.output_tokens_change_pct}% vs the 7 days before)`}`, `- API value used: ${usd(DATA.totals.api_value_usd)}`,
    ...(DATA.git ? [`- Merged PRs: ${DATA.git.merged_prs} · commits: ${DATA.git.commits} · repos: ${DATA.git.repos}`, `- Cost per merged PR: ${DATA.git.usd_per_merged_pr == null ? 'n/a' : '$' + DATA.git.usd_per_merged_pr.toFixed(2)}`] : []),
    `- Level ${DATA.game.level} (${DATA.game.title}), ${DATA.game.xp.toLocaleString('en-US')} XP, ${DATA.game.streak_days}-day streak`, '',
    '## Month by month', '', '| Month | Plan | Days tracked | API value used | × monthly plan price | Measured weekly limit |', '|---|---|---|---|---|---|', ...(DATA.months || []).map(x => `| ${x.month} | ${x.plan} | ${x.days_tracked} | ${usd(x.api_usd_used)} | ${x.used_times_plan_price}× | ${x.weekly_limit_usd ? usd(x.weekly_limit_usd) : ''} |`), '',
    ...(DATA.model_mix ? ['## Model mix', '', `Share of output tokens per 7-day block (${DATA.model_mix.weeks.join(', ')}).`, '', '| Model | Weights | ' + DATA.model_mix.weeks.join(' | ') + ' | vs last week |', '|---|---|' + DATA.model_mix.weeks.map(() => '---|').join('') + '---|',
      ...[...DATA.model_mix.series, DATA.model_mix.open, DATA.model_mix.closed].map(s => `| ${s.model} | ${s.open == null ? '' : s.open ? 'open' : 'closed'} | ${s.share_pct.map(v => v + '%').join(' | ')} | ${s.change_pts == null ? '' : (s.change_pts > 0 ? '+' : '') + s.change_pts + ' pts'} |`), '', DATA.model_mix.open_rule + '.', ''] : []),
    '## Events this week', '', '| Date | Provider | Type | What happened | Source |', '|---|---|---|---|---|', ...(DATA.events || []).map(e => `| ${e.date} | ${e.provider} | ${e.type} | ${e.title} | ${e.source} |`), '',
    '## Subscription waste', '', '| Account | Limit | Used | Unused | Why |', '|---|---|---|---|---|', ...DATA.waste.map(x => `| ${x.account} | ${usd(x.limit_usd)} | ${x.used_pct}% | ${usd(x.unused_usd)} | ${x.why} |`), '', ...(txt('Summary') ? ['## Summary', '', txt('Summary'), ''] : []),
    '## How it is measured', '', 'Every request in your local logs is priced at the provider\'s API list rate (input, cached input, cache writes, output with thinking). A plan\'s number is the priced usage inside one stretch of its weekly meter, scaled to 100% of the week. "Floor" means use of the same account on machines not scanned is missing, so the real value can only be higher. Unused allowance counts as waste only when the week closed without hitting the cap.', '',
    '```', ...dash.map(strip), '```', ''].join('\n');
  const f1 = `${STAMP}-worthit.md`; fs.writeFileSync(f1, md); audit('write', './' + f1); out.push(f1);
  const chrome = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(c => fs.existsSync(c));
  if (chrome) { const all = [...head, ...dash], hp = path.join(os.tmpdir(), `worthit-${process.pid}.html`), f2 = `${STAMP}-worthit.png`; fs.writeFileSync(hp, ansiHtml(all));
    audit('run', 'headless Chrome screenshot of the dashboard (local file, no network)');
    spawnSync(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--force-device-scale-factor=2', `--window-size=${Math.round(W * 9.05 + 64)},${Math.round(all.length * 18.6 + 60)}`, '--screenshot=' + path.resolve(f2), 'file://' + hp], { stdio: 'ignore', timeout: 60000 });
    fs.rmSync(hp, { force: true }); if (fs.existsSync(f2)) { audit('write', './' + f2); out.push(f2); } }
  const f3 = `${STAMP}-worthit-audit.log`; audit('write', './' + f3);
  fs.writeFileSync(f3, [`worthit ${VERSION} audit log · ${new Date().toISOString()}`, 'Every file read, command run, network request, model prompt and file written by this run. Kinds: read, run, net, agent, sent, write, note.', '', ...AUDIT, ''].join('\n')); out.push(f3);
  return out;
}

// ---------------------------------------------------------------- UI
const FR = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏', GOLD = C.gold;
const mid = (s, n) => s.length <= n ? s : s.slice(0, Math.floor(n * .45)) + '…' + s.slice(-(n - Math.floor(n * .45) - 1));
function StepLine({ s, i, total, f, wd = W }) {
  const head = `Step ${i + 1} of ${total} · ${s.title}`;
  if (s.state === 'wait') return h(Text, { dimColor: true }, '· ' + head);
  if (s.state === 'done') return h(Box, { flexDirection: 'column', marginBottom: 1 }, h(Text, {}, fg(C.cx, '✓') + ' ' + bold(w(head)) + d('  ' + s.secs + 's')), h(Text, { wrap: 'truncate-end' }, s.lines.map(l => '  ' + l).join('\n')));
  return h(Box, { flexDirection: 'column', marginBottom: 1 },
    h(Text, { wrap: 'truncate-end' }, fg(GOLD, FR[f % 10]) + ' ' + bold(w(head)) + '  ' + (s.pct == null ? d('working') : bar(s.pct, 1, 28, C.cl, C.pink) + ' ' + w(lpad(Math.round(s.pct * 100) + '%', 4))) + d('  ' + Math.round((Date.now() - s.t0) / 1000) + 's')),
    h(Text, { dimColor: true, wrap: 'truncate-end' }, '  ⎿ ' + mid(s.detail || 'starting', wd - 6)));     // one line: exactly what is being read right now
}
const Title = ({ label, live, f, who }) => h(Box, { flexDirection: 'column' },
  h(Box, { gap: 1 }, h(Text, { bold: true, color: GOLD }, live.done ? '✓' : FR[f % 10]), h(Text, { bold: true }, label),
    h(Text, { dimColor: true }, live.done ? (live.done.err ? 'failed: ' + live.done.err : live.done.cached ? `${who} · saved report from ${live.done.cached} (numbers moved under 2%)` : `${who}${live.done.secs == null ? '' : ' · ' + live.done.secs + 's'}`) : `${who} · ${live.status}`)),
  live.done || !live.trace ? null : h(Text, { dimColor: true, italic: true, wrap: 'truncate-end' }, '  ⎿ ' + live.trace));
function AskBar({ onSubmit, f }) {
  const [v, setV] = useState('');
  useInput((input, key) => { if (key.return) { if (v.trim()) { onSubmit(v.trim()); setV(''); } } else if (key.backspace || key.delete) setV(x => x.slice(0, -1)); else if (input && !key.ctrl && !key.meta) setV(x => x + input); });
  return h(Box, { borderStyle: 'round', borderColor: GOLD, paddingX: 1, marginTop: 1, width: W }, h(Text, { color: GOLD, bold: true }, '› '), h(Text, {}, v), h(Text, { color: GOLD }, Math.floor(f / 5) % 2 ? '█' : ' '),
    v ? null : h(Text, { dimColor: true }, 'Would you like to know anything else about your usage?'), h(Box, { flexGrow: 1 }), h(Text, { dimColor: true }, 'enter to ask · ctrl+c to exit'));
}
// Mouse: the questions are clickable. The terminal reports a click as a screen row; the cursor position report tells where
// the live area ends, so a click is turned into "N lines up from the last line". Mouse reporting is on only while a question
// is on screen, so text selection works normally on the dashboard.
const TEST_INPUT = process.env.WORTHIT_TEST_INPUT, MOUSE = TTY || !!TEST_INPUT;
const mouseOff = () => { if (MOUSE && !JSON_MODE) process.stdout.write('\x1b[?1000l\x1b[?1006l'); };
process.on('exit', mouseOff);
function useClick(onClick) {
  const { internal_eventEmitter: ee } = useStdin(); const pend = useRef(null), cb = useRef(onClick); cb.current = onClick;
  useEffect(() => { if (!MOUSE || !ee) return;
    process.stdout.write('\x1b[?1000h\x1b[?1006h');
    const on = data => { const s = String(data), re = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/g; let mm;
      while ((mm = re.exec(s))) if (mm[4] === 'M' && (+mm[1] & 3) === 0 && !(+mm[1] & 96)) { pend.current = { x: +mm[2], y: +mm[3] }; process.stdout.write('\x1b[6n'); }   // left button down, not a drag or wheel
      const r = /\x1b\[(\d+);(\d+)R/.exec(s); if (r && pend.current) { const p = pend.current; pend.current = null; cb.current(+r[1] - 1 - p.y, p.x); } };
    ee.on('input', on); return () => { ee.removeListener('input', on); mouseOff(); }; }, [ee]);
}
function Choice({ q, options, onPick }) {       // arrows move, enter picks; the recommended answer is already selected
  const [i, setI] = useState(0);
  useClick(up => { const k = options.length - 1 - up; if (k >= 0 && k < options.length) { setI(k); onPick(options[k]); } });
  useInput((input, key) => { if (key.upArrow || key.leftArrow) setI(x => (x + options.length - 1) % options.length); else if (key.downArrow || key.rightArrow || key.tab) setI(x => (x + 1) % options.length);
    else if (key.return) onPick(options[i]); else { const k = options.findIndex(o => o.key === input.toLowerCase()); if (k >= 0) onPick(options[k]); } });
  return h(Box, { flexDirection: 'column', marginTop: 1 }, h(Box, { gap: 1 }, h(Text, { color: GOLD, bold: true }, '?'), h(Text, { bold: true }, q), h(Text, { dimColor: true }, '↑↓ to move · enter to confirm · or click')),
    ...options.map((o, k) => h(Box, { key: o.label, gap: 1 }, h(Text, { color: GOLD }, k === i ? '  ❯' : '   '), h(Text, { bold: k === i, color: k === i ? GOLD : undefined }, o.label), h(Text, { dimColor: true }, o.hint || ''))));
}
function MultiChoice({ q, options, initial, onDone }) {   // ↑↓ move, space ticks, a = all, n = none, enter confirms
  const [i, setI] = useState(0); const [sel, setSel] = useState(() => new Set(initial)); const selRef = useRef(sel); selRef.current = sel;
  const finish = () => onDone(options.map(o => o.alias).filter(a => selRef.current.has(a)));
  useClick(up => { if (up === 0) return finish(); const k = options.length - up; if (k < 0 || k >= options.length) return; setI(k);
    setSel(s => { const n = new Set(s), a = options[k].alias; n.has(a) ? n.delete(a) : n.add(a); return n; }); });
  useInput((input, key) => { if (key.upArrow) setI(x => (x + options.length - 1) % options.length); else if (key.downArrow || key.tab) setI(x => (x + 1) % options.length);
    else if (input === ' ') setSel(s => { const n = new Set(s), a = options[i].alias; n.has(a) ? n.delete(a) : n.add(a); return n; });
    else if (input === 'a') setSel(new Set(options.map(o => o.alias))); else if (input === 'n') setSel(new Set());
    else if (key.return) finish(); });
  return h(Box, { flexDirection: 'column', marginTop: 1 }, h(Box, { gap: 1 }, h(Text, { color: GOLD, bold: true }, '?'), h(Text, { bold: true }, q), h(Text, { dimColor: true }, '↑↓ move · space or click to tick · a all · n none · enter confirm')),
    h(Text, { dimColor: true }, '    from your saved ssh hosts · scanned in parallel with the same read-only script · your choice is remembered'),
    ...options.map((o, k) => h(Box, { key: o.alias, gap: 1 }, h(Text, { color: GOLD }, k === i ? '  ❯' : '   '), h(Text, { color: sel.has(o.alias) ? 'green' : undefined }, sel.has(o.alias) ? '◉' : '○'),
      h(Text, { bold: k === i, color: k === i ? GOLD : undefined }, o.alias), h(Text, { dimColor: true }, o.hostname !== o.alias ? o.hostname : ''))),
    h(Text, { color: GOLD, bold: true }, `   [ Confirm · this machine${sel.size ? ' + ' + sel.size + ' more' : ' only'} ]`));
}
function Setup({ onDone }) {
  const [hostsAsked, setHostsAsked] = useState(!(F_HOSTS == null && DETECTED.length));
  const [ans, setAns] = useState([]); const [step, setStep] = useState(0); const [cfg, setCfg] = useState({});
  const pick = (label, patch, next) => o => { setAns(a => [...a, label + ': ' + o.label]); const c = { ...cfg, ...patch(o) }; setCfg(c); if (next === null || (next === 2 && !c.ai)) onDone(c); else setStep(next); };
  const qs = [
    h(Choice, { key: 'g', q: 'Include git data (commits, merged PRs)?', onPick: pick('Git data', o => ({ git: o.v }), AGENTS.length ? 1 : null),
      options: [{ label: 'Yes', key: 'y', v: true, hint: 'recommended · your merged PRs (gh) and local commits; adds cost per PR' }, { label: 'No', key: 'n', v: false, hint: 'tokens and plan value only' }] }),
    h(Choice, { key: 'a', q: 'Use an AI agent for the summary and your questions?', onPick: pick('AI', o => ({ ai: o.v }), AGENTS.length > 1 ? 2 : null),
      options: [{ label: 'Yes', key: 'y', v: true, hint: 'recommended · runs through your own CLI login; the week\'s data is sent to it' }, { label: 'No', key: 'n', v: false, hint: 'same dashboard, nothing leaves this machine, no questions' }] }),
    h(Choice, { key: 'w', q: 'Which agent?', onPick: pick('Agent', o => ({ agent: o.v }), null),
      options: AGENTS.map((a, k) => ({ label: a.label, v: a, hint: (k === 0 ? 'recommended · ' : '') + (a.via || 'medium reasoning, via ' + a.cli) })) })];
  return h(Box, { flexDirection: 'column' }, ...ans.map(a => h(Box, { key: a, gap: 1 }, h(Text, { color: 'green' }, '✓'), h(Text, {}, a))),
    AGENTS.length === 0 && step === 0 && hostsAsked ? h(Text, { dimColor: true }, '  no claude or codex CLI found: the dashboard will be built without AI') : null,
    hostsAsked ? qs[step] : h(MultiChoice, { q: 'Include your other machines?', options: DETECTED, initial: SAVED || [],
      onDone: sel => { HOSTS = sel; if (!DEMO) saveHosts(sel); setAns(a => [...a, 'Machines: this one' + (sel.length ? ' + ' + sel.join(', ') : ' only')]); setHostsAsked(true); } }));
}
const blank = () => ({ spec: null, n: 0, status: 'starting', trace: '', done: null });

function Main({ cfg }) {
  const { exit } = useApp(); const [f, setF] = useState(0); const agent = cfg.ai ? (cfg.agent || AGENTS[0]) : null, [whoNow, setWho] = useState(null), who = whoNow || (agent ? agent.model : 'built-in, no AI');
  const [steps, setSteps] = useState(() => [{ title: 'Scanning your logs' }, { title: 'Pricing every request, reading the weekly meters' }, ...(cfg.git ? [{ title: 'Git activity' }] : [])].map(s => ({ ...s, state: 'wait', pct: 0, detail: '', lines: [] })));
  const [dash, setDash] = useState(null), [cur, setCur] = useState(null), [past, setPast] = useState([]), [fail, setFail] = useState(null), [saved, setSaved] = useState(null); const last = useRef(0);
  // the hardware pet: lives in the right corner while the run works, then reports what the run cost this machine
  const [pet, setPet] = useState(null), [hw, setHw] = useState(null), stopPet = useRef(null), PETW = PET_W, cols = process.stdout.columns || 100, showPet = (TTY || !!TEST_INPUT) && cols >= 92;
  useEffect(() => { if (!(TTY || TEST_INPUT)) return; stopPet.current = (DEMO ? demoPet : startPet)(setPet); return () => { if (stopPet.current) stopPet.current(); }; }, []);
  const endPet = () => { if (!stopPet.current) return; const t = stopPet.current(); stopPet.current = null; setHw(t); audit('note', 'hardware during this run: ' + petSummary(t)); };
  const petBox = () => h(Box, { flexDirection: 'column', width: PETW, flexShrink: 0 }, h(Text, { wrap: 'truncate-end' }, petLines(pet, Math.floor(f / 2)).join('\n')));
  const S = (i, patch) => setSteps(s => s.map((x, k) => k === i ? { ...x, ...patch } : x));
  const st = set => (status, trace) => set(x => x && ({ ...x, status, trace: trace ?? x.trace }));
  const ask = q => { setCur({ ...blank(), q }); const base = 'DATA:\n' + forModel() + '\n\nQuestion: ' + q, t0 = Date.now();
    const closeAsk = done => { setCur(x => { setPast(p => [...p, { kind: 'panel', ...x, done: { ...done, secs: ((Date.now() - t0) / 1000).toFixed(1) }, id: 'a' + p.length }]); return null; }); if (!TTY) setTimeout(exit, 200); };
    if (DEMO) { setCur(x => ({ ...x, spec: demoAnswer(), n: 2 })); setTimeout(() => closeAsk({ n: 2 }), 700); return; }
    // the agent may first ask for lookups in the local store (worthit get / days / sql / schema): they are run here, read-only, and logged
    const round = (user, lookups) => feed({ system: ASK_SYSTEM, user, agent }, (spec, n) => setCur(x => ({ ...x, spec, n })), st(setCur), done => {
      const cmds = !done.n && !done.err && lookups < 2 ? [...String(done.raw || '').matchAll(/^\s*`?QUERY:\s*worthit\s+(.+?)`?\s*$/gm)].map(x => x[1].trim()).slice(0, 3) : [];
      if (!cmds.length) return closeAsk(done);
      const res = cmds.map(c => { const av = [...c.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map(x => x[1] ?? x[2] ?? x[3]); st(setCur)('looking up', 'worthit ' + c); audit('run', `worthit ${c}   (lookup in the local store, asked for by ${agent.cli})`);
        let v; try { if (!QUERY_COMMANDS.includes(av[0])) throw new Error('only get, days, sql and schema can be looked up'); v = JSON.stringify(runQuery(av)); } catch (e) { v = 'error: ' + e.message; }
        return `$ worthit ${c}\n${v.length > 6000 ? v.slice(0, 6000) + ' … (truncated)' : v}`; });
      round(base + '\n\nLookup results from the local store:\n' + res.join('\n\n') + '\n\nNow answer by placing blocks. Do not ask for more lookups.', lookups + 1); });
    round(base, 0); };
  useEffect(() => { const t = setInterval(() => setF(x => x + 1), 90);
    const live = i => p => { const now = Date.now(); if (now - last.current < 80 && p.pct !== 1) return; last.current = now; S(i, { pct: p.pct, detail: p.detail }); };
    const fin = (i, t0, lines) => S(i, { state: 'done', secs: ((Date.now() - t0) / 1000).toFixed(0), lines });
    (async () => { try {
      const gT = Date.now(); let gSecs = '0'; const gP = cfg.git ? (DEMO ? demoGit(live(2)) : git(cfg, live(2))).then(x => { gSecs = ((Date.now() - gT) / 1000).toFixed(0); return x; }) : null; if (gP) S(2, { state: 'run', t0: gT });   // git runs while the logs are scanned
      let t0 = Date.now(); S(0, { state: 'run', t0 }); const info = DEMO ? await demoScan(HOSTS, live(0)) : await scan({ days: DAYS, hosts: HOSTS }, live(0));
      const scanned = `${Object.values(info.counts).reduce((a, b) => a + b, 0).toLocaleString('en-US')} files on this machine` + (info.cached ? ` (${info.cached.toLocaleString('en-US')} unchanged, from cache)` : '') + (info.hosts.length ? ` · ${info.hosts.filter(x => x.ok).length} other machine${info.hosts.filter(x => x.ok).length === 1 ? '' : 's'} read in parallel` : '') + ` · last ${DAYS} days`;
      const hl = info.hosts.map(x => x.ok ? fg(C.cx, '✓ ') + w(x.alias) + d(' ' + x.files.toLocaleString('en-US') + ' files' + (x.cached ? ', ' + x.cached.toLocaleString('en-US') + ' cached' : '')) : x.same_as ? d('= ' + x.alias + ' same as ' + x.same_as) : fg(C.bad || C.go, '✗ ') + m(x.alias) + d(' no answer')), hrows = []; for (let k = 0; k < hl.length; k += 4) hrows.push('  ' + hl.slice(k, k + 4).join(d('  ·  ')));
      const scanSecs = ((Date.now() - t0) / 1000).toFixed(0); fin(0, t0, [m(scanned), ...hrows]);
      t0 = Date.now(); S(1, { state: 'run', t0, pct: null, detail: 'each request = its tokens × that model\'s API list price' }); const report = DEMO ? await demoPricing() : await analyse(info.runDir); const t1 = t0;
      const g = gP ? await gP : null;
      DATA = DEMO ? demoData() : buildData(report, g, { days: DAYS, hosts: HOSTS }, info);
      const hd = d(pad('  Tool', 17) + lpad('Sessions', 9) + lpad('Requests', 10) + lpad('Output', 9) + lpad('Cached in', 11) + lpad('Fresh in', 10) + lpad('API value', 11));
      const col = { claude: C.cl, codex: C.cx, antigravity: C.go, omp: C.pink, dsh: C.gold }, T = DATA.tools, tot = k => T.reduce((s, x) => s + x[k], 0);
      fin(0, 0, [m(scanned), hd, ...T.map(x => x.found ? fg(C.cx, '✓') + ' ' + pad(fg(col[x.key], x.tool), 15) + lpad(x.sessions ? w(x.sessions.toLocaleString('en-US')) : d('·'), 9) + lpad(w(x.requests.toLocaleString('en-US')), 10) + lpad(w(fmtTok(x.output)), 9) + lpad(w(fmtTok(x.cached)), 11) + lpad(w(fmtTok(x.fresh)), 10) + lpad(w(usd(x.usd)), 11) : d('– ' + pad(x.tool, 15) + 'no logs found')),
        '  ' + pad(bold(w('Last 7 days')), 15) + lpad('', 9) + lpad(bold(w(tot('requests').toLocaleString('en-US'))), 10) + lpad(bold(fg(GOLD, fmtTok(tot('output')))), 9) + lpad(bold(w(fmtTok(tot('cached')))), 11) + lpad(bold(w(fmtTok(tot('fresh')))), 10) + lpad(bold(w(usd(tot('usd')))), 11)]);
      S(0, { secs: scanSecs });
      fin(1, t1, DATA.plans.length ? DATA.plans.map(p => fg(C.cx, '✓') + ' ' + pad(fg(p.color, p.plan), 17) + m(pad(p.meter, 34)) + d('→ ') + bold(w(usd(p.usd_per_full_week))) + d(' per full week')) : [m('No weekly limit ran to its cap inside the scanned days: plans are ranked once one does.')]);
      if (cfg.git) { fin(2, gT, [fg(C.cx, '✓') + ' ' + w(DATA.git.merged_prs) + m(' merged PRs · ') + w(DATA.git.commits.toLocaleString('en-US')) + m(' commits · ') + w(DATA.git.repos) + m(' repos') + d('  in the last 7 days'), d(`  sources, 14 days: GitHub ${g.src.github} PRs · usagemeter ${g.src.meter} PRs` + (g.meter ? ` (usagemeter ${g.meter.version}${g.meter.downloaded ? ', downloaded' : ''})` : ''))]); S(2, { secs: gSecs }); }
      setSteps(s => { setPast(p => [{ kind: 'steps', id: 'steps', steps: s }, ...p]); return s; });
      const finish = (x, done) => { endPet(); if (!DEMO) saveSettings({ last: { hosts: HOSTS, git: !!cfg.git, ai: !!cfg.ai, agent: cfg.agent ? cfg.agent.id : null } }); let files = []; try { files = writeFiles(x.spec); } catch (e) { audit('note', 'files not written: ' + e.message); } setSaved(files); setPast(p => [...p, { kind: 'panel', ...x, done, id: 'dash' }]); return { ...x, done, moved: true }; };
      if (DEMO) { setDash(blank()); st(setDash)('drawing', 'placing Verdict'); setTimeout(() => st(setDash)('drawing', 'placing Summary'), 900);
        setTimeout(() => { setDash(finish({ ...blank(), spec: demoSpec(builtin(), DATA), n: 15 }, { secs: '6.2' })); if (!TTY) setTimeout(exit, 300); }, 1900); }
      else if (!agent) setTimeout(() => { setDash(finish({ ...blank(), spec: builtin() }, { secs: null })); setTimeout(exit, 300); }, 120);
      else { const key = reportKey(agent), rc = FRESH ? null : readReport();
        if (rc && sameReport(rc.key, key) && ready(rc.spec)) {        // nothing material changed since the saved report: show it, do not call the model
          audit('agent', `no headline number moved more than 2% since ${rc.at}: the saved report is shown, ${agent.cli} is not called (--fresh forces a new one)`);
          setTimeout(() => { setDash(finish({ ...blank(), spec: rc.spec, n: rc.n }, { secs: null, cached: rc.at.slice(0, 16).replace('T', ' ') })); if (ASK) ask(ASK); else if (!TTY) setTimeout(exit, 300); }, 120); }   // let the step lines paint first
        else { setDash(blank());
          // the chosen agent writes the report; if it cannot (not logged in, no credit, model missing), the next installed one tries, and the built-in tables are the last resort
          const order = [agent, ...AGENTS.filter(a => a.id !== agent.id)];
          const compose = k => feed({ system: SYSTEM, user: 'Here is this week\'s data as JSON. Compose the dashboard now.\n\n' + forModel(), agent: order[k] }, (spec, n) => setDash(x => ({ ...x, spec, n })), st(setDash),
            done => { if (done.err && order[k + 1]) { audit('note', `${order[k].cli} could not write the report (${done.err}): trying ${order[k + 1].cli}`); setWho(order[k + 1].model); setDash({ ...blank(), status: `${order[k].cli} failed, trying ${order[k + 1].cli}`, trace: String(done.err).slice(0, 80) }); return compose(k + 1); }
              setDash(x => { const ok = !(done.err || !ready(x.spec)); if (ok) saveReport(key, order[k], x.spec, x.n); return finish(ok ? x : { ...x, spec: builtin() }, done); }); if (ASK) ask(ASK); else if (!TTY) setTimeout(exit, 300); });
          compose(0); } }
    } catch (e) { endPet(); setFail(e.message); setTimeout(exit, 200); } })();
    return () => clearInterval(t); }, []);
  const collected = past.some(p => p.kind === 'steps');
  return h(Box, { flexDirection: 'column', marginTop: 1 },
    h(Static, { items: past }, it => it.kind === 'steps' ? h(Box, { key: it.id, flexDirection: 'column' }, ...it.steps.map((s, i) => h(StepLine, { key: i, s, i, total: it.steps.length, f: 0 })))
      : h(Box, { key: it.id, flexDirection: 'column', marginBottom: 1 }, h(Title, { label: it.id === 'dash' ? 'YOUR WEEK' : '› ' + it.q, live: it, f: 0, who }), h(View, { spec: it.spec, k: it.id }))),
    collected ? null : h(Box, { flexDirection: 'row' }, h(Box, { flexDirection: 'column', width: showPet ? cols - PETW - 1 : undefined, flexShrink: 1 }, ...steps.map((s, i) => h(StepLine, { key: i, s, i, total: steps.length, f, wd: showPet ? Math.min(W, cols - PETW - 1) : W }))), showPet && !fail ? petBox() : null),
    fail ? h(Text, { color: 'red' }, '✖ ' + fail) : null,
    dash && !dash.moved ? h(Box, { flexDirection: 'column' }, collected && showPet && !hw ? h(Box, { flexDirection: 'row' }, h(Box, { flexDirection: 'column', width: cols - PETW - 1 }, h(Title, { label: 'YOUR WEEK', live: dash, f, who })), petBox()) : h(Title, { label: 'YOUR WEEK', live: dash, f, who }), h(View, { spec: dash.spec, k: dash.n })) : null,
    cur ? h(Box, { flexDirection: 'column' }, h(Title, { label: '› ' + cur.q, live: cur, f, who }), h(View, { spec: cur.spec, k: cur.n })) : null,
    saved && saved.length && !cur ? h(Text, {}, fg(C.cx, '✓') + m(' Saved to ./  ') + saved.map(x => w(x)).join(d('  ·  '))) : null,
    hw && hw.seconds && dash && dash.moved && !cur ? h(Text, { wrap: 'truncate-end' }, fg(C.pink, '◆') + m(' This run cost your machine  ') + d(petSummary(hw))) : null,
    dash && dash.moved && !cur && TTY && agent ? h(AskBar, { onSubmit: ask, f }) : null,
    dash && dash.moved && !agent ? h(Text, { dimColor: true }, '  AI is off: run again and pick an agent to ask questions about your usage') : null);
}
function SkillQ({ onDone }) {      // "Install skill?": runs the skills CLI, which installs the worthit skill into the coding agents it finds
  const [state, setState] = useState('ask'), [msg, setMsg] = useState('');
  const end = (v, line) => { if (v && !DEMO) saveSettings({ skill: v, skill_at: new Date().toISOString() }); setMsg(line); setState('done'); setTimeout(onDone, 900); };
  const pick = o => { if (!o.v) return end('declined', 'Skill not installed. Any time: npx worthit install-skill');
    if (DEMO) return end('installed', 'worthit skill installed for your coding agents (demo: nothing was run)');
    setState('run'); audit('run', SKILL_CMD.join(' ') + '   (installs the worthit skill into your coding agents)'); const p = spawn(SKILL_CMD[0], SKILL_CMD.slice(1), { stdio: 'ignore' });
    p.on('error', () => end(null, 'Could not run npx. Later: npx worthit install-skill'));
    p.on('close', code => code ? end(null, 'The skills CLI did not finish. Later: npx worthit install-skill') : end('installed', 'worthit skill installed for your coding agents')); };
  if (state === 'run') return h(Text, {}, fg(GOLD, '⠿') + ' ' + w('Installing the worthit skill') + d('  ' + SKILL_CMD.join(' ')));
  if (state === 'done') return h(Text, {}, fg(C.cx, '✓') + ' ' + m(msg));
  return h(Choice, { q: 'Install the worthit skill for your coding agents?', onPick: pick,
    options: [{ label: 'Yes', key: 'y', v: true, hint: 'recommended · they can then answer usage questions with worthit' }, { label: 'No', key: 'n', v: false, hint: 'later: npx worthit install-skill' }] });
}
function App() {
  const preset = () => { const ai = F_AI ? F_AI !== 'no' : AGENTS.length > 0; return { git: F_GIT ? F_GIT !== 'no' : true, ai: ai && AGENTS.length > 0, agent: AGENTS.find(a => a.id === F_AI) || AGENTS[0] }; };
  const [cfg, setCfg] = useState((!TTY && !TEST_INPUT) || (F_GIT && F_AI) ? preset() : null);
  // asked once: the answer is remembered in ~/.worthit/settings.json
  const [skillAsked, setSkillAsked] = useState(!(TTY || TEST_INPUT) || !!(F_GIT && F_AI) || (!DEMO && (!!settings().skill || !has('npx'))));
  // after one finished run: offer the same answers again; No starts the questions over
  const last = settings().last, [reuse, setReuse] = useState(!cfg && !DEMO && F_GIT == null && F_AI == null && F_HOSTS == null && last ? 'ask' : 'no');
  if (reuse === 'ask') { const hosts = (last.hosts || []).filter(a => DETECTED.some(x => x.alias === a)), agent = AGENTS.find(a => a.id === last.agent) || AGENTS[0], ai = !!last.ai && !!agent;
    const sum = 'this machine' + (hosts.length ? ' + ' + hosts.join(', ') : ' only') + ' · git ' + (last.git ? 'yes' : 'no') + ' · AI ' + (ai ? agent.label : 'no');
    return h(Choice, { q: 'Same settings as last time?', onPick: o => { if (o.v) { HOSTS = hosts; setCfg({ git: !!last.git, ai, agent }); } setReuse('no'); },
      options: [{ label: 'Yes', key: 'y', v: true, hint: sum }, { label: 'No', key: 'n', v: false, hint: 'answer the questions again' }] }); }
  if (!cfg) return h(Setup, { onDone: c => setCfg({ agent: AGENTS[0], ...c }) });
  return skillAsked ? h(Main, { cfg }) : h(SkillQ, { onDone: () => setSkillAsked(true) });
}
console.log('\n' + LOGO.join('\n') + '\n ' + m('what your AI coding subscription is really worth') + d(`  ·  v${VERSION}  ·  ` + (DEMO ? 'demo · sample data' : 'reads your local logs')));
const fake = () => { const s = new PassThrough(); s.isTTY = true; s.setRawMode = () => s; s.ref = () => s; s.unref = () => s; return s; };   // no keyboard (pipes, tests): a stand-in input
const stdin = process.stdin.isTTY ? null : fake();
render(h(App), stdin ? { stdin } : {});
if (stdin && TEST_INPUT) { let t = 0; for (const [ms, text] of JSON.parse(TEST_INPUT)) { t += ms; setTimeout(() => stdin.write(text), t); } }   // scripted keys and clicks, for tests
