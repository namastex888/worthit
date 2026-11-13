// Imported first: node:sqlite still prints an "experimental" warning on Node 22 and 23. It is noise for people and for agents reading stderr.
const emit = process.emitWarning;
process.emitWarning = (w, ...rest) => { const t = typeof w === 'string' ? w : (w && w.message) || ''; if (/SQLite is an experimental feature/.test(t)) return; return emit.call(process, w, ...rest); };
