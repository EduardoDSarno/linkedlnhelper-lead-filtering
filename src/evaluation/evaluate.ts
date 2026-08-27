import type { GoogleGenAI } from "@google/genai";
import type { EvaluationBatchContext, EvaluationProfileData } from "./context.js";
import { evaluateBroadCriteria, filterEvaluationBatch } from "./filters/broad_filter.js";


// export function evaluateProfile(context: EvaluationBatchContext): EvaluationProfileData 
// {

//     const filtered_evaluation = filterEvaluationBatch(context);
    
//     const alreadyEvaluated = filtered_evaluation.evaluations;
//     const remainingProfiles = filtered_evaluation.profilesForAi;

//     const evaluations = [];

//     while (remainingProfiles.length > 0) {
//         const profile = remainingProfiles.shift();
//         const evaluation = evaluateBroadCriteria(profile, context.criteria);
//         evaluations.push(evaluation);
//     }

//     return evaluations;
// }

// export function runModelEvaluationBatch(profiles: readonly EvaluationProfileData[],
//     batchSize: number,
//     client: GoogleGenAI,
// ): ProfileBroadEvaluation[] {