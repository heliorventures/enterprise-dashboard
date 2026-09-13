import { defineConfig } from 'vitest/config';

// Bound jsdom workers so the complete suite does not exhaust workstation/CI memory.
export default defineConfig({ test: { maxWorkers: 2 } });
