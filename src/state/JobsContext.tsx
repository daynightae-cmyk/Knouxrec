import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  executeMediaJob,
  findTool,
  type CancellationToken,
  type MediaJobProgress,
  type MediaJobRequest,
  type MediaJobStage,
} from "../services/mediaJobs";
import type { MediaToolResult } from "../services/mediaTools";

/**
 * Global registry of real jobs.
 *
 * A job record is created only when a genuine processor runs: the media
 * tools behind `executeMediaJob`, the template WebM encoder, or an active
 * recording session. The registry never fabricates activity, and its
 * timeline contains only events the underlying service really emitted.
 */

export type StudioJobKind = "tool" | "template" | "recording";

export interface StudioJobInput {
  fileName: string | null;
  mimeType: string | null;
  bytes: number | null;
  text?: string;
}

/** Output artifact shared by every kind of job. */
export interface StudioArtifact {
  blob: Blob;
  mimeType: string;
  fileName: string;
  width?: number;
  height?: number;
  duration?: number;
  bytes: number;
  metrics: Record<string, string | number | boolean>;
  logs: string[];
}

export interface StudioJobEvent {
  stage: MediaJobStage;
  message: string;
  /** Wall-clock timestamp in ms. */
  at: number;
}

export interface MediaJobRecord {
  id: string;
  kind: StudioJobKind;
  /** Human-readable service name. */
  title: string;
  /** Route that owns the job (used for reopen). */
  route: string;
  stage: MediaJobStage;
  /** 0..1 where measurable; null while the service is indeterminate. */
  progress: number | null;
  message: string;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
  input: StudioJobInput | null;
  params: Record<string, unknown> | null;
  /** Original tool request; enables a real retry and source preview. */
  request: MediaJobRequest | null;
  result: StudioArtifact | null;
  /** Events the underlying service actually reported, in order. */
  history: StudioJobEvent[];
}

export interface RunJobOptions {
  route: string;
  /** Forward progress to the caller (the view keeps its local preview). */
  onProgress?: (progress: MediaJobProgress) => void;
  /** External cancellation token; the caller owns real cancellation. */
  token?: CancellationToken;
  /** Called with the new record id as soon as the job is registered. */
  onStart?: (id: string) => void;
}

export interface BeginJobSpec {
  kind: StudioJobKind;
  title: string;
  route: string;
  input?: StudioJobInput | null;
  params?: Record<string, unknown> | null;
  /** 0..1 where measurable; omit for indeterminate services. */
  progress?: number | null;
}

export interface StudioJobHandle {
  id: string;
  /** Real cancellation token observed by the underlying processor. */
  token: CancellationToken;
  /** Record one genuinely-performed stage with an optional measurable progress. */
  report: (stage: MediaJobStage, message: string, progress?: number) => void;
  complete: (result: StudioArtifact) => void;
  fail: (error: Error | string) => void;
}

interface JobsContextValue {
  /** Newest first. */
  jobs: MediaJobRecord[];
  activeJobs: MediaJobRecord[];
  runJob: (request: MediaJobRequest, options: RunJobOptions) => Promise<MediaToolResult>;
  beginJob: (spec: BeginJobSpec) => StudioJobHandle;
  /** Real cancellation for jobs whose processor supports it. */
  cancelJob: (id: string) => void;
}

const JobsContext = createContext<JobsContextValue | null>(null);

const MAX_RECORDS = 12;

function recordId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `job-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

const TERMINAL: MediaJobStage[] = ["done", "cancelled", "error"];

export function JobsProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<MediaJobRecord[]>([]);
  const tokensRef = useRef(new Map<string, CancellationToken>());

  const patch = useCallback((id: string, update: Partial<MediaJobRecord>) => {
    setJobs((current) =>
      current.map((job) => (job.id === id ? { ...job, ...update } : job)),
    );
  }, []);

  const appendEvent = useCallback(
    (id: string, event: StudioJobEvent) => {
      setJobs((current) =>
        current.map((job) =>
          job.id === id ? { ...job, history: [...job.history, event] } : job,
        ),
      );
    },
    [],
  );

  const beginJob = useCallback(
    (spec: BeginJobSpec): StudioJobHandle => {
      const id = recordId();
      const now = Date.now();
      const token: CancellationToken = { cancelled: false };
      tokensRef.current.set(id, token);
      const record: MediaJobRecord = {
        id,
        kind: spec.kind,
        title: spec.title,
        route: spec.route,
        stage: "validating",
        progress: spec.progress ?? null,
        message: "Starting",
        startedAt: now,
        finishedAt: null,
        error: null,
        input: spec.input ?? null,
        params: spec.params ?? null,
        request: null,
        result: null,
        history: [],
      };
      setJobs((current) => [record, ...current].slice(0, MAX_RECORDS));

      const report = (stage: MediaJobStage, message: string, progress?: number) => {
        const event: StudioJobEvent = { stage, message, at: Date.now() };
        appendEvent(id, event);
        patch(id, {
          stage,
          message,
          progress: progress ?? (stage === "validating" ? 0.05 : null),
          ...(TERMINAL.includes(stage) ? { finishedAt: Date.now() } : {}),
        });
        if (TERMINAL.includes(stage)) tokensRef.current.delete(id);
      };

      const handle: StudioJobHandle = {
        id,
        token,
        report,
        complete: (result) => {
          appendEvent(id, {
            stage: "done",
            message: "Completed",
            at: Date.now(),
          });
          patch(id, {
            stage: "done",
            progress: 1,
            message: "Completed",
            finishedAt: Date.now(),
            result,
          });
          tokensRef.current.delete(id);
        },
        fail: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          appendEvent(id, { stage: "error", message, at: Date.now() });
          patch(id, {
            stage: "error",
            progress: 0,
            message,
            error: message,
            finishedAt: Date.now(),
          });
          tokensRef.current.delete(id);
        },
      };
      return handle;
    },
    [appendEvent, patch],
  );

  const cancelJob = useCallback((id: string) => {
    const token = tokensRef.current.get(id);
    if (token) token.cancelled = true;
  }, []);

  const runJob = useCallback(
    async (request: MediaJobRequest, options: RunJobOptions): Promise<MediaToolResult> => {
      const tool = findTool(request.toolId);
      const token = options.token ?? { cancelled: false };
      const file = request.file ?? null;
      const handle = beginJob({
        kind: "tool",
        title: tool?.name ?? request.toolId,
        route: options.route,
        input: {
          fileName: request.fileName ?? null,
          mimeType: file?.type ?? null,
          bytes: file?.size ?? null,
          text: request.text,
        },
        params: request.options,
      });
      tokensRef.current.set(handle.id, token);
      options.onStart?.(handle.id);
      patch(handle.id, { request });

      try {
        const result = await executeMediaJob(request, (progress) => {
          // `complete` below records the single terminal "done" event.
          if (progress.stage !== "done") {
            handle.report(progress.stage, progress.message, progress.progress);
          }
          options.onProgress?.(progress);
        }, token);
        handle.complete({
          blob: result.blob,
          mimeType: result.mimeType,
          fileName: result.fileName,
          width: result.width,
          height: result.height,
          duration: result.duration,
          bytes: result.bytes,
          metrics: result.metrics,
          logs: result.logs,
        });
        return result;
      } catch (cause) {
        if (cause instanceof Error && cause.name === "MediaJobCancelledError") {
          handle.report("cancelled", "Cancelled", 0);
          throw cause;
        }
        handle.fail(cause instanceof Error ? cause : "The tool failed.");
        throw cause;
      } finally {
        tokensRef.current.delete(handle.id);
      }
    },
    [beginJob, patch],
  );

  const value = useMemo<JobsContextValue>(() => {
    const activeJobs = jobs
      .filter((job) => !TERMINAL.includes(job.stage))
      .sort((a, b) => b.startedAt - a.startedAt);
    return { jobs, activeJobs, runJob, beginJob, cancelJob };
  }, [jobs, runJob, beginJob, cancelJob]);

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const value = useContext(JobsContext);
  if (!value) {
    throw new Error("useJobs must be used inside a JobsProvider.");
  }
  return value;
}
