//loads the built developer package like a site or server would; node tests/sdk/check.mjs   env NODE_URL, GENESIS
import { cryptoRegisterFromNode, parseSignIn, verifySignedText } from '../../sdk/dist/server.js';
import { getNexus, isUserRejected, NexusErrors } from '../../sdk/dist/index.js';

const nodeUrl = process.env.NODE_URL || 'http://127.0.0.1:7080';
const genesis = process.env.GENESIS || 'b79ead583e88e06d31f1c4dedeb6ac91c77d1cbbb505eb320a745f7c97b8bf75';
let failures = 0;
function check(label, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ' - ' + detail : ''}`);
  if (!ok) {
    failures += 1;
  }
}

const text = [
  'shop.example wants you to sign in with your Nexus account:',
  'alice',
  `Genesis: ${genesis}`,
  '',
  'Log in to the shop',
  '',
  'URI: https://shop.example',
  'Network: private',
  'Nonce: abcdef123456',
  `Issued At: ${new Date().toISOString()}`,
].join('\n');
const fields = parseSignIn(text);
check('parses a sign-in text', fields?.nonce === 'abcdef123456' && fields?.username === 'alice', JSON.stringify(fields));

const reg = await cryptoRegisterFromNode(nodeUrl)(`8${'x'.repeat(50)}`).catch((e) => e);
check('crypto register lookup answers', reg === null || reg instanceof Error === false, String(reg));

const bad = await verifySignedText({ message: text, signature: '3000', publicKey: '02' + '00'.repeat(64), genesis, cryptoRegister: '' }, cryptoRegisterFromNode(nodeUrl), 'https://shop.example');
check('a wrong signature is refused', bad.valid === false, bad.reason);
const other = await verifySignedText({ message: text, signature: '3000', publicKey: '02', genesis, cryptoRegister: '' }, cryptoRegisterFromNode(nodeUrl), 'https://other.example');
check('a text for another site is refused', other.valid === false && /another site/.test(other.reason ?? ''), other.reason);

check('no window, no provider', (await getNexus(10)) === null);
check('error codes', NexusErrors.UserRejected === 4001 && isUserRejected({ code: 4001 }) && !isUserRejected(null));
console.log(failures ? `${failures} FAILED` : 'ALL PASSED');
process.exit(failures ? 1 : 0);
