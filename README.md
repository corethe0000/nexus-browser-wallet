# Nexus Wallet (browser extension)

Wallet for the [Nexus](https://nexus.io) blockchain in the browser, like MetaMask for Nexus. It works two ways:

- **Sign in this browser (light wallet):** the extension makes the keys from username, password and PIN and signs every transaction itself, exactly as the Nexus core does. A node is only read and given finished transactions, so there is no desktop wallet to download and no blockchain to sync. Create an account in the extension and the wallet is ready.
- **With a Nexus core:** the core of the Nexus desktop wallet on the same computer, or your own node, holds the login and signs after the user confirms with the PIN.

Websites use it through `window.nexus`: connect, Sign in with Nexus, payments, invoices and market orders, each approved by the user in a wallet window.

One codebase for Chrome, Edge, Brave, Opera (Manifest V3) and Firefox (built with WXT).

**Status (November 2026):** complete and tested on Nexus test networks (private chains of LLL-TAO 5.1.6 and the desktop wallet core 5.1.4), read-only checks against mainnet. Not yet in the browser stores and not signed. A public mainnet node for the light wallet is still to be arranged.

**For Nexusoft:** this is written for the Nexus community and meant to be taken over by [Nexusoft](https://github.com/Nexusoft) if they want it: fork it, move it into the Nexusoft organisation, sign it and publish it in the stores. No change to the Nexus core (LLL-TAO) is needed for anything here.

## Install a release

Download the zip for your browser from the Releases page and unzip it into a folder you keep.

- Chrome, Edge, Brave, Opera: open `chrome://extensions` (`edge://extensions`), switch on Developer mode, Load unpacked, choose the folder.
- Firefox: `about:debugging` > This Firefox > Load Temporary Add-on > `manifest.json` in the folder (removed when Firefox closes until the add-on is signed).

The user guide with screenshots is in the release as `nexus-wallet-guide.pdf` (source in `docs/guide/`).

## Build

```
npm install
npm run build            # .output/chrome-mv3
npm run build:firefox    # .output/firefox-mv2
npm run compile          # type check
npm test                 # unit tests
```

Chrome: Extensions > Developer mode > Load unpacked > `.output/chrome-mv3`. Firefox: about:debugging > This Firefox > Load Temporary Add-on > `.output/firefox-mv2/manifest.json`.

## Connect to the desktop wallet core

Start the Nexus desktop wallet, then in the extension enter:

- Core address: `http://127.0.0.1:8080`
- API user and password: `apiuser` and `apipassword` from `nexus.conf` in the core data folder (Windows `%APPDATA%\Nexus`, macOS `~/Library/Application Support/Nexus`, Linux `~/.Nexus`)

If the desktop wallet is logged in, the extension uses that login. Logging out in the extension logs out the core, and so the desktop wallet too.

## A node without the desktop wallet

Any Nexus node works, also one in multi-user mode (`-multiuser=1`) that many people share. There the extension keeps its own session for that node (also across browser restarts, starting locked), every call carries it, and logging out ends only this wallet's session. New users can make an account in the extension (Log in > Create a new account: username at least 2, password at least 8, PIN at least 4 characters, as the core requires); it can be used after the next block.

A node on another computer sees the username, password and PIN of everyone who logs in through it, the wallet says so on the setup and login screens. Use your own node or one you trust.

Public single-user nodes: the official seed nodes node3.nexus.io and node5.nexus.io (port 8080, checked 2026-11-10) answer the API to anyone, on mainnet, single-user and without an API login. There one login is shared by every caller, so the wallet refuses to log in or create an account on any remote single-user node without an API user (src/lib/settings.ts isSharedLogin).

## What it does

- Balances, accounts, tokens, assets, invoices and activity of the logged in profile. Tap a transaction for its details: contracts, claimed or not, a link to the explorer (Settings > Explorer, default explorer.nexus.io) and "Save as contact".
- Send NXS or tokens to an address or name, with a contact picker and "If not claimed" (10 minutes to 7 days, or never). A send the receiver has not claimed can be taken back from its details after that time: the core only allows the void after the expiry, the receiver only claims before it.
- Claim incoming payments and assets; the toolbar icon shows how many wait (checked every minute and after login, claim and node changes). Expired ones are left out.
- Contacts (Settings > Contacts): name, address or name, note; Send from a contact.
- Create accounts (NXS or a token), tokens (supply, 0 to 8 decimals), names (local or global, pointing to one of your registers) and assets (own fields) from the Accounts and Assets tabs. The core may charge NXS for some of them.
- Invoices: pay or reject ones sent to you; send your own (payer username, account to be paid into, items with price and quantity, note). Sent ones stay under "Sent, not paid yet" and can be cancelled. The core's `invoices/cancel/invoice` only finds an invoice when the payer is logged in on the same node, so the wallet then voids the invoice's transfer itself (its condition lets the issuer take it back), which is what the core's cancel does too.
- Staking (trust account card > Change stake or start staking): new total stake (`finance/set/stake`, from or back to the trust account balance) and start or stop the core's stake minter for the profile (`sessions/unlock/local` or `sessions/lock/local` with `staking`). A multi-user node cannot stake for its users.
- Settings > Password, PIN and recovery: new password or PIN (`profiles/update/credentials`), recovery phrase (`profiles/update/recovery`, at least 40 characters, the current one is needed when one was set before). Login > Forgot password or PIN? sets a new password and PIN with the phrase (`profiles/recover/master`).
- Several cores: every core the wallet connects to is kept (newest first, up to 10) with its API password in the background; Core settings > Saved cores switches with one click. Forgetting the core of a locked wallet also forgets the saved list.

## Sign in this browser (no login on the node)

Core settings > "Sign in this browser": the extension works like a key wallet. The node never sees the username, password or PIN; it is only read (`ledger/list/transactions` by genesis, `register/get/any`, `ledger/get/transaction`, `names/get/name`) and given finished transactions (`ledger/submit/transaction`). So any node works, also a public one such as node3.nexus.io, and nothing has to be synced on the user's computer.

- Login: the profile is found by its crypto register (genesis with the network's user type byte), password and PIN are checked against its auth key, all in the extension. Username and password are kept in memory only (storage.session) until log out or the browser closes; the PIN is asked for every transaction.
- Accounts are read from the profile's own chain (CREATE contracts, cached). Payments to claim and assets or invoices sent to the profile come from an index (Core settings > Index, an explorer backend with `/explorer/incoming`, `addr=` for payments and `genesis=` for registers) or, without one, from the newest 300 blocks. Claim all puts every open payment in one transaction.
- Sends and claims are built and signed in the extension (src/lib/tritium.ts: the core's transaction format, keys, register pre-states and checksums); src/lib/local-wallet.ts is the wallet for this mode. A second transaction waits until the first is in a block. A transaction less than 10 seconds after the previous one would pay a fee, the wallet waits instead.
- New profiles are made in the extension too: the first transaction with its accounts, names and crypto register, and on mainnet and testnet a proof of work of about 65,000 small Argon2 runs (one to three minutes, the wallet window has to stay open).
- Sends carry the same expiry condition as the core, and can be taken back after it; a send to an own account has none, like in the core.
- Password and PIN can be changed here too (signed with the current key, the crypto register and the next key come from the new ones).
- The recovery phrase can be set and used here too: Login > Forgot password or PIN? signs with the key of the phrase, no login anywhere. Phrases made by cores 5.0.6 to 5.1.0 use an older key and are not supported here.
- New accounts (NXS or a token) can be made here; the account is free, its name costs 1 NXS on mainnet, paid from the default account.
- New tokens, names and assets too. Fees on mainnet as the core charges them, shown before confirming: a token max(1, 100 per supply digit over 2) NXS plus 2000 NXS for its name (token names are global), a local name 1 NXS, a global name 2000 NXS, an asset max(1, 0.001 per byte) NXS plus 1 NXS for a name. A token's own register holds its supply and is a source for sends.
- Assets can be sent to another user (with the same expiry as payments) and claimed; Claim all takes payments and assets in one transaction. The asset's current state is read from its newest transaction (creation, transfer or claim); an asset changed after it arrived cannot be sent yet.
- Invoices: send (fee max(1, 0.001 per byte) NXS on mainnet), pay, cancel your own; reject hides an invoice in this wallet, as the core's reject only hides it for the payer. Invoices sent to you are found in the newest blocks.
- Market orders: place an ask or bid, fill someone else's, cancel your own, list your own; written exactly as the core writes them (checked against real mainnet orders). Optional fees a node operator sets with -marketfee are left out.
- Staking needs a core in any case: the stake minter runs inside a core, and finance/set/stake is no transaction but a signed request the core keeps in its own local database for its minter. So this mode shows the trust account and lets you send NXS to it, but changing the stake or staking is done in the desktop wallet or on your own node. Those screens are hidden or say so.

## Lock and backup

- Auto lock (Settings, default 15 minutes without clicks or keys, or never; also after the browser starts): the wallet shows a lock screen and gives sites no data until the PIN is entered again. The core stays logged in, so the desktop wallet is not touched. Cores with `sessions/validate/pin` (5.1.6) check the PIN; older ones (5.1.4 in the desktop wallet) need password and PIN, checked in the wallet page against the `auth` key of the account's crypto register. Requests that open a window anyway (send, sign, invoice, market) open it and ask to unlock first; silent reads answer 4900 "The wallet is locked". The lock is a screen guard: the core still asks for the PIN for every transaction.
- Settings > Backup exports core address, API user, language and lock time (and the account's connected sites, for information) to a JSON file. The saved API password never leaves the extension, not in the file and not in the settings form either (an empty password field keeps it for the same address). Importing fills the core settings form for the user to check and connect; it never connects sites and never turns the auto lock off.
- If the core stops answering while the wallet is locked, the wallet offers to forget the core settings (the saved API password is deleted, not shown). A changed core address is shown on the login screen until the next login.
- Site connections and approval windows belong to one account: a request made while account A was logged in is cancelled if the window is answered as account B.
- Settings > Open the wallet in a tab shows the same wallet as a page.

## For websites: `window.nexus`

The extension adds `window.nexus` to every http and https page. It fires `nexus#initialized` on `window` when it is ready.

```js
const info = await window.nexus.request({ method: 'nexus_connect' });
// { genesis, username, accounts: [{ address, name, type, token, ticker }] }

const { txid } = await window.nexus.request({
  method: 'nexus_send',
  params: { to: 'bob:main', amount: 1.5, token: 'NXS', reference: '1001' },
});

window.nexus.on('accountsChanged', (info) => { /* null after log out */ });
window.nexus.on('disconnect', () => { /* the user removed this site */ });
```

| Method | Needs connect | Opens a window | Result |
|---|---|---|---|
| `nexus_getNetwork` | no | no | `{ network: 'mainnet' \| 'testnet' \| 'private', blocks, synchronized }` |
| `nexus_connect` | - | first time, or when logged out | `{ genesis, username, accounts }` |
| `nexus_getAccounts` | yes | no | accounts as in connect |
| `nexus_getBalances` | yes | no | the core's `finance/get/balances` |
| `nexus_send` | yes | always | `{ txid }` |
| `nexus_getAssets` | yes | no | `[{ address, name, type, form, created, modified, owner, fields }]` |
| `nexus_payInvoice` | yes | always | `{ txid }` |
| `nexus_disconnect` | no | no | `true` |

`nexus_payInvoice` params: `address` (register address of an invoice sent to the user). The wallet window shows the items and total, the user picks the paying account of the invoice's token and confirms with the PIN.

`nexus_send` params: `to` (account address or name: `name`, `user:name`, `namespace::name`), `amount` (number or text), `token` (optional, `NXS` or empty = NXS, else token address or ticker), `reference` (optional, whole number 0 to 18446744073709551615). The user picks the paying account and confirms with the PIN in the wallet window; the site never sees the PIN.

Errors are `Error` objects with a `code`:

| Code | Meaning |
|---|---|
| 4001 | the user rejected or closed the window |
| 4100 | the site is not connected, call `nexus_connect` |
| 4200 | unknown method |
| 4900 | the wallet is not logged in, or it restarted while the request was open |
| -32602 | bad params |
| -32002 | another request of this site is already waiting for the user |
| -32603 | the core refused or failed, the message says why |

A test page is in `tests/dapp/index.html`. The developer package in `sdk/` (`npm run build:sdk`) gives sites a typed `window.nexus` (`getNexus()`, every method with its params and result) and servers the sign-in check.

## Market

| Method | Needs connect | Opens a window | Result |
|---|---|---|---|
| `nexus_getOrders` | no | no | `{ bids, asks }`, each order `{ txid, type, market, owner, timestamp, give, want }` |
| `nexus_getMyOrders` | yes | no | the user's open orders on that pair |
| `nexus_fillOrder` | yes | always | `{ txid }` |
| `nexus_placeOrder` | yes | always | `{ txid }` of the new order |
| `nexus_cancelOrder` | yes | always | `{ txid }` |

All take `market` as `A/B` (tickers or token addresses, `NXS` for NXS). `give` is what the order's owner pays and `want` what the owner gets, both `{ token, ticker, amount }` in whole units (the wallet converts the core's NXS base units). `nexus_fillOrder` and `nexus_cancelOrder` take `txid` of an open order on that pair (for cancel one of the user's own). `nexus_placeOrder` takes `side` (`sell` = give A for B, `buy` = give B for A), `amount` (of A) and `price` (B per A); the wallet shows what the user pays and gets, the user can only accept or reject those values.

## Sign in with Nexus

| Method | Needs connect | Opens a window | Result |
|---|---|---|---|
| `nexus_signIn` | yes | always | `{ message, signature, publicKey, genesis, cryptoRegister }` |
| `nexus_signMessage` | yes | always | same |

`nexus_signIn` params: `nonce` (8 to 64 letters or digits, from your server), `statement` (optional, one line). The wallet writes the text itself, with your site's address, the account, the network, the nonce and the time, so a signature made for one site is no use on another:

```
shop.example wants you to sign in with your Nexus account:
alice
Genesis: <genesis>

Log in to the shop

URI: https://shop.example
Network: mainnet
Nonce: <nonce>
Issued At: <ISO time>
```

`nexus_signMessage` params: `message` (text up to 2000 characters); the wallet puts `Nexus signed message`, `Site: <origin>` and `Account: <username> <genesis>` in front.

How it works without any change to the core: every signature chain has a crypto register (address = `Address("crypto", genesis)`) whose `sign` field is the hash of a brainpoolP512t1 public key that the core made from username, password and PIN. The wallet makes the same key in the browser (Argon2id as in `src/TAO/Ledger/credentials.cpp`), signs the text (ECDSA over SHA-512, DER) and forgets the key. The user types password and PIN in the wallet window; they never reach the site.

To check a sign-in on your server, use `verifySignedText(signed, cryptoRegisterFromNode(nodeUrl), 'https://your.site')` from the developer package (`sdk/`, `nexus-wallet-sdk/server`, see sdk/README.md; the code is `src/lib/signin.ts`). It reads the text strictly line by line (a signed message or a text made for another site never passes as your sign-in, and the wallet refuses statements that look like one of the fields), checks the signature, that the public key hashes (SK256) to the `sign` field of the account's crypto register on any node (`register/get/crypto`, no login needed) and that the register belongs to that genesis. On success it returns the fields (`signIn.nonce`, `signIn.issuedAt`, ...): your server must still check that the nonce is the one it issued. Pass `{ network: 'mainnet', maxAgeSeconds: 300 }` as fifth argument to also check the network and that `Issued At` is recent. For `nexus_signMessage` texts pass `'message'` as fourth argument. Statements and messages with control, direction or line separator characters are refused by the wallet. Accounts whose crypto register has no `sign` key cannot sign.

## Languages

English, German, Spanish, Filipino, French, Croatian, Indonesian, Italian, Dutch, Polish, Portuguese and Turkish. The wallet starts in the browser's language when it has it, and Settings > Language switches.

Each language is one file in `src/lib/locales/` (`en.ts` is the reference). To add one: copy `en.ts` to `<code>.ts`, translate the values (keep the `{placeholders}`), and add the code to the imports, `languages` and `all` in `src/lib/i18n.ts`. TypeScript refuses a pack that misses a text, and `tests/e2e/uiaudit.mjs` checks that every language fits the popup.

## Tests

- `src/lib/*.test.ts`: unit tests (vitest)
- `tests/e2e/popup.mjs`: click-through of the popup against a core
- `tests/e2e/dapp.mjs`: the website flow with approval windows
- `tests/e2e/features.mjs`: transaction details, take back after the expiry, contacts, toolbar badge
- `tests/e2e/manage.mjs`: create account, token, name and asset, send and cancel an invoice, change stake and start or stop staking (stake parts through `tests/fixtures/fixture-node.mjs`)
- `tests/e2e/account.mjs`: recovery phrase, PIN and password change, recover (on frank of the multi-user test node, put back at the end)
- `tests/e2e/local.mjs`: sign in this browser on the private chain (login, claim, send, wait for the block, activity, unlock)
- `src/lib/tritium.int.test.ts`, `tritium.claim.int.test.ts`: browser-signed debit and credit against a node (settings at the top of each file)
- `tests/sdk/check.mjs`: the built developer package

Both e2e scripts use Playwright with its own Chromium (branded Chrome no longer loads unpacked extensions from the command line); see the comment at the top of each script for the settings.
