import assert from 'node:assert/strict';
import test from 'node:test';

import { locationTextMatches } from '../filters/brazil_location.js';
import {
  BROAD_DECISION,
  BROAD_OUTCOME,
  CRITERIA_MATCH,
  evaluateBroadCriteria,
} from '../filters/broad_filter.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { EvaluationProfileData } from '../context.js';

/** Creates the required prompts for a small criteria fixture. */
function prompts(): Pick<FullEvaluationCriteria, 'systemPrompt' | 'userPrompt'> {
  return {
    systemPrompt: 'Evaluate the profile using the selected criteria.',
    userPrompt: 'Return a structured evaluation.',
  };
}

/** Builds compact profile data with only the location text the UI compares. */
function profileWithText(text: string): EvaluationProfileData {
  return {
    profileId: 'profile-1',
    hasPhoto: true,
    location: { text },
    experience: [],
    education: [],
  };
}

test('city UF chips match LinkedIn full-state, metro, and city-only text', () => {
  const configured = 'Florianópolis, SC';

  assert.equal(
    locationTextMatches('Florianópolis, Santa Catarina, Brasil', configured),
    true,
  );
  assert.equal(locationTextMatches('Florianópolis, SC', configured), true);
  assert.equal(locationTextMatches('Florianópolis e Região', configured), true);
  assert.equal(locationTextMatches('Florianópolis', configured), true);
  assert.equal(locationTextMatches('Greater Florianópolis', configured), true);
  assert.equal(locationTextMatches('Santa Catarina, Brasil', configured), false);
  assert.equal(
    locationTextMatches('Joinville, Santa Catarina, Brasil', configured),
    false,
  );
});

test('state names match the UF token without treating the letters as a substring', () => {
  assert.equal(
    locationTextMatches('Florianópolis, SC', 'Santa Catarina'),
    true,
  );
  assert.equal(
    locationTextMatches('Florianópolis, Santa Catarina, Brasil', 'Santa Catarina'),
    true,
  );
  assert.equal(locationTextMatches('Santa Catarina, Brasil', 'Santa Catarina'), true);
  assert.equal(locationTextMatches('Florianópolis e Região', 'Santa Catarina'), false);
});

test('a capital chip does not keep every city in that state', () => {
  const configured = 'São Paulo, SP';

  assert.equal(
    locationTextMatches('São Paulo, São Paulo, Brasil', configured),
    true,
  );
  assert.equal(locationTextMatches('São Paulo, SP', configured), true);
  assert.equal(locationTextMatches('São Paulo e Região', configured), true);
  assert.equal(
    locationTextMatches('Campinas, São Paulo, Brasil', configured),
    false,
  );
});

test('a city chip does not match a longer city that only shares a prefix', () => {
  assert.equal(
    locationTextMatches('São José dos Campos, SP', 'São José, SC'),
    false,
  );
  assert.equal(locationTextMatches('São José, SC', 'São José, SC'), true);
});

test('the UI text field keeps Florianópolis variants for a city or state chip', () => {
  const cityCriteria: FullEvaluationCriteria = {
    location: {
      locations: ['Florianópolis, SC'],
      fields: ['text'],
      match: CRITERIA_MATCH.any,
    },
    ...prompts(),
  };
  const stateCriteria: FullEvaluationCriteria = {
    location: {
      locations: ['Santa Catarina'],
      fields: ['text'],
      match: CRITERIA_MATCH.any,
    },
    ...prompts(),
  };

  const cityEvaluation = evaluateBroadCriteria(
    profileWithText('Florianópolis, Santa Catarina, Brasil'),
    cityCriteria,
  );
  const metroEvaluation = evaluateBroadCriteria(
    profileWithText('Florianópolis e Região'),
    cityCriteria,
  );
  const stateEvaluation = evaluateBroadCriteria(
    profileWithText('Florianópolis, SC'),
    stateCriteria,
  );

  assert.equal(cityEvaluation.decision, BROAD_DECISION.NextPhase);
  assert.equal(cityEvaluation.results[0]?.outcome, BROAD_OUTCOME.matched);
  assert.equal(metroEvaluation.results[0]?.outcome, BROAD_OUTCOME.matched);
  assert.equal(stateEvaluation.results[0]?.outcome, BROAD_OUTCOME.matched);
});
