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
import type { MediaToolId, MediaToolResult } from "../services/mediaTools";

/**
 * Global registry of real media jobs.
 *
 * The TopBar surfaces running jobs from this registry and the Dashboard lists
 * recent ones. A job record is created only when the genuine processor behind
 * `executeMediaJob` actually runs: the registry never fabricates activity.
 */

export interface MediaJobRecord {
  id: string;
  toolId: MediaToolId;
  /** Human-readable tool name, resolved from the real tool catalog. */
  toolName: string;
  /** Route that owns the job (used by the TopBar chip to navigate). */
  route: string;
  stage: MediaJobStage;
  /** 0..1, derived from the stages that actually finished. */
  progress: number;
  message: string;
  startedAt: number;
  finishedAt: number | null;
  error: string | null;
}

export interface RunJobOptions {
  route: string;
  /** Forward progress to the caller (the view keeps its local preview). */
  onProgress?: (progress: MediaJobProgress) => void;
  /** External cancellation token; the caller owns real cancellation. */
  token?: CancellationToken;
}

interface JobsContextValue {
  /** Newest first. */
  jobs: MediaJobRecord[];
  activeJobs: MediaJobRecord[];
  runJob: (request: MediaJobRequest, options: RunJobOptions) => Promise<MediaToolResult>;
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
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const patch = useCallback((id: string, update: Partial<MediaJobRecord>) => {
    setJobs((current) =>
      current.map((job) => (job.id === id ? { ...job, ...update } : job)),
    );
  }, []);

  const runJob = useCallback(
    async (request: MediaJobRequest, options: RunJobOptions): Promise<MediaToolResult> => {
      const tool = findTool(request.toolId);
      const id = recordId();
      const record: MediaJobRecord = {
        id,
        toolId: request.toolId,
        toolName: tool?.name ?? request.toolId,
        route: options.route,
        stage: "validating",
        progress: 0.05,
        message: "Validating the input",
        startedAt: Date.now(),
        finishedAt: null,
        error: null,
      };
      setJobs((current) => [record, ...current].slice(0, MAX_RECORDS));
      const token = options.token ?? { cancelled: false };

      const onProgress = (progress: MediaJobProgress) => {
        patch(id, {
          stage: progress.stage,
          progress: progress.progress,
          message: progress.message,
          ...(TERMINAL.includes(progress.stage) ? { finishedAt: Date.now() } : {}),
        });
        options.onProgress?.(progress);
      };

      try {
        const result = await executeMediaJob(request, onProgress, token);
        patch(id, { stage: "done", progress: 1, finishedAt: Date.now() });
        return result;
      } catch (cause) {
        if (cause instanceof Error && cause.name === "MediaJobCancelledError") {
          patch(id, { stage: "cancelled", progress: 0, finishedAt: Date.now() });
          throw cause;
        }
        const message = cause instanceof Error ? cause.message : "The tool failed.";
        patch(id, { stage: "error", progress: 0, message, finishedAt: Date.now(), error: message });
        throw cause;
      }
    },
    [patch],
  );

  const value = useMemo<JobsContextValue>(() => {
    const activeJobs = jobs
      .filter((job) => !TERMINAL.includes(job.stage))
      .sort((a, b) => b.startedAt - a.startedAt);
    return { jobs, activeJobs, runJob };
  }, [jobs, runJob]);

  return <JobsContext.Provider value={value}>{children}</JobsContext.Provider>;
}

export function useJobs(): JobsContextValue {
  const value = useContext(JobsContext);
  if (!value) {
    throw new Error("useJobs must be used inside a JobsProvider.");
  }
  return value;
}
