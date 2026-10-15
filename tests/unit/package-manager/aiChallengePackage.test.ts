/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { JSDOM } from 'jsdom';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseAdapterDocument,
  readAdapterDocument,
  parsePackageManifest,
} from '../../../packages/desktop/src/common/packages';
import { verifyArtifactSignature } from '../../../packages/desktop/src/process/extensions/package-manager/artifactSecurity';
import { buildPackageProject } from '../../../scripts/package-apps/packageProject';
import {
  TomniGameAdapter,
  type AgentDecision,
  type CoachDirective,
} from '../../../packages/package-apps/ai-challenge/adapter/tomniGameAdapter';

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('AI Challenge standard package app (com.tomni.ai-challenge)', () => {
  const packageDir = path.resolve('packages/package-apps/ai-challenge');

  it('validates manifest schema v1 with sandboxed-web runtime and sidebar sessions', async () => {
    const manifestContent = await readFile(path.join(packageDir, 'tomny-package.json'), 'utf8');
    const manifest = parsePackageManifest(JSON.parse(manifestContent));

    expect(manifest.id).toBe('com.tomni.ai-challenge');
    expect(manifest.publisherId).toBe('com.tomni');
    expect(manifest.type).toBe('app');
    expect(manifest.bundleKind).toBe('single');
    expect(manifest.modules).toEqual([
      expect.objectContaining({
        id: 'arena',
        surface: 'apps/ai-challenge',
        runtime: 'sandboxed-web',
        entrypoint: 'index.html',
        pinnable: true,
      }),
    ]);
    expect(manifest.permissions).toContain('sidebar.sessions');
    expect(manifest.tags).toContain('game');
    expect(manifest.tags).toContain('ai-arena');
    expect(manifest.contributions?.apps).toEqual([
      expect.objectContaining({
        id: 'arena',
        moduleId: 'arena',
      }),
    ]);
  });

  it('validates adapter.json against RepoToPackage v2 connection schema', async () => {
    const adapterContent = await readFile(path.join(packageDir, 'adapter', 'adapter.json'), 'utf8');
    const rawAdapter = JSON.parse(adapterContent);

    // Strict validation for writer/builder
    const strictParsed = parseAdapterDocument(rawAdapter);
    expect(strictParsed.schemaVersion).toBe(1);
    expect(strictParsed.generatedBy).toBe('user');
    expect(strictParsed.connections).toHaveLength(1);
    expect(strictParsed.connections[0]).toMatchObject({
      kind: 'skill',
      path: 'adapter/skills/coach-tactics',
    });

    // Tolerant reading for host loader
    const { document: readDoc, issues } = readAdapterDocument(rawAdapter);
    expect(issues).toEqual([]);
    expect(readDoc.connections).toEqual(strictParsed.connections);

    // Verify backing SKILL.md exists
    const skillPath = path.join(packageDir, 'adapter', 'skills', 'coach-tactics', 'SKILL.md');
    const skillContent = await readFile(skillPath, 'utf8');
    expect(skillContent).toContain('name: coach-tactics');
    expect(skillContent).toContain('AI Challenge');
  });

  it('builds a verified, signed .tomny package artifact using packageProject', async () => {
    const outputDir = await mkdtemp(path.join(os.tmpdir(), 'ai-challenge-build-'));
    roots.push(outputDir);

    const keys = generateKeyPairSync('ed25519');
    const keyPath = path.join(outputDir, 'private.pem');
    await writeFile(keyPath, keys.privateKey.export({ type: 'pkcs8', format: 'pem' }));

    const result = await buildPackageProject({
      projectDirectory: packageDir,
      outputDirectory: outputDir,
      privateKeyPath: keyPath,
      keyId: 'dev-signing-key',
    });

    expect(result.artifactPath).toContain('com.tomni.ai-challenge-1.0.0.tomny');
    expect(result.archiveBytes).toBeGreaterThan(0);

    const archive = await JSZip.loadAsync(await readFile(result.artifactPath));
    const manifest = parsePackageManifest(
      JSON.parse(await archive.file('tomny-package.json')!.async('string'))
    );

    // Verify Ed25519 signature
    verifyArtifactSignature(manifest, {
      'dev-signing-key': keys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
    });

    // Verify payload entrypoint exists in archive with scripts inlined
    expect(archive.file('index.html')).not.toBeNull();
    const indexHtml = await archive.file('index.html')!.async('string');
    expect(indexHtml).toContain('AI Challenge - Mech Arena');
    expect(indexHtml).toContain('TomniGameAdapter');
    expect(indexHtml).toContain('ModelDecisionProvider');
    expect(indexHtml).toContain('AiChallengeHangar');
    expect(indexHtml).toContain('AiChallengeArenaSimulator');
    expect(indexHtml).not.toContain('tomni:inline');

    // Verify adapter and skills exist in archive according to RepoToPackage v2
    expect(archive.file('adapter/adapter.json')).not.toBeNull();
    const archivedAdapter = parseAdapterDocument(
      JSON.parse(await archive.file('adapter/adapter.json')!.async('string'))
    );
    expect(archivedAdapter.schemaVersion).toBe(1);
    expect(archivedAdapter.connections).toHaveLength(1);
    expect(archivedAdapter.connections[0].path).toBe('adapter/skills/coach-tactics');

    expect(archive.file('adapter/skills/coach-tactics/SKILL.md')).not.toBeNull();
    const archivedSkill = await archive.file('adapter/skills/coach-tactics/SKILL.md')!.async('string');
    expect(archivedSkill).toContain('name: coach-tactics');
  });

  it('complies strictly with sandboxed-web security and offline CSP', async () => {
    const html = await readFile(path.join(packageDir, 'payload', 'index.html'), 'utf8');
    const dom = new JSDOM(html);

    // 1. Restrictive CSP meta tag
    const csp = dom.window.document
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content');
    expect(csp).toBeTruthy();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("connect-src 'none'");

    // 2. No external remote scripts
    const scripts = Array.from(dom.window.document.querySelectorAll('script'));
    for (const script of scripts) {
      const src = script.getAttribute('src');
      expect(src).toBeNull();
    }

    // 3. No external remote stylesheets
    const links = Array.from(dom.window.document.querySelectorAll('link[rel="stylesheet"]'));
    expect(links).toHaveLength(0);

    // 4. Structure: weight classes, telemetry, coach corner, canvas
    expect(dom.window.document.querySelector('#gameCanvas')).not.toBeNull();
    expect(dom.window.document.querySelector('#logFeed')).not.toBeNull();
    expect(dom.window.document.querySelector('#coachForm')).not.toBeNull();
    expect(dom.window.document.querySelector('#focusPips')).not.toBeNull();
    expect(dom.window.document.querySelector('#modelModal')).not.toBeNull();
  });

  it('verifies TomniGameAdapter postMessage event contracts', () => {
    const sentMessages: unknown[] = [];
    const mockWindow = {
      postMessage: (msg: unknown) => {
        sentMessages.push(msg);
      },
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as Window;

    const receivedActions: AgentDecision[] = [];
    const receivedDirectives: CoachDirective[] = [];

    const adapter = new TomniGameAdapter({
      gameId: 'ai-challenge',
      title: 'Mech Arena',
      targetWindow: mockWindow,
      onAction: (act) => receivedActions.push(act),
      onCoachDirective: (dir) => receivedDirectives.push(dir),
    });

    // 1. Send Observation
    adapter.sendObservation({
      matchId: 'm-123',
      tick: 42,
      timeLeftSeconds: 95,
      distance: 3.2,
      myMech: {
        name: 'V-Striker',
        hp: 85,
        maxHp: 100,
        energy: 60,
        maxEnergy: 100,
        element: 'lightning',
        positionX: 2.0,
        status: 'idle',
      },
      opponentMech: {
        name: 'Dreadnought',
        hp: 70,
        maxHp: 100,
        energy: 40,
        maxEnergy: 100,
        element: 'fire',
        positionX: 5.2,
        status: 'attacking',
      },
    });

    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]).toMatchObject({
      type: 'tomni.game.observation',
      matchId: 'm-123',
      tick: 42,
      distance: 3.2,
    });

    // 2. Report Sidebar Session (normalized to valid TomniHubOS status 'working')
    adapter.reportSession({
      matchId: 'm-123',
      title: 'Mech Arena: 85% vs 70%',
      status: 'in-battle',
      lastActiveAt: 123456789,
    });

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[1]).toMatchObject({
      type: 'tomni.capability.invoke',
      capability: 'sessions.report',
      args: {
        sessions: [
          expect.objectContaining({
            id: 'm-123',
            status: 'working',
          }),
        ],
      },
    });

    adapter.dispose();
  });
});
