import { describe, it, expect, vi, beforeEach } from "vitest";

const shellIconMock = vi.fn();
vi.mock("./bindings", () => ({
  commands: {
    shellIcon: (ext: string) => shellIconMock(ext),
  },
}));

/** Every reaction our production code chains off the mocked `invoke` call
 *  (`.then().catch()`) is a microtask; a zero-delay timer runs after every
 *  pending microtask has drained, so this reliably waits out the whole
 *  chain without racing it. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  // Module-level cache/pending/disabled state in shellIcons.ts must not leak
  // between tests — reload the module fresh each time.
  vi.resetModules();
  shellIconMock.mockReset();
});

describe("extOf", () => {
  it("returns the lowercased extension after the last dot", async () => {
    const { extOf } = await import("./shellIcons");
    expect(extOf("Setup.EXE")).toBe("exe");
  });

  it("returns empty string for a name with no dot", async () => {
    const { extOf } = await import("./shellIcons");
    expect(extOf("README")).toBe("");
  });

  it("returns empty string when the only dot leads the name", async () => {
    const { extOf } = await import("./shellIcons");
    expect(extOf(".gitignore")).toBe("");
  });

  it("uses the last segment of a double extension", async () => {
    const { extOf } = await import("./shellIcons");
    expect(extOf("archive.tar.gz")).toBe("gz");
  });
});

describe("requestShellIcon / getShellIcon", () => {
  it("is null before resolution, then caches the resolved icon and notifies once", async () => {
    const { requestShellIcon, getShellIcon, subscribeShellIcons } = await import("./shellIcons");
    shellIconMock.mockResolvedValue("data:image/png;base64,AAA");
    const listener = vi.fn();
    subscribeShellIcons(listener);

    requestShellIcon("pdf");
    expect(getShellIcon("pdf")).toBeNull();

    await flush();

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getShellIcon("pdf")).toBe("data:image/png;base64,AAA");
  });

  it("dedupes concurrent requests for the same extension", async () => {
    const { requestShellIcon } = await import("./shellIcons");
    shellIconMock.mockResolvedValue("data:image/png;base64,BBB");

    requestShellIcon("zip");
    requestShellIcon("zip");
    requestShellIcon("zip");
    await flush();

    expect(shellIconMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry a cached miss (null result)", async () => {
    const { requestShellIcon, getShellIcon } = await import("./shellIcons");
    shellIconMock.mockResolvedValue(null);

    requestShellIcon("qqq");
    await flush();
    expect(getShellIcon("qqq")).toBeNull();

    requestShellIcon("qqq");
    await flush();
    expect(shellIconMock).toHaveBeenCalledTimes(1);
  });

  it("skips the lookup entirely for an empty extension", async () => {
    const { requestShellIcon } = await import("./shellIcons");
    requestShellIcon("");
    await flush();
    expect(shellIconMock).not.toHaveBeenCalled();
  });

  it("disables all further lookups after a rejected invoke", async () => {
    const { requestShellIcon, getShellIcon } = await import("./shellIcons");
    shellIconMock.mockRejectedValueOnce(new Error("no such command"));

    requestShellIcon("exe");
    await flush();
    expect(getShellIcon("exe")).toBeNull();

    shellIconMock.mockResolvedValue("data:image/png;base64,CCC");
    requestShellIcon("png");
    await flush();

    expect(shellIconMock).toHaveBeenCalledTimes(1); // only the "exe" attempt
    expect(getShellIcon("png")).toBeNull();
  });
});
