import * as path from 'node:path';
import { runTests } from '@vscode/test-electron';

async function main(): Promise<void> {
  // Compiled to out/e2e/test/e2e/, so the repo root is four levels up.
  const root = path.resolve(__dirname, '..', '..', '..', '..');
  try {
    await runTests({
      extensionDevelopmentPath: root,
      extensionTestsPath: path.resolve(__dirname, 'suite', 'index'),
      launchArgs: [
        path.join(root, 'test', 'fixtures', 'poky-mini'),
        '--disable-extensions',
        '--disable-workspace-trust',
      ],
    });
  } catch (err) {
    console.error('Integration tests failed:', err);
    process.exit(1);
  }
}

void main();
