/**
 * How the Postgres backend decides on TLS from the connection string alone.
 * Hosted providers (Supabase, Neon) need encryption; a local database does not.
 */
import { describe, expect, it } from 'vitest';
import { sslOptionsFor } from '@/server/db/postgres-storage';

const SUPABASE = 'postgresql://postgres.ref:pw@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres';

describe('sslOptionsFor', () => {
  it('connects to a local database in the clear', () => {
    expect(sslOptionsFor('postgres://postgres:pw@localhost:5432/dev', undefined)).toBe(false);
    expect(sslOptionsFor('postgres://postgres:pw@127.0.0.1:5432/dev', undefined)).toBe(false);
  });

  it('encrypts a hosted connection, accepting the certificate when no CA is supplied', () => {
    expect(sslOptionsFor(SUPABASE, undefined)).toEqual({ rejectUnauthorized: false });
  });

  it('verifies the certificate against a supplied CA', () => {
    expect(sslOptionsFor(SUPABASE, '-----BEGIN CERTIFICATE-----')).toEqual({
      ca: '-----BEGIN CERTIFICATE-----',
      rejectUnauthorized: true,
    });
  });

  it('leaves an explicit sslmode to the driver', () => {
    expect(sslOptionsFor(`${SUPABASE}?sslmode=verify-full`, undefined)).toBeUndefined();
  });

  it('leaves a string it cannot parse to the driver', () => {
    expect(sslOptionsFor('not a url', undefined)).toBeUndefined();
  });
});
