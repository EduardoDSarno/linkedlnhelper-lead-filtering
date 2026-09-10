import type { ProfileResult } from './code/api';
import type { PresentedRow } from './code/listView';

/** Props for the inline profile expansion. */
interface ProfileDetailsProps {
  profile: ProfileResult;
  row: PresentedRow;
  onClose: () => void;
}

/**
 * The model's reasoning about one profile, opened below its row.
 *
 * Deliberately does not repeat the identity, career or education already on
 * the row: the row's blocks show the full history on hover, so restating it
 * here only pushed the reasoning — the one thing that is not on the row —
 * further down the page.
 */
export function ProfileDetails({ profile, row, onClose }: ProfileDetailsProps) {
  const about = profile.details?.about;

  return (
    <section className="profile-details" aria-label={`Análise de ${row.name}`}>
      {about && (
        <div className="profile-about">
          <span className="profile-about-label">Sobre</span>
          <p>{about}</p>
        </div>
      )}

      <div className="profile-analysis-head">
        <span className="profile-analysis-title">Análise da IA</span>
        <span className="profile-analysis-meta">{analysisMeta(profile, row)}</span>
        <button type="button" className="profile-analysis-close" onClick={onClose}>
          Recolher ↑
        </button>
      </div>

      {profile.modelDecision ? (
        <>
          <div className="profile-points">
            <PointList
              label="Pontos positivos"
              tone="positive"
              items={profile.positives}
              emptyText="Nenhum ponto positivo destacado."
            />
            <PointList
              label="Pontos de atenção"
              tone="negative"
              items={profile.negatives}
              emptyText="Nenhum ponto de atenção destacado."
            />
          </div>

          {profile.summary && (
            <div className="profile-why">
              <span className="profile-why-label">Por que essa nota</span>
              <span className="profile-why-text">{profile.summary}</span>
            </div>
          )}
        </>
      ) : (
        <p className="profile-unavailable">
          Este perfil não recebeu análise da IA. Consulte o aviso exibido na linha.
        </p>
      )}
    </section>
  );
}

/** The one-line provenance of the score, shown beside the analysis heading. */
function analysisMeta(profile: ProfileResult, row: PresentedRow): string {
  const parts = [`nota ${row.score}/100`];
  if (row.compensationConfidence !== '—') {
    parts.push(`confiança ${row.compensationConfidence}`);
  }
  parts.push(profile.photo ? 'foto analisada' : 'sem foto');
  return parts.join(' · ');
}

/** A list of short model points, coloured by whether it helps or hurts the fit. */
function PointList({
  label,
  tone,
  items,
  emptyText,
}: {
  label: string;
  tone: 'positive' | 'negative';
  items?: readonly string[];
  emptyText: string;
}) {
  return (
    <div className={`profile-point-list is-${tone}`}>
      <span className="profile-point-label">{label}</span>
      {items?.length ? (
        <div className="profile-point-items">
          {items.map((item, index) => (
            <div className="profile-point" key={`${tone}-${String(index)}`}>
              <span className="profile-point-icon" aria-hidden="true">
                {tone === 'positive' ? '✓' : '!'}
              </span>
              <span>{item}</span>
            </div>
          ))}
        </div>
      ) : (
        <span className="profile-point-empty">{emptyText}</span>
      )}
    </div>
  );
}
