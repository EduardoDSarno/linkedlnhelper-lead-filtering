import type { KeyboardEvent } from 'react';

import { Combobox } from './Combobox';
import { BRAZIL_LOCATIONS } from './data/locations';
import { BRAZIL_STATES, REGION_NAMES } from './data/regions';
import {
  LOCATION_MODE,
  OPEN_TO_WORK,
  criteriaSummary,
  type CriteriaForm,
} from './criteria';

/** Props: the current form, a patch applier, and the modal's actions. */
interface CriteriaModalProps {
  form: CriteriaForm;
  update: (patch: Partial<CriteriaForm>) => void;
  onClose: () => void;
  onConfirm: () => void;
}

/** Shared style for the small text/number inputs. */
const inputStyle: React.CSSProperties = {
  fontSize: 13,
  padding: '8px 10px',
  border: '1px solid #e2e8f0',
  borderRadius: 9,
  background: '#fff',
  color: '#0f172a',
};

/** A small badge flagging that a section is driven by the AI. */
function AiPill() {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '.02em',
        color: '#1d4ed8',
        background: '#e0edff',
        border: '1px solid #bfdbfe',
        padding: '2px 7px',
        borderRadius: 999,
      }}
    >
      <svg width="11" height="11" viewBox="0 0 24 24" fill="#2563eb" aria-hidden="true">
        <path d="M12 2l1.9 5.1L19 9l-5.1 1.9L12 16l-1.9-5.1L5 9l5.1-1.9L12 2z" />
      </svg>
      IA
    </span>
  );
}

/** Section heading inside the modal body. */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>
      {children}
    </div>
  );
}

/** A helper note shown under a field. */
function Note({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

/**
 * One removable chip inside a chip list.
 *
 * `tone` switches between the neutral (locations) and reject (exclusions) looks.
 */
function Chip({
  label,
  tone,
  onRemove,
}: {
  label: string;
  tone: 'neutral' | 'reject';
  onRemove: () => void;
}) {
  const colors =
    tone === 'reject'
      ? { color: '#9f1239', background: '#fff1f2', border: '#fecdd3', x: '#fb7185' }
      : { color: '#334155', background: '#f1f5f9', border: '#e2e8f0', x: '#94a3b8' };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 12,
        fontWeight: 500,
        color: colors.color,
        background: colors.background,
        border: `1px solid ${colors.border}`,
        padding: '4px 6px 4px 10px',
        borderRadius: 8,
      }}
    >
      {label}
      <button
        type="button"
        onClick={onRemove}
        style={{ all: 'unset', cursor: 'pointer', color: colors.x, padding: '0 3px' }}
      >
        ✕
      </button>
    </span>
  );
}

/**
 * The evaluation-criteria modal.
 *
 * It edits every field the backend accepts: the ideal-profile prompt, allowed
 * locations, age and compensation ranges, target seniority, role-keyword
 * exclusions, the photo requirement, the open-to-work filter, and the decision
 * policy. Confirming hands the form back for the run.
 */
export function CriteriaModal({ form, update, onClose, onConfirm }: CriteriaModalProps) {
  /** Adds a trimmed exclusion keyword when Enter is pressed. */
  function addExclusionOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== 'Enter') return;
    const value = event.currentTarget.value.trim().toLowerCase();
    if (!value) return;

    update({ exclusions: [...form.exclusions, value] });
    event.currentTarget.value = '';
    event.preventDefault();
  }

  /** Removes one exclusion keyword by index. */
  function removeExclusion(index: number) {
    update({ exclusions: form.exclusions.filter((_, i) => i !== index) });
  }

  const band1 = form.manualMin;
  const band2 = Math.max(0, form.approveMin - form.manualMin);
  const band3 = Math.max(0, 100 - form.approveMin);

  // The location field shown depends on the active mode; each keeps its own list.
  const locationField =
    form.locationMode === LOCATION_MODE.include
      ? 'includeLocations'
      : 'excludeLocations';
  const locationValues = form[locationField];

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 50,
        background: 'rgba(15,23,42,.42)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '48px 20px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 720,
          maxHeight: 'calc(100vh - 96px)',
          background: '#fff',
          borderRadius: 16,
          boxShadow: '0 24px 60px rgba(15,23,42,.28)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            flex: 'none',
            padding: '18px 22px',
            borderBottom: '1px solid #eef1f5',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <span>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 700, letterSpacing: '-0.02em' }}>
              Critérios de avaliação
            </span>
            <span style={{ display: 'block', fontSize: 12.5, color: '#94a3b8', marginTop: 2 }}>
              A IA usa estes critérios para pontuar e ordenar os perfis.
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              all: 'unset',
              cursor: 'pointer',
              marginLeft: 'auto',
              width: 30,
              height: 30,
              borderRadius: 8,
              display: 'grid',
              placeItems: 'center',
              color: '#94a3b8',
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </div>

        <div
          className="sc"
          style={{
            flex: 1,
            minHeight: 0,
            overflow: 'auto',
            padding: '20px 22px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 22,
          }}
        >
          {/* Ideal profile */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Perfil ideal</span>
              <AiPill />
            </div>
            <textarea
              rows={4}
              value={form.ideal}
              onChange={(e) => update({ ideal: e.target.value })}
              placeholder={
                'Ex.: Gestores comerciais e de Customer Success em SaaS B2B.\n' +
                '• Cargo e área: liderança de vendas/CS\n' +
                '• Senioridade: coordenação a diretoria\n' +
                '• Trajetória: progressão de analista a gestão\n' +
                '• Valorizar: carreira consultiva, ticket alto\n' +
                '• Evitar: perfis puramente operacionais'
              }
              style={{
                width: '100%',
                fontSize: 13.5,
                lineHeight: 1.55,
                padding: '10px 12px',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                resize: 'vertical',
                color: '#0f172a',
                background: '#fff',
              }}
            />
            <Note>
              Descreva o candidato-alvo. Para melhor avaliação, mencione:{' '}
              <b>cargo e área</b>, <b>senioridade</b>, <b>trajetória esperada</b>,{' '}
              <b>o que valorizar</b> e <b>o que evitar</b>.
            </Note>
          </div>

          {/* Extra guidance */}
          <div style={{ borderTop: '1px solid #eef1f5', paddingTop: 18 }}>
            <SectionTitle>Prioridades e sinais de alerta (opcional)</SectionTitle>
            <textarea
              rows={2}
              value={form.extra}
              onChange={(e) => update({ extra: e.target.value })}
              placeholder="Ex.: priorize experiência em fintech; desempate por tempo de casa; sinal de alerta: mais de 3 trocas de emprego em 2 anos."
              style={{
                width: '100%',
                fontSize: 13.5,
                lineHeight: 1.55,
                padding: '10px 12px',
                border: '1px solid #e2e8f0',
                borderRadius: 10,
                resize: 'vertical',
                color: '#0f172a',
                background: '#fff',
              }}
            />
            <Note>
              Como a IA deve pesar os perfis: <b>prioridades</b>,{' '}
              <b>critérios de desempate</b> e <b>sinais de alerta</b>.
            </Note>
          </div>

          {/* Locations */}
          <div style={{ borderTop: '1px solid #eef1f5', paddingTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Localização</span>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 4 }}>
                {[
                  { label: 'Incluir apenas', value: LOCATION_MODE.include },
                  { label: 'Excluir', value: LOCATION_MODE.exclude },
                ].map((option) => {
                  const on = form.locationMode === option.value;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      // Each mode keeps its own list, so switching only changes
                      // which list is shown — nothing is cleared.
                      onClick={() => update({ locationMode: option.value })}
                      style={{
                        all: 'unset',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '4px 10px',
                        borderRadius: 7,
                        border: `1px solid ${on ? '#2563eb' : '#e2e8f0'}`,
                        background: on ? '#f5f9ff' : '#fff',
                        color: on ? '#1d4ed8' : '#475569',
                      }}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <Combobox
              values={locationValues}
              suggestions={
                form.locationMode === LOCATION_MODE.include
                  ? [...REGION_NAMES, ...BRAZIL_LOCATIONS]
                  : [...REGION_NAMES, ...BRAZIL_STATES]
              }
              onAdd={(value) => update({ [locationField]: [...locationValues, value] })}
              onRemove={(index) =>
                update({
                  [locationField]: locationValues.filter((_, i) => i !== index),
                })
              }
              placeholder={
                form.locationMode === LOCATION_MODE.include
                  ? '+ cidade, estado ou região'
                  : '+ estado ou região a excluir'
              }
            />
            <Note>
              {form.locationMode === LOCATION_MODE.include ? (
                <>
                  Mantém apenas perfis nas localizações listadas. Adicione uma{' '}
                  <b>região</b> para incluir todos os seus estados de uma vez.
                </>
              ) : (
                <>
                  Mantém todos os estados <b>exceto</b> os listados (o backend
                  recebe a lista dos demais estados). Funciona por estado ou
                  região, não por cidade.
                </>
              )}{' '}
              Localização incerta no perfil não elimina o lead: vai para revisão
              manual com o aviso registrado.
            </Note>
          </div>

          {/* Age + compensation */}
          <div
            style={{
              borderTop: '1px solid #eef1f5',
              paddingTop: 18,
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 20,
            }}
          >
            <div>
              <SectionTitle>Faixa de idade aparente</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  value={form.ageMin}
                  onChange={(e) => update({ ageMin: Number(e.target.value) })}
                  style={{ ...inputStyle, width: 78 }}
                />
                <span style={{ color: '#94a3b8' }}>até</span>
                <input
                  type="number"
                  value={form.ageMax}
                  onChange={(e) => update({ ageMax: Number(e.target.value) })}
                  style={{ ...inputStyle, width: 78 }}
                />
                <span style={{ fontSize: 12.5, color: '#64748b' }}>anos</span>
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: '#92400e',
                  background: '#fffbeb',
                  border: '1px solid #fde68a',
                  borderRadius: 8,
                  padding: '7px 10px',
                  marginTop: 8,
                  lineHeight: 1.5,
                }}
              >
                A idade é uma <b>estimativa aparente</b>, inferida do histórico de
                trabalho e educação, nunca um dado verificado.
              </div>
            </div>
            <div>
              <SectionTitle>Remuneração mensal estimada (BRL)</SectionTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="number"
                  step={1000}
                  value={form.compMin}
                  onChange={(e) => update({ compMin: Number(e.target.value) })}
                  style={{ ...inputStyle, width: 104 }}
                />
                <span style={{ color: '#94a3b8' }}>até</span>
                <input
                  type="number"
                  step={1000}
                  value={form.compMax}
                  onChange={(e) => update({ compMax: Number(e.target.value) })}
                  style={{ ...inputStyle, width: 104 }}
                />
              </div>
              <Note>
                Estimada a partir de cargo, senioridade, histórico e mercado
                local. Cada perfil traz o nível de confiança.
              </Note>
            </div>
          </div>

          {/* Exclusions */}
          <div style={{ borderTop: '1px solid #eef1f5', paddingTop: 18 }}>
            <SectionTitle>Excluir por palavra no cargo atual</SectionTitle>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
              {form.exclusions.map((word, index) => (
                <Chip
                  key={`${word}-${index}`}
                  label={word}
                  tone="reject"
                  onRemove={() => removeExclusion(index)}
                />
              ))}
              <input
                placeholder="+ palavra e Enter"
                onKeyDown={addExclusionOnEnter}
                style={{
                  width: 160,
                  fontSize: 12.5,
                  padding: '6px 10px',
                  border: '1px dashed #cfd8e3',
                  borderRadius: 8,
                  background: '#fff',
                  color: '#0f172a',
                }}
              />
            </div>
            <Note>
              Aplica-se apenas ao cargo atual — estágios e trainees no histórico
              não excluem o perfil.
            </Note>
          </div>

          {/* Photo + open to work */}
          <div style={{ borderTop: '1px solid #eef1f5', paddingTop: 18 }}>
            <SectionTitle>Foto de perfil</SectionTitle>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, cursor: 'pointer', color: '#334155' }}>
              <input
                type="checkbox"
                checked={form.requirePhoto}
                onChange={(e) => update({ requirePhoto: e.target.checked })}
                style={{ marginTop: 3, accentColor: '#2563eb' }}
              />
              Exigir foto de perfil (exclui perfis sem foto antes da avaliação)
            </label>
            <Note>
              Só são observadas propriedades neutras: rosto visível, número de
              faces, tipo de foto, enquadramento, nitidez e iluminação.
            </Note>

            <div style={{ marginTop: 16 }}>
              <SectionTitle>Disponibilidade (open to work)</SectionTitle>
              <select
                value={form.openToWork}
                onChange={(e) => update({ openToWork: e.target.value as CriteriaForm['openToWork'] })}
                style={{ ...inputStyle, cursor: 'pointer' }}
              >
                <option value={OPEN_TO_WORK.ignore}>Ignorar</option>
                <option value={OPEN_TO_WORK.only}>Somente perfis open to work</option>
                <option value={OPEN_TO_WORK.exclude}>Excluir perfis open to work</option>
              </select>
            </div>
          </div>

          {/* Decision policy */}
          <div style={{ borderTop: '1px solid #eef1f5', paddingTop: 18 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>Política de decisão</span>
              <AiPill />
            </div>

            <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
              {[
                {
                  label: 'Automático',
                  value: true,
                  hint: 'A IA decide por você',
                },
                {
                  label: 'Manual',
                  value: false,
                  hint: 'A IA só pontua e ordena',
                },
              ].map((option) => {
                const on = form.automatic === option.value;
                return (
                  <button
                    key={option.label}
                    type="button"
                    onClick={() => update({ automatic: option.value })}
                    style={{
                      all: 'unset',
                      cursor: 'pointer',
                      flex: 1,
                      padding: '10px 12px',
                      borderRadius: 10,
                      border: `1.5px solid ${on ? '#2563eb' : '#e2e8f0'}`,
                      background: on ? '#f5f9ff' : '#fff',
                    }}
                  >
                    <span
                      style={{
                        display: 'block',
                        fontSize: 13,
                        fontWeight: 600,
                        color: on ? '#1d4ed8' : '#334155',
                      }}
                    >
                      {option.label}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        fontSize: 11.5,
                        color: '#94a3b8',
                        marginTop: 2,
                      }}
                    >
                      {option.hint}
                    </span>
                  </button>
                );
              })}
            </div>

            <div
              style={{
                fontSize: 12.5,
                color: '#475569',
                lineHeight: 1.6,
                background: '#f8fafc',
                border: '1px solid #eef1f5',
                borderRadius: 10,
                padding: '10px 12px',
              }}
            >
              {form.automatic ? (
                <>
                  A <b>IA decide automaticamente</b>, aprova, envia para revisão
                  ou reprova cada perfil conforme as faixas de nota abaixo. Você
                  ainda pode mudar qualquer decisão depois, na lista.
                </>
              ) : (
                <>
                  A IA apenas <b>pontua e ordena</b> os perfis. Nenhuma decisão é
                  tomada, você aprova ou reprova cada um manualmente na lista.
                </>
              )}
            </div>

            {form.automatic && (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
                  <span style={{ fontSize: 12.5, color: '#64748b', width: 130 }}>
                    Aprovar a partir de
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.approveMin}
                    onChange={(e) => update({ approveMin: Number(e.target.value) })}
                    style={{ ...inputStyle, width: 78 }}
                  />
                  <span style={{ fontSize: 12.5, color: '#64748b' }}>pts</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 }}>
                  <span style={{ fontSize: 12.5, color: '#64748b', width: 130 }}>
                    Revisão a partir de
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={form.manualMin}
                    onChange={(e) => update({ manualMin: Number(e.target.value) })}
                    style={{ ...inputStyle, width: 78 }}
                  />
                  <span style={{ fontSize: 12.5, color: '#64748b' }}>pts</span>
                </div>

                <div
                  style={{
                    display: 'flex',
                    height: 8,
                    borderRadius: 99,
                    overflow: 'hidden',
                    marginTop: 12,
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <span style={{ width: `${band1}%`, background: '#fecdd3' }} />
                  <span style={{ width: `${band2}%`, background: '#fde68a' }} />
                  <span style={{ width: `${band3}%`, background: '#a7f3d0' }} />
                </div>
                <div style={{ display: 'flex', gap: 14, marginTop: 7, fontSize: 11.5, color: '#64748b' }}>
                  <span>■ Reprovado &lt; {form.manualMin}</span>
                  <span>■ Revisão manual {form.manualMin}–{form.approveMin - 1}</span>
                  <span>■ Aprovado ≥ {form.approveMin}</span>
                </div>
              </>
            )}
          </div>
        </div>

        <div
          style={{
            flex: 'none',
            padding: '14px 22px',
            borderTop: '1px solid #eef1f5',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            background: '#fbfcfe',
          }}
        >
          <span style={{ fontSize: 12, color: '#94a3b8' }}>{criteriaSummary(form)}</span>
          <button
            type="button"
            onClick={onClose}
            style={{
              all: 'unset',
              cursor: 'pointer',
              marginLeft: 'auto',
              fontSize: 13,
              fontWeight: 600,
              color: '#475569',
              padding: '9px 14px',
              border: '1px solid #e2e8f0',
              borderRadius: 9,
              background: '#fff',
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={{
              all: 'unset',
              cursor: 'pointer',
              background: '#2563eb',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              padding: '10px 18px',
              borderRadius: 9,
              boxShadow: '0 1px 2px rgba(37,99,235,.35)',
            }}
          >
            Confirmar critérios
          </button>
        </div>
      </div>
    </div>
  );
}
