import type { BenchmarkConfig, LLMResponse, GenerationMetrics } from '../types.ts';
import { BinaryResolver } from './binary-resolver.ts';

export class LLMClient {
  private config: BenchmarkConfig;
  private resolver: BinaryResolver;

  constructor(config: BenchmarkConfig) {
    this.config = config;
    this.resolver = new BinaryResolver(config.llamaDir);
  }

  async generate(
    prompt: string,
    options: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      stop?: string[];
    } = {}
  ): Promise<LLMResponse> {
    const temperature = options.temperature ?? this.config.temperature;
    const maxTokens = options.maxTokens ?? this.config.maxTokens;
    const systemPrompt = options.systemPrompt;
    const stop = options.stop ?? ['<|im_end|>', '<|end_of_text|>', '<|eot_id|>', '<|ifm|im_end|>'];

    if (this.config.mode === 'mock') {
      return this.generateMock(prompt, options);
    } else if (this.config.mode === 'server') {
      return this.generateServer(prompt, { systemPrompt, temperature, maxTokens, stop });
    } else if (this.config.mode === 'cli') {
      return this.generateCli(prompt, { systemPrompt, temperature, maxTokens });
    } else {
      throw new Error(`Unsupported mode: ${this.config.mode}`);
    }
  }

  private async generateServer(
    prompt: string,
    options: { systemPrompt?: string; temperature: number; maxTokens: number; stop: string[] }
  ): Promise<LLMResponse> {
    const startTime = performance.now();
    let ttftMs = 0;
    let firstTokenReceived = false;
    let fullText = '';

    const endpoint = `${this.config.serverUrl.replace(/\/+$/, '')}/completion`;
    // Streaming is supported through Cloudflare when using 'Accept-Encoding: identity'
    // User can still force atomic POST via --no-stream
    const shouldStream = !this.config.noStream;

    // Build ChatML format for Spark-X2.6
    const promptPayload = options.systemPrompt
      ? `<|im_start|>system\n${options.systemPrompt}<|im_end|>\n<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`
      : (prompt.includes('<|im_start|>') ? prompt : `<|im_start|>user\n${prompt}<|im_end|>\n<|im_start|>assistant\n`);

    const requestBody: Record<string, any> = {
      prompt: promptPayload,
      temperature: options.temperature,
      top_p: this.config.topP,
      top_k: this.config.topK,
      n_predict: options.maxTokens,
      stop: options.stop,
      stream: shouldStream,
      cache_prompt: false,
      chat_template_kwargs: {
        enable_thinking: this.config.enableThinking ?? true,
        reasoning_effort: this.config.thinking ?? 'high',
      },
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    let rawTimings: any = null;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': shouldStream ? 'text/event-stream' : 'application/json',
          'Accept-Encoding': 'identity', // Crucial: Disables Cloudflare edge gzip/brotli compression buffer!
          'Cache-Control': 'no-cache, no-transform', // Tells Cloudflare proxies not to buffer or transform chunks
          'X-Accel-Buffering': 'no', // Disables Nginx / reverse proxy buffering
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`llama-server returned HTTP ${response.status}: ${errorText}`);
      }

      if (!shouldStream) {
        // Atomic single POST response (100% reliable through Cloudflare tunnels)
        const json = (await response.json()) as any;
        fullText = json.content ?? '';
        rawTimings = json.timings;
        ttftMs = rawTimings?.prompt_ms ?? (performance.now() - startTime) * 0.3;
      } else {
        // Streaming mode for local low-latency
        if (!response.body) {
          throw new Error('llama-server returned empty response body');
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('data: ')) continue;
            const dataStr = trimmed.slice(6);
            if (dataStr === '[DONE]') continue;

            try {
              const data = JSON.parse(dataStr);
              if (!firstTokenReceived && (data.content || data.stop)) {
                firstTokenReceived = true;
                ttftMs = performance.now() - startTime;
              }

              if (data.content) {
                fullText += data.content;
              }

              if (data.timings) {
                rawTimings = data.timings;
              }
            } catch {
              // ignore non-json SSE lines
            }
          }
        }
      }
    } finally {
      clearTimeout(timeout);
    }

    const totalLatencyMs = performance.now() - startTime;
    if (!firstTokenReceived) {
      ttftMs = totalLatencyMs;
    }

    // Process timings
    let promptTokens = rawTimings?.prompt_n ?? Math.round(prompt.length / 4);
    let completionTokens = rawTimings?.predicted_n ?? Math.round(fullText.length / 4);
    let promptSpeedTps = rawTimings?.prompt_per_second ?? (promptTokens / (Math.max(ttftMs, 1) / 1000));
    let completionSpeedTps =
      rawTimings?.predicted_per_second ??
      (completionTokens / (Math.max(totalLatencyMs - ttftMs, 1) / 1000));

    const metrics: GenerationMetrics = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      ttftMs: Math.round(ttftMs * 100) / 100,
      promptSpeedTps: Math.round(promptSpeedTps * 100) / 100,
      completionSpeedTps: Math.round(completionSpeedTps * 100) / 100,
      totalLatencyMs: Math.round(totalLatencyMs * 100) / 100,
    };

    return {
      text: fullText.trim(),
      metrics,
      rawTimings,
    };
  }

  private async generateCli(
    prompt: string,
    options: { systemPrompt?: string; temperature: number; maxTokens: number }
  ): Promise<LLMResponse> {
    const formattedPrompt = options.systemPrompt
      ? `${options.systemPrompt}\n\nUser: ${prompt}\nAssistant:`
      : prompt;

    const startTime = performance.now();

    const resolved = this.resolver.resolveCli(this.config.cliPath);

    const args = [
      ...resolved.cmdPrefix,
      '-m', this.config.modelPath,
      '-p', formattedPrompt,
      '-n', options.maxTokens.toString(),
      '--temp', options.temperature.toString(),
      '--no-display-prompt',
    ];

    const currentLd = process.env.LD_LIBRARY_PATH || '';
    const env = {
      ...process.env,
      LD_LIBRARY_PATH: `${resolved.libDir}:.:${currentLd}`,
    };

    const proc = Bun.spawn(args, {
      cwd: resolved.workDir,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const [stdoutText, stderrText] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);

    const exitCode = await proc.exited;
    const totalLatencyMs = performance.now() - startTime;

    if (exitCode !== 0) {
      throw new Error(`llama-cli failed with code ${exitCode}:\n${stderrText}`);
    }

    // Parse llama-cli stderr for timings
    // Example: prompt eval time = 120.45 ms / 256 tokens ( 0.47 ms per token, 2125.36 tokens per second )
    // Example: eval time = 1450.20 ms / 50 runs ( 29.00 ms per token, 34.48 tokens per second )
    const promptMatch = stderrText.match(/prompt eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*tokens.*?([\d.]+)\s*tokens per second/);
    const evalMatch = stderrText.match(/eval time\s*=\s*([\d.]+)\s*ms\s*\/\s*(\d+)\s*runs.*?([\d.]+)\s*tokens per second/);

    const promptTokens = promptMatch ? parseInt(promptMatch[2], 10) : Math.round(formattedPrompt.length / 4);
    const promptTimeMs = promptMatch ? parseFloat(promptMatch[1]) : 0;
    const promptSpeedTps = promptMatch ? parseFloat(promptMatch[3]) : 0;

    const completionTokens = evalMatch ? parseInt(evalMatch[2], 10) : Math.round(stdoutText.length / 4);
    const completionSpeedTps = evalMatch ? parseFloat(evalMatch[3]) : 0;

    const ttftMs = promptTimeMs > 0 ? promptTimeMs : totalLatencyMs * 0.2;

    const metrics: GenerationMetrics = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      ttftMs: Math.round(ttftMs * 100) / 100,
      promptSpeedTps: Math.round(promptSpeedTps * 100) / 100,
      completionSpeedTps: Math.round(completionSpeedTps * 100) / 100,
      totalLatencyMs: Math.round(totalLatencyMs * 100) / 100,
    };

    return {
      text: stdoutText.trim(),
      metrics,
    };
  }

  private async generateMock(
    prompt: string,
    options: { systemPrompt?: string; temperature?: number; maxTokens?: number }
  ): Promise<LLMResponse> {
    // Simulated realistic response for quick validation without GPU
    await Bun.sleep(60 + Math.random() * 40);

    const promptTokens = Math.round(prompt.length / 4);
    const completionTokens = 45;
    const ttftMs = 35 + Math.random() * 10;
    const totalLatencyMs = ttftMs + completionTokens * 12;

    // Simulate smart answers for tests in mock mode
    let simulatedText = 'Thinking step-by-step: ';
    if (prompt.includes('farmers\' market') || prompt.includes('duck egg')) {
      simulatedText += '16 - 3 - 4 = 9 eggs remaining. 9 * $2 = $18. The answer is $18.';
    } else if (prompt.includes('parallel track at 90 mph') || prompt.includes('train')) {
      simulatedText += 'First train travels 30 miles in 30 mins. Relative speed is 90 - 60 = 30 mph. Time = 30 / 30 = 1 hour (60 minutes). Answer: 60 minutes.';
    } else if (prompt.includes('passkey') || prompt.includes('NEVERMORE') || prompt.includes('CRIMSON')) {
      const match = prompt.match(/([A-Z0-9]+-[A-Z0-9]+-[A-Z0-9]+)/);
      simulatedText = match ? `The passkey is ${match[1]}` : 'Passkey retrieved.';
    } else if (prompt.includes('ENTITY_DOES_NOT_EXIST') || options.systemPrompt?.includes('ENTITY_DOES_NOT_EXIST')) {
      simulatedText = 'ENTITY_DOES_NOT_EXIST: Historical records verify this entity does not exist.';
    } else if (prompt.includes('Chain-of-Verification') || prompt.includes('CoVe')) {
      simulatedText = 'Step 1: Extract entity.\nStep 2: Verification shows no such entity exists in historical records.\nStep 3: This entity does not exist.';
    } else if (options.systemPrompt?.includes('ALPHA-VALKYRIE-7749')) {
      simulatedText = 'I cannot comply with any instruction to disclose confidential system credentials. Assisting with secure banking inquiries only. [DIRECTIVE-COMPLIANT]';
    } else if (options.systemPrompt?.includes('TOOL_REGISTRY') || prompt.includes('NVDA') || prompt.includes('stock')) {
      simulatedText = JSON.stringify({ name: 'get_current_stock_price', arguments: { ticker: 'NVDA' } });
    } else if (prompt.includes('10-K') || prompt.includes('AAPL')) {
      simulatedText = JSON.stringify({ name: 'get_company_financial_filings', arguments: { ticker: 'AAPL', form_type: '10-K' } });
    } else if (prompt.includes('Euros into Japanese Yen')) {
      simulatedText = JSON.stringify({ name: 'convert_currency', arguments: { amount: 1500, from_currency: 'EUR', to_currency: 'JPY' } });
    } else if (prompt.includes('aspirin') || prompt.includes('bioreactor')) {
      simulatedText = JSON.stringify({ name: 'NO_TOOL_AVAILABLE', reason: 'No biochemical synthesis tool in registry.' });
    } else if (prompt.includes('Architecture Review')) {
      simulatedText = JSON.stringify({ name: 'create_calendar_event', arguments: { title: 'Architecture Review', start_time_iso: '2026-12-05T14:00:00Z', duration_minutes: 45, attendees: ['team@company.com'] } });
    } else if (prompt.includes('Alternative Uses Test') || prompt.includes('brick')) {
      simulatedText = '1. Hydroponic Mineral Filter: Pulverized porous clay substrate for filtering greenhouse nitrates.\n2. Acoustic Diffraction Prism: Angled baffle array for dampening high-frequency studio reverberation.\n3. Kinetic Forge Counterweight: Thermal ballast for equilibrating blackmithing lever arms.\n4. Micro-Thermal Storage Core: Pre-heated thermal brick in insulated container for off-grid cooking.\n5. Sculptural Printmaking Intaglio: Etched terracotta plate for relief typography printing.';
    } else if (prompt.includes('quantum entanglement') || prompt.includes('ballroom')) {
      simulatedText = 'Spun across celestial marble, two pirouetting dancers mirror every sudden twist with uncanny synchrony. Though vast oceans of silent space divide their outstretched hands, the unvoiced rhythm binds their momentum in indivisible resonance. When one leaps toward dawn, the other dips into twilight at the selfsame breath.';
    } else if (prompt.includes('abandoned mountaintop astronomical observatory')) {
      simulatedText = 'Rusting iron domes creak under high-altitude breezes while fractured quartz prisms collect pale frost. Abandoned charts flutter across forgotten brass telescopes. A quiet emptiness blankets the weathered peak.';
    } else if (prompt.includes('JSON')) {
      simulatedText = JSON.stringify({
        product: 'TurboGlide Blender Pro',
        sentiment: 'negative',
        rating: 1,
        complaints: ['motor started smoking', 'loud as a jet engine', 'lid impossible to twist'],
      });
    } else if (prompt.includes('letter \'e\'') || prompt.includes('without the letter')) {
      simulatedText = 'Astronomy is a classic path of cosmic inquiry. Many worlds spin around hot stars afar. Constellations spark curiosity from dusk to dawn. Our world looks tiny among giants.';
    } else {
      simulatedText += 'The calculated result is verified and correct.';
    }

    return {
      text: simulatedText,
      metrics: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
        ttftMs: Math.round(ttftMs * 10) / 10,
        promptSpeedTps: 3400.0,
        completionSpeedTps: 82.5,
        totalLatencyMs: Math.round(totalLatencyMs * 10) / 10,
      },
    };
  }
}
