import { useCallback, useEffect, useRef, useState } from 'react';

import {
  getResults,
  getStatus,
  importCsv,
  listRuns,
  renameRun,
  startDownload,
  startReview,
  submitDecisions,
} from './client';
import type {
  ArtifactKind,
  CampaignSummary,
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
import {
  LIST_TAB,
  nextOverride,
  overridesFromResults,
  tabCounts,
  type OverrideMap,
} from './listView';

/** How often the run's status is re-checked while the pipeline works. */
const POLL_INTERVAL_MS = 2000;

/** Which screen the flow is currently showing. */
export type Screen = 'upload' | 'list' | 'campaigns';

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

  const [campaignName, setCampaignName] = useState('');
  const [runNameOpen, setRunNameOpen] = useState(false);

  const [status, setStatus] = useState<RunStatus | undefined>(undefined);
  const [results, setResults] = useState<ProfileResult[]>([]);
  const [overrides, setOverrides] = useState<OverrideMap>({});

  const [saving, setSaving] = useState(false);
  const [savedApprovedCount, setSavedApprovedCount] = useState<number | undefined>(undefined);

  // The run under review. Set by a fresh import, or by reopening a past run
  // from the campaigns list (which has no `imported` record of its own).
  const [reopenedId, setReopenedId] = useState<string | undefined>(undefined);
  const processingId = reopenedId ?? imported?.processingId;

  // Land on the campaigns home when the account already has runs, so the
  // reopen/downloads live behind the first screen rather than after an import.
  const booted = useRef(false);
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void listRuns()
      .then((runs) => {
        if (runs.length > 0) setScreen('campaigns');
      })
      .catch(() => {
        /* Stay on upload if the campaigns list cannot be reached. */
      });
  }, []);

  /** Uploads the chosen file and keeps the parsed result for display. */
  const pickFile = useCallback(async (chosen: File | undefined) => {
    if (!chosen) return;

    setBusy(true);
    setError(undefined);
    try {
      const result = await importCsv(chosen);
      setFile(chosen);
      setImported(result);
      // Default the campaign name to the file name without its .csv extension.
      setCampaignName(chosen.name.replace(/\.csv$/i, ''));
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

  /** Starts the run under the given campaign name and watches it on the list. */
  const submit = useCallback(async (name: string) => {
    if (!processingId) return;

    setRunNameOpen(false);
    setCampaignName(name);
    setSubmitting(true);
    setError(undefined);
    try {
      await startReview(
        processingId,
        toEvaluationCriteria(criteria),
        name,
        criteria.thinkingMode,
      );
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
    setReopenedId(undefined);
    setStatus(undefined);
    setResults([]);
    setOverrides({});
    setSavedApprovedCount(undefined);
    setConfigured(false);
    setError(undefined);
  }, []);

  /**
   * Reopens a concluded run for editing: loads its stored results and the
   * decisions already saved for it, then shows the review list. The exports
   * stay "saved" until the reviewer changes a decision, so the reopened run
   * offers "Concluir revisão" rather than forcing a redundant save.
   */
  const reopen = useCallback(async (run: CampaignSummary) => {
    setBusy(true);
    setError(undefined);
    try {
      const loaded = await getResults(run.processingId);
      const seeded = overridesFromResults(loaded.results);
      setReopenedId(run.processingId);
      setImported(undefined);
      setResults(loaded.results);
      setOverrides(seeded);
      setCampaignName(run.name);
      setStatus({ processingId: run.processingId, status: 'completed' });
      setSavedApprovedCount(tabCounts(loaded.results, seeded)[LIST_TAB.approved]);
      setScreen('list');
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  /** Shows the campaigns home. */
  const goToCampaigns = useCallback(() => {
    setError(undefined);
    setScreen('campaigns');
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
  const save = useCallback(async (): Promise<boolean> => {
    if (!processingId) return false;

    setSaving(true);
    setError(undefined);
    try {
      const payload = Object.entries(overrides).map(([publicId, decision]) => ({
        publicId,
        decision,
      }));
      const result = await submitDecisions(processingId, payload, campaignName);
      setSavedApprovedCount(result.finalApprovedCount);
      return true;
    } catch (cause) {
      setError(messageOf(cause));
      return false;
    } finally {
      setSaving(false);
    }
  }, [processingId, overrides, campaignName]);

  /**
   * Renames the campaign during review and persists it immediately. Concluding
   * does not re-send the name, so an in-review rename must be saved on its own
   * or the campaigns list would keep showing the pre-edit name.
   */
  const renameCampaign = useCallback(
    (name: string) => {
      const next = name.trim();
      if (!next || next === campaignName) return;
      setCampaignName(next);
      if (processingId) {
        void renameRun(processingId, next).catch((cause) => setError(messageOf(cause)));
      }
    },
    [campaignName, processingId],
  );

  /** Moves to the campaigns home once decisions are saved. */
  const conclude = useCallback(() => setScreen('campaigns'), []);

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

    campaignName,
    renameCampaign,
    runNameOpen,
    openRunName: () => setRunNameOpen(true),
    closeRunName: () => setRunNameOpen(false),

    status,
    loading: status?.status === 'queued' || status?.status === 'running',
    results,
    overrides,
    decide,

    save,
    saving,
    savedApprovedCount,
    decisionsSaved: savedApprovedCount !== undefined,
    // Overrides changed since the last save (or since a reopen): leaving the
    // list without saving would drop them.
    dirty: savedApprovedCount === undefined && Object.keys(overrides).length > 0,
    conclude,
    download,

    reopen,
    goToCampaigns,

    processingId,
    restart,
  };
}

/** The full flow state and actions, as the screens receive it. */
export type ReviewFlow = ReturnType<typeof useReviewFlow>;
