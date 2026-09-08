import assert from 'node:assert/strict';
import test from 'node:test';

import { buildCareerTimeline } from '../career_timeline.js';

const NOW = new Date('2026-06-01T00:00:00.000Z');

test('takes the oldest higher-education year, not the first listed entry', () => {
  // Providers return education newest-first, so the MBA leads the array.
  const timeline = buildCareerTimeline(
    [],
    [
      { schoolName: 'FGV', degree: 'MBA', startDate: { year: 2015 } },
      {
        schoolName: 'Universidade Federal de Goiás',
        degree: 'Bacharelado em Administração',
        startDate: { year: 1999 },
      },
    ],
    NOW,
  );

  assert.equal(timeline.firstAcademicYear, 1999);
  assert.deepEqual(
    timeline.academicEntries.map((entry) => entry.startYear),
    [1999, 2015],
  );
});

test('ignores secondary and technical study when anchoring the first degree', () => {
  const timeline = buildCareerTimeline(
    [],
    [
      { schoolName: 'Colégio Estadual', degree: 'Ensino Médio', startDate: { year: 1994 } },
      { schoolName: 'SENAI', degree: 'Curso Técnico em Eletrônica', startDate: { year: 1996 } },
      { schoolName: 'PUC', degree: 'Bacharelado', startDate: { year: 2003 } },
    ],
    NOW,
  );

  assert.equal(timeline.firstAcademicYear, 2003);
  assert.deepEqual(
    timeline.academicEntries.map((entry) => entry.schoolName),
    ['PUC'],
  );
});

test('falls back to the end year when a course has no start year', () => {
  const timeline = buildCareerTimeline(
    [],
    [{ schoolName: 'UFG', degree: 'Bacharelado', endDate: { year: 2010 } }],
    NOW,
  );

  assert.equal(timeline.firstAcademicYear, 2010);
});

test('derives professional anchors from the earliest role', () => {
  const timeline = buildCareerTimeline(
    [
      { position: 'Gerente', companyName: 'B', startDate: { year: 2018 } },
      { position: 'Analista', companyName: 'A', startDate: { year: 2006 } },
    ],
    [],
    NOW,
  );

  assert.equal(timeline.firstProfessionalYear, 2006);
  assert.equal(timeline.yearsOfExperience, 20);
});

test('leaves anchors absent rather than guessing when no dates exist', () => {
  const timeline = buildCareerTimeline(
    [{ position: 'Analista', companyName: 'A' }],
    [{ schoolName: 'UFG', degree: 'Bacharelado' }],
    NOW,
  );

  assert.equal(timeline.firstAcademicYear, undefined);
  assert.equal(timeline.firstProfessionalYear, undefined);
  assert.equal(timeline.yearsOfExperience, undefined);
  assert.equal(timeline.academicEntries.length, 1);
});
