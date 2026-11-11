//checks a signature the extension made in tests/e2e/dapp.mjs against a real node, like a website would
//SIGN_OUT=<file from dapp.mjs> NEXUS_NODE=http://127.0.0.1:7080 npx vitest run src/lib/verify.int.test.ts
import fs from 'fs';
import { describe, expect, it } from 'vitest';
import { cryptoRegisterFromNode, verifySignedText } from './signin';

const file = process.env.SIGN_OUT;
const node = process.env.NEXUS_NODE;

describe.skipIf(!file || !node)('signature from the extension on a real node', () => {
  it('verifies against the crypto register on chain', async () => {
    const s = JSON.parse(fs.readFileSync(file!, 'utf8'));
    const lookup = cryptoRegisterFromNode(node!);
    expect(await verifySignedText(s, lookup, s.origin)).toEqual({ valid: true });
    expect((await verifySignedText(s, lookup, 'https://other.example')).valid).toBe(false);
    expect((await verifySignedText({ ...s, message: s.message + ' ' }, lookup, s.origin)).valid).toBe(false);
  }, 30000);
});
