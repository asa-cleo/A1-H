import type { Subprocess } from 'bun';
import { BinaryResolver, type ResolvedCommand } from './binary-resolver.ts';
import { ensureModel } from './model-downloader.ts';

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
    temperature?: number;
    topP?: number;
    topK?: number;
    enableTunnel?: boolean;
  }) {
    this.binaryPath = options.binaryPath || './llama-server';
    this.llamaDir = options.llamaDir || process.env.LLAMA_DIR || '';
    this.modelPath = options.modelPath || '';
    this.hfModel = options.hfModel || 'bartowski/Spark-X2.6-4B-GGUF:Spark-X2.6-4B-Q4_K_M.gguf';
    this.port = options.port || 8080;
    // Cap context window to 128k max to prevent Colab GPU crash
    this.contextSize = Math.min(options.contextSize || 131072, 131072);
    this.gpuLayers = options.gpuLayers ?? 99; // Offload all layers to T4 GPU
    this.flashAttention = options.flashAttention ?? true;
    this.quantizeKv = options.quantizeKv ?? true;
    this.temperature = options.temperature ?? 1.0;
    this.topP = options.topP ?? 0.95;
    this.topK = options.topK ?? 0;
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
    // Check if an instance is already running
    if (await this.isHealthy()) {
      console.log(`\n  ℹ️ Existing llama server detected at ${this.serverUrl}. Reusing running instance.`);
      if (this.enableTunnel && !this.publicTunnelUrl) {
        await this.startTunnel();
      }
      return;
    }

    // 1. Ensure model file is downloaded and ready on disk
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

    // 3. Attempt spawn (with automatic fallback if optional flags fail)
    try {
      await this.spawnServerProcess(resolved, true, timeoutMs);
    } catch (err: any) {
      const errText = this.errorBuffer.join('\n');
      if (errText.includes('unknown option') || errText.includes('invalid argument') || errText.includes('-ctk')) {
        console.log('\n  ⚠️ Flag compatibility issue detected. Retrying with safe baseline arguments...');
        this.flashAttention = false;
        this.quantizeKv = false;
        await this.spawnServerProcess(resolved, false, timeoutMs);
      } else {
        throw err;
      }
    }

    // 4. Start Cloudflare Tunnel if requested
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

    if (useAdvancedFlags && this.flashAttention) args.push('-fa');
    if (useAdvancedFlags && this.quantizeKv) args.push('-ctk', 'q8_0', '-ctv', 'q8_0');
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
      console.log(`Model Context:        ${this.contextSize} tokens (128K capped)`);
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
