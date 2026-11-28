import type { ApiEnv } from '@farmplus/config/server';

/**
 * The seam to an AI model. The API key lives only here (read from the server environment, sent only to the provider,
 * never logged, stored or returned). The provider is asked for ONE thing — a short explanation of facts it is handed —
 * and nothing it returns is trusted until `narrative.ts` has validated it.
 */
export type AiErrorCode = 'timeout' | 'rate_limited' | 'auth' | 'unavailable' | 'bad_response';

export class AiProviderError extends Error {
  constructor(
    readonly code: AiErrorCode,
    message = 'The AI provider failed',
  ) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiRequest {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}
export interface AiResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** The model that actually answered (as reported by the provider). */
  model: string;
}
export interface AiProvider {
  readonly name: string;
  readonly model: string;
  readonly isMock: boolean;
  complete(request: AiRequest): Promise<AiResponse>;
}

// ---------------------------------------------------------------------------
// Anthropic Messages API. Implemented against the documented request/response shapes and tested against a fake HTTP
// endpoint (request format, parsing, error mapping, timeout); it has NOT been run against the live service in this repository.
// ---------------------------------------------------------------------------
export class AnthropicProvider implements AiProvider {
  readonly name = 'anthropic';
  readonly isMock = false;
  constructor(
    private readonly options: {
      apiKey: string;
      model: string;
      baseUrl?: string | undefined;
      fetch?: typeof fetch | undefined;
    },
  ) {}
  get model(): string {
    return this.options.model;
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    const doFetch = this.options.fetch ?? globalThis.fetch.bind(globalThis);
    const base = (this.options.baseUrl ?? 'https://api.anthropic.com').replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs);
    let res: Response;
    try {
      res = await doFetch(`${base}/v1/messages`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': this.options.apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: this.options.model,
          max_tokens: req.maxTokens,
          system: req.system,
          messages: [{ role: 'user', content: req.user }],
        }),
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted)
        throw new AiProviderError('timeout', 'The AI provider timed out');
      clearTimeout(timer);
      throw new AiProviderError(
        'unavailable',
        error instanceof Error ? error.name : 'network error',
      );
    }
    // Never include the response body or headers in an error: they are not ours to log.
    // The deadline also covers reading the body: a stream that stalls after the headers must not hang the request.
    let body: unknown;
    try {
      if (res.status === 401 || res.status === 403)
        throw new AiProviderError('auth', `HTTP ${res.status}`);
      if (res.status === 429) throw new AiProviderError('rate_limited', 'HTTP 429');
      if (res.status >= 500) throw new AiProviderError('unavailable', `HTTP ${res.status}`);
      if (!res.ok) throw new AiProviderError('bad_response', `HTTP ${res.status}`);
      const timedOut = new Promise<never>((_, reject) => {
        const onAbort = () => reject(new AiProviderError('timeout', 'The AI provider timed out'));
        if (controller.signal.aborted) onAbort();
        else controller.signal.addEventListener('abort', onAbort, { once: true });
      });
      timedOut.catch(() => undefined);
      body = await Promise.race([res.json(), timedOut]);
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (controller.signal.aborted)
        throw new AiProviderError('timeout', 'The AI provider timed out');
      throw new AiProviderError('bad_response', 'not JSON');
    } finally {
      clearTimeout(timer);
    }
    const b = body as {
      content?: { type?: string; text?: string }[];
      usage?: { input_tokens?: number; output_tokens?: number };
      model?: string;
    };
    const text = (b.content ?? [])
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('');
    if (!text) throw new AiProviderError('bad_response', 'no text in response');
    return {
      text,
      inputTokens: Number(b.usage?.input_tokens ?? 0) || 0,
      outputTokens: Number(b.usage?.output_tokens ?? 0) || 0,
      model: typeof b.model === 'string' ? b.model : this.options.model,
    };
  }
}

// ---------------------------------------------------------------------------
// Development/test stand-in: grounded by construction (it only restates the numbers it was given), with failure injection.
// ---------------------------------------------------------------------------
export type MockMode =
  | 'grounded'
  | 'not_json'
  | 'invented_number'
  | 'diagnosis'
  | 'oversize'
  | 'extra_field'
  | 'link'
  | 'fenced_json';

export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly model = 'mock-model-1';
  readonly isMock = true;
  mode: MockMode = 'grounded';
  failWith: AiErrorCode | null = null;
  calls = 0;
  lastRequest: AiRequest | null = null;
  /** Tests: the exact text to return for the next assistant questions (null = a grounded answer). */
  assistantReply: string | null = null;

  async complete(req: AiRequest): Promise<AiResponse> {
    this.calls++;
    this.lastRequest = req;
    if (this.failWith) throw new AiProviderError(this.failWith, 'simulated');
    if (req.system.startsWith('You are the FARM+ help assistant')) return this.assistant(req);
    const facts = req.user;
    const base = {
      summary: 'This is a plain-language reading of the recorded facts only.',
      observations: ['Based on the data you recorded.'],
      questionsForOwner: ['Is there anything not recorded that matters for a sale?'],
    };
    const out: Record<MockMode, string> = {
      grounded: JSON.stringify(base),
      not_json: 'Sure! Here is my analysis: the animal looks great.',
      invented_number: JSON.stringify({
        ...base,
        summary: 'Cattle like this usually sell for 987654 baht.',
      }),
      diagnosis: JSON.stringify({
        ...base,
        summary: 'The weight pattern suggests a diagnosis of parasites; treat with an antibiotic.',
      }),
      oversize: JSON.stringify({ ...base, summary: 'x'.repeat(5000) }),
      extra_field: JSON.stringify({ ...base, price: 5 }),
      link: JSON.stringify({ ...base, summary: 'See https://example.test/prices for details.' }),
      fenced_json: '```json\n' + JSON.stringify(base) + '\n```',
    };
    return {
      text: out[this.mode],
      inputTokens: Math.ceil((req.system.length + facts.length) / 4),
      outputTokens: Math.ceil(out[this.mode].length / 4),
      model: this.model,
    };
  }

  private assistant(req: AiRequest): AiResponse {
    const text = this.assistantReply ?? mockAssistantReply(req);
    return {
      text,
      inputTokens: Math.ceil((req.system.length + req.user.length) / 4),
      outputTokens: Math.ceil(text.length / 4),
      model: this.model,
    };
  }
}

/** The mock's assistant reply: cites the first article it was handed and offers the help centre. */
function mockAssistantReply(req: AiRequest): string {
  const slug = /<chunk slug="([^"]+)"/.exec(req.user)?.[1];
  const thai = req.user.includes('<locale>th</locale>');
  return JSON.stringify({
    answer: thai
      ? '[คำตอบทดสอบ] ทำตามขั้นตอนในบทความช่วยเหลือที่อ้างถึงด้านล่าง'
      : '[Test answer] Follow the steps in the help article cited below.',
    citations: slug ? [slug] : [],
    links: ['help'],
    tours: ['help-centre'],
  });
}

export function createAiProvider(env: ApiEnv): AiProvider | null {
  if (env.AI_PROVIDER === 'mock') return new MockAiProvider();
  if (env.AI_PROVIDER === 'anthropic' && env.AI_API_KEY)
    return new AnthropicProvider({
      apiKey: env.AI_API_KEY,
      model: env.AI_MODEL,
      baseUrl: env.AI_BASE_URL,
    });
  return null;
}
