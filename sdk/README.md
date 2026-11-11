# nexus-wallet-sdk

For websites that use the Nexus Wallet browser extension, and for their servers. Local package, not published: build it in the wallet repo and copy `sdk/` (with `dist/`) into your project, or point `npm install` at the folder.

```
npm run build:sdk        # in the wallet repo, writes sdk/dist
npm install ../wallet/sdk
```

The code comes from the extension itself (`src/lib/dapp.ts`, `src/lib/signin.ts`), so the types always match what the wallet does.

## In the page

```ts
import { getNexus, isUserRejected, NexusErrors } from 'nexus-wallet-sdk';

const nexus = await getNexus(); // null when the extension is not installed
if (nexus) {
  const { network } = await nexus.request({ method: 'nexus_getNetwork' });
  const me = await nexus.request({ method: 'nexus_connect' }); // { genesis, username, accounts }
  try {
    const { txid } = await nexus.request({ method: 'nexus_send', params: { to: 'bob:main', amount: 1.5 } });
  } catch (e) {
    if (isUserRejected(e)) {
      // the user closed the window
    }
  }
  nexus.on('accountsChanged', (info) => { /* null after log out */ });
}
```

`request` knows every method: the params it takes and what it gives back (`DappRequests`). Methods, params and error codes are listed in the wallet's README ("For websites").

## On the server: Sign in with Nexus

```ts
import { cryptoRegisterFromNode, verifySignedText } from 'nexus-wallet-sdk/server';

// signed = what nexus_signIn gave the page, sent to your server
const r = await verifySignedText(signed, cryptoRegisterFromNode('https://your-nexus-node:8080'), 'https://your.site', 'signIn', {
  network: 'mainnet',
  maxAgeSeconds: 300,
});
if (r.valid && r.signIn?.nonce === nonceYouIssued) {
  // r.signIn.genesis is the account, log it in
}
```

It checks that the text was made for your site, account and network, that it is recent, that the signature matches, and that the key is the `sign` key in the account's crypto register on the node (`register/get/crypto`, no login on the node needed). Your server still checks that the nonce is one it gave out and uses it once. For texts from `nexus_signMessage` pass `'message'` as fourth argument.

Runs in Node 18+ and any runtime with `fetch`. `tests/sdk/check.mjs` in the wallet repo loads the built package as a server would.
