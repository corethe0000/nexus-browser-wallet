//checks "Sign in with Nexus" texts on a server: Node 18+ or any runtime with fetch, no login on the node needed
export { cryptoRegisterFromNode, parseSignIn, verifySignedText } from '../../src/lib/signin';
export type { CryptoRegister, SignedText, SignInFields, VerifyResult } from '../../src/lib/signin';
