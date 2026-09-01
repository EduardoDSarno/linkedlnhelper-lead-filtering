import Fastify, { type FastifyInstance } from 'fastify';
import { processingPaths, saveOriginalCsv } from '../dataCollector/processing/processing.js';
import crypto from 'crypto';
import {
    dbGetEvaluationRunById,
    dbGetProcessingRunById,
    dbInsertProcessingRun,
    dbListProfiles,
    dbUpdateProcessingRun,
    openDatabase,
} from '../database/index.js';
import { MANUAL_DECISION, PROCESSING_STATUS } from '../database/types.js';
import type { ManualOverride } from '../database/types.js';
import { finalizeRun } from '../dataCollector/processing/finalize.js';
import { loadProfilesFromCsv } from '../dataCollector/csv/csvdata.js';
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
    registerDecisionsRoute(server);
    registerResultsRoute(server);
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
                ...(run.name ? { name: run.name } : {}),
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

/**
 * Parses the request's overrides array into typed manual decisions.
 *
 * Returns undefined when the value is not an array of well-formed entries, so
 * the route can reject the request instead of applying a partial review.
 */
function parseManualOverrides(value: unknown): ManualOverride[] | undefined
{
    if (!Array.isArray(value)) return undefined;

    const overrides: ManualOverride[] = [];
    for (const entry of value)
    {
        const record = asRecord(entry);
        if (!record) return undefined;

        const publicId = asString(record[API_FIELD.publicId]);
        const decision = asString(record[API_FIELD.decision]);
        const reason = asString(record[API_FIELD.reason]);
        if (!publicId) return undefined;
        if (decision !== MANUAL_DECISION.approved && decision !== MANUAL_DECISION.rejected) {
            return undefined;
        }

        overrides.push({ publicId, decision, ...(reason ? { reason } : {}) });
    }
    return overrides;
}

/** This function receives a server instance and it's responsible
 * for registering the decisions route for the API.
 * It applies human approved/rejected overrides to a completed run and
 * rebuilds both output artifacts from the retained original CSV.
*/
function registerDecisionsRoute(server: FastifyInstance)
{
    server.post(API_ROUTES.decisions, async (request, reply) =>
    {
        const params = asRecord(request.params);
        if (!params) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Invalid params' });

        const processingId = asString(params[API_FIELD.processingId]);
        if (!processingId) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Missing processingId' });

        const body = asRecord(request.body);
        if (!body) return reply.status(HTTP_STATUS.badRequest).send({ error: 'Invalid body' });

        const overrides = parseManualOverrides(body[API_FIELD.overrides]);
        if (!overrides) {
            return reply.status(HTTP_STATUS.badRequest).send({ error: 'Invalid overrides' });
        }

        const db = openDatabase();
        try
        {
            const run = dbGetProcessingRunById(processingId, db);
            if (!run) {
                return reply.status(HTTP_STATUS.notFound).send({ error: 'Processing run not found' });
            }
            // Decisions only make sense over a finished automatic review.
            if (run.status !== PROCESSING_STATUS.completed || !run.evaluationRunId) {
                return reply.status(HTTP_STATUS.conflict).send({ error: 'Processing run is not completed' });
            }

            const evaluationRun = dbGetEvaluationRunById(run.evaluationRunId, db);
            if (!evaluationRun) {
                return reply.status(HTTP_STATUS.internalError).send({ error: 'Evaluation results are missing' });
            }

            // The report join only needs the profiles that carry a Linked
            // Helper identity from this kind of import.
            const profiles = dbListProfiles(db).filter(
                (profile) => profile.linkedHelperPublicId,
            );

            const { finalApprovedCount } = await finalizeRun(
                processingPaths(processingId),
                evaluationRun,
                profiles,
                overrides,
            );

            // Each submission replaces the previous overrides entirely, and an
            // optional name persists a rename made during review.
            const renamed = asString(body[API_FIELD.name]);
            dbUpdateProcessingRun(
                {
                    ...run,
                    manualOverrides: overrides,
                    ...(renamed ? { name: renamed } : {}),
                },
                db,
            );

            return reply.status(HTTP_STATUS.ok).send({
                processingId,
                finalApprovedCount,
                overridesApplied: overrides.length,
            });
        }
        catch (error)
        {
            request.log.error({ err: error }, 'Applying decisions failed');
            return reply.status(HTTP_STATUS.internalError).send({ error: 'Failed to apply decisions' });
        }
        finally
        {
            db.close();
        }
    });
}

/** This function receives a server instance and it's responsible
 * for registering the results route for the API.
 * It returns the evaluation results as JSON so a review interface can list
 * every profile's decisions without parsing the report CSV.
*/
function registerResultsRoute(server: FastifyInstance)
{
    server.get(API_ROUTES.results, async (request, reply) =>
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
            if (!run.evaluationRunId) {
                return reply.status(HTTP_STATUS.conflict).send({ error: 'Results are not ready' });
            }

            const evaluationRun = dbGetEvaluationRunById(run.evaluationRunId, db);
            if (!evaluationRun) {
                return reply.status(HTTP_STATUS.internalError).send({ error: 'Evaluation results are missing' });
            }

            const profileByPublicId = new Map(
                dbListProfiles(db)
                    .filter((profile) => profile.linkedHelperPublicId)
                    .map((profile) => [profile.linkedHelperPublicId as string, profile]),
            );
            const modelByPublicId = new Map(
                evaluationRun.evaluation.modelEvaluation.evaluations
                    .filter((evaluation) => evaluation.linkedHelperPublicId)
                    .map((evaluation) => [evaluation.linkedHelperPublicId as string, evaluation]),
            );
            const overrideByPublicId = new Map(
                (run.manualOverrides ?? []).map((override) => [override.publicId, override]),
            );

            const results = evaluationRun.evaluation.broadFilter.evaluations.map((broad) =>
            {
                const publicId = broad.linkedHelperPublicId ?? '';
                const profile = profileByPublicId.get(publicId);
                const model = modelByPublicId.get(publicId);
                const override = overrideByPublicId.get(publicId);
                const currentRole = profile?.experience?.[0];

                return {
                    publicId,
                    name: [profile?.firstName, profile?.lastName].filter(Boolean).join(' '),
                    linkedinUrl: profile?.linkedinUrl ?? '',
                    broadDecision: broad.decision,
                    broadDecisionMessage: broad.decisionMessage,

                    // Presentation details the review list shows per row.
                    ...(profile?.headline ? { headline: profile.headline } : {}),
                    ...(currentRole?.position ? { position: currentRole.position } : {}),
                    ...(currentRole?.companyName ? { company: currentRole.companyName } : {}),
                    ...(profile?.location?.text ? { location: profile.location.text } : {}),
                    ...(profile?.photo ? { photo: profile.photo } : {}),
                    ...(profile?.imageAnalysis?.assessment?.apparentAge
                        ? { apparentAge: profile.imageAnalysis.assessment.apparentAge }
                        : {}),

                    ...(model
                        ? {
                            modelDecision: model.decision,
                            matchPercent: model.matchPercent,
                            reasons: model.reasons,
                            evidence: model.evidence,
                            uncertainties: model.uncertainties,
                            compensation: model.estimatedTotalMonthlyCompensation,
                            ...(model.compensationRangeMatch
                                ? { compensationMatch: model.compensationRangeMatch }
                                : {}),
                          }
                        : {}),
                    ...(override ? { override } : {}),
                };
            });

            return reply.status(HTTP_STATUS.ok).send({ processingId, results });
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

        // Check if the processing run exists and may be (re)started. Only a
        // queued run or a failed one being retried may start the pipeline.
        const db = openDatabase();
        try
        {
            const run = dbGetProcessingRunById(processingId, db);
            if (!run) {
                return reply.status(HTTP_STATUS.notFound).send({ error: 'Processing run not found' });
            }
            if (run.status === PROCESSING_STATUS.running) {
                return reply.status(HTTP_STATUS.conflict).send({ error: 'Processing run is already running' });
            }
            if (run.status === PROCESSING_STATUS.completed) {
                return reply.status(HTTP_STATUS.conflict).send({ error: 'Processing run is already completed; submit decisions instead' });
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
        const name = asString(body[API_FIELD.name]);

        void runPipeline(processingId, paths, validCriteria, request.log as Logger, name)
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

        // Parse a copy right away so the upload screen can report what the file
        // holds before the user commits to a paid evaluation run.
        let imported;
        try
        {
            imported = await loadProfilesFromCsv(originalPath);
        }
        catch (error)
        {
            request.log.error({ err: error }, 'Uploaded CSV could not be parsed');
            return reply.status(HTTP_STATUS.badRequest).send({ error: 'Could not parse the uploaded CSV' });
        }

        const db = openDatabase();
        try
        {
            dbInsertProcessingRun({
                id,
                status: PROCESSING_STATUS.queued,
                originalCsvPath: originalPath,
                createdAt: new Date().toISOString(),
            }, db);

            reply.status(HTTP_STATUS.created).send({
                processingId: id,
                totalRows: imported.total_rows,
                validProfiles: imported.total_profiles,
                duplicatedProfiles: imported.duplicated_profiles,

                // Rows the importer dropped because they carry no public_id.
                invalidProfiles:
                    imported.total_rows
                    - imported.total_profiles
                    - imported.duplicated_profiles,
            });
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

