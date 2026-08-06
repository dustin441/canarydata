#!/usr/bin/env node
import { runCompatibilityMatrix } from './test-social-compatibility-matrix.mjs';

const evidence = await runCompatibilityMatrix({ mode: 'rollback-drill' });
process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`);
if (!evidence.passed) process.exitCode = 1;
