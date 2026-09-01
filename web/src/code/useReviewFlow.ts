import { useCallback, useEffect, useState } from 'react';

import {
  getResults,
  getStatus,
  importCsv,
  startDownload,
  startReview,
  submitDecisions,
} from './client';
import type {
  ArtifactKind,
  ImportResult,
  ManualDecision,
  ProfileResult,
  RunStatus,
} from './api';
import {
  DEFAULT_CRITERIA,
  toEvaluationCriteria,
  type CriteriaForm,
} from './criteria';
import { nextOverride, overridesFromResults, type OverrideMap } from './listView';

/** How often the run's status is re-checked while the pipeline works. */
const POLL_INTERVAL_MS = 2000;

/** Which screen the flow is currently showing. */
export type Screen = 'upload' | 'list' | 'done';

/** Turns an unknown thrown value into a message. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns the whole review flow: import, criteria, starting the run, polling its
 * status, loading results, and the in-memory map of human overrides.
 *
 * All state lives here so the screens stay presentational and App only routes
 * between them. The polling effect drives the upload-to-list transition on its
 * own once a run is started.
 */
export function useReviewFlow() {
  const [screen, setScreen] = useState<Screen>('upload');
  const [error, setError] = useState<string | undefined>(undefined);

  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | undefined>(undefined);
  const [imported, setImported] = useState<ImportResult | undefined>(undefined);

  const [criteria, setCriteria] = useState<CriteriaForm>(DEFAULT_CRITERIA);
  const [criteriaOpen, setCriteriaOpen] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [status, setStatus] = useState<RunStatus | undefined>(undefined);
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [overrides, setOverrides] = useState<OverrideMap>({});

  const [saving, setSaving] = useState(false);
  const [savedApprovedCount, setSavedApprovedCount] = useState<number | undefined>(undefined);

  const processingId = imported?.processingId;

  /** Uploads the chosen file and keeps the parsed result for display. */
  const pickFile = useCallback(async (chosen: File | undefined) => {
    if (!chosen) return;

    setBusy(true);
    setError(undefined);
    try {
      const result = await importCsv(chosen);
      setFile(chosen);
      setImported(result);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Merges one change into the criteria form. */
  const updateCriteria = useCallback((patch: Partial<CriteriaForm>) => {
    setCriteria((current) => ({ ...current, ...patch }));
  }, []);

  /** Starts the run and moves to the list screen to watch it. */
  const submit = useCallback(async () => {
    if (!processingId) return;

    setSubmitting(true);
    setError(undefined);
    try {
      await startReview(processingId, toEvaluationCriteria(criteria));
      setStatus({ processingId, status: 'running' });
      setResults([]);
      setOverrides({});
      setSavedApprovedCount(undefined);
      setScreen('list');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSubmitting(false);
    }
  }, [processingId, criteria]);

  // Poll while the run is in flight, then load its results once it completes.
  useEffect(() => {
    const running = status?.status === 'queued' || status?.status === 'running';
    if (!processingId || !running) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const next = await getStatus(processingId);
        if (cancelled) return;
        if (next.status === 'completed') {
          const loaded = await getResults(processingId);
          if (cancelled) return;
          setResults(loaded.results);
          setOverrides(overridesFromResults(loaded.results));
          setStatus(next);
          return;
        }
        setStatus(next);
        if (next.status === 'failed') {
          setError(next.error ?? 'A avaliação falhou.');
        }
      } catch (cause) {
        if (!cancelled) setError(messageOf(cause));
      }
    };

    const timer = window.setInterval(() => void tick(), POLL_INTERVAL_MS);
    void tick();

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [processingId, status?.status]);

  /** Returns to the upload screen for a new import. */
  const restart = useCallback(() => {
    setScreen('upload');
    setFile(undefined);
    setImported(undefined);
    setStatus(undefined);
    setResults([]);
    setOverrides({});
    setSavedApprovedCount(undefined);
    setConfigured(false);
    setError(undefined);
  }, []);

  /**
   * Records a human decision on one profile. Approve/reject toggle off when
   * pressed again; "manual" clears the override so the IA decision returns.
   */
  const decide = useCallback(
    (publicId: string, action: ManualDecision | 'manual') => {
      // A new decision invalidates the last save, so the exports re-lock until
      // the reviewer saves again.
      setSavedApprovedCount(undefined);
      setOverrides((current) => {
        const next = nextOverride(current[publicId], action);
        if (next === undefined) {
          const rest = { ...current };
          delete rest[publicId];
          return rest;
        }
        return { ...current, [publicId]: next };
      });
    },
    [],
  );

  /**
   * Saves the current decisions, which rebuilds the approved CSV and report on
   * the backend. Only explicit overrides are sent; the untouched profiles keep
   * their automatic decision.
   */
  const save = useCallback(async () => {
    if (!processingId) return;

    setSaving(true);
    setError(undefined);
    try {
      const payload = Object.entries(overrides).map(([publicId, decision]) => ({
        publicId,
        decision,
      }));
      const result = await submitDecisions(processingId, payload);
      setSavedApprovedCount(result.finalApprovedCount);
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setSaving(false);
    }
  }, [processingId, overrides]);

  /** Moves to the final page once decisions are saved. */
  const conclude = useCallback(() => setScreen('done'), []);

  /** Returns from the final page to the list, keeping decisions intact. */
  const backToList = useCallback(() => setScreen('list'), []);

  /** Downloads one output artifact for the current run. */
  const download = useCallback(
    (artifact: ArtifactKind) => {
      if (processingId) startDownload(processingId, artifact);
    },
    [processingId],
  );

  return {
    screen,
    error,
    dismissError: () => setError(undefined),

    busy,
    file,
    imported,
    pickFile,

    criteria,
    updateCriteria,
    criteriaOpen,
    openCriteria: () => setCriteriaOpen(true),
    closeCriteria: () => setCriteriaOpen(false),
    confirmCriteria: () => {
      setCriteriaOpen(false);
      setConfigured(true);
    },
    configured,

    submit,
    submitting,

    status,
    loading: status?.status === 'queued' || status?.status === 'running',
    results,
    overrides,
    decide,

    save,
    saving,
    savedApprovedCount,
    decisionsSaved: savedApprovedCount !== undefined,
    conclude,
    backToList,
    download,

    processingId,
    restart,
  };
}

/** The full flow state and actions, as the screens receive it. */
export type ReviewFlow = ReturnType<typeof useReviewFlow>;
