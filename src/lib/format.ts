export function formatDuration(totalSeconds: number): string {
  const safe = Number.isFinite(totalSeconds) && totalSeconds > 0 ? totalSeconds : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = Math.floor(safe % 60);
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  );
  const value = bytes / Math.pow(1024, index);
  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

export function sanitizeFileName(name: string): string {
  const cleaned = Array.from(name)
    .map((char) => (char.charCodeAt(0) < 32 ? "-" : char))
    .join("")
    .replace(/[<>:"/\\|?*]/g, "-")
    .replace(/\s+/g, " ")
    .replace(/^\.+/, "")
    .trim();
  return cleaned.length > 0 ? cleaned.slice(0, 120) : "knoux-recording";
}

export function extensionForMime(mime: string): string {
  if (mime.includes("mp4")) return "mp4";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("png")) return "png";
  if (mime.includes("jpeg")) return "jpg";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("mpeg")) return "mp3";
  return "bin";
}

export function buildFileName(
  pattern: string,
  extension: string,
  date = new Date(),
): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  const datePart = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )}`;
  const timePart = `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(
    date.getSeconds(),
  )}`;
  const base = (pattern || "KNOUX-REC-[DATE]_[TIME]")
    .replace(/\[DATE\]/gi, datePart)
    .replace(/\[TIME\]/gi, timePart)
    .replace(/\[EXT\]/gi, extension);
  const safe = sanitizeFileName(base.replace(/\.[a-z0-9]+$/i, ""));
  return `${safe}.${extension}`;
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = sanitizeFileName(filename);
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, payload] = dataUrl.split(",");
  const mime = /:(.*?);/.exec(header)?.[1] ?? "application/octet-stream";
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function readMediaDuration(blob: Blob): Promise<number> {
  return new Promise((resolve) => {
    const element = document.createElement(blob.type.startsWith("audio") ? "audio" : "video");
    const url = URL.createObjectURL(blob);
    const finish = (value: number) => {
      URL.revokeObjectURL(url);
      element.remove();
      resolve(Number.isFinite(value) ? value : 0);
    };
    element.preload = "metadata";
    element.onloadedmetadata = () => finish(element.duration);
    element.onerror = () => finish(0);
    element.src = url;
    window.setTimeout(() => finish(0), 11000);
  });
}

export async function createThumbnail(
  blob: Blob,
  maxWidth = 480,
): Promise<string | null> {
  if (!blob.type.startsWith("video") && !blob.type.startsWith("image")) {
    return null;
  }
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const cleanup = () => URL.revokeObjectURL(url);
    if (blob.type.startsWith("image")) {
      const image = new Image();
      image.onload = () => {
        const scale = Math.min(1, maxWidth / image.width);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(image.width * scale));
        canvas.height = Math.max(1, Math.round(image.height * scale));
        const context = canvas.getContext("2d");
        if (!context) return resolve(null);
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        const result = canvas.toDataURL("image/jpeg", 0.72);
        cleanup();
        resolve(result);
      };
      image.onerror = () => {
        cleanup();
        resolve(null);
      };
      image.src = url;
      return;
    }
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "metadata";
    video.onloadeddata = () => {
      try {
        video.currentTime = Math.min(0.2, Math.max(0, (video.duration || 1) * 0.05));
      } catch {
        /* ignore */
      }
    };
    video.onseeked = () => {
      const scale = Math.min(1, maxWidth / (video.videoWidth || maxWidth));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round((video.videoWidth || 640) * scale));
      canvas.height = Math.max(1, Math.round((video.videoHeight || 360) * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        cleanup();
        return resolve(null);
      }
      context.drawImage(video, 0, 0, canvas.width, canvas.height);
      const result = canvas.toDataURL("image/jpeg", 0.7);
      cleanup();
      resolve(result);
    };
    video.onerror = () => {
      cleanup();
      resolve(null);
    };
    video.src = url;
    window.setTimeout(() => {
      cleanup();
      resolve(null);
    }, 9000);
  });
}
