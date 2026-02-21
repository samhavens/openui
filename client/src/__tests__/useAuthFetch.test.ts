import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useAuthFetch } from "../hooks/useAuthFetch";

const TOKEN_KEY = "openui-token";

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("useAuthFetch", () => {
  it("adds Bearer header when token is in localStorage", async () => {
    localStorage.setItem(TOKEN_KEY, "my-token");
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useAuthFetch());

    await act(async () => {
      await result.current.authFetch("/api/test");
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.Authorization).toBe("Bearer my-token");
  });

  it("omits Authorization header when no token stored", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useAuthFetch());

    await act(async () => {
      await result.current.authFetch("/api/test");
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const calledHeaders = mockFetch.mock.calls[0][1].headers;
    expect(calledHeaders.Authorization).toBeUndefined();
  });

  it("passes through request options", async () => {
    const mockFetch = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const { result } = renderHook(() => useAuthFetch());

    await act(async () => {
      await result.current.authFetch("/api/data", {
        method: "POST",
        body: "test-body",
      });
    });

    expect(mockFetch.mock.calls[0][1].method).toBe("POST");
    expect(mockFetch.mock.calls[0][1].body).toBe("test-body");
  });

  it("promptVisible defaults to false", () => {
    const { result } = renderHook(() => useAuthFetch());
    expect(result.current.promptVisible).toBe(false);
  });
});
