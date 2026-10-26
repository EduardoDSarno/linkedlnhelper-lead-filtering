import { stdin, stdout } from "node:process";

import { hashPassword } from "../auth/password.js";
import { connectToDb } from "../db/client.js";
import { createOrganization, createUser, findOrganizationIdByName, findUserByEmail } from "../db/usersDb.js";

/** Shortest password accepted; length is what makes a password hard to guess. */
const MINIMUM_PASSWORD_LENGTH = 12;

/** Keys the hidden password prompt reacts to. */
const ENTER = ["\r", "\n"];
const BACKSPACE = ["\u007f", "\b"];
const CTRL_C = "\u0003";

/**
 * Create a user who can log in, run as
 * `npm run user:create -- <email> "<organization name>"`.
 *
 * The organization is reused when one with that exact name exists (adding a
 * colleague) and created otherwise. The password is typed at a hidden prompt,
 * never passed as an argument, so it stays out of the shell's history.
 */
async function main(): Promise<void> {
  const [email, organizationName] = process.argv.slice(2);
  if (!email || !organizationName) {
    throw new Error('Usage: npm run user:create -- <email> "<organization name>"');
  }

  const password = await askHidden("Password: ");
  if (password.length < MINIMUM_PASSWORD_LENGTH) {
    throw new Error(`The password must have at least ${MINIMUM_PASSWORD_LENGTH} characters.`);
  }
  if ((await askHidden("Repeat password: ")) !== password) {
    throw new Error("The passwords don't match.");
  }

  const db = await connectToDb();
  try {
    if (await findUserByEmail(db, email)) throw new Error(`A user with ${email} already exists.`);

    const existingOrganization = await findOrganizationIdByName(db, organizationName);
    const organizationId = existingOrganization ?? (await createOrganization(db, organizationName));
    await createUser(db, { organizationId, email, passwordHash: await hashPassword(password) });

    console.log(`Created ${email} in ${existingOrganization ? "existing" : "new"} organization "${organizationName}".`);
  } finally {
    await db.destroy();
  }
}

/**
 * Ask a question and read the answer without showing what is typed, like a
 * terminal's own password prompts.
 */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve, reject) => {
    stdout.write(question);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let answer = "";

    /** Handle each key: finish on Enter, erase on Backspace, stop on Ctrl+C, else collect. */
    const onData = (keys: string) => {
      for (const key of keys) {
        if (ENTER.includes(key) || key === CTRL_C) {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          if (key === CTRL_C) reject(new Error("Cancelled."));
          else resolve(answer);
          return;
        }
        answer = BACKSPACE.includes(key) ? answer.slice(0, -1) : answer + key;
      }
    };
    stdin.on("data", onData);
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
