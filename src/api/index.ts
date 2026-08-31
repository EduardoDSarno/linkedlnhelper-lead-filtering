import Fastify, { type FastifyInstance } from 'fastify';
import { processingPaths, saveOriginalCsv } from '../dataCollector/processing/processing.js';
import crypto from 'crypto';
import { dbGetProcessingRunById, dbInsertProcessingRun, openDatabase } from '../database/index.js';
import {PROCESSING_STATUS} from '../database/types.js';
import {
    API_ROUTES,
    ARTIFACT_TYPE,
    CSV_CONTENT_TYPE,
    HTTP_STATUS,
    PARSE_AS_BUFFER,
    API_FIELD,
} from './constants.js';
import { asRecord, asString } from '../helpers/type_guards.js';
import { parseFullEvaluationCriteria } from '../evaluation/index.js';
import { runPipeline } from '../app.js';
import type { Logger } from '../logging/index.js';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';

export async function buildServer()
{
    const server = Fastify({logger:true});
    await registerCsvParser(server);
    registerImportRoute(server);
    registerFilterRoute(server);
    registerGetProccessByIdRoute(server);
    registerDownloadRoute(server);
    return server;
}

function registerDownloadRoute(server: FastifyInstance)
{
    server.get(API_ROUTES.download, async (request, reply) =>
    {
        const params = asRecord(request.params);
        if (!params) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Invalid params' });

        const processingId = asString(params[API_FIELD.processingId]);
        if (!processingId) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Missing processingId' });

        const artifactType = asString(params[API_FIELD.artifact]);
        if (!artifactType) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Missing artifact' });

        // Map the requested artifact to a fixed path. Only these two values are
        // ever served, so a caller cannot craft a path to another file.
        const paths = processingPaths(processingId);
        const filePath =
            artifactType === ARTIFACT_TYPE.approved ? paths.approved
            : artifactType === ARTIFACT_TYPE.report ? paths.report
            : undefined;
        if (!filePath) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Unknown artifact' });

        // The artifacts only exist after a successful run.
        const db = openDatabase();
        try
        {
            const run = dbGetProcessingRunById(processingId, db);
            if (!run) {
                return reply.status(HTTP_STATUS.notFound).send({ error: 'Processing run not found' });
            }
            if (run.status !== PROCESSING_STATUS.completed) {
                return reply.status(HTTP_STATUS.notFound).send({ error: 'Artifacts are not ready' });
            }
        }
        finally
        {
            db.close();
        }

        // Send the file to the client
        return reply
            .header('Content-Type', CSV_CONTENT_TYPE)
            .header('Content-Disposition', `attachment; filename="${basename(filePath)}"`)
            .send(createReadStream(filePath));
    });
}

/** This function receives a server instance and it's responsible
 * for registering the get processing by id route for the API
 * it gets the processing run by id and returns the processing run
*/
function registerGetProccessByIdRoute(server: FastifyInstance)
{
    server.get(API_ROUTES.getProccessById, async (request, reply) =>
    {
        const params = asRecord(request.params);
        if (!params) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Invalid params' });

       const processingId = asString(params[API_FIELD.processingId]);
       if (!processingId) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Missing processingId' });

       const db = openDatabase();
       try
       {
            const run = dbGetProcessingRunById(processingId, db);
            if (!run) {
                return reply.status(HTTP_STATUS.notFound).send({ error: 'Processing run not found' });
            }

            return reply.status(HTTP_STATUS.ok).send({
                processingId: run.id,
                status: run.status,
                ...(run.evaluationRunId ? { evaluationRunId: run.evaluationRunId } : {}),
                ...(run.error ? { error: run.error } : {}),
                ...(run.completedAt ? { completedAt: run.completedAt } : {}),
            });
       }
       finally
       {
            db.close();
       }
    });
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

        // Start the pipeline in the background; the response is already sent, so
        // the failure is only logged. The run is marked failed in the database
        // and the client learns the outcome by polling the status route.
        void runPipeline(processingId, paths, validCriteria, request.log as Logger)
        .catch((error) =>
        {
            request.log.error({ err: error }, 'Review run failed');
        });

        return reply.status(HTTP_STATUS.accepted).send({ processingId }); // Accepted; running in the background
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

