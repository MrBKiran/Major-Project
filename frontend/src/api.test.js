import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getToken, refreshSession, setToken } from "./api.js";

const reply = (status, body = {}) => Promise.resolve(new Response(JSON.stringify(body), { status }));

describe("refreshSession", () => {
  beforeEach(() => {
    setToken(null);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("adopts the new access token", async () => {
    vi.stubGlobal("fetch", vi.fn(() => reply(200, { access_token: "fresh" })));
    await expect(refreshSession()).resolves.toBe(true);
    expect(getToken()).toBe("fresh");
  });

  it("retries once when another tab refreshed a moment earlier", async () => {
    // 409 = the server saw this cookie rotated seconds ago; by now the shared
    // cookie jar holds the other tab's token, so asking again succeeds.
    const fetch = vi.fn()
      .mockImplementationOnce(() => reply(409, { detail: "retry" }))
      .mockImplementationOnce(() => reply(200, { access_token: "after-race" }));
    vi.stubGlobal("fetch", fetch);

    const done = refreshSession();
    await vi.runAllTimersAsync();

    await expect(done).resolves.toBe(true);
    expect(getToken()).toBe("after-race");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("gives up after one retry", async () => {
    const fetch = vi.fn(() => reply(409, { detail: "retry" }));
    vi.stubGlobal("fetch", fetch);

    const done = refreshSession();
    await vi.runAllTimersAsync();

    await expect(done).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("does not retry a refused cookie", async () => {
    const fetch = vi.fn(() => reply(401, { detail: "invalid" }));
    vi.stubGlobal("fetch", fetch);

    await expect(refreshSession()).resolves.toBe(false);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("shares one attempt between simultaneous callers", async () => {
    const fetch = vi.fn(() => reply(200, { access_token: "once" }));
    vi.stubGlobal("fetch", fetch);

    const [a, b] = await Promise.all([refreshSession(), refreshSession()]);

    expect(a && b).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
