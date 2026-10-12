import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";
import { promisify } from "node:util";

/** scrypt cost settings for new hashes: N sets memory and time, r the block size, p the parallel runs. */
const SCRYPT_COST = { N: 2 ** 17, r: 8, p: 1 } as const;

const SCRYPT_CONFIG = {
  /** Bytes of hash produced for a new password. */
  passwordKeyLength: 64,
  /** Bytes of random salt, new for every password. */
  saltBytes: 16,
};

/** First part of every stored hash, naming the algorithm so others can be added later. */
const HASH_PREFIX = "scrypt";
/** Separates the parts of a stored hash: algorithm, N, r, p, salt, hash. */
const SEPARATOR = "$";
const STORED_PARTS = 6;

/** Bytes scrypt uses per unit of N × r, and how far above that Node's memory limit is set. */
const SCRYPT_BLOCK_BYTES = 128;
const MEMORY_HEADROOM = 2;

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: ScryptOptions,
) => Promise<Buffer>;

/**
 * Turn a password into the text saved in `users.password_hash`.
 *
 * The text carries the algorithm, its settings and the salt next to the hash,
 * so `verifyPassword` can repeat the exact same work later, even after the
 * settings for new passwords change.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SCRYPT_CONFIG.saltBytes);
  const { N, r, p } = SCRYPT_COST;
  const hash = await scryptAsync(password, salt, SCRYPT_CONFIG.passwordKeyLength, scryptOptions(N, r, p));

  return [HASH_PREFIX, N, r, p, salt.toString("base64"), hash.toString("base64")].join(SEPARATOR);
}

/**
 * Check a typed password against a stored hash.
 *
 * It hashes the typed password again with the stored salt and settings and
 * compares the two in constant time, so the time taken reveals nothing about
 * how close the guess was. A stored value it cannot read counts as a mismatch.
 */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(SEPARATOR);
  if (parts.length !== STORED_PARTS || parts[0] !== HASH_PREFIX) return false;

  const [, N, r, p, salt, hash] = parts;
  const expected = Buffer.from(hash ?? "", "base64");
  const actual = await scryptAsync(
    password,
    Buffer.from(salt ?? "", "base64"),
    expected.length,
    scryptOptions(Number(N), Number(r), Number(p)),
  );

  return timingSafeEqual(actual, expected);
}

/** scrypt's options for these costs, with Node's memory limit raised enough for them to run. */
function scryptOptions(N: number, r: number, p: number): ScryptOptions {
  return { N, r, p, maxmem: MEMORY_HEADROOM * SCRYPT_BLOCK_BYTES * N * r };
}
