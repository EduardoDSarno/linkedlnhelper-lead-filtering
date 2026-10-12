import { useEffect, useState } from "react";
import type { FormEvent, ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api";
import type { LinkedinAccount, PeopleSearch, SearchParameter } from "../api";
import { ParameterPicker } from "../components/ParameterPicker";

/** Profile languages offered in the form, as LinkedIn's two-letter codes. */
const LANGUAGES = [
  { code: "pt", label: "Portuguese" },
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
];

/** Connection degrees, as LinkedIn's search names them. */
const DEGREES = [
  { value: 1, label: "1st" },
  { value: 2, label: "2nd" },
  { value: 3, label: "3rd+" },
];

/** Everything the form holds; picked filters keep their titles for the review page. */
interface CampaignForm {
  accountId: string;
  name: string;
  keywords: string;
  title: string;
  company: string;
  school: string;
  locations: SearchParameter[];
  industries: SearchParameter[];
  companies: SearchParameter[];
  pastCompanies: SearchParameter[];
  schools: SearchParameter[];
  networkDistance: number[];
  languages: string[];
  prompt: string;
  approvedTarget: string;
  approvalThreshold: string;
  reviewThreshold: string;
  weeklyInviteLimit: string;
  dailyProfileLimit: string;
}

const EMPTY_FORM: CampaignForm = {
  accountId: "",
  name: "",
  keywords: "",
  title: "",
  company: "",
  school: "",
  locations: [],
  industries: [],
  companies: [],
  pastCompanies: [],
  schools: [],
  networkDistance: [],
  languages: [],
  prompt: "",
  approvedTarget: "",
  approvalThreshold: "",
  reviewThreshold: "",
  weeklyInviteLimit: "",
  dailyProfileLimit: "",
};

/**
 * Set up a campaign in two screens: the form (who to search for and who
 * qualifies), then a review of everything before it starts.
 */
export function NewCampaignPage() {
  const navigate = useNavigate();
  const [accounts, setAccounts] = useState<LinkedinAccount[]>([]);
  const [form, setForm] = useState<CampaignForm>(EMPTY_FORM);
  const [reviewing, setReviewing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    api<{ accounts: LinkedinAccount[] }>("/api/linkedin-accounts").then((answer) => {
      setAccounts(answer.accounts);
      const [only] = answer.accounts;
      if (answer.accounts.length === 1 && only) setForm((current) => ({ ...current, accountId: only.id }));
    });
    api<{ thresholds: { approve: number; review: number } }>("/api/campaigns/defaults").then((answer) =>
      setForm((current) => ({
        ...current,
        approvalThreshold: String(answer.thresholds.approve),
        reviewThreshold: String(answer.thresholds.review),
      })),
    );
  }, []);

  /** Update one field of the form. */
  function set<K extends keyof CampaignForm>(key: K, value: CampaignForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  /** Move to the review screen once the required fields are filled. */
  function review(event: FormEvent) {
    event.preventDefault();
    setError(Object.keys(searchOf(form)).length ? null : "Set at least one search field.");
    if (Object.keys(searchOf(form)).length) setReviewing(true);
  }

  /** Create the campaign; it starts active, so the pipeline picks it up. */
  async function start() {
    setStarting(true);
    setError(null);
    try {
      const answer = await api<{ id: string }>("/api/campaigns", {
        body: {
          linkedinAccountId: form.accountId,
          name: form.name,
          search: searchOf(form),
          prompt: form.prompt,
          approvedTarget: form.approvedTarget,
          approvalThreshold: form.approvalThreshold,
          reviewThreshold: form.reviewThreshold,
          weeklyInviteLimit: form.weeklyInviteLimit,
          dailyProfileLimit: form.dailyProfileLimit,
        },
      });
      navigate(`/campaigns/${answer.id}`);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not start the campaign.");
      setStarting(false);
    }
  }

  if (reviewing) {
    return (
      <ReviewScreen
        form={form}
        accountLabel={accounts.find((account) => account.id === form.accountId)?.label ?? ""}
        error={error}
        starting={starting}
        onBack={() => setReviewing(false)}
        onStart={() => void start()}
      />
    );
  }

  return (
    <form onSubmit={review} className="max-w-3xl space-y-6">
      <div>
        <Link to="/campaigns" className="text-sm text-indigo-600 hover:underline">← Campaigns</Link>
        <h1 className="mt-2 text-xl font-semibold">New campaign</h1>
      </div>

      <Section title="Basics">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">
            LinkedIn account
            <select
              required
              value={form.accountId}
              onChange={(event) => set("accountId", event.target.value)}
              className={INPUT}
            >
              <option value="">Choose…</option>
              {accounts.map((account) => (
                <option key={account.id} value={account.id}>{account.label}</option>
              ))}
            </select>
          </label>
          <TextField label="Campaign name" required value={form.name} onChange={(value) => set("name", value)} />
        </div>
      </Section>

      <Section title="Search" hint="The same fields as LinkedIn's people search. Leave blank what you don't need.">
        <TextField label="Keywords" value={form.keywords} onChange={(value) => set("keywords", value)} />
        <div className="grid gap-4 sm:grid-cols-3">
          <TextField label="Title" value={form.title} onChange={(value) => set("title", value)} />
          <TextField label="Company" value={form.company} onChange={(value) => set("company", value)} />
          <TextField label="School" value={form.school} onChange={(value) => set("school", value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <ParameterPicker label="Locations" type="LOCATION" accountId={form.accountId} value={form.locations} onChange={(value) => set("locations", value)} />
          <ParameterPicker label="Industries" type="INDUSTRY" accountId={form.accountId} value={form.industries} onChange={(value) => set("industries", value)} />
          <ParameterPicker label="Current companies" type="COMPANY" accountId={form.accountId} value={form.companies} onChange={(value) => set("companies", value)} />
          <ParameterPicker label="Past companies" type="COMPANY" accountId={form.accountId} value={form.pastCompanies} onChange={(value) => set("pastCompanies", value)} />
          <ParameterPicker label="Schools" type="SCHOOL" accountId={form.accountId} value={form.schools} onChange={(value) => set("schools", value)} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <CheckboxGroup
            label="Connection degree"
            options={DEGREES.map((degree) => ({ value: degree.value, label: degree.label }))}
            value={form.networkDistance}
            onChange={(value) => set("networkDistance", value)}
          />
          <CheckboxGroup
            label="Profile language"
            options={LANGUAGES.map((language) => ({ value: language.code, label: language.label }))}
            value={form.languages}
            onChange={(value) => set("languages", value)}
          />
        </div>
      </Section>

      <Section title="Who you're looking for" hint="Plain language. The AI reads every profile against this and scores the fit.">
        <textarea
          required
          rows={7}
          value={form.prompt}
          onChange={(event) => set("prompt", event.target.value)}
          placeholder="e.g. Financial advisors or insurance brokers in São Paulo, 28–45, with at least 3 years in client-facing sales. Not interested in people currently working at banks…"
          className={INPUT}
        />
      </Section>

      <Section title="Goal">
        <TextField
          label="Stop after this many approved leads (blank: until the search runs out)"
          type="number"
          value={form.approvedTarget}
          onChange={(value) => set("approvedTarget", value)}
        />
      </Section>

      <details className="rounded-xl border border-slate-200 bg-white p-5">
        <summary className="cursor-pointer text-sm font-medium">Advanced</summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <TextField label="Approve at score ≥" type="number" value={form.approvalThreshold} onChange={(value) => set("approvalThreshold", value)} />
          <TextField label="Manual review at score ≥" type="number" value={form.reviewThreshold} onChange={(value) => set("reviewThreshold", value)} />
          <TextField label="Weekly invite budget (blank: account cap)" type="number" value={form.weeklyInviteLimit} onChange={(value) => set("weeklyInviteLimit", value)} />
          <TextField label="Daily profile budget (blank: account cap)" type="number" value={form.dailyProfileLimit} onChange={(value) => set("dailyProfileLimit", value)} />
        </div>
      </details>

      {error && <p className="text-sm text-red-600">{error}</p>}
      <button className="rounded-md bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700">
        Review campaign →
      </button>
    </form>
  );
}

/** Everything the campaign will do, laid out for a last check before it starts. */
function ReviewScreen(props: {
  form: CampaignForm;
  accountLabel: string;
  error: string | null;
  starting: boolean;
  onBack(): void;
  onStart(): void;
}) {
  const { form } = props;
  const searchRows: [string, string][] = [
    ["Keywords", form.keywords],
    ["Title", form.title],
    ["Company", form.company],
    ["School", form.school],
    ["Locations", titles(form.locations)],
    ["Industries", titles(form.industries)],
    ["Current companies", titles(form.companies)],
    ["Past companies", titles(form.pastCompanies)],
    ["Schools", titles(form.schools)],
    ["Connection degree", DEGREES.filter((degree) => form.networkDistance.includes(degree.value)).map((degree) => degree.label).join(", ")],
    ["Profile language", LANGUAGES.filter((language) => form.languages.includes(language.code)).map((language) => language.label).join(", ")],
  ];

  return (
    <div className="max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold">Review “{form.name}”</h1>
        <p className="mt-1 text-sm text-slate-500">Check everything below. The campaign starts working as soon as you start it.</p>
      </div>

      <Section title="Account">
        <p className="text-sm">{props.accountLabel}</p>
      </Section>

      <Section title="Search">
        <dl className="grid grid-cols-[10rem_1fr] gap-x-4 gap-y-2 text-sm">
          {searchRows
            .filter(([, value]) => value)
            .map(([label, value]) => (
              <div key={label} className="contents">
                <dt className="text-slate-500">{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
        </dl>
      </Section>

      <Section title="Who you're looking for">
        <p className="whitespace-pre-wrap rounded-md bg-slate-50 p-4 text-sm">{form.prompt}</p>
      </Section>

      <Section title="How leads are decided">
        <ul className="space-y-1 text-sm">
          <li><span className="font-medium text-emerald-700">Approved</span> at score {form.approvalThreshold} or more</li>
          <li><span className="font-medium text-amber-700">Manual review</span> from {form.reviewThreshold} to {Number(form.approvalThreshold) - 1}</li>
          <li><span className="font-medium text-red-700">Rejected</span> below {form.reviewThreshold}</li>
        </ul>
      </Section>

      <Section title="Goal and limits">
        <ul className="space-y-1 text-sm">
          <li>{form.approvedTarget ? `Stops after ${form.approvedTarget} approved leads, or when the search runs out.` : "Runs until the search runs out of results."}</li>
          <li>Invites: {form.weeklyInviteLimit ? `${form.weeklyInviteLimit} a week` : "the account's weekly cap"}.</li>
          <li>Profiles: {form.dailyProfileLimit ? `${form.dailyProfileLimit} a day` : "the account's daily cap"}.</li>
        </ul>
      </Section>

      {props.error && <p className="text-sm text-red-600">{props.error}</p>}
      <div className="flex gap-3">
        <button onClick={props.onBack} className="rounded-md border border-slate-300 bg-white px-5 py-2 text-sm font-medium hover:bg-slate-50">
          ← Edit
        </button>
        <button
          onClick={props.onStart}
          disabled={props.starting}
          className="rounded-md bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
        >
          {props.starting ? "Starting…" : "Start campaign"}
        </button>
      </div>
    </div>
  );
}

/** The search the server stores: ids only, blanks left out. */
function searchOf(form: CampaignForm): PeopleSearch {
  const search: PeopleSearch = {};
  if (form.keywords.trim()) search.keywords = form.keywords.trim();
  if (form.title.trim()) search.title = form.title.trim();
  if (form.company.trim()) search.company = form.company.trim();
  if (form.school.trim()) search.school = form.school.trim();
  if (form.locations.length) search.locationIds = ids(form.locations);
  if (form.industries.length) search.industryIds = ids(form.industries);
  if (form.companies.length) search.companyIds = ids(form.companies);
  if (form.pastCompanies.length) search.pastCompanyIds = ids(form.pastCompanies);
  if (form.schools.length) search.schoolIds = ids(form.schools);
  if (form.networkDistance.length) search.networkDistance = form.networkDistance;
  if (form.languages.length) search.profileLanguages = form.languages;

  const picked = [...form.locations, ...form.industries, ...form.companies, ...form.pastCompanies, ...form.schools];
  if (picked.length) search.titles = Object.fromEntries(picked.map((item) => [item.id, item.title]));
  return search;
}

/** The ids of picked filter values. */
function ids(items: SearchParameter[]): string[] {
  return items.map((item) => item.id);
}

/** The names of picked filter values, for display. */
function titles(items: SearchParameter[]): string {
  return items.map((item) => item.title).join(", ");
}

/** Shared input styling. */
const INPUT =
  "mt-1 w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-normal focus:border-indigo-500 focus:outline-none";

/** A titled white card grouping related fields. */
function Section(props: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <div>
        <h2 className="text-sm font-semibold">{props.title}</h2>
        {props.hint && <p className="mt-0.5 text-xs text-slate-500">{props.hint}</p>}
      </div>
      {props.children}
    </section>
  );
}

/** A labelled single-line input. */
function TextField(props: {
  label: string;
  value: string;
  onChange(value: string): void;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block text-sm font-medium">
      {props.label}
      <input
        type={props.type ?? "text"}
        min={props.type === "number" ? 0 : undefined}
        required={props.required}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        className={INPUT}
      />
    </label>
  );
}

/** A row of checkboxes whose checked values form a list. */
function CheckboxGroup<T extends string | number>(props: {
  label: string;
  options: { value: T; label: string }[];
  value: T[];
  onChange(value: T[]): void;
}) {
  return (
    <div>
      <span className="text-sm font-medium">{props.label}</span>
      <div className="mt-2 flex flex-wrap gap-4">
        {props.options.map((option) => (
          <label key={String(option.value)} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={props.value.includes(option.value)}
              onChange={(event) =>
                props.onChange(
                  event.target.checked
                    ? [...props.value, option.value]
                    : props.value.filter((item) => item !== option.value),
                )
              }
            />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
