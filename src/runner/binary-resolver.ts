import { existsSync, chmodSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';

export interface ResolvedCommand {
  cmdPrefix: string[]; // e.g. ["/path/to/llama-server"] or ["llama", "serve"]
  workDir: string;
  libDir: string;
}

export class BinaryResolver {
  private customLlamaDir: string;

  constructor(customLlamaDir?: string) {
    this.customLlamaDir = (customLlamaDir || process.env.LLAMA_DIR || '').trim();
  }

  resolveServer(specifiedBin?: string): ResolvedCommand {
    // 1. If explicit binary specified and exists
    if (specifiedBin && specifiedBin !== './llama-server' && existsSync(specifiedBin)) {
      const fullPath = resolve(specifiedBin);
      return {
        cmdPrefix: [fullPath],
        workDir: dirname(fullPath),
        libDir: dirname(fullPath),
      };
    }

    const searchDirs = this.getSearchDirs();

    // 2. Search candidate executables in search directories
    for (const d of searchDirs) {
      if (!existsSync(d)) continue;
      for (const name of ['llama-server', 'llama-serve']) {
        const candidate = join(d, name);
        if (this.isExecutable(candidate)) {
          return {
            cmdPrefix: [candidate],
            workDir: d,
            libDir: d,
          };
        }
      }
    }

    // 3. Search system PATH for llama-server or llama-serve
    for (const name of ['llama-server', 'llama-serve']) {
      const systemPath = Bun.which(name);
      if (systemPath) {
        const pDir = dirname(systemPath);
        return {
          cmdPrefix: [systemPath],
          workDir: pDir,
          libDir: pDir,
        };
      }
    }

    // 4. Check if 'llama' CLI tool is in PATH (e.g., installed via URL/brew/apt with 'llama serve')
    const llamaCli = Bun.which('llama');
    if (llamaCli) {
      const pDir = dirname(llamaCli);
      return {
        cmdPrefix: [llamaCli, 'serve'],
        workDir: pDir,
        libDir: pDir,
      };
    }

    // 5. Fallback: Check if ./llama-server exists in current directory
    const local = resolve('./llama-server');
    if (this.isExecutable(local)) {
      return {
        cmdPrefix: [local],
        workDir: process.cwd(),
        libDir: process.cwd(),
      };
    }

    throw new Error(
      `llama-server not found! Checked $LLAMA_DIR ("${this.customLlamaDir}"), system PATH, and local paths.\n` +
      `Either install llama.cpp, export LLAMA_DIR=/path/to/binaries, or run with --auto-install-llama`
    );
  }

  resolveCli(specifiedBin?: string): ResolvedCommand {
    if (specifiedBin && specifiedBin !== './llama-cli' && existsSync(specifiedBin)) {
      const fullPath = resolve(specifiedBin);
      return {
        cmdPrefix: [fullPath],
        workDir: dirname(fullPath),
        libDir: dirname(fullPath),
      };
    }

    const searchDirs = this.getSearchDirs();

    for (const d of searchDirs) {
      if (!existsSync(d)) continue;
      const candidate = join(d, 'llama-cli');
      if (this.isExecutable(candidate)) {
        return {
          cmdPrefix: [candidate],
          workDir: d,
          libDir: d,
        };
      }
    }

    const systemCli = Bun.which('llama-cli');
    if (systemCli) {
      const pDir = dirname(systemCli);
      return {
        cmdPrefix: [systemCli],
        workDir: pDir,
        libDir: pDir,
      };
    }

    const llama = Bun.which('llama');
    if (llama) {
      const pDir = dirname(llama);
      return {
        cmdPrefix: [llama, 'cli'],
        workDir: pDir,
        libDir: pDir,
      };
    }

    const local = resolve('./llama-cli');
    if (this.isExecutable(local)) {
      return {
        cmdPrefix: [local],
        workDir: process.cwd(),
        libDir: process.cwd(),
      };
    }

    throw new Error(
      `llama-cli not found! Checked $LLAMA_DIR, system PATH, and local directory.`
    );
  }

  async ensureCloudflared(): Promise<string> {
    const systemCf = Bun.which('cloudflared');
    if (systemCf) return systemCf;

    const localCf = resolve('./cloudflared');
    if (this.isExecutable(localCf)) return localCf;

    console.log('  📥 cloudflared not found in PATH. Downloading standalone Linux binary...');
    const url = 'https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64';
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to download cloudflared: HTTP ${resp.status}`);

    const buffer = await resp.arrayBuffer();
    await Bun.write(localCf, buffer);
    chmodSync(localCf, 0o755);
    console.log(`  ✓ cloudflared downloaded and made executable: ${localCf}`);
    return localCf;
  }

  async autoInstallLlamaPrebuilt(targetDir: string = '.'): Promise<void> {
    console.log('  📥 Downloading latest llama.cpp pre-built binary for CUDA sm_75 / T4...');
    const tag = 'b12283';
    const downloadUrl = `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/llama-${tag}-bin-ubuntu-cuda-12.8-x64.tar.gz`;

    const archivePath = join(targetDir, 'llama-cuda.tar.gz');
    const resp = await fetch(downloadUrl);
    if (!resp.ok) throw new Error(`Failed to download llama.cpp release: HTTP ${resp.status}`);

    const buffer = await resp.arrayBuffer();
    await Bun.write(archivePath, buffer);

    console.log('  📦 Extracting llama-server, llama-cli, and CUDA shared libraries...');
    const proc = Bun.spawn(
      ['tar', '-zxvf', archivePath, '--wildcards', '*llama-server*', '*llama-cli*', '*lib*', '--strip-components=1'],
      { cwd: targetDir, stdout: 'inherit', stderr: 'inherit' }
    );
    await proc.exited;

    if (existsSync(join(targetDir, 'llama-server'))) {
      chmodSync(join(targetDir, 'llama-server'), 0o755);
    }
    if (existsSync(join(targetDir, 'llama-cli'))) {
      chmodSync(join(targetDir, 'llama-cli'), 0o755);
    }
    try {
      Bun.spawnSync(['rm', '-f', archivePath]);
    } catch {}
    console.log('  ✓ llama.cpp installed successfully!');
  }

  private getSearchDirs(): string[] {
    const dirs: string[] = [];
    if (this.customLlamaDir) {
      dirs.push(resolve(this.customLlamaDir));
    }
    dirs.push(
      process.cwd(),
      join(process.cwd(), 'bin'),
      '/content',
      '/content/llama-server',
      '/content/llama.cpp',
      '/content/llama.cpp/build/bin',
      '/usr/local/bin',
      '/opt/llama.cpp'
    );
    return dirs;
  }

  private isExecutable(p: string): boolean {
    if (!existsSync(p)) return false;
    try {
      const stat = statSync(p);
      return stat.isFile() && (stat.mode & 0o111) !== 0;
    } catch {
      return false;
    }
  }
}
