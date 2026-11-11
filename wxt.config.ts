import { defineConfig } from 'wxt';

//Argon2 for the sign key runs as WebAssembly in extension pages
const pageCsp = "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'";

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  manifest: ({ manifestVersion }) => ({
    name: 'Nexus Wallet',
    description: 'Wallet for the Nexus blockchain in your browser, works with the core of the Nexus desktop wallet',
    //alarms: the minute check for incoming payments behind the toolbar badge
    permissions: ['storage', 'alarms'],
    //the desktop wallet core listens on this PC only
    host_permissions: ['http://127.0.0.1/*', 'http://localhost/*', 'https://127.0.0.1/*', 'https://localhost/*'],
    //any other node is asked for when the user saves it
    optional_host_permissions: ['http://*/*', 'https://*/*'],
    //window.nexus is injected into pages from this file
    web_accessible_resources: [{ resources: ['nexus-provider.js'], matches: ['http://*/*', 'https://*/*'] }],
    content_security_policy: manifestVersion === 3 ? { extension_pages: pageCsp } : pageCsp,
    browser_specific_settings: {
      gecko: { id: 'nexus-wallet@local', strict_min_version: '115.0' },
    },
  }),
});
