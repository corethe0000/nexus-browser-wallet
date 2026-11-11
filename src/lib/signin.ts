//"Sign in with Nexus": the wallet signs a text with the user's crypto register "sign" key (brainpoolP512t1,
//ECDSA over SHA-512 of the text, DER), the site checks it against that register on any node
import { cryptoRegisterAddress, fromHex, keyHash, signer, toHex } from './keys';

export interface SignedText {
  message: string;
  signature: string; //DER, hex
  publicKey: string; //compressed, hex
  genesis: string;
  cryptoRegister: string;
}

export interface SignInParams {
  statement?: string;
  nonce: string;
}

const maxStatement = 300;
const maxMessage = 2000;
const noncePattern = /^[A-Za-z0-9]{8,64}$/;
const fieldLine = /^(URI|Network|Nonce|Issued At|Genesis|Site|Account):/i;
//control, format (bidi) and line/paragraph separator characters could fake lines in the sign window
const hiddenChars = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u;
const genesisPattern = /^[0-9a-f]{64}$/i;
const signInTitle = ' wants you to sign in with your Nexus account:';
const messageTitle = 'Nexus signed message';

export function checkSignInParams(raw: unknown): SignInParams {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (typeof p.nonce !== 'string' || !noncePattern.test(p.nonce)) {
    throw new Error('nonce must be 8 to 64 letters or digits');
  }
  if (p.statement !== undefined && (typeof p.statement !== 'string' || p.statement.length > maxStatement || /[\r\n]/.test(p.statement))) {
    throw new Error(`statement must be one line of at most ${maxStatement} characters`);
  }
  //a statement that looks like one of the fields could pass as another site's sign-in
  if (typeof p.statement === 'string' && (fieldLine.test(p.statement.trim()) || p.statement.includes(signInTitle.trim()) || hiddenChars.test(p.statement))) {
    throw new Error('statement must not look like a field of the sign-in text');
  }
  return { nonce: p.nonce, statement: (p.statement as string | undefined)?.trim() || undefined };
}

export function checkMessageParams(raw: unknown): string {
  const p = (raw ?? {}) as Record<string, unknown>;
  if (typeof p.message !== 'string' || !p.message.trim() || p.message.length > maxMessage) {
    throw new Error(`message must be text of at most ${maxMessage} characters`);
  }
  //line breaks and tabs are fine in a message, other hidden characters are not
  if (hiddenChars.test(p.message.replace(/[\n\t]/g, ''))) {
    throw new Error('message must not contain control or direction characters');
  }
  return p.message;
}

interface Who {
  origin: string;
  username: string;
  genesis: string;
  network: string;
}

//the site address is always written in by the wallet, so a signature is no use on another site
export function signInText(who: Who, p: SignInParams, issuedAt: Date): string {
  checkWho(who);
  const host = new URL(who.origin).host;
  const lines = [`${host}${signInTitle}`, who.username, `Genesis: ${who.genesis}`, ''];
  if (p.statement) {
    lines.push(p.statement, '');
  }
  lines.push(`URI: ${who.origin}`, `Network: ${who.network}`, `Nonce: ${p.nonce}`, `Issued At: ${issuedAt.toISOString()}`);
  return lines.join('\n');
}

//names with line breaks would move the fields
function checkWho(who: Who) {
  if (hiddenChars.test(who.username) || !genesisPattern.test(who.genesis)) {
    throw new Error('account name or genesis cannot be written into a signed text');
  }
}

export function messageText(who: Who, message: string): string {
  checkWho(who);
  return [messageTitle, `Site: ${who.origin}`, `Account: ${who.username} ${who.genesis}`, '', message].join('\n');
}

export function signText(text: string, privateKey: Uint8Array, publicKey: Uint8Array, genesis: string): SignedText {
  const sig = signer.sign(new TextEncoder().encode(text), privateKey, { format: 'der', lowS: false });
  return {
    message: text,
    signature: toHex(sig),
    publicKey: toHex(publicKey),
    genesis,
    cryptoRegister: cryptoRegisterAddress(genesis),
  };
}

export interface CryptoRegister {
  owner: string;
  sign: string;
}

export interface SignInFields {
  host: string;
  username: string;
  genesis: string;
  statement?: string;
  uri: string;
  network: string;
  nonce: string;
  issuedAt: string;
}

//strict reading of a sign-in text, line by line as signInText writes it
export function parseSignIn(text: string): SignInFields | null {
  const l = text.split('\n');
  if (l.length !== 8 && l.length !== 10) {
    return null;
  }
  if (!l[0]!.endsWith(signInTitle) || !l[1] || !l[2]!.startsWith('Genesis: ') || l[3] !== '') {
    return null;
  }
  let i = 4;
  let statement: string | undefined;
  if (l.length === 10) {
    statement = l[4];
    if (!statement || l[5] !== '' || fieldLine.test(statement)) {
      return null;
    }
    i = 6;
  }
  const field = (line: string | undefined, name: string) => (line?.startsWith(`${name}: `) ? line.slice(name.length + 2) : null);
  const uri = field(l[i], 'URI');
  const network = field(l[i + 1], 'Network');
  const nonce = field(l[i + 2], 'Nonce');
  const issuedAt = field(l[i + 3], 'Issued At');
  const genesis = l[2]!.slice('Genesis: '.length);
  if (!uri || !network || !nonce || !issuedAt || !genesisPattern.test(genesis)) {
    return null;
  }
  return { host: l[0]!.slice(0, -signInTitle.length), username: l[1]!, genesis, statement, uri, network, nonce, issuedAt };
}

export interface VerifyResult {
  valid: boolean;
  reason?: string;
  //fields of a valid sign-in; the server still checks that the nonce is its own and the time is recent
  signIn?: SignInFields;
}

//for websites: the text is a sign-in (or with kind 'message' a signed message) made for this site and
//account, the signature matches, and the key is the sign key in the account's crypto register
export async function verifySignedText(
  s: SignedText,
  getCryptoRegister: (address: string) => Promise<CryptoRegister | null>,
  expectedOriginIn: string,
  kind: 'signIn' | 'message' = 'signIn',
  opts: { network?: string; maxAgeSeconds?: number; now?: Date } = {},
): Promise<VerifyResult> {
  //https://shop.example/ and https://shop.example are the same site
  const expectedOrigin = new URL(expectedOriginIn).origin;
  let fields: SignInFields | null = null;
  if (kind === 'signIn') {
    fields = parseSignIn(s.message);
    if (!fields) {
      return { valid: false, reason: 'not a sign-in text' };
    }
    if (fields.uri !== expectedOrigin || fields.host !== new URL(expectedOrigin).host) {
      return { valid: false, reason: 'message was made for another site' };
    }
    if (fields.genesis.toLowerCase() !== s.genesis.toLowerCase()) {
      return { valid: false, reason: 'message names another account' };
    }
    if (opts.network && fields.network !== opts.network) {
      return { valid: false, reason: 'message was made for another network' };
    }
    if (opts.maxAgeSeconds !== undefined) {
      const at = Date.parse(fields.issuedAt);
      const now = (opts.now ?? new Date()).getTime();
      if (!Number.isFinite(at) || now - at > opts.maxAgeSeconds * 1000 || at - now > 60000) {
        return { valid: false, reason: 'message is too old or from the future' };
      }
    }
  } else {
    const l = s.message.split('\n');
    if (l[0] !== messageTitle || l[1] !== `Site: ${expectedOrigin}` || !l[2]?.startsWith('Account: ') || !l[2].endsWith(` ${s.genesis}`) || l[3] !== '') {
      return { valid: false, reason: 'not a signed message made for this site and account' };
    }
  }
  let ok = false;
  try {
    ok = signer.verify(fromHex(s.signature), new TextEncoder().encode(s.message), fromHex(s.publicKey), { format: 'der', lowS: false });
  } catch {
    ok = false;
  }
  if (!ok) {
    return { valid: false, reason: 'signature does not match the message and public key' };
  }
  const address = cryptoRegisterAddress(s.genesis);
  const reg = await getCryptoRegister(address);
  if (!reg) {
    return { valid: false, reason: 'no crypto register for this genesis' };
  }
  if (reg.owner.toLowerCase() !== s.genesis.toLowerCase()) {
    return { valid: false, reason: 'crypto register belongs to another genesis' };
  }
  if (keyHash(fromHex(s.publicKey)).toLowerCase() !== reg.sign.toLowerCase()) {
    return { valid: false, reason: 'public key is not the sign key of this account' };
  }
  return fields ? { valid: true, signIn: fields } : { valid: true };
}

//crypto register from a node, register/get/crypto needs no login
export function cryptoRegisterFromNode(nodeUrl: string, fetcher: typeof fetch = fetch) {
  return async (address: string): Promise<CryptoRegister | null> => {
    const res = await fetcher(`${nodeUrl.replace(/\/+$/, '')}/register/get/crypto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    const body = await res.json().catch(() => null);
    return body?.result ? { owner: body.result.owner, sign: body.result.sign } : null;
  };
}
