export interface EncryptedSession {
  version: 1
  iv: string
  ciphertext: string
}

function bytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), char => char.charCodeAt(0))
}

function base64(value: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(value instanceof ArrayBuffer ? value : value.buffer)))
}

async function importKey(secret: string): Promise<CryptoKey> {
  if (!/^[0-9a-f]{64}$/iu.test(secret)) throw new Error('SESSION_KEY_INVALID')
  const raw = Uint8Array.from(secret.match(/../gu)!, hex => Number.parseInt(hex, 16))
  return await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
}

export async function encryptSession(value: string, secret: string, owner: string): Promise<EncryptedSession> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: new TextEncoder().encode(owner) },
    await importKey(secret),
    new TextEncoder().encode(value)
  )
  return { version: 1, iv: base64(iv), ciphertext: base64(ciphertext) }
}

export async function decryptSession(value: EncryptedSession, secret: string, owner: string): Promise<string> {
  if (value.version !== 1) throw new Error('SESSION_VERSION_INVALID')
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: bytes(value.iv), additionalData: new TextEncoder().encode(owner) },
    await importKey(secret),
    bytes(value.ciphertext)
  )
  return new TextDecoder().decode(plaintext)
}
