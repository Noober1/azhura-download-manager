import { describe, it, expect } from "vitest";
import { categoryOf, categoryOfUrl, FILE_CATEGORIES, CATEGORY_LABEL, CATEGORY_FOLDER } from "./categories";

describe("categoryOf", () => {
  it("classifies one extension per bucket", () => {
    expect(categoryOf("movie.mp4")).toBe("video");
    expect(categoryOf("song.mp3")).toBe("audio");
    expect(categoryOf("setup.exe")).toBe("program");
    expect(categoryOf("report.pdf")).toBe("docs");
    expect(categoryOf("bundle.zip")).toBe("archive");
  });

  it("falls back to 'other' for unknown or missing extensions", () => {
    expect(categoryOf("unknown.xyz")).toBe("other");
    expect(categoryOf("noext")).toBe("other");
  });

  it("treats a dotfile as having no extension", () => {
    expect(categoryOf(".bashrc")).toBe("other");
  });

  it("is case-insensitive", () => {
    expect(categoryOf("MOVIE.MP4")).toBe("video");
  });

  it("uses the last extension for a double extension", () => {
    expect(categoryOf("archive.tar.gz")).toBe("archive");
  });
});

describe("categoryOfUrl", () => {
  it("strips query and fragment before classifying", () => {
    expect(categoryOfUrl("https://example.com/path/movie.mp4?token=abc")).toBe("video");
    expect(categoryOfUrl("https://example.com/archive.zip#frag")).toBe("archive");
  });

  it("handles a trailing slash with no filename", () => {
    expect(categoryOfUrl("https://example.com/folder/")).toBe("other");
    expect(categoryOfUrl("https://example.com/")).toBe("other");
  });
});

describe("category tables stay in lockstep", () => {
  it("FILE_CATEGORIES and CATEGORY_LABEL/CATEGORY_FOLDER cover the same ids", () => {
    for (const id of FILE_CATEGORIES) {
      expect(CATEGORY_LABEL[id]).toBeTruthy();
      expect(CATEGORY_FOLDER[id]).toBeTruthy();
    }
  });
});
