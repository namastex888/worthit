// Parts B (#144) and C (#145) move their scenario ids here in the same PR that
// implements them. An activated assertion executes in normal CI. No assertion
// is weakened or auto-enabled by a capability probe. Part C activates every id.
export const activated = new Set([]);
