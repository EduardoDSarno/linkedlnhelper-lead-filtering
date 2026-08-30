import Fastify, { type FastifyInstance } from 'fastify';
import { saveOriginalCsv } from '../dataCollector/processing/processing.js';
import crypto from 'crypto';
import { dbInsertProcessingRun, openDatabase } from '../database/index.js';
import {PROCESSING_STATUS} from '../database/types.js';
import {
    API_ROUTES,
    CSV_CONTENT_TYPE,
    HTTP_STATUS,
    PARSE_AS_BUFFER,
} from './constants.js';

export async function buildServer()
{
    const server = Fastify();
    await registerCsvParser(server);
    registerImportRoute(server);
    return server;
}

/** This function receives a server instance and it's responsible
 * for registering the import route for the API
 * it saves the original CSV file to the database and to the file processing directory.
*/
function registerImportRoute(server: FastifyInstance)
{
    server.post(API_ROUTES.import, async (request, reply) =>
    {
        const bytes = request.body;
        if (!Buffer.isBuffer(bytes) || bytes.length === 0)
        {
            return reply.status(HTTP_STATUS.badRequest).send({ error: 'No data provided' });
        }

        
        const id = crypto.randomUUID(); // Create Id for the processing run
        const { originalPath } = await saveOriginalCsv(id, bytes);

        const db = openDatabase();
        try
        {
            dbInsertProcessingRun({
                id,
                status: PROCESSING_STATUS.queued,
                originalCsvPath: originalPath,
                createdAt: new Date().toISOString(),
            }, db);

            reply.status(HTTP_STATUS.created).send({ processingId: id });
        }
        catch (error)
        {
            return reply.status(HTTP_STATUS.internalError).send({ error: 'Failed to insert processing run' });
        }
        finally
        {
            db.close();
        }
    });
}

/** Received a Fastify intance and registers a parser for CSV files */
async function registerCsvParser(server: FastifyInstance)
{
    server.addContentTypeParser(CSV_CONTENT_TYPE,
        {
            parseAs: PARSE_AS_BUFFER
        },
        (_request, payload, done) => 
        {
            done(null, payload);
        },
    );
}