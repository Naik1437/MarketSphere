export async function requestWithRetry(
  input: RequestInfo | URL,
  init: RequestInit,
  options: { timeoutMs?: number; retries?: number } = {}
): Promise<Response> {
  const timeoutMs = options.timeoutMs ?? 8000;
  const retries = options.retries ?? 2;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      if (response.ok || response.status < 500 || attempt === retries) return response;
      lastError = new Error(`provider returned ${response.status}`);
    } catch (error) {
      lastError = error;
      if (attempt === retries) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("provider request failed");
}

export async function providerError(response: Response): Promise<never> {
  const body = await response.text();
  throw new Error(`External provider failed (${response.status}): ${body.slice(0, 500)}`);
}
