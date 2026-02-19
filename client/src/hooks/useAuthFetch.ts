import { useCallback, useState } from "react";

const TOKEN_KEY = "openui-token";

function getStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function setStoredToken(token: string) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {}
}

/**
 * Wraps fetch to add Bearer token auth when a token is stored.
 * On 401, prompts for a token and retries.
 */
export function useAuthFetch() {
  const [promptVisible, setPromptVisible] = useState(false);
  const [pendingResolve, setPendingResolve] = useState<((token: string) => void) | null>(null);

  const promptForToken = useCallback((): Promise<string> => {
    return new Promise((resolve) => {
      setPromptVisible(true);
      setPendingResolve(() => resolve);
    });
  }, []);

  const submitToken = useCallback((token: string) => {
    setStoredToken(token);
    setPromptVisible(false);
    if (pendingResolve) {
      pendingResolve(token);
      setPendingResolve(null);
    }
  }, [pendingResolve]);

  const authFetch = useCallback(async (url: string, init?: RequestInit): Promise<Response> => {
    const token = getStoredToken();
    const headers: Record<string, string> = {
      ...(init?.headers as Record<string, string>),
    };
    if (token) {
      headers["Authorization"] = `Bearer ${token}`;
    }

    const res = await fetch(url, { ...init, headers });

    if (res.status === 401) {
      const newToken = await promptForToken();
      const retryHeaders = {
        ...headers,
        Authorization: `Bearer ${newToken}`,
      };
      return fetch(url, { ...init, headers: retryHeaders });
    }

    return res;
  }, [promptForToken]);

  return { authFetch, promptVisible, submitToken };
}
