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

test('reports an open role as currently employed, with no gap to measure', () => {
  const timeline = buildCareerTimeline(
    [
      { position: 'Gerente', companyName: 'A', startDate: { year: 2023, month: 6 }, endDate: { text: 'Present' } },
      { position: 'Analista', companyName: 'B', startDate: { year: 2019 }, endDate: { year: 2023, month: 5 } },
    ],
    [],
    new Date('2026-09-11T00:00:00Z'),
  );

  assert.equal(timeline.isCurrentlyEmployed, true);
  assert.equal(timeline.monthsSinceLastRole, undefined);
});

test('treats a role with no end date as still open', () => {
  const timeline = buildCareerTimeline(
    [{ position: 'Sócio', companyName: 'A', startDate: { year: 2021 } }],
    [],
    new Date('2026-09-11T00:00:00Z'),
  );

  assert.equal(timeline.isCurrentlyEmployed, true);
});

test('measures the gap from the most recent ending, not the last listed role', () => {
  // Providers do not always return roles newest-first, so the gap has to come
  // from the maximum end date rather than from position in the array.
  const timeline = buildCareerTimeline(
    [
      { position: 'Antigo', companyName: 'A', startDate: { year: 2009 }, endDate: { year: 2012, month: 3 } },
      { position: 'Recente', companyName: 'B', startDate: { year: 2024, month: 4 }, endDate: { year: 2024, month: 9 } },
    ],
    [],
    new Date('2026-09-11T00:00:00Z'),
  );

  assert.equal(timeline.isCurrentlyEmployed, false);
  assert.equal(timeline.monthsSinceLastRole, 24);
});

test('leaves the gap unknown when no ended role carries a year', () => {
  const timeline = buildCareerTimeline(
    [{ position: 'Consultor', companyName: 'A', endDate: { text: 'alguns anos' } }],
    [],
    new Date('2026-09-11T00:00:00Z'),
  );

  assert.equal(timeline.isCurrentlyEmployed, false);
  assert.equal(timeline.monthsSinceLastRole, undefined);
});

test('says nothing about employment when no roles are listed', () => {
  // An empty history is not evidence of being out of work.
  const timeline = buildCareerTimeline([], [], new Date('2026-09-11T00:00:00Z'));

  assert.equal(timeline.isCurrentlyEmployed, undefined);
  assert.equal(timeline.monthsSinceLastRole, undefined);
});

test('does not read a post-dated role as time out of work', () => {
  const timeline = buildCareerTimeline(
    [{ position: 'Gerente', companyName: 'A', startDate: { year: 2024 }, endDate: { year: 2027, month: 4 } }],
    [],
    new Date('2026-09-11T00:00:00Z'),
  );

  assert.equal(timeline.monthsSinceLastRole, 0);
});
