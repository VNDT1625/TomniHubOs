import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { describe, expect, it } from 'vitest';
import { classifyRepository, parsePackageManifest } from '@/common/packages';
import { buildTomnyPackageFromRepo } from '../../../packages/desktop/src/process/extensions/package-manager/repoPackager';
import { verifyArtifactSignature } from '../../../packages/desktop/src/process/extensions/package-manager/artifactSecurity';

describe('Repo-to-Package Automated Classifier', () => {
  it('classifies an MCP Tool Server correctly', () => {
    const result = classifyRepository({
      files: ['src/index.ts', 'package.json', 'mcp.json'],
      packageJson: {
        name: 'sqlite-mcp-server',
        description: 'An MCP server for SQLite database operations',
        dependencies: {
          '@modelcontextprotocol/sdk': '^1.0.0',
        },
      },
    });

    expect(result.archetype).toBe('mcp-tool-server');
    expect(result.packageType).toBe('agent-capsule');
    expect(result.permissions).toContain('mcp.tool');
    expect(result.isSupported).toBe(true);

    const parsed = parsePackageManifest(result.manifest);
    expect(parsed.id).toBe('com.community.sqlite-mcp-server');
    expect(parsed.type).toBe('agent-capsule');
  });

  it('classifies a Chat Stage Package correctly', () => {
    const result = classifyRepository({
      files: ['src/docsRetrieverStage.ts', 'package.json'],
      fileSnippets: {
        'src/docsRetrieverStage.ts': 'export class DocsRetrieverStage implements IChatStage { phase = "retrieve"; }',
      },
      packageJson: {
        name: 'context7-docs-retriever',
        description: 'Context7 Realtime documentation retriever chat stage',
      },
    });

    expect(result.archetype).toBe('chat-stage');
    expect(result.packageType).toBe('agent-capsule');
    expect(result.permissions).toContain('chat.stage');
    expect(result.isSupported).toBe(true);

    const parsed = parsePackageManifest(result.manifest);
    expect(parsed.type).toBe('agent-capsule');
  });

  it('classifies a Workflow Capsule correctly', () => {
    const result = classifyRepository({
      files: ['workflow.json', 'README.md'],
      fileSnippets: {
        'workflow.json': '{"nodes": [{"type": "action.code"}], "connections": {}}',
      },
      repositoryName: 'landing-page-generator',
    });

    expect(result.archetype).toBe('workflow-capsule');
    expect(result.packageType).toBe('agent-capsule');
    expect(result.isSupported).toBe(true);

    const parsed = parsePackageManifest(result.manifest);
    expect(parsed.type).toBe('agent-capsule');
  });

  it('classifies a UI Theme package correctly', () => {
    const result = classifyRepository({
      files: ['dracula-theme.css', 'tokens.json', 'uno.config.ts', 'preview.png'],
      repositoryName: 'dracula-neon-theme',
    });

    expect(result.archetype).toBe('ui-theme');
    expect(result.packageType).toBe('ui');
    expect(result.permissions).toContain('ui.theme');

    const parsed = parsePackageManifest(result.manifest);
    expect(parsed.type).toBe('ui');
    expect(parsed.contributions?.themes).toBeDefined();
    expect(parsed.contributions?.themes?.[0].id).toBe('dracula-neon-theme');
  });

  it('classifies an IDE Document Viewer correctly', () => {
    const result = classifyRepository({
      files: ['index.html', 'src/viewer.ts', 'package.json'],
      packageJson: {
        name: 'mermaid-diagram-viewer',
        dependencies: { react: '^18.0.0' },
      },
    });

    expect(result.archetype).toBe('ide-viewer');
    expect(result.packageType).toBe('ui');
    expect(result.permissions).toContain('workspace.read');

    const parsed = parsePackageManifest(result.manifest);
    expect(parsed.type).toBe('ui');
    expect(parsed.contributions?.ide?.subtabs).toBeDefined();
    expect(parsed.dependencies).toEqual([{ id: 'com.tomni.ide', version: '>=1.0.0' }]);
  });

  it('classifies a Web Surface App with zero permissions by default (Least Privilege)', () => {
    const result = classifyRepository({
      files: ['index.html', 'src/main.tsx', 'vite.config.ts', 'package.json'],
      packageJson: {
        name: 'cyberchef-utility',
        description: 'The Cyber Swiss Army Knife for encryption and encoding',
        dependencies: { vite: '^5.0.0' },
      },
    });

    expect(result.archetype).toBe('web-surface-app');
    expect(result.packageType).toBe('app');
    expect(result.permissions).toEqual([]);
    expect(result.isSupported).toBe(true);
    expect(result.adminApprovalRequired).toBe(false);

    const parsed = parsePackageManifest(result.manifest);
    expect(parsed.type).toBe('app');
    expect(parsed.modules[0].runtime).toBe('sandboxed-web');
    expect(parsed.contributions?.apps?.[0].id).toBe('main');
  });

  it('flags a Service Daemon and requires Admin approval', () => {
    const result = classifyRepository({
      files: ['src/server.ts', 'package.json'],
      packageJson: {
        name: 'router9-gateway-daemon',
        dependencies: { express: '^4.18.0' },
      },
      fileSnippets: {
        'src/server.ts': 'app.listen(20128, () => console.log("Gateway listening"));',
      },
    });

    expect(result.archetype).toBe('service-daemon');
    expect(result.adminApprovalRequired).toBe(true);
    expect(result.permissions).toContain('network.listen');
  });

  it('safely rejects unsupported native kernel drivers', () => {
    const result = classifyRepository({
      files: ['driver.c', 'kernel_hook.h', 'Makefile'],
      repositoryName: 'rootkit-driver',
    });

    expect(result.archetype).toBe('unsupported-native');
    expect(result.isSupported).toBe(false);
  });
});

describe('Repo-to-Package End-to-End Packaging', () => {
  it('builds, signs, and produces a valid .tomny archive from a local project directory', async () => {
    const tempProjectDir = await fs.mkdtemp(path.join(tmpdir(), 'tomni-test-repo-'));
    const outputDir = await fs.mkdtemp(path.join(tmpdir(), 'tomni-test-out-'));

    try {
      // Create a mock web project
      await fs.writeFile(
        path.join(tempProjectDir, 'package.json'),
        JSON.stringify({
          name: 'color-palette-generator',
          description: 'A handy tool to create color palettes',
          version: '1.2.0',
        })
      );
      await fs.writeFile(
        path.join(tempProjectDir, 'index.html'),
        '<!doctype html><html><head><title>Color Palette</title></head><body><h1>Palettes</h1></body></html>'
      );
      await fs.writeFile(path.join(tempProjectDir, 'style.css'), 'body { background: #fafafa; }');

      const result = await buildTomnyPackageFromRepo({
        source: tempProjectDir,
        outputDirectory: outputDir,
        keyId: 'test-repo-signing-key',
      });

      expect(result.classification.archetype).toBe('web-surface-app');
      expect(result.manifest.id).toBe('com.community.color-palette-generator');
      expect(result.manifest.version).toBe('1.2.0');
      expect(result.manifest.artifact).toBeDefined();
      expect(result.manifest.artifact?.integrity).toMatch(/^sha256-[a-f0-9]{64}$/);
      expect(result.manifest.artifact?.signature.algorithm).toBe('ed25519');
      expect(result.manifest.artifact?.signature.keyId).toBe('test-repo-signing-key');
      expect(result.archiveBytes).toBeGreaterThan(0);

      // Verify that the produced file exists on disk and is a valid .tomny zip
      const fileStat = await fs.stat(result.artifactPath);
      expect(fileStat.isFile()).toBe(true);

      // Inspect ZIP file contents using JSZip
      const zipData = await fs.readFile(result.artifactPath);
      const zip = await JSZip.loadAsync(zipData);
      const manifestFile = zip.file('tomny-package.json');
      expect(manifestFile).toBeDefined();

      const manifestContent = await manifestFile!.async('text');
      const verifiedManifest = parsePackageManifest(JSON.parse(manifestContent));
      expect(verifiedManifest.id).toBe('com.community.color-palette-generator');
      expect(verifiedManifest.version).toBe('1.2.0');

      // Verify Ed25519 signature succeeds without throwing
      expect(() => {
        verifyArtifactSignature(verifiedManifest, {
          'test-repo-signing-key': result.publicKeyPem,
        });
      }).not.toThrow();

      // Verify payload entries are inside zip
      expect(zip.file('index.html')).toBeDefined();
      expect(zip.file('style.css')).toBeDefined();
    } finally {
      await fs.rm(tempProjectDir, { recursive: true, force: true });
      await fs.rm(outputDir, { recursive: true, force: true });
    }
  });
});
