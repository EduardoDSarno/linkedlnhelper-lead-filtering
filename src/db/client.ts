import pg from "pg";
import { Kysely, PostgresDialect } from "kysely";

import type { Database } from "./schema.js";

/**
 * How long to wait for a database connection before giving up.
 *
 * pg waits forever by default, so a database that hangs would hang every
 * request with it; failing after this lets the request error out instead.
 */
const DB_CONNECTION_TIMEOUT_MS = 5_000;


function getLink(): string
{
    const url = process.env.DATABASE_URL;

    if(!url){
        throw new Error("DATABASE_URL is not defined");
    }

    return url;
}

/**
 * This function will initialize a connection with the database, only
 * continue if connection is accepted
 */
export async function connectToDb(): Promise<Kysely<Database>> {

    const link = getLink();
    const client  = new pg.Pool({
        connectionString: link,
        connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    });

    client.on('error', (error) => console.error('Idle database connection failed', error));

    // The pool only connects on its first query, so a wrong DATABASE_URL would
    // otherwise surface at the first webhook. Asking once now fails at startup.
    await client.query('SELECT 1');

    const db = new Kysely<Database>({
    dialect: new PostgresDialect({
        pool: client,
    }),
    });

    return db;
}