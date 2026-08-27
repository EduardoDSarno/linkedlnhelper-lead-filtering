import assert from 'node:assert/strict';
import test from 'node:test';

import { createEvaluationContext } from '../context.js';
import type { FullEvaluationCriteria } from '../criterias/index.js';
import type { FullProfile } from '../../profile/index.js';

test('builds a compact AI evaluation payload without exposing the raw profile', () => {
  const criteria: FullEvaluationCriteria = {
    openToWork: false,
    systemPrompt: 'Evaluate the profile using the selected criteria.',
    userPrompt: 'Prioritize evidence from the professional trajectory.',
  };
  const fullProfile: FullProfile = {
    id: 'profile-1',
    linkedinUrl: 'https://www.linkedin.com/in/example-profile',
    headline: 'Customer Success Manager',
    openToWork: false,
    location: {
      text: 'Goiânia, Goiás, Brasil',
      city: 'Goiânia',
      state: 'Goiás',
      country: 'Brasil',
    },
    experience: [
      {
        position: 'Customer Success Manager',
        companyName: 'Example Company',
        location: 'Goiânia, Goiás, Brasil',
        startDate: { year: 2024, month: 3 },
      },
    ],
    education: [
      {
        schoolName: 'Example University',
        degree: 'Bachelor of Business Administration',
        fieldOfStudy: 'Business Administration',
        startDate: { year: 2017 },
        endDate: { year: 2021 },
      },
    ],
    raw: {
      about: 'Builds long-term customer relationships.',
      emails: ['private@example.test'],
      experience: [
        {
          position: 'Customer Success Manager',
          companyName: 'Example Company',
          description: 'Leads onboarding and retention programs.',
          employmentType: 'Full-time',
          workplaceType: 'Remote',
          skills: ['Customer Success'],
        },
      ],
    },
    imageAnalysis: {
      assessment: {
        hasFace: true,
        faceCount: 1,
        faceVisibility: 'clear',
        imageQuality: 'good',
        isBlurry: false,
        isPoorlyLit: false,
        photoType: 'professional_portrait',
        framing: 'headshot',
        background: 'plain',
        attire: 'business_casual',
        apparentAge: { bracket: '25_34', confidence: 'medium' },
        certainty: 'certain',
        reviewRequired: false,
        observations: [],
      },
      model: 'test-model',
      resolution: 'medium',
    },
  };

  const context = createEvaluationContext(fullProfile, criteria);
  const imageAnalysis = fullProfile.imageAnalysis;

  assert.ok(imageAnalysis);

  assert.equal(context.criteria, criteria);
  assert.deepEqual(context.profile, {
    profileId: 'profile-1',
    headline: 'Customer Success Manager',
    location: fullProfile.location,
    openToWork: false,
    hasPhoto: false,
    experience: fullProfile.experience,
    education: fullProfile.education,
    imageAnalysis: imageAnalysis.assessment,
    about: 'Builds long-term customer relationships.',
    workDetails: [
      {
        position: 'Customer Success Manager',
        companyName: 'Example Company',
        description: 'Leads onboarding and retention programs.',
        employmentType: 'Full-time',
        workplaceType: 'Remote',
      },
    ],
  });
  assert.equal('raw' in context.profile, false);
  assert.equal('emails' in context.profile, false);
  assert.equal(context.profile.experience, fullProfile.experience);
  assert.equal(context.profile.education, fullProfile.education);
});
