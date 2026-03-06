/**
 * Tests for useAuthFetch hook — wraps fetch with Bearer token auth.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

beforeEach(() => {
  localStorage.clear();
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ data: "test" }),
  }) as any;
});

describe("useAuthFetch", () => {
  let useAuthFetch: any;

  beforeEach(async () => {
    const mod = await import("../hooks/useAuthFetch");
    useAuthFetch = mod.useAuthFetch;
  });

  it("authFetch calls fetch without auth header when no token stored", async () => {
    const { result } = renderHook(() => useAuthFetch());

    await act(async () => {
      await result.current.authFetch("/api/test");
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      headers: expect.not.objectContaining({ Authorization: expect.anything() }),
    }));
  });

  it("authFetch adds Bearer token when stored", async () => {
    localStorage.setItem("openui-token", "my-secret-token");
    const { result } = renderHook(() => useAuthFetch());

    await act(async () => {
      await result.current.authFetch("/api/test");
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer my-secret-token" }),
    }));
  });

  it("authFetch passes through additional init options", async () => {
    const { result } = renderHook(() => useAuthFetch());

    await act(async () => {
      await result.current.authFetch("/api/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: '{"key":"value"}',
      });
    });

    expect(global.fetch).toHaveBeenCalledWith("/api/test", expect.objectContaining({
      method: "POST",
      body: '{"key":"value"}',
    }));
  });

  it("promptVisible is false initially", () => {
    const { result } = renderHook(() => useAuthFetch());
    expect(result.current.promptVisible).toBe(false);
  });

  it("401 response sets promptVisible to true", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
      json: () => Promise.resolve({ error: "Unauthorized" }),
    });

    const { result } = renderHook(() => useAuthFetch());

    // Start the fetch (it will hang on the token prompt)
    let fetchPromise: Promise<any>;
    act(() => {
      fetchPromise = result.current.authFetch("/api/test");
    });

    // Wait for the prompt to become visible
    await vi.waitFor(() => {
      expect(result.current.promptVisible).toBe(true);
    });

    // Submit a token to resolve the prompt
    (global.fetch as any).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });

    await act(async () => {
      result.current.submitToken("new-token");
    });

    await fetchPromise!;
  });

  it("submitToken stores token and hides prompt", async () => {
    (global.fetch as any).mockResolvedValue({
      ok: false,
      status: 401,
    });

    const { result } = renderHook(() => useAuthFetch());

    act(() => {
      result.current.authFetch("/api/test");
    });

    await vi.waitFor(() => {
      expect(result.current.promptVisible).toBe(true);
    });

    (global.fetch as any).mockResolvedValueOnce({ ok: true, status: 200 });

    await act(async () => {
      result.current.submitToken("stored-token");
    });

    expect(result.current.promptVisible).toBe(false);
    expect(localStorage.getItem("openui-token")).toBe("stored-token");
  });

  it("submitToken retries the failed request with new token", async () => {
    (global.fetch as any)
      .mockResolvedValueOnce({ ok: false, status: 401 })
      .mockResolvedValueOnce({ ok: true, status: 200, json: () => Promise.resolve({ success: true }) });

    const { result } = renderHook(() => useAuthFetch());

    let response: any;
    act(() => {
      result.current.authFetch("/api/protected").then((r: any) => { response = r; });
    });

    await vi.waitFor(() => {
      expect(result.current.promptVisible).toBe(true);
    });

    await act(async () => {
      result.current.submitToken("fresh-token");
    });

    await vi.waitFor(() => {
      expect(response).toBeDefined();
    });

    // The retry call should include the new token
    const calls = (global.fetch as any).mock.calls;
    const lastCall = calls[calls.length - 1];
    expect(lastCall[1].headers.Authorization).toBe("Bearer fresh-token");
  });
});
