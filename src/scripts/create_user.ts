import { createInterface } from "node:readline/promises";

import { hashPassword, MINIMUM_PASSWORD_LENGTH } from "../api/auth.js";
import { connectToDb } from "../db/client.js";
import { createUser } from "../db/usersDb.js";

/**
 * Create a login for the web app: `npm run user:create -- <email> "<organization>"`.
 *
 * There is no sign-up page on purpose, since the app is on the internet; users
 * are added by whoever runs the server. The password is asked for in the
 * terminal so it never lands in shell history.
 */
async function main(): Promise<void> {
  const [email, organizationName] = process.argv.slice(2);
  if (!email || !organizationName) {
    throw new Error('Usage: npm run user:create -- <email> "<organization name>"');
  }

  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  const password = await terminal.question(`Password for ${email}: `);
  terminal.close();
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`Password must have at least ${MINIMUM_PASSWORD_LENGTH} characters.`);
  }

  const db = await connectToDb();
  try {
    const id = await createUser(db, {
      organizationName,
      email,
      passwordHash: await hashPassword(password),
    });
    console.log(`Created user ${id} (${email.toLowerCase()}) in "${organizationName}".`);
  } finally {
    await db.destroy();
  }
}

await main();
