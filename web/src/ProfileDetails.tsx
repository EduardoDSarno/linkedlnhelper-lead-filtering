import type { ReactNode } from 'react';

import type {
  ProfileDate,
  ProfileEducation,
  ProfileExperience,
  ProfileResult,
} from './code/api';
import type { PresentedRow } from './code/listView';

/** Portuguese month abbreviations used by LinkedIn-style career periods. */
const MONTH_LABELS = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const;

/** Props for the inline profile expansion. */
interface ProfileDetailsProps {
  profile: ProfileResult;
  row: PresentedRow;
  onClose: () => void;
}

/**
 * Expands one result into the career evidence and AI explanation a reviewer
 * needs before changing its decision.
 */
export function ProfileDetails({ profile, row, onClose }: ProfileDetailsProps) {
  const details = profile.details;

  return (
    <section className="profile-details" aria-label={`Detalhes de ${row.name}`}>
      <header className="profile-details-head">
        <ProfilePhoto profile={profile} row={row} />

        <div className="profile-details-identity">
          <div className="profile-details-name-line">
            <h2>{row.name}</h2>
            {profile.headline && <span className="profile-details-headline">{profile.headline}</span>}
            {details?.openToWork && <Pill>Open to work</Pill>}
          </div>
          <div className="profile-details-meta">
            {profile.location && <span>{profile.location}</span>}
            <a href={row.url} target="_blank" rel="noreferrer">
              Ver perfil no LinkedIn ↗
            </a>
          </div>
          <CompactEducation items={details?.education} />
        </div>

        <button type="button" className="profile-details-close" onClick={onClose}>
          Recolher ↑
        </button>
      </header>

      {details?.about && (
        <div className="profile-details-about">
          <strong>Sobre</strong>
          <p>{details.about}</p>
        </div>
      )}

      <div className="profile-details-grid">
        <DetailBlock title="Experiência profissional">
          {details?.experience.length ? (
            <ExperienceTimeline items={details.experience} />
          ) : (
            <Unavailable>Histórico profissional detalhado ainda não disponível.</Unavailable>
          )}
        </DetailBlock>

        <DetailBlock title="Análise da IA" tone="blue">
          <AnalysisContent profile={profile} />
        </DetailBlock>
      </div>
    </section>
  );
}

/** Profile photo with a large hover preview and an original-image link. */
function ProfilePhoto({ profile, row }: { profile: ProfileResult; row: PresentedRow }) {
  if (!profile.photo) {
    return (
      <span
        className="profile-details-photo profile-details-initials"
        style={{ background: row.avBg, color: row.avFg }}
      >
        {row.initials}
      </span>
    );
  }

  return (
    <a
      className="profile-photo-link"
      href={profile.photo}
      target="_blank"
      rel="noreferrer"
      title="Clique para abrir a imagem original"
    >
      <img className="profile-details-photo" src={profile.photo} alt={`Foto de ${row.name}`} />
      <span className="profile-photo-preview" aria-hidden="true">
        <img src={profile.photo} alt="" />
        <span>Clique para abrir em tamanho original</span>
      </span>
    </a>
  );
}

/** Compresses the first education record into one line under the identity. */
function CompactEducation({ items }: { items: ProfileEducation[] | undefined }) {
  const education = items?.[0];
  if (!education) {
    return <span className="profile-details-education">Formação não informada</span>;
  }

  const course = [education.degree, education.fieldOfStudy].filter(Boolean).join(' em ');
  const period = formatPeriod(education.startDate, education.endDate);

  return (
    <span className="profile-details-education">
      <b>Formação:</b> {[course, education.schoolName, period].filter(Boolean).join(' · ')}
      {items && items.length > 1 ? ` · +${items.length - 1}` : ''}
    </span>
  );
}

/** Small neutral tag in the expanded-profile header. */
function Pill({ children }: { children: ReactNode }) {
  return <span className="profile-details-pill">{children}</span>;
}

/** Consistent section heading used inside and outside cards. */
function DetailTitle({ children }: { children: ReactNode }) {
  return <h3 className="profile-details-title">{children}</h3>;
}

/** Card-like section for one category of detailed information. */
function DetailBlock({
  title,
  tone,
  children,
}: {
  title: string;
  tone?: 'blue';
  children: ReactNode;
}) {
  return (
    <section className={`profile-details-block${tone ? ` is-${tone}` : ''}`}>
      <DetailTitle>{title}</DetailTitle>
      {children}
    </section>
  );
}

/** Low-emphasis copy for detail fields not supplied by the API. */
function Unavailable({ children }: { children: ReactNode }) {
  return <p className="profile-details-unavailable">{children}</p>;
}

/** Professional history rendered as a compact vertical timeline. */
function ExperienceTimeline({ items }: { items: ProfileExperience[] }) {
  return (
    <div className="profile-timeline">
      {items.map((item, index) => (
        <article
          className="profile-timeline-item"
          key={`${item.companyName}-${item.position}-${index}`}
        >
          <span className="profile-timeline-dot" aria-hidden="true" />
          <div>
            <strong>{item.position}</strong>
            <span className="profile-timeline-company">{item.companyName}</span>
            <span className="profile-timeline-meta">
              {formatPeriod(item.startDate, item.endDate)}
              {item.location ? ` · ${item.location}` : ''}
            </span>
            {item.description && <p>{item.description}</p>}
          </div>
        </article>
      ))}
    </div>
  );
}

/** Reasons, evidence, and uncertainty lists returned by Gemini. */
function AnalysisContent({ profile }: { profile: ProfileResult }) {
  if (!profile.modelDecision) {
    return (
      <Unavailable>
        Este perfil não recebeu análise da IA. Consulte o aviso exibido na linha.
      </Unavailable>
    );
  }

  return (
    <div className="profile-analysis-content">
      <LabeledList label="Por que recebeu esta nota" items={profile.reasons} />
      <LabeledList label="Evidências consideradas" items={profile.evidence} />
      <LabeledList
        label="Pontos incertos"
        items={profile.uncertainties}
        emptyText="Nenhuma incerteza relevante registrada."
      />
    </div>
  );
}

/** A labeled bullet list that handles missing model output consistently. */
function LabeledList({
  label,
  items,
  emptyText = 'Não informado.',
}: {
  label: string;
  items?: readonly string[];
  emptyText?: string;
}) {
  return (
    <div className="profile-labeled-list">
      <span className="profile-details-label">{label}</span>
      {items?.length ? (
        <ul>
          {items.map((item, index) => (
            <li key={`${label}-${index}`}>{item}</li>
          ))}
        </ul>
      ) : (
        <span className="profile-details-empty">{emptyText}</span>
      )}
    </div>
  );
}

/** Formats a start/end pair without pretending missing dates are known. */
function formatPeriod(start: ProfileDate | undefined, end: ProfileDate | undefined): string {
  const from = formatDate(start);
  const to = isPresent(end) ? 'Atual' : formatDate(end);
  if (from && to) return `${from} – ${to}`;
  return from || to || 'Período não informado';
}

/** Formats one partial LinkedIn date in pt-BR. */
function formatDate(date: ProfileDate | undefined): string {
  if (!date) return '';
  if (date.month && date.year) {
    return `${MONTH_LABELS[date.month - 1] ?? ''} ${date.year}`.trim();
  }
  if (date.year) return String(date.year);
  return date.text ?? '';
}

/** Recognizes the provider's current-role marker. */
function isPresent(date: ProfileDate | undefined): boolean {
  return date?.text?.toLowerCase() === 'present';
}
