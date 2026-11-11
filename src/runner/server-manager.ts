import type { Subprocess } from 'bun';
import { createServer } from 'node:net';
import { BinaryResolver, type ResolvedCommand } from './binary-resolver.ts';
import { ensureModel } from './model-downloader.ts';

export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => resolve(false));
    server.once('listening', () => {
      server.close(() => resolve(true));
    });
    server.listen(port, '0.0.0.0');
  });
}

export async function findAvailablePort(startPort: number = 8088): Promise<number> {
  let port = startPort;
  for (let i = 0; i < 50; i++) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }
  return startPort;
}

export class ServerManager {
  private serverProc: Subprocess | null = null;
  private tunnelProc: Subprocess | null = null;
  private serverUrl: string;
  private publicTunnelUrl: string | null = null;
  private binaryPath: string;
  private llamaDir: string;
  private modelPath: string;
  private hfModel: string;
  private contextSize: number;
  private gpuLayers: number;
  private port: number;
  private flashAttention: boolean;
  private quantizeKv: boolean;
  private jinja: boolean;
  private thinking: 'none' | 'low' | 'high';
  private enableThinking: boolean;
  private temperature: number;
  private topP: number;
  private topK: number;
  private enableTunnel: boolean;
  private resolver: BinaryResolver;
  private errorBuffer: string[] = [];

  constructor(options: {
    binaryPath?: string;
    llamaDir?: string;
    modelPath?: string;
    hfModel?: string;
    port?: number;
    contextSize?: number;
    gpuLayers?: number;
    flashAttention?: boolean;
    quantizeKv?: boolean;
    jinja?: boolean;
    thinking?: 'none' | 'low' | 'high';
    enableThinking?: boolean;
    temperature?: number;
    topP?: number;
    topK?: number;
    enableTunnel?: boolean;
  }) {
    this.binaryPath = options.binaryPath || './llama-server';
    this.llamaDir = options.llamaDir || process.env.LLAMA_DIR || '';
    this.modelPath = options.modelPath || '';
    this.hfModel = options.hfModel || 'bartowski/Spark-X2.6-4B-GGUF:Spark-X2.6-4B-Q4_K_M.gguf';
    this.port = options.port || 8088; // Default 8088 to avoid busy 8080 in Colab
    // Cap context window to 128k max to prevent Colab GPU crash
    this.contextSize = Math.min(options.contextSize || 131072, 131072);
    this.gpuLayers = options.gpuLayers ?? 99; // Offload all layers to T4 GPU
    this.flashAttention = options.flashAttention ?? true;
    this.quantizeKv = options.quantizeKv ?? true;
    this.jinja = options.jinja ?? true;
    this.thinking = options.thinking ?? 'high';
    this.enableThinking = options.enableThinking ?? true;
    this.temperature = options.temperature ?? 1.0;
    this.topP = options.topP ?? 0.95;
    this.topK = options.topK ?? -1;
    this.enableTunnel = options.enableTunnel ?? false;
    this.serverUrl = `http://127.0.0.1:${this.port}`;
    this.resolver = new BinaryResolver(this.llamaDir);
  }

  getUrl(): string {
    return this.serverUrl;
  }

  getPublicUrl(): string | null {
    return this.publicTunnelUrl;
  }

  async isHealthy(): Promise<boolean> {
    try {
      const res = await fetch(`${this.serverUrl}/health`, { signal: AbortSignal.timeout(1500) });
      return res.ok;
    } catch {
      return false;
    }
  }

  async start(timeoutMs: number = 120000): Promise<void> {
    // 1. Check if model file is downloaded and ready on disk
    let hfRepo = 'bartowski/Spark-X2.6-4B-GGUF';
    let hfFile = 'Spark-X2.6-4B-Q4_K_M.gguf';
    if (this.hfModel && this.hfModel.includes(':')) {
      const parts = this.hfModel.split(':');
      hfRepo = parts[0];
      hfFile = parts[1];
    } else if (this.hfModel) {
      hfRepo = this.hfModel;
    }

    const resolvedModelPath = await ensureModel(this.modelPath, hfRepo, hfFile);
    this.modelPath = resolvedModelPath;

    // 2. Resolve server binary
    const resolved = await this.resolver.resolveServer(this.binaryPath);
    console.log(`  ✓ Using server binary: ${resolved.cmdPrefix.join(' ')}`);

    // 3. Find an available free port (so we never fail with "socket already bound")
    const freePort = await findAvailablePort(this.port);
    if (freePort !== this.port) {
      console.log(`  ℹ️ Port ${this.port} is already in use. Switched to available port ${freePort}.`);
      this.port = freePort;
      this.serverUrl = `http://127.0.0.1:${this.port}`;
    }

    // 4. Attempt spawn (with automatic fallback for flag syntax or socket issues)
    try {
      await this.spawnServerProcess(resolved, true, timeoutMs);
    } catch (err: any) {
      const errText = this.errorBuffer.join('\n');
      if (errText.includes("couldn't bind HTTP server socket") || errText.includes('port')) {
        const nextPort = await findAvailablePort(this.port + 1);
        console.log(`\n  ⚠️ Port ${this.port} busy. Retrying on port ${nextPort}...`);
        this.port = nextPort;
        this.serverUrl = `http://127.0.0.1:${this.port}`;
        await this.spawnServerProcess(resolved, true, timeoutMs);
      } else if (
        errText.includes('unknown option') ||
        errText.includes('invalid argument') ||
        errText.includes('unknown value for --flash-attn') ||
        errText.includes('-fa') ||
        errText.includes('-ctk') ||
        errText.includes('--jinja') ||
        errText.includes('--top-k')
      ) {
        console.log('\n  ⚠️ Flag compatibility issue detected. Retrying with safe baseline arguments...');
        this.flashAttention = false;
        this.quantizeKv = false;
        this.jinja = false;
        if (errText.includes('--top-k') || errText.includes('top_k')) {
          this.topK = 0; // Fallback from -1 to 0 if llama-server CLI parser rejects -1
        }
        await this.spawnServerProcess(resolved, false, timeoutMs);
      } else {
        throw err;
      }
    }

    // 5. Start Cloudflare Tunnel if requested
    if (this.enableTunnel) {
      await this.startTunnel();
    }
  }

  private async spawnServerProcess(
    resolved: ResolvedCommand,
    useAdvancedFlags: boolean,
    timeoutMs: number
  ): Promise<void> {
    this.errorBuffer = [];

    const args = [
      ...resolved.cmdPrefix,
      '-m', this.modelPath,
      '-c', this.contextSize.toString(),
      '-ngl', this.gpuLayers.toString(),
      '--port', this.port.toString(),
      '--host', '0.0.0.0',
    ];

    // Newer llama.cpp requires '--flash-attn on' or '-fa on'
    if (useAdvancedFlags && this.flashAttention) {
      args.push('--flash-attn', 'on');
    }
    if (useAdvancedFlags && this.quantizeKv) {
      args.push('-ctk', 'q8_0', '-ctv', 'q8_0');
    }
    if (useAdvancedFlags && this.jinja) {
      args.push('--jinja');
    }
    if (this.temperature !== undefined) args.push('--temp', this.temperature.toString());
    if (this.topP !== undefined) args.push('--top-p', this.topP.toString());
    if (this.topK !== undefined) args.push('--top-k', this.topK.toString());

    console.log(`\n  🚀 Spawning server in background: ${args.join(' ')}`);

    const currentLd = process.env.LD_LIBRARY_PATH || '';
    const env = {
      ...process.env,
      LD_LIBRARY_PATH: `${resolved.libDir}:.:${currentLd}`,
    };

    this.serverProc = Bun.spawn(args, {
      cwd: resolved.workDir,
      env,
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const cleanup = () => {
      this.stop();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

    // Stream logs in background & record errors
    this.pipeLogs(this.serverProc);

    const start = Date.now();
    process.stdout.write('  ⏳ Waiting for model to load into VRAM...');

    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) {
        console.log(' Ready! ✅\n');
        return;
      }

      if (this.serverProc.exitCode !== null) {
        const errorDetails = this.errorBuffer.join('\n').trim();
        console.log(`\n❌ llama server exited with code ${this.serverProc.exitCode}!`);
        if (errorDetails) {
          console.log(`\n--- Server Error Output ---\n${errorDetails}\n---------------------------`);
        }
        throw new Error(`llama server process exited with code ${this.serverProc.exitCode}!`);
      }

      process.stdout.write('.');
      await Bun.sleep(1000);
    }

    this.stop();
    throw new Error(`llama server failed to respond on ${this.serverUrl}/health within ${timeoutMs / 1000}s`);
  }

  private async startTunnel(): Promise<void> {
    console.log('  🌐 Setting up Cloudflare Tunnel...');
    const cfBin = await this.resolver.ensureCloudflared();

    this.tunnelProc = Bun.spawn([cfBin, 'tunnel', '--url', `http://127.0.0.1:${this.port}`], {
      stdout: 'pipe',
      stderr: 'pipe',
    });

    const start = Date.now();
    process.stdout.write('  ⏳ Waiting for public trycloudflare.com URL...');

    if (!this.tunnelProc.stderr || typeof this.tunnelProc.stderr === 'number') {
      console.log('\n  ⚠️ Unable to read cloudflared stderr stream.');
      return;
    }

    const reader = this.tunnelProc.stderr.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (Date.now() - start < 45000) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const match = buffer.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match) {
        this.publicTunnelUrl = match[0];
        console.log(' Established! ✅\n');
        break;
      }
      process.stdout.write('.');
    }

    if (!this.publicTunnelUrl) {
      console.log('\n  ⚠️ Cloudflare tunnel startup timed out, continuing on localhost.');
    } else {
      console.log('='.repeat(72));
      console.log('🎉 CLOUDFLARE PUBLIC TUNNEL IS READY!');
      console.log('='.repeat(72));
      console.log(`Public Base URL:      ${this.publicTunnelUrl}`);
      console.log(`OpenAI API Endpoint:  ${this.publicTunnelUrl}/v1/chat/completions`);
      console.log(`Llama Native API:     ${this.publicTunnelUrl}/completion`);
      console.log(`Health Check:         ${this.publicTunnelUrl}/health`);
      console.log(`Local Server Port:    ${this.port}`);
      console.log(`Model Context:        ${this.contextSize} tokens (128K capped)`);
      console.log(`Thinking Mode:        ${this.thinking.toUpperCase()} (enable_thinking: ${this.enableThinking})`);
      console.log(`Sampling Settings:    temp=${this.temperature}, top_p=${this.topP}, top_k=${this.topK}`);
      console.log('='.repeat(72));
      console.log('\nCopy the Public Base URL and run benchmarks locally against it:');
      console.log(`bun run bench --mode server --server-url ${this.publicTunnelUrl} --suite all\n`);
      console.log('='.repeat(72) + '\n');
    }
  }

  private async pipeLogs(proc: Subprocess) {
    if (!proc.stderr || typeof proc.stderr === 'number') return;
    try {
      const reader = proc.stderr.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const clean = line.trim();
          if (!clean) continue;
          this.errorBuffer.push(clean);
          if (this.errorBuffer.length > 50) this.errorBuffer.shift();

          // Show key informative lines live
          if (
            clean.includes('load_tensors') ||
            clean.includes('offloaded') ||
            clean.includes('kv_cache') ||
            clean.includes('listening on') ||
            clean.includes('CUDA') ||
            clean.includes('error') ||
            clean.includes('failed')
          ) {
            console.log(`    [llama] ${clean}`);
          }
        }
      }
    } catch {}
  }

  stop(): void {
    if (this.serverProc) {
      console.log('\n  🛑 Stopping background llama server process...');
      try {
        this.serverProc.kill();
      } catch {}
      this.serverProc = null;
    }
    if (this.tunnelProc) {
      console.log('  🛑 Stopping Cloudflare tunnel...');
      try {
        this.tunnelProc.kill();
      } catch {}
      this.tunnelProc = null;
    }
  }
}
