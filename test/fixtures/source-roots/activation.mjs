// Parts B (#144) and C (#145) move their scenario ids here in the same PR that
// implements them. An activated assertion executes in normal CI. No assertion
// is weakened or auto-enabled by a capability probe. Part C activates every id.
export const activated = new Set([
  'registration-preflight-unread',
  'registration-machine-floor-and-guard',
  'commands-add-list',
  'commands-selection',
  'commands-boundary',
  'unsupported-antigravity',
  'unsupported-account',
  'unsupported-model',
  'unsupported-mappings',
  'invalid-duplicate-keys',
  'invalid-unknown-key',
  'invalid-traversal',
  'invalid-relative-root',
  'invalid-duplicate-binding',
  'empty-retirement',
  'empty-retire-before-registration',
  'empty-retire-future',
  'unsupported-update',
  'unsupported-unretire',
  'answered-retire-rejected',
  'review-m1-unrelated-default-cwd',
  'review-m3-probe-failed-shared-machine',
]);
