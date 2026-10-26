import { createHash, randomBytes } from "node:crypto";
import {
    deleteSessionByTokenHash,
    findSessionByTokenHash,
    insertSession,
    type NewSession,
    type SessionRow,
} from "../db/sessionDb.js";
import type { Kysely } from "kysely";
import type { Database } from "../db/schema.js";

/** Random bytes in a session token: far too many to ever be guessed. */
const TOKEN_BYTES = 32;

const MS_PER_DAY = 24 * 60 * 60 * 1000;
/** How long a login lasts before the user must log in again. */
export const SESSION_DAYS = 30;

/** This function creates and insert a session for the user
 * in the database, with where the login came from, and
 * @returns the token to be given back to the user for it's
 * cookies
 */
export async function createSessionFromUser(
    db: Kysely<Database>,
    userId: string,
    origin: Pick<NewSession, "ip" | "userAgent">): Promise<string>{

    // base64url: no "+", "/" or "=", which cookies and URLs can mangle.
    const token = randomBytes(TOKEN_BYTES).toString("base64url");

    const hash = hashToken(token);

    const session: NewSession = {
        userId,
        tokenHash: hash,
        expiresAt: new Date(Date.now() + (SESSION_DAYS * MS_PER_DAY)),
        ...origin,
    }

    await insertSession(db,session);
    return token;
}

/**
 * Find the session a cookie's token belongs to, or nothing when the token is
 * unknown or its session has expired. Every logged-in request goes through it.
 */
export async function findSessionByToken(
    db: Kysely<Database>,
    token: string): Promise<SessionRow | undefined> {
    return findSessionByTokenHash(db, hashToken(token));
}

/** End the session a cookie's token belongs to, so that cookie stops working (logout). */
export async function deleteSessionByToken(
    db: Kysely<Database>,
    token: string): Promise<void> {
    await deleteSessionByTokenHash(db, hashToken(token));
}

/**
 * The form a token is stored and looked up in. Creating, finding and deleting
 * all hash through here, so they can never disagree.
 */
function hashToken(token: string): string {
    return createHash("sha256").update(token).digest("hex");
}