
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterAll } from 'vitest';

// Create a unique temporary directory for this test file
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vitest-test-'));

// Set the environment variable
process.env.TEST_TMPDIR = tmpDir;
console.log(`[Setup] Created TEST_TMPDIR: ${tmpDir}`);

// Register cleanup to run after all tests in this file
afterAll(() => {
    try {
        if (fs.existsSync(tmpDir)) {
            fs.rmSync(tmpDir, { recursive: true, force: true });
            // console.log(`[Teardown] Cleaned up TEST_TMPDIR: ${tmpDir}`);
        }
    } catch (err) {
        console.error(`[Teardown] Failed to clean up TEST_TMPDIR: ${err}`);
    }
});
