# Try the Nexus Wallet extension

For trying it on your own PC with your own desktop wallet. Nothing is published anywhere: you load the extension from a file.

## What you need

- The Nexus desktop wallet, running and synchronized (it starts the core the extension talks to)
- Chrome, Edge, Brave, Opera or Firefox
- The packages in `release/` of this folder: `nexus-wallet-extension-0.1.0-chrome.zip` (Chrome, Edge, Brave, Opera) and `nexus-wallet-extension-0.1.0-firefox.zip`

## Load it

Chrome, Edge, Brave, Opera:

1. Unzip `nexus-wallet-extension-0.1.0-chrome.zip` into a folder you keep (the browser loads it from there every start)
2. Open `chrome://extensions` (Edge: `edge://extensions`), switch on Developer mode
3. Load unpacked, pick that folder
4. Pin the Nexus Wallet icon in the toolbar

Firefox (stays until Firefox closes, then load it again):

1. Open `about:debugging#/runtime/this-firefox`
2. Load Temporary Add-on, pick `nexus-wallet-extension-0.1.0-firefox.zip`

## Connect to the desktop wallet

1. Open the Nexus Wallet popup
2. Core address: `http://127.0.0.1:8080` (the default)
3. API user and password: open `nexus.conf` in the core data folder and copy `apiuser` and `apipassword`
   - Windows: `%APPDATA%\Nexus\nexus.conf`
   - macOS: `~/Library/Application Support/Nexus/nexus.conf`
   - Linux: `~/.Nexus/nexus.conf`
4. Connect. If the desktop wallet is logged in, the extension uses that login; otherwise log in with username, password and PIN

## Things to know

- This is your real account on mainnet. Start with small amounts.
- Every send, invoice payment, market order and signature asks for your PIN in the wallet window, never on the website.
- Log out in the extension logs out the desktop wallet too (it is the same core).
- The extension locks after 15 minutes without use and after the browser starts (Settings, Lock automatically). The desktop wallet core version 5.1.4 cannot check a PIN alone, so unlocking there asks for password and PIN.
- Rejecting an invoice needs a newer core than 5.1.4; the wallet tells you so.
- Staking shows when your profile has a trust account; changing the stake and starting or stopping staking were only tried on a test core with made up numbers.

## Newer things to try

- Tap a transaction in Activity: details, link to the explorer, save the other side as a contact. A send nobody claimed can be taken back there once its "If not claimed" time is over (choose 10 minutes in Send to try it).
- Settings > Contacts, and the contact picker in Send.
- The number on the toolbar icon = payments and assets waiting for you.
- Accounts tab > New account, token or name; Assets tab > New asset.
- Invoices tab > New invoice (to another user); your sent ones can be cancelled.
- Settings > Password, PIN and recovery; Log in > Forgot password or PIN? (needs the recovery phrase).
- Core settings > Saved cores, once you used two cores.
- Explorer: the local branch `wallet-connect` of nexus-explorer-next has Connect wallet in the header and Send with wallet on account pages.

## Try a website

`tests/dapp/index.html` is a small test page with buttons for every website call. Serve it from any local web server (the extension only works on http and https pages, not on `file://`), for example `npx http-server tests/dapp -p 8099`, then open `http://127.0.0.1:8099/`.

## If something goes wrong

- "The node refused the API user or password": copy `apiuser` and `apipassword` again from `nexus.conf`
- "Cannot reach the node": the desktop wallet is not running, or its core uses another port (Settings > Core in the desktop wallet)
- Settings > Backup exports your settings to a file you can import after reinstalling the extension
