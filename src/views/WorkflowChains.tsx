import { useCallback, useEffect, useRef, useState } from "react";
import { Icon } from "../app/icons";
import { useLibrary } from "../state/LibraryContext";
import { useSettings } from "../state/SettingsContext";
import { useToast } from "../state/ToastContext";
import { translate } from "../i18n/translate";
import { downloadBlob, formatBytes } from "../lib/format";
import {
  CHAINS,
  ChainCancelledError,
  describeStep,
  runChain,
  type ChainDefinition,
  type ChainRunResult,
} from "../services/workflowChains";

interface ChainState {
  running: boolean;
  progress: number;
  message: string;
  result: ChainRunResult | null;
  error: string | null;
}

const INITIAL: ChainState = {
  running: false,
  progress: 0,
  message: "",
  result: null,
  error: null,
};

/**
 * One-click workflow chains.
 *
 * Each card runs a real sequence over the user's own media using the same
 * processors the Toolbox, Recorder and template engine already ship. The tray
 * reports the bytes, dimensions and codec each step actually produced, and the
 * final artefacts go to the local library or to disk.
 */
export default function WorkflowChains({
  templateOptions,
}: {
  templateOptions: Array<{ id: string; name: string }>;
}) {
  const { settings } = useSettings();
  const { add } = useLibrary();
  const { push } = useToast();
  const t = useCallback(
    (key: string) => translate(settings.language, key),
    [settings.language],
  );
  const arabic = settings.language === "ar";

  const [active, setActive] = useState<string>(CHAINS[0].id);
  const [states, setStates] = useState<Record<string, ChainState>>({});
  const [inputs, setInputs] = useState<Record<string, File | null>>({});
  const [templateId, setTemplateId] = useState("");
  const [title, setTitle] = useState("KNOUX REC");
  const tokens = useRef<Record<string, { cancelled: boolean }>>({});

  // Adopt the first real catalogue id once the engine has been loaded, so the
  // chain never asks the template engine for a name that does not exist.
  useEffect(() => {
    if (!templateId && templateOptions.length > 0) {
      setTemplateId(templateOptions[0].id);
    }
  }, [templateId, templateOptions]);

  const chain = CHAINS.find((entry) => entry.id === active) as ChainDefinition;
  const state = states[active] ?? INITIAL;

  const patch = useCallback((id: string, value: Partial<ChainState>) => {
    setStates((current) => ({ ...current, [id]: { ...(current[id] ?? INITIAL), ...value } }));
  }, []);

  const execute = useCallback(async () => {
    const file = inputs[chain.id] ?? null;
    if (chain.input !== "template" && !file) {
      patch(chain.id, { error: t("chains.needInput") });
      return;
    }
    if (chain.input === "template" && !templateId) {
      patch(chain.id, { error: t("chains.noTemplate") });
      return;
    }
    const token = { cancelled: false };
    tokens.current[chain.id] = token;
    patch(chain.id, { ...INITIAL, running: true, progress: 0.02, message: t("chains.starting") });
    try {
      const blob = file ? new Blob([await file.arrayBuffer()], { type: file.type }) : null;
      const result = await runChain(
        chain.id,
        blob,
        {
          token,
          onProgress: (fraction, message) =>
            patch(chain.id, { progress: Math.max(0.02, fraction), message }),
        },
        { templateId, title, trimStart: 0.1, trimEnd: 1.1 },
      );
      if (!token.cancelled) {
        patch(chain.id, { running: false, progress: 1, message: t("chains.done"), result });
      }
    } catch (cause) {
      if (cause instanceof ChainCancelledError || token.cancelled) {
        patch(chain.id, { ...INITIAL, error: t("chains.cancelled") });
        return;
      }
      patch(chain.id, {
        running: false,
        error: cause instanceof Error ? cause.message : "The chain failed.",
      });
    }
  }, [chain, inputs, patch, t, templateId, title]);

  const cancel = useCallback(() => {
    const token = tokens.current[active];
    if (token) token.cancelled = true;
    patch(active, { ...INITIAL, error: t("chains.cancelled") });
  }, [active, patch, t]);

  const archive = useCallback(
    async (outputIndex: number) => {
      const artifact = state.result?.outputs[outputIndex];
      if (!artifact) return;
      try {
        await add({
          name: artifact.fileName,
          kind: artifact.mimeType.startsWith("video") ? "video" : "image",
          mimeType: artifact.mimeType,
          blob: artifact.blob,
          duration: artifact.duration ?? 0,
          width: artifact.width ?? 0,
          height: artifact.height ?? 0,
          source: "toolbox",
          thumbnail: null,
        });
        push("success", t("chains.archived"), `${artifact.fileName} · ${formatBytes(artifact.bytes)}`);
      } catch (cause) {
        push("error", t("chains.archiveFailed"), cause instanceof Error ? cause.message : String(cause));
      }
    },
    [add, push, state.result, t],
  );

  return (
    <section className="kx-card kx-chains" aria-labelledby="kx-chains-title">
      <div className="kx-row-between" style={{ alignItems: "flex-start", gap: 12 }}>
        <div>
          <div className="kx-card-title" id="kx-chains-title">
            <Icon name="layers" size={16} />
            {t("chains.title")}
          </div>
          <p className="kx-card-sub">{t("chains.description")}</p>
        </div>
        <span className="kx-badge" data-state="PARTIAL">
          {CHAINS.length} {t("chains.count")}
        </span>
      </div>

      <div className="kx-row" style={{ gap: 6, flexWrap: "wrap", margin: "10px 0 12px" }}>
        {CHAINS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            className="kx-chip"
            data-chain-id={entry.id}
            aria-pressed={active === entry.id}
            onClick={() => setActive(entry.id)}
          >
            {arabic ? entry.label : entry.labelEn}
          </button>
        ))}
      </div>

      <p className="kx-card-sub" style={{ marginTop: 0 }}>
        {arabic ? chain.summary : chain.summaryEn}
      </p>

      <ol className="kx-chain-steps" aria-label={t("chains.steps")}>
        {chain.steps.map((step, index) => {
          const outcome = state.result?.steps[index];
          return (
            <li key={step.id} data-chain-step={step.id} data-ok={outcome ? outcome.ok : undefined}>
              <span className="kx-chain-no">{index + 1}</span>
              <span className="kx-chain-name">{arabic ? step.label : step.labelEn}</span>
              <code className="kx-chain-processor">{step.processor}</code>
              {outcome && (
                <span className="kx-chain-outcome" dir="ltr">
                  {describeStep(outcome)} · {outcome.ms} ms
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <div className="kx-row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
        {chain.input !== "template" && (
          <label className="kx-field kx-chain-file">
            <span className="kx-label">
              {chain.input === "image" ? t("chains.pickImage") : t("chains.pickVideo")}
            </span>
            <input
              type="file"
              accept={chain.input === "image" ? "image/*" : "video/*"}
              data-chain-input={chain.id}
              onChange={(event) => {
                setInputs((current) => ({ ...current, [chain.id]: event.target.files?.[0] ?? null }));
                patch(chain.id, INITIAL);
              }}
            />
          </label>
        )}
        {chain.input === "template" && (
          <>
            <label className="kx-field">
              <span className="kx-label">{t("chains.template")}</span>
              <select
                className="kx-input"
                value={templateId}
                data-chain-template
                onChange={(event) => setTemplateId(event.target.value)}
              >
                {templateOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="kx-field">
              <span className="kx-label">{t("chains.titleField")}</span>
              <input
                className="kx-input"
                value={title}
                data-chain-title
                onChange={(event) => setTitle(event.target.value)}
              />
            </label>
          </>
        )}
        {!state.running ? (
          <button
            type="button"
            className="kx-btn kx-btn-primary"
            data-chain-run
            onClick={() => void execute()}
          >
            <Icon name="play" size={15} />
            {t("chains.run")}
          </button>
        ) : (
          <button type="button" className="kx-btn" data-chain-cancel onClick={cancel}>
            <Icon name="x" size={15} />
            {t("chains.cancel")}
          </button>
        )}
      </div>

      {state.running && (
        <div className="kx-chain-progress" role="progressbar" aria-valuenow={Math.round(state.progress * 100)}>
          <span style={{ width: `${Math.round(state.progress * 100)}%` }} />
          <em dir="ltr">{state.message}</em>
        </div>
      )}

      {state.error && (
        <div className="kx-notice" data-tone="danger">
          <Icon name="alert" size={16} />
          <div>{state.error}</div>
        </div>
      )}

      {state.result?.outputs.length ? (
        <div className="kx-chain-outputs">
          {state.result.outputs.map((artifact, index) => (
            <div className="kx-chain-output" key={`${artifact.fileName}-${index}`} data-chain-output>
              <span className="kx-chain-output-name" dir="ltr">
                {artifact.fileName}
              </span>
              <span className="kx-muted kx-mono" dir="ltr">
                {artifact.mimeType} · {formatBytes(artifact.bytes)}
                {artifact.width ? ` · ${artifact.width}×${artifact.height}` : ""}
                {artifact.duration ? ` · ${artifact.duration.toFixed(2)}s` : ""}
              </span>
              <span className="kx-row" style={{ gap: 6 }}>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  onClick={() => void archive(index)}
                >
                  {t("chains.archive")}
                </button>
                <button
                  type="button"
                  className="kx-btn kx-btn-sm"
                  onClick={() => downloadBlob(artifact.blob, artifact.fileName)}
                >
                  {t("chains.download")}
                </button>
              </span>
            </div>
          ))}
          <p className="kx-muted" style={{ fontSize: "0.72rem", margin: "4px 0 0" }} dir="ltr">
            {state.result.steps.length} steps · {state.result.ms} ms total
          </p>
        </div>
      ) : null}
    </section>
  );
}
