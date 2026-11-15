import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from 'node:crypto';
import type { Quote, Signature } from './types';
import { canonicalJson, sha256 } from './util';

// Ed25519 key used to sign quotes. Set SIGNING_KEY (PKCS#8 PEM) to keep quotes verifiable across restarts;
// otherwise a fresh key is generated on start.
const privateKey: KeyObject = process.env.SIGNING_KEY
  ? createPrivateKey(process.env.SIGNING_KEY.replace(/\\n/g, '\n'))
  : generateKeyPairSync('ed25519').privateKey;
const publicKey = createPublicKey(privateKey);

const publicJwk = publicKey.export({ format: 'jwk' }) as { kty: string; crv: string; x: string };
export const keyId = `aimo-${sha256(publicJwk.x).slice(0, 12)}`;

/** Published at /.well-known/jwks.json so any agent can verify a quote independently. */
export const jwks = {
  keys: [{ ...publicJwk, kid: keyId, alg: 'EdDSA', use: 'sig' }],
};

function payload(quote: Quote): Buffer {
  const { signature: _signature, ...unsigned } = quote;
  return Buffer.from(canonicalJson(unsigned));
}

export function signQuote(quote: Quote): Signature {
  return { alg: 'EdDSA', kid: keyId, value: sign(null, payload(quote), privateKey).toString('base64url') };
}

export function verifyQuote(quote: Quote): boolean {
  if (!quote.signature || quote.signature.kid !== keyId) return false;
  return verify(null, payload(quote), publicKey, Buffer.from(quote.signature.value, 'base64url'));
}
