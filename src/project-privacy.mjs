// Project identities stay local, including text typed into an AI question/share request.
export function redactProjects(text, data) {
  let result = String(text);
  const identities = (data?.projects?.rows || []).flatMap(r => [r.project, r.name, r.project.split('/').slice(1).join('/'), r.project.split('/').at(-1)]).filter(Boolean).sort((a, b) => b.length - a.length);
  for (const id of identities) result = result.replace(new RegExp(id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '[repository]');
  return result;
}
export function redactProjectValues(value, data) {
  if (typeof value === 'string') return redactProjects(value, data);
  if (Array.isArray(value)) return value.map(v => redactProjectValues(v, data));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactProjectValues(v, data)]));
  return value;
}
export function dataForAgent(data) {
  const { projects, project_activity, heat, ...rest } = data;
  return JSON.stringify(redactProjectValues({ ...rest, ...(heat ? { busiest: heat.note } : {}) }, data));
}
