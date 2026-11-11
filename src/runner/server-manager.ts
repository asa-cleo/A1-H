import type { Subprocess } from 'bun';
import { existsSync } from 'node:fs';
import { BinaryResolver, type ResolvedCommand } from './binary-resolver.ts';

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
    this.hfModel = options.hfModel || '';
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

  async start(timeoutMs: number = 90000): Promise<void> {
    // Check if an instance is already running
    if (await this.isHealthy()) {
      console.log(`\n  ℹ️ Existing llama server detected at ${this.serverUrl}. Reusing running instance.`);
      if (this.enableTunnel && !this.publicTunnelUrl) {
        await this.startTunnel();
      }
      return;
    }

    // Resolve model source (local file or Hugging Face)
    const modelArgs: string[] = [];
    if (this.modelPath && existsSync(this.modelPath)) {
      modelArgs.push('-m', this.modelPath);
    } else if (this.hfModel) {
      modelArgs.push('-hf', this.hfModel);
    } else if (this.modelPath) {
      modelArgs.push('-m', this.modelPath);
    } else {
      modelArgs.push('-hf', 'bartowski/Spark-X2.6-4B-GGUF:Spark-X2.6-4B-Q4_K_M.gguf');
    }

    // Resolve binary (supporting llama-server, llama-serve, llama serve, or LLAMA_DIR)
    let resolved: ResolvedCommand;
    try {
      resolved = this.resolver.resolveServer(this.binaryPath);
    } catch (err: any) {
      console.log(`\n  ⚠️ ${err.message}`);
      console.log('  ⚡ Auto-installing pre-built llama.cpp CUDA binaries...');
      await this.resolver.autoInstallLlamaPrebuilt('.');
      resolved = this.resolver.resolveServer();
    }

    console.log(`  ✓ Using binary: ${resolved.cmdPrefix.join(' ')}`);

    const args = [
      ...resolved.cmdPrefix,
      ...modelArgs,
      '-c', this.contextSize.toString(),
      '-ngl', this.gpuLayers.toString(),
      '--port', this.port.toString(),
      '--host', '0.0.0.0',
    ];

    if (this.flashAttention) args.push('-fa');
    if (this.quantizeKv) args.push('-ctk', 'q8_0', '-ctv', 'q8_0');
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

    // Cleanup hook on unexpected exit
    const cleanup = () => {
      this.stop();
    };
    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
    process.on('exit', cleanup);

    // Stream startup logs in background
    this.pipeLogs(this.serverProc);

    // Poll /health until server is ready
    const start = Date.now();
    process.stdout.write('  ⏳ Waiting for model to load into VRAM...');

    while (Date.now() - start < timeoutMs) {
      if (await this.isHealthy()) {
        console.log(' Ready! ✅\n');
        break;
      }

      if (this.serverProc.exitCode !== null) {
        throw new Error(`llama server process exited with code ${this.serverProc.exitCode}!`);
      }

      process.stdout.write('.');
      await Bun.sleep(1000);
    }

    if (!await this.isHealthy()) {
      this.stop();
      throw new Error(`llama server failed to respond on ${this.serverUrl}/health within ${timeoutMs / 1000}s`);
    }

    if (this.enableTunnel) {
      await this.startTunnel();
    }
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

    while (Date.now() - start < 35000) {
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
      console.log('='.repeat(70));
      console.log('🎉 PUBLIC CLOUDFLARE ENDPOINTS:');
      console.log('='.repeat(70));
      console.log(`Base URL:             ${this.publicTunnelUrl}`);
      console.log(`OpenAI API Endpoint:  ${this.publicTunnelUrl}/v1/chat/completions`);
      console.log(`Llama Native API:     ${this.publicTunnelUrl}/completion`);
      console.log(`Health Check:         ${this.publicTunnelUrl}/health`);
      console.log('='.repeat(70) + '\n');
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
          if (
            clean.includes('load_tensors') ||
            clean.includes('offloaded') ||
            clean.includes('kv_cache') ||
            clean.includes('listening on') ||
            clean.includes('CUDA')
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
