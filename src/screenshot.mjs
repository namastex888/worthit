// Both local-file renderers use a disposable profile with network activity disabled.
export const screenshotArgs = profile => [
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', '--disable-background-networking', '--disable-component-update',
  '--disable-sync', '--disable-default-apps', '--metrics-recording-only', '--host-resolver-rules=MAP * ~NOTFOUND',
  '--user-data-dir=' + profile,
];
