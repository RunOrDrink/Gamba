export async function sha256Hex(value: string) {
  const encoded = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(hash))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function seedToUnitInterval(clientSeed: string, serverSeedHash: string, nonce: number) {
  const hash = await sha256Hex(`${serverSeedHash}:${clientSeed}:${nonce}`);
  const integer = Number.parseInt(hash.slice(0, 12), 16);
  return integer / 0xffffffffffff;
}

export async function seedToSignedOffset(clientSeed: string, serverSeedHash: string, nonce: number) {
  return (await seedToUnitInterval(clientSeed, serverSeedHash, nonce)) * 2 - 1;
}
