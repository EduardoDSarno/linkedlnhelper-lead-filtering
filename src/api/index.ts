import Fastify, { type FastifyInstance } from 'fastify';
import { processingPaths, saveOriginalCsv } from '../dataCollector/processing/processing.js';
import crypto from 'crypto';
import { dbGetProcessingRunById, dbInsertProcessingRun, openDatabase } from '../database/index.js';
import {PROCESSING_STATUS} from '../database/types.js';
import {
    API_ROUTES,
    CSV_CONTENT_TYPE,
    HTTP_STATUS,
    PARSE_AS_BUFFER,
    API_FIELD,
} from './constants.js';
import { asRecord, asString } from '../helpers/type_guards.js';
import { parseFullEvaluationCriteria } from '../evaluation/index.js';
import { runPipeline } from '../app.js';
import type { Logger } from '../logging/index.js';

export async function buildServer()
{
    const server = Fastify({logger:true});
    await registerCsvParser(server);
    registerImportRoute(server);
    return server;
}

/** This function receives a server instance and it's responsible
 * for registering the filter route for the API
 * it validates the request body and runs the pipeline
*/
function registerFilterRoute(server: FastifyInstance)
{
    server.post(API_ROUTES.review, async (request, reply) =>
    {
        const body = asRecord(request.body);
        // Check if the request body is a record and contains the processingId and criteria
        if(!body)
        {
            return reply.status(HTTP_STATUS.badRequest).send({ error: 'Invalid body' });
        }
        const processingId = asString(body[API_FIELD.processingId]);
        if (!processingId) 
        {
            return reply.status(HTTP_STATUS.badRequest).send({ error: 'Missing processingId' });
        }

        // Check if the processing run exists
        const db = openDatabase();
        try 
        {
            const run = dbGetProcessingRunById(processingId, db);
            if (!run) {
                return reply.status(HTTP_STATUS.notFound).send({ error: 'Processing run not found' });
            }
        } 
        finally {
            db.close();
        }

        // Check if the criteria is a valid JSON object
        const criteria = body[API_FIELD.criteria];
        let validCriteria;
        // Parse the criteria
        try
        {
           validCriteria = parseFullEvaluationCriteria(criteria) 
        }
        // If the criteria is not a valid JSON object, return a bad request error
        catch(error)
        {
            return reply.status(HTTP_STATUS.badRequest).send({ error: 'Invalid criteria' });
        }

        // Get the paths for the processing run
        const paths = processingPaths(processingId);
        // Run the pipeline

        // Run the pipeline
        const result = await runPipeline(processingId, paths, validCriteria, request.log as Logger);
        // Return the result

        return reply.status(HTTP_STATUS.ok).send(result);
    });
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

