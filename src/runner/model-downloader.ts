import { existsSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';

export async function ensureModel(
  specifiedPath?: string,
  hfRepo: string = 'bartowski/Spark-X2.6-4B-GGUF',
  hfFilename: string = 'Spark-X2.6-4B-Q4_K_M.gguf'
): Promise<string> {
  // 1. If user provided a path that exists
  if (specifiedPath && existsSync(specifiedPath)) {
    const full = resolve(specifiedPath);
    const mb = statSync(full).size / (1024 * 1024);
    console.log(`  ✓ Using existing model: ${basename(full)} (${mb.toFixed(1)} MB)`);
    return full;
  }

  // 2. Check current directory for default filename
  const localDefault = resolve(hfFilename);
  if (existsSync(localDefault)) {
    const mb = statSync(localDefault).size / (1024 * 1024);
    console.log(`  ✓ Found existing model: ${hfFilename} (${mb.toFixed(1)} MB)`);
    return localDefault;
  }

  // 3. Download the model file with live streaming progress
  const targetPath = specifiedPath ? resolve(specifiedPath) : localDefault;
  const downloadUrl = `https://huggingface.co/${hfRepo}/resolve/main/${hfFilename}`;

  console.log(`\n  📥 Model not found locally. Downloading ${hfFilename} (~2.6 GB)...`);
  console.log(`  🌐 Source: ${downloadUrl}`);

  // Try huggingface-cli if installed
  const hfCli = Bun.which('huggingface-cli');
  if (hfCli) {
    console.log('  ⚡ Using huggingface-cli for accelerated download...');
    const proc = Bun.spawn([
      hfCli, 'download', hfRepo, hfFilename,
      '--local-dir', '.', '--local-dir-use-symlinks', 'False'
    ], { stdout: 'inherit', stderr: 'inherit' });
    await proc.exited;
    if (existsSync(targetPath)) {
      return targetPath;
    }
  }

  // Fast direct stream download using fetch
  const startTime = Date.now();
  const resp = await fetch(downloadUrl);
  if (!resp.ok) {
    throw new Error(`Failed to download model from Hugging Face: HTTP ${resp.status} ${resp.statusText}`);
  }

  const totalBytes = parseInt(resp.headers.get('content-length') || '0', 10);
  const totalMb = totalBytes / (1024 * 1024);

  if (!resp.body) {
    throw new Error('Empty response body from Hugging Face CDN');
  }

  const reader = resp.body.getReader();
  const fileWriter = Bun.file(targetPath).writer();
  let downloadedBytes = 0;
  let lastLogTime = Date.now();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    fileWriter.write(value);
    downloadedBytes += value.length;

    const now = Date.now();
    if (now - lastLogTime > 400 || downloadedBytes === totalBytes) {
      lastLogTime = now;
      const pct = totalBytes > 0 ? (downloadedBytes / totalBytes) * 100 : 0;
      const dlMb = downloadedBytes / (1024 * 1024);
      const elapsedSec = (now - startTime) / 1000;
      const speedMb = dlMb / Math.max(elapsedSec, 0.001);

      const barLen = 25;
      const filled = Math.round((barLen * pct) / 100);
      const bar = '█'.repeat(filled) + '░'.repeat(Math.max(0, barLen - filled));

      process.stdout.write(
        `\r  [${bar}] ${pct.toFixed(1)}% (${dlMb.toFixed(1)}/${totalMb.toFixed(1)} MB) @ ${speedMb.toFixed(1)} MB/s `
      );
    }
  }

  await fileWriter.end();
  console.log(`\n  ✓ Model download complete! Saved to ${targetPath}\n`);
  return targetPath;
}
