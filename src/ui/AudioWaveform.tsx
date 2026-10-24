import { useEffect, useRef, useState } from "react";
import WaveSurfer from "wavesurfer.js";
import { Icon } from "../app/icons";
import { formatDuration } from "../lib/format";

/**
 * Interactive waveform for locally produced audio blobs.
 *
 * CSP-safe by construction: the blob is decoded with Web Audio from its own
 * ArrayBuffer (never fetched over the network), the peaks are computed from
 * real samples, and playback goes through a media element, which the app CSP
 * explicitly allows (`media-src 'self' blob:`).
 *
 * If the browser cannot decode the container, the component falls back to the
 * native audio player instead of showing an empty decoration.
 */
export function AudioWaveform({
  blob,
  label,
  playLabel,
  pauseLabel,
  decodingLabel,
  fallbackNote,
}: {
  blob: Blob;
  label: string;
  playLabel: string;
  pauseLabel: string;
  decodingLabel: string;
  fallbackNote: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const wavesurferRef = useRef<WaveSurfer | null>(null);
  const fallbackUrlRef = useRef<string | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [current, setCurrent] = useState(0);
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    let wavesurfer: WaveSurfer | null = null;
    let objectUrl: string | null = null;
    const audioElement = audioRef.current;

    const load = async () => {
      setState("loading");
      setPlaying(false);
      setCurrent(0);
      setDuration(0);
      setFallbackUrl(null);
      fallbackUrlRef.current = null;
      const container = containerRef.current;
      const audio = audioRef.current;
      if (!container || !audio) return;

      try {
        const context = new AudioContext();
        let buffer: AudioBuffer;
        try {
          buffer = await context.decodeAudioData(await blob.arrayBuffer());
        } finally {
          await context.close().catch(() => undefined);
        }
        if (disposed) return;

        const channel = buffer.getChannelData(0);
        const bins = 480;
        const step = Math.max(1, Math.floor(channel.length / bins));
        const peaks: number[] = [];
        for (let bin = 0; bin < bins; bin += 1) {
          let peak = 0;
          const start = bin * step;
          const end = Math.min(start + step, channel.length);
          for (let index = start; index < end; index += 1) {
            const value = Math.abs(channel[index]);
            if (value > peak) peak = value;
          }
          peaks.push(peak);
        }

        objectUrl = URL.createObjectURL(blob);
        audio.src = objectUrl;
        audio.preload = "metadata";

        wavesurfer = WaveSurfer.create({
          container,
          media: audio,
          peaks: [peaks],
          duration: buffer.duration,
          height: 58,
          waveColor: "rgba(255, 255, 255, 0.24)",
          progressColor: getComputedStyle(document.documentElement)
            .getPropertyValue("--kx-accent")
            .trim() || "#ffde00",
          cursorColor: "rgba(255, 255, 255, 0.65)",
          cursorWidth: 1,
          barWidth: 2,
          barGap: 2,
          normalize: true,
          interact: true,
        });
        wavesurferRef.current = wavesurfer;

        wavesurfer.on("ready", (readyDuration) => {
          if (disposed) return;
          setDuration(readyDuration || buffer.duration);
          setState("ready");
        });
        wavesurfer.on("play", () => setPlaying(true));
        wavesurfer.on("pause", () => setPlaying(false));
        wavesurfer.on("timeupdate", (time) => setCurrent(time));
        wavesurfer.on("finish", () => {
          setPlaying(false);
          setCurrent(buffer.duration);
        });
        wavesurfer.on("error", () => {
          if (!disposed) setState("error");
        });
      } catch {
        if (disposed) return;
        const url = URL.createObjectURL(blob);
        fallbackUrlRef.current = url;
        setFallbackUrl(url);
        setState("error");
      }
    };

    void load();

    return () => {
      disposed = true;
      wavesurferRef.current?.destroy();
      wavesurferRef.current = null;
      audioElement?.removeAttribute("src");
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      if (fallbackUrlRef.current) {
        URL.revokeObjectURL(fallbackUrlRef.current);
        fallbackUrlRef.current = null;
      }
    };
  }, [blob]);

  if (state === "error" && fallbackUrl) {
    return (
      <div className="kx-live-audio">
        <span className="kx-live-audio-label">{label}</span>
        <audio src={fallbackUrl} controls preload="metadata" />
        <span className="kx-live-audio-meta">{fallbackNote}</span>
      </div>
    );
  }

  return (
    <div className="kx-live-audio">
      <span className="kx-live-audio-label">{label}</span>
      <div className="kx-live-waveform" data-state={state}>
        <audio ref={audioRef} aria-hidden="true" />
        <div ref={containerRef} className="kx-live-waveform-canvas" />
        {state === "loading" && (
          <span className="kx-live-waveform-loading">
            <span className="kx-spin">
              <Icon name="refresh" size={14} />
            </span>
            {decodingLabel}
          </span>
        )}
      </div>
      <div className="kx-live-audio-controls">
        <button
          type="button"
          className="kx-icon-button kx-icon-button-sm"
          aria-label={playing ? pauseLabel : playLabel}
          disabled={state !== "ready"}
          onClick={() => void wavesurferRef.current?.playPause()}
        >
          <Icon name={playing ? "pause" : "play"} size={15} />
        </button>
        <span className="kx-live-audio-meta kx-mono">
          {formatDuration(current)} / {formatDuration(duration)}
        </span>
      </div>
    </div>
  );
}
