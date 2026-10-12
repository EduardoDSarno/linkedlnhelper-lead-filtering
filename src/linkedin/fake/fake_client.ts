import type { FoundLead } from "../../db/leadsDb.js";
import type { LinkedinClient, SearchParameter, SearchParameterType } from "../client.js";

/** People a fake search returns in total, across all pages. */
const FAKE_SEARCH_TOTAL = 120;

/** People per page, matching LinkedIn's classic search page size. */
const FAKE_PAGE_SIZE = 10;

/** Prefix that marks a member id as generated, so it is never mistaken for a real one. */
const FAKE_MEMBER_PREFIX = "fake-member-";

/** Sample careers, mixed on purpose so evaluation sees clear fits and clear misfits. */
const CAREERS = [
  { role: "Financial Advisor", company: "XP Investimentos", industry: "Financial Services" },
  { role: "Insurance Broker", company: "Porto Seguro", industry: "Insurance" },
  { role: "Sales Manager", company: "Ambev", industry: "Food and Beverage" },
  { role: "Software Engineer", company: "Nubank", industry: "Technology" },
  { role: "Private Banker", company: "Itaú Unibanco", industry: "Banking" },
  { role: "High School Teacher", company: "Colégio Bandeirantes", industry: "Education" },
  { role: "Real Estate Agent", company: "Lopes Imobiliária", industry: "Real Estate" },
  { role: "Commercial Director", company: "Natura", industry: "Consumer Goods" },
] as const;

const FIRST_NAMES = ["Ana", "Bruno", "Carla", "Diego", "Elisa", "Felipe", "Gabriela", "Henrique", "Isabela", "João", "Larissa", "Marcos"];
const LAST_NAMES = ["Silva", "Santos", "Oliveira", "Souza", "Lima", "Pereira", "Costa", "Almeida", "Ferreira", "Rodrigues"];
const CITIES = ["São Paulo", "Rio de Janeiro", "Belo Horizonte", "Curitiba", "Porto Alegre"];
const SCHOOLS = ["Universidade de São Paulo", "FGV", "Insper", "PUC-Rio", "Unicamp"];

/** Sample filter choices, with made-up numeric ids shaped like LinkedIn's. */
const PARAMETERS: Record<SearchParameterType, SearchParameter[]> = {
  LOCATION: CITIES.map((title, index) => ({ id: String(100 + index), title: `${title}, Brazil` })),
  INDUSTRY: [...new Set(CAREERS.map((career) => career.industry))].map((title, index) => ({
    id: String(200 + index),
    title,
  })),
  COMPANY: CAREERS.map((career, index) => ({ id: String(300 + index), title: career.company })),
  SCHOOL: SCHOOLS.map((title, index) => ({ id: String(400 + index), title })),
};

/**
 * A LinkedIn that never leaves this process: searches page through generated
 * people, profiles are built from the same person, and invites are only kept
 * in memory.
 *
 * Replies use Unipile's shapes, so the code that reads real profiles is
 * exercised by fake ones too. The same index always yields the same person,
 * so repeated searches behave like LinkedIn: same people, deduplicated by id.
 */
export function createFakeLinkedinClient(): LinkedinClient & { invitesSent: string[] } {
  const invitesSent: string[] = [];

  return {
    mode: "fake",
    invitesSent,

    async searchPeople(_accountId, _search, cursor) {
      const start = cursor ? Number(cursor) : 0;
      const end = Math.min(start + FAKE_PAGE_SIZE, FAKE_SEARCH_TOTAL);
      const people: FoundLead[] = [];
      for (let index = start; index < end; index++) people.push(fakeSearchCard(index));
      return { people, cursor: end < FAKE_SEARCH_TOTAL ? String(end) : null };
    },

    async searchParameters(_accountId, type, keywords) {
      const wanted = keywords.trim().toLowerCase();
      return PARAMETERS[type].filter((choice) => choice.title.toLowerCase().includes(wanted));
    },

    async getProfile(_accountId, memberId) {
      return fakeProfile(fakeIndex(memberId));
    },

    async sendInvite(_accountId, memberId) {
      invitesSent.push(memberId);
    },
  };
}

/** The search card for generated person number `index`. */
function fakeSearchCard(index: number): FoundLead {
  const person = fakePerson(index);
  return {
    linkedinMemberId: `${FAKE_MEMBER_PREFIX}${index}`,
    name: `${person.firstName} ${person.lastName}`,
    headline: `${person.career.role} at ${person.career.company}`,
    location: `${person.city}, Brazil`,
    industry: person.career.industry,
    currentPositions: [
      { company: person.career.company, role: person.career.role, location: person.city, description: null },
    ],
    premium: index % 4 === 0,
    openProfile: index % 7 === 0,
  };
}

/** The full profile for person number `index`, in Unipile's `UserProfile` shape. */
function fakeProfile(index: number): Record<string, unknown> {
  const person = fakePerson(index);
  const previous = CAREERS[(index + 3) % CAREERS.length]!;
  const currentStartYear = 2015 + (index % 8);
  const graduationYear = currentStartYear - 2 - (index % 10);

  return {
    object: "UserProfile",
    provider: "LINKEDIN",
    provider_id: `${FAKE_MEMBER_PREFIX}${index}`,
    public_identifier: `${person.firstName}-${person.lastName}-${index}`.toLowerCase(),
    first_name: person.firstName,
    last_name: person.lastName,
    headline: `${person.career.role} at ${person.career.company}`,
    summary: `${person.career.role} focused on long-term client relationships in ${person.city}.`,
    location: `${person.city}, Brazil`,
    is_premium: index % 4 === 0,
    is_open_to_work: index % 5 === 0,
    network_distance: "DISTANCE_2",
    connections_count: 150 + index * 7,
    profile_picture_url: null,
    work_experience: [
      {
        position: person.career.role,
        company: person.career.company,
        industry: person.career.industry,
        location: person.city,
        description: `Responsible for a portfolio of clients at ${person.career.company}.`,
        current: true,
        start: `1/${currentStartYear}`,
        end: null,
      },
      {
        position: previous.role,
        company: previous.company,
        industry: previous.industry,
        location: person.city,
        description: null,
        current: false,
        start: `1/${graduationYear + 1}`,
        end: `12/${currentStartYear - 1}`,
      },
    ],
    education: [
      {
        school: SCHOOLS[index % SCHOOLS.length],
        degree: "Bachelor's degree",
        field_of_study: index % 2 === 0 ? "Business Administration" : "Economics",
        start: `1/${graduationYear - 4}`,
        end: `12/${graduationYear}`,
      },
    ],
    skills: [{ name: "Negotiation" }, { name: "Client Relationship Management" }],
    languages: [{ name: "Portuguese", proficiency: "NATIVE_OR_BILINGUAL" }],
  };
}

/** The fixed traits of generated person number `index`. */
function fakePerson(index: number) {
  return {
    firstName: FIRST_NAMES[index % FIRST_NAMES.length]!,
    lastName: LAST_NAMES[(index * 3) % LAST_NAMES.length]!,
    city: CITIES[index % CITIES.length]!,
    career: CAREERS[index % CAREERS.length]!,
  };
}

/**
 * The index inside a generated member id.
 *
 * @throws When the id was not produced by this fake, which means real and fake data got mixed.
 */
function fakeIndex(memberId: string): number {
  const index = Number(memberId.slice(FAKE_MEMBER_PREFIX.length));
  if (!memberId.startsWith(FAKE_MEMBER_PREFIX) || !Number.isInteger(index)) {
    throw new Error(`Fake LinkedIn cannot load ${memberId}: it is not a fake member id.`);
  }
  return index;
}
