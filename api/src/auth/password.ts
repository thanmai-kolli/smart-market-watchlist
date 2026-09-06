/**
 * Password storage.
 *
 * scrypt from the standard library rather than a dependency: it is memory-hard,
 * it is what Node ships for exactly this, and adding an npm package to hash a
 * string would undo the argument the rest of this project makes about its own
 * dependency count.
 */
import {
  randomBytes,
  randomUUID,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEY_BYTES = 64;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 8;

/** Stored as salt:hash, so the salt travels with the hash and is never reused. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await scrypt(password, salt, KEY_BYTES);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;

  const expected = Buffer.from(keyHex, "hex");
  const actual = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);

  // Length is checked first because timingSafeEqual throws on a mismatch, and
  // the throw would itself be a signal.
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Burns the same work as a real check when the email does not exist.
 *
 * Without it, an unknown address answers noticeably faster than a known one with
 * the wrong password, which turns the login form into a way to find out who has
 * an account here.
 */
export async function wasteTime(): Promise<void> {
  await scrypt(randomUUID(), randomBytes(SALT_BYTES), KEY_BYTES);
}

/** Deliberately permissive: the only real test of an address is sending to it. */
export function normaliseEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (email.length < 3 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}
