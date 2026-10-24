import { describe, expect, it } from "vitest";
import { MEDIA_TOOLS, type MediaToolDescriptor } from "./mediaTools";
import {
  MediaJobCancelledError,
  MediaJobValidationError,
  executeMediaJob,
  validateRequest,
  type MediaJobRequest,
} from "./mediaJobs";

const fileTools = MEDIA_TOOLS.filter((tool) => tool.inputKind === "file");
const textTools = MEDIA_TOOLS.filter((tool) => tool.inputKind === "text");

function fileRequest(tool: MediaToolDescriptor, blob: Blob): MediaJobRequest {
  return { toolId: tool.id, file: blob, fileName: "input.bin", options: {} };
}

describe("validateRequest", () => {
  it("covers every Toolbox tool", () => {
    expect(MEDIA_TOOLS).toHaveLength(11);
    expect(fileTools).toHaveLength(9);
    expect(textTools).toHaveLength(2);
  });

  it("rejects a zero-byte file for every file-based tool", () => {
    for (const tool of fileTools) {
      const empty = new Blob([], { type: tool.accepts[0] });
      expect(
        () => validateRequest(fileRequest(tool, empty)),
        `${tool.id} accepts an empty file`,
      ).toThrowError(/empty/i);
    }
  });

  it("rejects a wrong MIME type for every file-based tool", () => {
    for (const tool of fileTools) {
      const wrong = new Blob(["not the expected media"], {
        type: "application/x-knoux-wrong",
      });
      expect(
        () => validateRequest(fileRequest(tool, wrong)),
        `${tool.id} accepts a wrong MIME type`,
      ).toThrowError(/does not accept/i);
    }
  });

  it("rejects missing and empty text for both text tools", () => {
    for (const tool of textTools) {
      expect(
        () => validateRequest({ toolId: tool.id, options: {} }),
        `${tool.id} accepts missing text`,
      ).toThrowError(MediaJobValidationError);
      expect(
        () => validateRequest({ toolId: tool.id, text: "   \n ", options: {} }),
        `${tool.id} accepts blank text`,
      ).toThrowError(/enter the text/i);
    }
  });
});

describe("executeMediaJob cancellation", () => {
  it("honours a cancelled token before doing any work for every tool", async () => {
    for (const tool of MEDIA_TOOLS) {
      const request: MediaJobRequest =
        tool.inputKind === "text"
          ? { toolId: tool.id, text: "test", options: {} }
          : fileRequest(tool, new Blob(["x"], { type: tool.accepts[0] }));
      const stages: string[] = [];
      await expect(
        executeMediaJob(request, (progress) => stages.push(progress.stage), {
          cancelled: true,
        }),
        `${tool.id} ignored the cancellation token`,
      ).rejects.toBeInstanceOf(MediaJobCancelledError);
      expect(stages).toEqual(["validating"]);
    }
  });
});
