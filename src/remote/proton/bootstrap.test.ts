import { CryptoProxy } from '@protontech/crypto';
import { createMessage, encrypt, enums } from 'openpgp';
import { describe, expect, it } from 'vitest';

import { initOpenPgp, MAX_DECOMPRESSED_MESSAGE_BYTES } from './bootstrap.js';

const sessionKey = { data: new Uint8Array(32).fill(7), algorithm: 'aes256' as const };

/** A block whose encrypted form is tiny but inflates to `bytes` of plaintext. */
async function compressedBlock(bytes: number): Promise<Uint8Array<ArrayBuffer>> {
  return encrypt({
    message: await createMessage({ binary: new Uint8Array(bytes) }),
    sessionKey,
    format: 'binary',
    config: { preferredCompressionAlgorithm: enums.compression.zlib },
  });
}

describe('initOpenPgp', () => {
  it('rejects a compressed packet that inflates past the block size instead of holding it in RAM', async () => {
    initOpenPgp();
    const bomb = await compressedBlock(MAX_DECOMPRESSED_MESSAGE_BYTES * 16);
    expect(bomb.length).toBeLessThan(128 * 1024);
    await expect(CryptoProxy.decryptMessage({ binaryMessage: bomb, sessionKeys: sessionKey, format: 'binary' }))
      .rejects.toThrow(/decompressed message size/i);
  });

  it('still decrypts a compressed packet holding a full 4 MiB block', async () => {
    initOpenPgp();
    const block = 4 * 1024 * 1024;
    const ok = await compressedBlock(block);
    const { data } = await CryptoProxy.decryptMessage({ binaryMessage: ok, sessionKeys: sessionKey, format: 'binary' });
    expect(data).toHaveLength(block);
  });
});
