import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";

import type { Database } from "../db/schema.js";
import {
  deleteSession,
  findSessionUser,
  findUserForLogin,
  insertSession,
} from "../db/usersDb.js";
import type { SessionUser } from "../db/usersDb.js";
import { asRecord, asString, CONFIG_NUMBER_MINIMUMS, resolveConfigNumber } from "../shared/helpers/index.js";
import { HTTP_BAD_REQUEST, HTTP_UNAUTHORIZED } from "./consts.js";

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireUser` on every protected route. */
    user: SessionUser | null;
  }
}

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keyLength: number,
) => Promise<Buffer>;

/** Name of the cookie that carries the session token. */
const SESSION_COOKIE = "session";

/** Environment variable for how long a login lasts, in days. */
const SESSION_DAYS_KEY = "SESSION_DAYS";
const DEFAULT_SESSION_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Random bytes in a session token; enough that guessing one is hopeless. */
const SESSION_TOKEN_BYTES = 32;
const PASSWORD_SALT_BYTES = 16;
const PASSWORD_KEY_BYTES = 64;

/** Shortest password `npm run user:create` accepts. */
export const MINIMUM_PASSWORD_LENGTH = 10;

/**
 * Add login, logout and "who am I" routes.
 *
 * A login sets an httpOnly cookie holding a random token; only its hash is
 * stored, so the sessions table alone cannot be used to log in.
 */
export function registerAuthRoutes(
  app: FastifyInstance,
  db: Kysely<Database>,
  environment: NodeJS.ProcessEnv = process.env,
): void {
  const sessionMs = sessionDays(environment) * MS_PER_DAY;

  app.post("/api/auth/login", async (request, reply) => {
    const body = asRecord(request.body);
    const email = asString(body?.["email"])?.trim();
    const password = asString(body?.["password"]);
    if (!email || !password) {
      return reply.code(HTTP_BAD_REQUEST).send({ error: "Email and password are required." });
    }

    const user = await findUserForLogin(db, email);
    // An unknown email still runs a hash check, so timing does not reveal
    // which addresses have accounts.
    const valid = await verifyPassword(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);
    if (!user || !valid) {
      return reply.code(HTTP_UNAUTHORIZED).send({ error: "Wrong email or password." });
    }

    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(Date.now() + sessionMs);
    await insertSession(db, { tokenHash: hashToken(token), userId: user.id, expiresAt });

    reply.setCookie(SESSION_COOKIE, token, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      secure: environment["NODE_ENV"] === "production",
      expires: expiresAt,
    });
    return { user: await findSessionUser(db, hashToken(token)) };
  });

  app.post("/api/auth/logout", async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSession(db, hashToken(token));
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return { loggedOut: true };
  });

  app.get("/api/auth/me", async (request, reply) => {
    const user = await sessionUser(db, request);
    if (!user) return reply.code(HTTP_UNAUTHORIZED).send({ error: "Not logged in." });
    return { user };
  });
}

/**
 * A pre-handler that lets a request through only with a valid session, and
 * puts the user on `request.user` for the route to scope its queries by.
 */
export function requireUser(db: Kysely<Database>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = await sessionUser(db, request);
    if (!user) {
      await reply.code(HTTP_UNAUTHORIZED).send({ error: "Not logged in." });
      return;
    }
    request.user = user;
  };
}

/**
 * The logged-in user of a protected route.
 *
 * @throws When called on a route without `requireUser`, which is a wiring bug.
 */
export function currentUser(request: FastifyRequest): SessionUser {
  if (!request.user) throw new Error("Route is missing the requireUser pre-handler.");
  return request.user;
}

/** Hash a password with a fresh random salt, as `salt:key` in hex. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(PASSWORD_SALT_BYTES);
  const key = await scryptAsync(password, salt, PASSWORD_KEY_BYTES);
  return `${salt.toString("hex")}:${key.toString("hex")}`;
}

/** Check a password against a stored `salt:key` hash, in constant time. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [saltHex, keyHex] = stored.split(":");
  if (!saltHex || !keyHex) return false;
  const expected = Buffer.from(keyHex, "hex");
  const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A valid hash no password matches, checked when the email is unknown. */
const DUMMY_PASSWORD_HASH = `${"00".repeat(PASSWORD_SALT_BYTES)}:${"00".repeat(PASSWORD_KEY_BYTES)}`;

/** The session's user, from the request's cookie, or nothing. */
async function sessionUser(
  db: Kysely<Database>,
  request: FastifyRequest,
): Promise<SessionUser | undefined> {
  const token = request.cookies[SESSION_COOKIE];
  return token ? findSessionUser(db, hashToken(token)) : undefined;
}

/** What is stored in place of a session token. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** How many days a login lasts, from `.env` or the default. */
function sessionDays(environment: NodeJS.ProcessEnv): number {
  return resolveConfigNumber(environment[SESSION_DAYS_KEY], {
    fallback: DEFAULT_SESSION_DAYS,
    minimum: CONFIG_NUMBER_MINIMUMS.positive,
    integer: true,
  });
}
