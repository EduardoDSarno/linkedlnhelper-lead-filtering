import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeLinkedinUrl } from '../index.js';

const INTERNATIONAL_PROFILE_SLUGS = [
  'md-ßâžžâđ-b173a1427',
  'joão-leite-20415836',
  'alain-dugué-7a4877382',
  'grégoire-braux-57a58b182',
  'césar-arellanes-prosci®-8a4aa6a2',
  'melanie-muñoz-rendon-490342213',
  'nur-gök-133999426',
  'doğa-nur-yeşiltaş-900606428',
  'hikmet-arıkan-5a4050425',
  'yavuz-aydın-3b3776428',
  'mehmet-fırat-undefined-8a7283424',
  'beatriz-bolaños-manssur-99742633a',
  'laura-belén-romero-787361423',
  'graciela-millán-2632801a',
  'orlando-josé-peña-soto-7b1117428',
  'richard-alexander-peña-a71799426',
  'darwin-rafael-rodríguez-940a46330',
  'débora-felippe-guirelli-771996303',
  'risto-sipilä-6a188362',
  'risto-pitkänen-a135614a',
  'irma-jääskeläinen-25591885',
  '思桐-龚-01519a290',
  'daša-humeníková-138b9a9',
  'lukáš-nemergut-660a6b9a',
  'dávid-leško-04972371',
  'maria-mączewska-bb28b0424',
  'magda-ryś-226398426',
  'บุญ-สวัสดิ์ชัย-b625a437',
  'อังคาร-ดวงปัญญา-09b6a5411',
  'มีอ๊ะ-นิยมเดชา-8a7938415',
  '敬畲-蔣-2775b3429',
  'عبدالمالك-النصيري-2373aa428',
  'gonzalo-borredà-88a4221a4',
  'juan-garcia-gutiérrez-15ba41426',
  'byron-gonzález-castañeda-760471426',
  'hüseyin-lakşe-4a341b423',
  'aybars-yılmaz-092a30422',
  'ناجي-محمد-49b652425',
  'ömer-şahin-0a3688423',
  'natália-cristina-moreira-5b8838239',
  'jörg-redeker-65b36b373',
  'bárbara-damazio-dias-aabb06205',
  '海云-周-282384368',
  'anita-pérez-100a59342',
  'sandra-cañuta-b4b127314',
  'diana-lópez-banda-594369423',
  'esteban-nuñez-b60634423',
  'telesforo-peñafiel-santillan-389759152',
  'fernando-hildeberto-ramírez-gonzález-aab82a426',
] as const;

test('canonicalizes encoded and decoded international benchmark URLs', () => {
  for (const slug of INTERNATIONAL_PROFILE_SLUGS) {
    const decodedUrl = `https://www.linkedin.com/in/${slug}`;
    const encodedUrl = encodeURI(decodedUrl);

    assert.equal(
      normalizeLinkedinUrl(encodedUrl),
      normalizeLinkedinUrl(decodedUrl),
      slug,
    );
  }
});

test('collapses cosmetic LinkedIn URL variants without shortening the slug', () => {
  const expected = 'https://www.linkedin.com/in/jane-doe-123';
  const variants = [
    ' https://www.linkedin.com/in/JANE-DOE-123/ ',
    'https://br.linkedin.com/in/jane-doe-123?trk=search',
    'https://LINKEDIN.com/IN/jane-doe-123/#profile',
  ];

  for (const variant of variants) {
    assert.equal(normalizeLinkedinUrl(variant), expected);
  }
});

test('normalizes composed and decomposed Unicode slugs identically', () => {
  const composed = 'https://linkedin.com/in/josé-silva';
  const decomposed = 'https://linkedin.com/in/jose\u0301-silva';

  assert.equal(normalizeLinkedinUrl(composed), normalizeLinkedinUrl(decomposed));
});

test('keeps different complete LinkedIn slugs distinct', () => {
  assert.notEqual(
    normalizeLinkedinUrl('https://linkedin.com/in/jane-doe-123'),
    normalizeLinkedinUrl('https://linkedin.com/in/jane-doe-456'),
  );
});

test('keeps malformed URL escapes deterministic and non-throwing', () => {
  const malformedUrl = 'https://linkedin.com/in/profile-%E0%A4%A';

  assert.doesNotThrow(() => normalizeLinkedinUrl(malformedUrl));
  assert.equal(normalizeLinkedinUrl(malformedUrl), normalizeLinkedinUrl(malformedUrl));
});
