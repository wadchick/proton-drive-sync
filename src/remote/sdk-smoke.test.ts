import { describe, expect, it } from 'vitest';
import { OpenPGPCryptoWithCryptoProxy, ProtonDriveClient } from '@protontech/drive-sdk';
import { getSrp } from '@protontech/crypto/srp';
import { CryptoProxy } from '@protontech/crypto';
import dbus from 'dbus-next';
import picomatch from 'picomatch';
import { DatabaseSync } from 'node:sqlite';

describe('dependency smoke imports', () => {
  it('imports the Proton Drive SDK', () => {
    expect(typeof ProtonDriveClient).toBe('function');
    expect(typeof OpenPGPCryptoWithCryptoProxy).toBe('function');
  });
  it('imports Proton crypto and SRP', () => {
    expect(typeof getSrp).toBe('function');
    expect(typeof CryptoProxy.setEndpoint).toBe('function');
  });
  it('imports dbus, picomatch, sqlite', () => {
    expect(typeof dbus.sessionBus).toBe('function');
    expect(picomatch('*.tmp')('a.tmp')).toBe(true);
    expect(new DatabaseSync(':memory:').prepare('select 1 as x').get()).toEqual({ x: 1 });
  });
});
