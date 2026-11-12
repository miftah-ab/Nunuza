const encoder = new TextEncoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}
function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}
async function hmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const imported = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", imported, data));
}
async function hkdfExpand(prk: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  let previous = new Uint8Array(0);
  const blocks: Uint8Array[] = [];
  let total = 0;
  for (let i = 1; total < length; i++) {
    const input = new Uint8Array(previous.length + info.length + 1);
    input.set(previous); input.set(info, previous.length); input[input.length - 1] = i;
    previous = await hmac(prk, input);
    blocks.push(previous); total += previous.length;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const block of blocks) {
    const take = Math.min(block.length, length - offset);
    output.set(block.slice(0, take), offset);
    offset += take;
    if (offset === length) break;
  }
  return output;
}
async function hkdfExtract(salt: Uint8Array, ikm: Uint8Array): Promise<Uint8Array> {
  return hmac(salt.length ? salt : new Uint8Array(32), ikm);
}
function concat(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((n, part) => n + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
function derPkcs8FromRaw(raw: Uint8Array): Uint8Array {
  if (raw.length !== 32) throw new Error("VAPID private key must be a 32-byte P-256 key or PKCS#8 PEM.");
  const prefix = Uint8Array.from([
    0x30,0x44,0x02,0x01,0x00,0x30,0x13,0x06,0x07,0x2a,0x86,0x48,0xce,0x3d,0x02,0x01,
    0x06,0x08,0x2a,0x86,0x48,0xce,0x3d,0x03,0x01,0x07,0x04,0x2d,0x30,0x2b,0x02,0x01,0x01,0x04,0x20,
  ]);
  return concat(prefix, raw);
}
function privateKeyBytes(value: string): Uint8Array {
  const clean = value.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  const decoded = base64UrlToBytes(clean);
  return decoded.length === 32 ? derPkcs8FromRaw(decoded) : decoded;
}

async function createVapidToken(endpoint: string): Promise<{ token: string; publicKey: string }> {
  const publicKey = process.env.WEB_PUSH_VAPID_PUBLIC_KEY;
  const privateKey = process.env.WEB_PUSH_VAPID_PRIVATE_KEY;
  const subject = process.env.WEB_PUSH_VAPID_SUBJECT || "mailto:support@nunuza.com";
  if (!publicKey || !privateKey) throw new Error("Web Push is not configured.");
  const audience = new URL(endpoint).origin;
  const now = Math.floor(Date.now() / 1000);
  const header = bytesToBase64Url(encoder.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ aud: audience, exp: now + 12 * 60 * 60, sub: subject })));
  const unsigned = header + "." + payload;
  const key = await crypto.subtle.importKey("pkcs8", privateKeyBytes(privateKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, encoder.encode(unsigned)));
  return { token: unsigned + "." + bytesToBase64Url(signature), publicKey };
}

export async function sendWebPush(
  subscription: { endpoint: string; p256dh: string; auth_secret: string },
  payload: Record<string, unknown>
): Promise<{ ok: boolean; expired?: boolean; status?: number }> {
  const vapid = await createVapidToken(subscription.endpoint);
  const userPublicRaw = base64UrlToBytes(subscription.p256dh);
  const authSecret = base64UrlToBytes(subscription.auth_secret);
  const userPublic = await crypto.subtle.importKey("raw", userPublicRaw, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ephemeral = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const serverPublic = new Uint8Array(await crypto.subtle.exportKey("raw", ephemeral.publicKey));
  const sharedSecret = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: userPublic }, ephemeral.privateKey, 256));
  const authPrk = await hkdfExtract(authSecret, sharedSecret);
  const keyInfo = concat(encoder.encode("WebPush: info"), new Uint8Array([0]), userPublicRaw, serverPublic);
  const ikm = await hkdfExpand(authPrk, keyInfo, 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk = await hkdfExtract(salt, ikm);
  const cek = await hkdfExpand(prk, concat(encoder.encode("Content-Encoding: aes128gcm"), new Uint8Array([0])), 16);
  const nonce = await hkdfExpand(prk, concat(encoder.encode("Content-Encoding: nonce"), new Uint8Array([0])), 12);
  const plain = concat(encoder.encode(JSON.stringify(payload)), new Uint8Array([2]));
  const aesKey = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, aesKey, plain));
  const header = new Uint8Array(16 + 4 + 1 + serverPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, 4096, false);
  header[20] = serverPublic.length;
  header.set(serverPublic, 21);
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: \`vapid t=\${vapid.token}, k=\${vapid.publicKey}\`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "high",
    },
    body: concat(header, encrypted),
    signal: AbortSignal.timeout(10_000),
  });
  return { ok: response.ok, expired: response.status === 404 || response.status === 410, status: response.status };
}
