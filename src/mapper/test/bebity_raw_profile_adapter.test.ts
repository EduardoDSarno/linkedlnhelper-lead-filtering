import assert from 'node:assert/strict';
import test from 'node:test';

import { mapApifyProfile } from '../apify_profile_mapper.js';
import { adaptBebityRawProfile } from '../bebity_raw_profile_adapter.js';
import { buildCareerTimeline } from '../../evaluation/career_timeline.js';

// A trimmed version of a real Bebity dataset record (arietamelo), captured
// during the live Bebity/Harvest comparison benchmark.
const BEBITY_RAW_PROFILE = {
  vanityName: 'arietamelo',
  firstName: 'ARIETA',
  lastName: 'MELO',
  headline: 'CPA-20 | Gerente de Relacionamento PF/PJ',
  location: 'Goiânia, Goiás, Brazil',
  summary: 'Profissional do mercado financeiro, atuando em instituições...',
  profilePictureUrl: 'https://media.licdn.com/dms/image/v2/example.jpg',
  connectionsCount: 500,
  followersCount: 846,
  experience: [
    {
      title: 'Especialista Santander',
      companyName: 'Santander',
      employmentType: 'Full-time',
      startDate: 'Aug 2024',
      endDate: 'Present',
      duration: '1 yr 2 mos',
      location: 'Goiânia, Goiás, Brazil',
      description: 'Atuo como Especialista de Negócios.',
    },
  ],
  education: [
    {
      schoolName: 'FGV - Fundação Getulio Vargas',
      degreeName: 'Master of Business Administration',
      fieldOfStudy: 'MBA, Gestão Empresarial',
      startDate: 'Jan 2020',
      endDate: 'Feb 2022',
    },
  ],
  linkedinUrl: 'https://www.linkedin.com/in/arietamelo',
  status: 'FOUND',
};

test('renames the bio, photo, and experience/education fields Harvest uses', () => {
  const adapted = adaptBebityRawProfile(BEBITY_RAW_PROFILE);

  assert.equal(adapted['about'], BEBITY_RAW_PROFILE.summary);
  assert.equal(adapted['photo'], BEBITY_RAW_PROFILE.profilePictureUrl);
  assert.equal(adapted['summary'], undefined);
  assert.equal(adapted['profilePictureUrl'], undefined);

  const [experience] = adapted['experience'] as Record<string, unknown>[];
  assert.equal(experience?.['position'], 'Especialista Santander');
  assert.equal(experience?.['title'], undefined);
  assert.deepEqual(experience?.['startDate'], { year: 2024, month: 8, text: 'Aug 2024' });
  assert.deepEqual(experience?.['endDate'], { text: 'Present' });
  assert.equal(experience?.['companyName'], 'Santander');
  assert.equal(experience?.['employmentType'], 'Full-time');

  const [education] = adapted['education'] as Record<string, unknown>[];
  assert.equal(education?.['degree'], 'Master of Business Administration');
  assert.equal(education?.['degreeName'], undefined);
  assert.equal(education?.['schoolName'], 'FGV - Fundação Getulio Vargas');
});

test('parses a recognized Brazilian state out of the flat location string', () => {
  const adapted = adaptBebityRawProfile(BEBITY_RAW_PROFILE);
  const location = adapted['location'] as Record<string, unknown>;
  const parsed = location['parsed'] as Record<string, unknown>;

  assert.equal(location['linkedinText'], 'Goiânia, Goiás, Brazil');
  assert.equal(parsed['city'], 'Goiânia');
  assert.equal(parsed['state'], 'Goiás');
  assert.equal(parsed['countryCode'], 'BR');
});

test('parses the state regardless of what language the country word is localized to', () => {
  // Both observed live: Bebity does not always render the country word as
  // "Brasil"/"Brazil" — it can come back in whatever locale scraped the
  // profile. A country-word allowlist would miss these; matching on the
  // state segment itself does not care what language surrounds it.
  for (const localizedLocation of [
    'Goiânia, Goiás, Brésil',
    'Goiânia, Goiás, Brezilya',
  ]) {
    const adapted = adaptBebityRawProfile({
      ...BEBITY_RAW_PROFILE,
      location: localizedLocation,
    });
    const location = adapted['location'] as Record<string, unknown>;
    const parsed = location['parsed'] as Record<string, unknown>;

    assert.equal(parsed['city'], 'Goiânia', localizedLocation);
    assert.equal(parsed['state'], 'Goiás', localizedLocation);
  }
});

test('keeps the full text without inventing city/state for an unrecognized location', () => {
  const adapted = adaptBebityRawProfile({
    ...BEBITY_RAW_PROFILE,
    location: 'Zurich, Switzerland',
  });
  const location = adapted['location'] as Record<string, unknown>;
  const parsed = location['parsed'] as Record<string, unknown>;

  assert.equal(location['linkedinText'], 'Zurich, Switzerland');
  assert.equal(parsed['text'], 'Zurich, Switzerland');
  assert.equal(parsed['city'], undefined);
  assert.equal(parsed['state'], undefined);
});

/** Adapts one Bebity education entry and returns it as a plain record. */
function adaptedEducationEntry(
  education: Record<string, unknown>,
): Record<string, unknown> {
  const raw = {
    linkedinUrl: 'https://www.linkedin.com/in/example',
    education: [{ schoolName: 'Example University', ...education }],
  };
  const adapted = adaptBebityRawProfile(raw) as {
    education: Record<string, unknown>[];
  };
  return adapted.education[0] ?? {};
}

test('splits a glued degree into degree and field of study on the first comma', () => {
  const entry = adaptedEducationEntry({ degreeName: 'Bacharelado, Economics' });

  assert.deepEqual(entry, {
    schoolName: 'Example University',
    degree: 'Bacharelado',
    fieldOfStudy: 'Economics',
  });
});

test('keeps a taxonomy label with its own internal comma whole in field of study', () => {
  // LinkedIn's own field-of-study entries can contain a comma
  // ("Business Administration and Management, General"), so only the first
  // comma in degreeName is the real split point — not every comma in it.
  const entry = adaptedEducationEntry({
    degreeName: 'Adm de Empresas, Business Administration and Management, General',
  });

  assert.equal(entry['degree'], 'Adm de Empresas');
  assert.equal(
    entry['fieldOfStudy'],
    'Business Administration and Management, General',
  );
});

test('does not split degreeName when Bebity already supplied a field of study', () => {
  // A comma here is a compound degree title, not this concatenation — Bebity
  // proved it can report the two fields apart, so trust it when it does.
  const entry = adaptedEducationEntry({
    degreeName: 'Mestrado em Comunicação, Mídia e Cidadania',
    fieldOfStudy: 'Communication and Media Studies',
  });

  assert.equal(entry['degree'], 'Mestrado em Comunicação, Mídia e Cidadania');
  assert.equal(entry['fieldOfStudy'], 'Communication and Media Studies');
});

test('leaves a degree with no comma untouched', () => {
  const entry = adaptedEducationEntry({ degreeName: 'Bacharelado' });

  assert.deepEqual(entry, {
    schoolName: 'Example University',
    degree: 'Bacharelado',
  });
});

test('does not split free-text prose that happens to contain a comma', () => {
  // A real profile (pamellaborges): degreeName here is a training-program
  // description, not a "degree, field" pair. Splitting it on the first comma
  // would cut a sentence in half instead of separating anything meaningful.
  const prose =
    'Programa focado no desenvolvimento de liderança estratégica e gestão de pessoas, ' +
    'com ênfase em tomada de decisão, negociação, gestão de conflitos, coaching e mentoring.';
  const entry = adaptedEducationEntry({ degreeName: prose });

  assert.deepEqual(entry, { schoolName: 'Example University', degree: prose });
});

test('passes through fields with no Harvest equivalent instead of dropping them', () => {
  const adapted = adaptBebityRawProfile(BEBITY_RAW_PROFILE);

  assert.equal(adapted['connectionsCount'], 500);
  assert.equal(adapted['followersCount'], 846);
  assert.equal(adapted['vanityName'], 'arietamelo');
  assert.equal(adapted['status'], 'FOUND');
});

test('the adapted record maps into a fully populated Profile', () => {
  const profile = mapApifyProfile(adaptBebityRawProfile(BEBITY_RAW_PROFILE));

  assert.equal(profile.firstName, 'ARIETA');
  assert.equal(profile.photo, BEBITY_RAW_PROFILE.profilePictureUrl);
  assert.equal(profile.location?.city, 'Goiânia');
  assert.equal(profile.location?.state, 'Goiás');
  assert.equal(profile.experience.length, 1);
  assert.equal(profile.experience[0]?.position, 'Especialista Santander');
  assert.equal(profile.experience[0]?.companyName, 'Santander');
  assert.equal(profile.education.length, 1);
  assert.equal(profile.education[0]?.degree, 'Master of Business Administration');
});

test('reads a year and month out of every date shape Bebity sends', () => {
  const raw = {
    ...BEBITY_RAW_PROFILE,
    experience: [
      // "Mon YYYY" and a bare "YYYY" are 89% of the dates in stored data.
      { title: 'A', companyName: 'A', startDate: 'Mar 2024', endDate: 'Present' },
      { title: 'B', companyName: 'B', startDate: '2011', endDate: '2014' },
      // A month name mapDate spells out rather than abbreviates.
      { title: 'C', companyName: 'C', startDate: 'September 2018' },
    ],
  };

  const profile = mapApifyProfile(adaptBebityRawProfile(raw));

  assert.deepEqual(profile.experience[0]?.startDate, {
    year: 2024,
    month: 3,
    text: 'Mar 2024',
  });
  assert.deepEqual(profile.experience[0]?.endDate, { text: 'Present' });
  assert.deepEqual(profile.experience[1]?.startDate, { year: 2011, text: '2011' });
  assert.deepEqual(profile.experience[2]?.startDate, {
    year: 2018,
    month: 9,
    text: 'September 2018',
  });
});

test('keeps the year when the month name is in an unknown language', () => {
  // Bebity's scrapers run under whatever locale they were assigned, and that
  // locale already leaks into other display text it returns. The year is what
  // age reasoning needs, so it must survive a month word we cannot read.
  const raw = {
    ...BEBITY_RAW_PROFILE,
    education: [{ schoolName: 'X', degreeName: 'Y', startDate: 'márc 1994' }],
  };

  const profile = mapApifyProfile(adaptBebityRawProfile(raw));

  assert.deepEqual(profile.education[0]?.startDate, {
    year: 1994,
    text: 'márc 1994',
  });
});

test('ignores a four-digit number that cannot be a year', () => {
  const raw = {
    ...BEBITY_RAW_PROFILE,
    experience: [
      { title: 'A', companyName: 'A', startDate: 'Turma 1042' },
      { title: 'B', companyName: 'B', startDate: 'Grade: MBA' },
    ],
  };

  const profile = mapApifyProfile(adaptBebityRawProfile(raw));

  assert.deepEqual(profile.experience[0]?.startDate, { text: 'Turma 1042' });
  assert.deepEqual(profile.experience[1]?.startDate, { text: 'Grade: MBA' });
});

test('gives buildCareerTimeline the anchors it reads the age from', () => {
  const raw = {
    ...BEBITY_RAW_PROFILE,
    experience: [
      { title: 'Analista', companyName: 'A', startDate: 'Feb 1998', endDate: 'Present' },
    ],
    education: [
      { schoolName: 'Universidade de Fortaleza', degreeName: 'Bacharelado, Informática', startDate: '1994', endDate: '1998' },
      { schoolName: 'FGV', degreeName: 'MBA, Gestão Empresarial', startDate: 'Jan 2009' },
    ],
  };

  const profile = mapApifyProfile(adaptBebityRawProfile(raw));
  const timeline = buildCareerTimeline(profile.experience, profile.education);

  assert.equal(timeline.firstAcademicYear, 1994);
  assert.equal(timeline.firstProfessionalYear, 1998);
  assert.equal(timeline.academicEntries[0]?.startYear, 1994);
});
