#!/usr/bin/env node

const path = require('node:path');
const { prepareTomnyRuntime } = require('./prepare-tomny-runtime.js');

try {
  prepareTomnyRuntime({
    projectRoot: path.resolve(__dirname, '../../..'),
    platform: process.env.TOMNY_RUNTIME_PLATFORM || process.platform,
    arch: process.env.TOMNY_RUNTIME_ARCH || process.arch,
  });
} catch (error) {
  console.error('Failed to prepare Tomny Runtime:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
