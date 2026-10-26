import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Kysely } from "kysely";

import { hashPassword, verifyPassword } from "../auth/password.js";
import { createSessionFromUser, deleteSessionByToken, findSessionByToken, SESSION_DAYS } from "../auth/sessions.js";
import type { Database } from "../db/schema.js";
import { findUserByEmail, findUserById } from "../db/usersDb.js";
import { HTTP_NO_CONTENT, HTTP_UNAUTHORIZED } from "./consts.js";

const LOGIN_PATH = "/api/login";
const LOGOUT_PATH = "/api/logout";
const ME_PATH = "/api/me";

/** Name of the cookie that carries the session token. */
const SESSION_COOKIE = "session";
const SECONDS_PER_DAY = 24 * 60 * 60;

/**
 * Login tries one IP may make per window, far stricter than the general
 * limit, so passwords can't be guessed and slow password checks can't be
 * used to overload the server.
 */
const LOGIN_TRIES_PER_WINDOW = 5;
const LOGIN_WINDOW_MS = 60_000;

/** Longest email and password accepted; a huge password would make the slow hash slower still. */
const MAXIMUM_EMAIL_LENGTH = 320;
const MAXIMUM_PASSWORD_LENGTH = 1_024;

/** The one answer for every failed login, so it never reveals which emails have accounts. */
const LOGIN_FAILED = "Wrong email or password";

/** The logged-in user, as private routes read it from `request.user`. */
export interface SessionUser {
  id: string;
  organizationId: string;
  email: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `requireUser` before a private route runs. */
    user?: SessionUser;
  }
}

/**
 * Adds the login, logout and "who am I" routes.
 *
 * Login checks the password, starts a session and puts its token in an
 * `HttpOnly` cookie; every later request carries that cookie on its own.
 */
export function registerAuthRoutes(app: FastifyInstance, db: Kysely<Database>): void {
  // A password check to run when the email doesn't exist, so that answer
  // takes as long as a wrong password and timing reveals nothing.
  const dummyHash = hashPassword("password-for-unknown-emails");

  app.post(
    LOGIN_PATH,
    {
      config: { rateLimit: { max: LOGIN_TRIES_PER_WINDOW, timeWindow: LOGIN_WINDOW_MS } },
      schema: {
        body: {
          type: "object",
          required: ["email", "password"],
          properties: {
            email: { type: "string", minLength: 1, maxLength: MAXIMUM_EMAIL_LENGTH },
            password: { type: "string", minLength: 1, maxLength: MAXIMUM_PASSWORD_LENGTH },
          },
        },
      },
    },
    async (request, reply) => {
      const { email, password } = request.body as { email: string; password: string };
      const user = await findUserByEmail(db, email);
      const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));

      if (!user || !passwordOk) {
        request.log.warn({ email }, "Failed login");
        return reply.code(HTTP_UNAUTHORIZED).send({ error: LOGIN_FAILED });
      }

      const token = await createSessionFromUser(db, user.id, {
        ip: request.ip,
        ...(request.headers["user-agent"] ? { userAgent: request.headers["user-agent"] } : {}),
      });
      reply.setCookie(SESSION_COOKIE, token, {
        httpOnly: true,
        // Secure whenever the request came over HTTPS; plain HTTP only works on localhost.
        secure: "auto",
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_DAYS * SECONDS_PER_DAY,
      });
      return { email: user.email, organizationId: user.organizationId };
    },
  );

  app.get(ME_PATH, { preHandler: requireUser(db) }, async (request) => {
    const { email, organizationId } = request.user as SessionUser;
    return { email, organizationId };
  });

  app.post(LOGOUT_PATH, async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) await deleteSessionByToken(db, token);
    reply.clearCookie(SESSION_COOKIE, { path: "/" });
    return reply.code(HTTP_NO_CONTENT).send();
  });
}

/**
 * A check to run before any private route: it finds the user behind the
 * request's session cookie and puts them on `request.user`, or answers 401
 * so the route never runs.
 */
export function requireUser(db: Kysely<Database>) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const token = request.cookies[SESSION_COOKIE];
    const session = token ? await findSessionByToken(db, token) : undefined;
    const user = session ? await findUserById(db, session.userId) : undefined;

    if (!user) {
      await reply.code(HTTP_UNAUTHORIZED).send({ error: "Not logged in" });
      return;
    }
    request.user = user;
  };
}
