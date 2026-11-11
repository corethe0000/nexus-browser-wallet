//test node in front of a real core: answers chosen API methods with fixed data, sends everything else on
//node fixture-node.mjs <port> <target url> <scenario>   scenarios below; GET /__scenario/<name> switches at runtime
import http from 'http';

const port = Number(process.argv[2] || 7090);
const target = (process.argv[3] || 'http://127.0.0.1:7080').replace(/\/$/, '');
let scenario = process.argv[4] || 'staking';
//PIN the stake commands accept, alice on the private test chain
const fixturePin = process.env.FIXTURE_PIN || '1111';

const nxs = (o) => ({ token: '0', ticker: 'NXS', decimals: 6, available: 0, confirmed: 0, unclaimed: 0, unconfirmed: 0, stake: 0, immature: 0, ...o });
const trustAddress = '8Ce5QTDqj3tZQd3HFJPy4fN8YSyW5y3jvmJaF2BvYaXQvJZqk9C';

const scenarios = {
  //a trust account that stakes
  staking: {
    'finance/get/stakeinfo': { address: trustAddress, balance: 12.345678, stake: 15000, trust: 338495, onhold: false, stakerate: 1.8052413746600344, trustweight: 53.440432749937834, blockweight: 15.358176013767272, stakeweight: 49.63220707632078, new: false, staking: true, change: false },
    'finance/get/trust': { address: trustAddress, name: 'trust', type: 'TRUST', token: '0', ticker: 'NXS', balance: 12.345678, stake: 15000 },
    patchBalances: (list) => list.map((b) => (b.token === '0' ? nxs({ ...b, available: 1250.5, confirmed: 1250.5, stake: 15000 }) : b)),
  },
  //new trust account waiting before staking starts, with a stake change asked for
  onhold: {
    'finance/get/stakeinfo': { address: trustAddress, balance: 0, stake: 500, trust: 0, onhold: true, holdtime: 5400, stakerate: 0.5, trustweight: 0, blockweight: 0, stakeweight: 0, new: true, staking: true, change: true, amount: 750, requested: Math.floor(Date.now() / 1000) - 600, expires: 0 },
    'finance/get/trust': { address: trustAddress, name: 'trust', type: 'TRUST', token: '0', ticker: 'NXS', balance: 0, stake: 500 },
    patchBalances: (list) => list.map((b) => (b.token === '0' ? nxs({ ...b, available: 20, stake: 500 }) : b)),
  },
  //trust account, staking not running in the core
  notstaking: {
    'finance/get/stakeinfo': { address: trustAddress, balance: 3, stake: 2000, trust: 1200, onhold: false, stakerate: 0.7, trustweight: 0, blockweight: 0, stakeweight: 0, new: false, staking: false, change: false },
    'finance/get/trust': { address: trustAddress, name: 'trust', type: 'TRUST', token: '0', ticker: 'NXS', balance: 3, stake: 2000 },
    patchBalances: (list) => list.map((b) => (b.token === '0' ? nxs({ ...b, available: 3, stake: 2000 }) : b)),
  },
  //hard cases for the layout: long names, big and tiny numbers, many tokens, unnamed token
  edge: {
    'finance/get/stakeinfo': { address: trustAddress, balance: 0.000001, stake: 123456789.123456, trust: 99999999, onhold: false, stakerate: 3, trustweight: 90, blockweight: 10, stakeweight: 100, new: false, staking: true, change: false },
    patchBalances: (list) => [
      nxs({ available: 98765432.123456, stake: 123456789.123456, unclaimed: 0.000001, unconfirmed: 1234.5 }),
      ...list.filter((b) => b.token !== '0'),
      ...Array.from({ length: 8 }, (_, i) => ({ token: `8Tok${i}xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`, ticker: i === 3 ? undefined : `VERYLONGTICKER${i}`, decimals: i, available: 10 ** (i + 3) + 0.5, confirmed: 0, unclaimed: i % 2 ? 7 : 0, unconfirmed: 0 })),
    ],
    patchAccounts: (list) => [
      ...list,
      { address: '8BxLongNameAccountAddressXXXXXXXXXXXXXXXXXXXXXXXXXX', name: 'my-very-long-account-name-for-saving-up-for-something-big', type: 'ACCOUNT', token: '0', ticker: 'NXS', balance: 98765432.123456 },
      { address: '8BxUnnamedAccountAddressXXXXXXXXXXXXXXXXXXXXXXXXXXX', type: 'ACCOUNT', token: '8Tok3xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx', balance: 1000000 },
    ],
  },
  //the core refusing balances and stake info
  errors: {
    'finance/get/stakeinfo': { error: { code: -70, message: 'Trust account not found' } },
    'finance/get/balances': { error: { code: -1, message: 'Database read failed for an internal reason that is described in a rather long message' } },
  },
};

async function forward(req, body) {
  const res = await fetch(target + req.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(req.headers.authorization ? { Authorization: req.headers.authorization } : {}) },
    body: body || '{}',
  });
  return { status: res.status, text: await res.text() };
}

http
  .createServer(async (req, res) => {
    const method = (req.url || '/').slice(1).split('?')[0];
    if (method.startsWith('__scenario/')) {
      scenario = method.slice('__scenario/'.length);
      res.end(JSON.stringify({ scenario }));
      return;
    }
    let body = '';
    for await (const c of req) {
      body += c;
    }
    const s = scenarios[scenario] ?? {};
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      //stake changes and the stake minter switch act on the scenario's stake info
      const si = s['finance/get/stakeinfo'];
      if (si && !si.error && ['finance/set/stake', 'sessions/unlock/local', 'sessions/lock/local'].includes(method)) {
        const p = JSON.parse(body || '{}');
        if (String(p.pin) !== fixturePin) {
          return send(400, { error: { code: -139, message: 'Invalid credentials' } });
        }
        if (method === 'finance/set/stake') {
          const amount = Number(p.amount);
          if (amount > si.stake + si.balance) {
            return send(400, { error: { code: -77, message: 'Insufficient trust account balance to add to stake' } });
          }
          Object.assign(si, { change: true, amount, requested: Math.floor(Date.now() / 1000), expires: 0 });
          return send(200, { result: { success: true, txid: '01'.repeat(64) } });
        }
        const on = method === 'sessions/unlock/local';
        if (si.staking === on) {
          return send(400, { error: { code: -208, message: 'Locked status has not changed' } });
        }
        si.staking = on;
        return send(200, { result: { unlocked: { mining: false, notifications: true, staking: on, transactions: true } } });
      }
      const fixed = s[method];
      if (fixed) {
        return fixed.error ? send(400, { error: fixed.error }) : send(200, { result: fixed });
      }
      const real = await forward(req, body);
      if (method === 'finance/get/balances' && s.patchBalances && real.status === 200) {
        return send(200, { result: s.patchBalances(JSON.parse(real.text).result ?? []) });
      }
      if (method === 'finance/list/accounts' && s.patchAccounts && real.status === 200) {
        return send(200, { result: s.patchAccounts(JSON.parse(real.text).result ?? []) });
      }
      res.writeHead(real.status, { 'Content-Type': 'application/json' });
      res.end(real.text);
    } catch (e) {
      send(502, { error: { code: -1, message: 'fixture node: ' + e.message } });
    }
  })
  .listen(port, '127.0.0.1', () => console.log(`fixture node on ${port} -> ${target}, scenario ${scenario}`));
