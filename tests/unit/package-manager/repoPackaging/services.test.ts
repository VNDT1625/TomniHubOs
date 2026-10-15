import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  classifyRepository,
  detectServices,
  scanEnvironmentUsage,
} from '../../../../packages/desktop/src/common/packages';
import { buildTomnyPackageFromRepo } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/packager';
import { renderSuccess } from '../../../../packages/desktop/src/process/extensions/package-manager/repoPackaging/report';
import { readArchive, testSigning, withTemp, writeTree } from './helpers';

const NEXT_PACKAGE = JSON.stringify({
  name: 'web',
  scripts: { dev: 'next dev', build: 'next build' },
  dependencies: { next: '14.0.0', react: '18.0.0' },
});
const FASTAPI_PYPROJECT = '[project]\nname = "api"\ndependencies = ["fastapi", "uvicorn"]\n';
const ENV_EXAMPLE = '# database\nDATABASE_URL=\nLOG_LEVEL=info\nSECRET_KEY=""\n';

describe('reading the variables a program asks for', () => {
  it('tells required from optional in Python', () => {
    const usage = scanEnvironmentUsage(
      'api/config.py',
      [
        'import os',
        'A = os.environ["DATABASE_URL"]',
        'B = os.environ.get("LOG_LEVEL", "info")',
        'C = os.getenv("OPENAI_API_KEY")',
        'D = os.getenv("REGION", None)',
        'E = os.environ.get("HOME")',
      ].join('\n')
    );
    const byName = Object.fromEntries(usage.map((entry) => [entry.name, entry.required]));
    expect(byName).toEqual({ DATABASE_URL: true, LOG_LEVEL: false, OPENAI_API_KEY: true, REGION: false });
  });

  it('reads pydantic settings fields: no default means required', () => {
    const usage = scanEnvironmentUsage(
      'api/settings.py',
      [
        'from pydantic_settings import BaseSettings',
        '',
        'class Settings(BaseSettings):',
        '    database_url: str',
        '    debug: bool = False',
        '',
        'class Other:',
        '    not_a_setting: str',
      ].join('\n')
    );
    expect(usage.map((entry) => [entry.name, entry.required])).toEqual([
      ['DATABASE_URL', true],
      ['DEBUG', false],
    ]);
  });

  it('reads JavaScript and Vite variables and treats a fallback as optional', () => {
    const usage = scanEnvironmentUsage(
      'web/lib/env.ts',
      'const a = process.env.API_URL;\nconst b = process.env.SITE_NAME ?? "x";\nconst c = import.meta.env.VITE_KEY;\nconst d = process.env["TOKEN"];\nprocess.env.NODE_ENV;'
    );
    const byName = Object.fromEntries(usage.map((entry) => [entry.name, entry.required]));
    expect(byName).toEqual({ API_URL: true, SITE_NAME: false, VITE_KEY: true, TOKEN: true });
  });
});

describe('finding the services of a repository', () => {
  it('starts back ends before the front end and shows the front end', () => {
    const detection = detectServices(
      ['apps/api/pyproject.toml', 'apps/api/app/main.py', 'apps/web/package.json', 'apps/web/pnpm-lock.yaml'],
      {
        'apps/api/pyproject.toml': FASTAPI_PYPROJECT,
        'apps/web/package.json': NEXT_PACKAGE,
      }
    );
    expect(detection.services.map((service) => service.id)).toEqual(['api', 'web']);
    expect(detection.embed).toBe('web');
    expect(detection.services[0]).toMatchObject({
      directory: 'apps/api',
      start: ['uvicorn', 'app.main:app', '--port', '8000'],
      port: 8000,
      embeddable: false,
      setup: [['pip', 'install', '-e', '.']],
    });
    expect(detection.services[1]).toMatchObject({
      directory: 'apps/web',
      start: ['pnpm', 'run', 'dev'],
      setup: [['pnpm', 'install']],
      port: 3000,
    });
  });

  it('reads the port from the dev script and picks Streamlit and Gradio entries', () => {
    const vite = detectServices(['package.json'], {
      'package.json': JSON.stringify({ scripts: { dev: 'vite --port 4000' }, devDependencies: { vite: '5' } }),
    });
    expect(vite.services[0]).toMatchObject({ port: 4000, start: ['npm', 'run', 'dev'] });

    const streamlit = detectServices(['requirements.txt', 'app.py'], { 'requirements.txt': 'streamlit==1.30\n' });
    expect(streamlit.services[0]).toMatchObject({ port: 8501, framework: 'Streamlit' });
    expect(streamlit.services[0]?.start.slice(0, 3)).toEqual(['streamlit', 'run', 'app.py']);

    const gradio = detectServices(['requirements.txt', 'demo.py'], { 'requirements.txt': 'gradio\n' });
    expect(gradio.services[0]).toMatchObject({ start: ['python', 'demo.py'], port: 7860 });
  });

  it('has nothing to show for a back end alone, and notes a compose file', () => {
    const detection = detectServices(['pyproject.toml', 'main.py', 'docker-compose.yml'], {
      'pyproject.toml': FASTAPI_PYPROJECT,
      'docker-compose.yml': 'services: {}',
    });
    expect(detection.services).toHaveLength(1);
    expect(detection.embed).toBeUndefined();
    expect(detection.notes.join(' ')).toContain('docker-compose.yml');
  });

  it('lists the example file first, then what the code reads', () => {
    const detection = detectServices(
      ['api/pyproject.toml', 'api/main.py'],
      { 'api/pyproject.toml': FASTAPI_PYPROJECT, '.env.example': ENV_EXAMPLE },
      [
        { path: 'api/main.py', name: 'OPENAI_API_KEY', required: true },
        { path: 'api/main.py', name: 'DATABASE_URL', required: true },
        { path: 'other/x.py', name: 'ELSEWHERE', required: true },
      ]
    );
    expect(detection.services[0]?.env).toEqual([
      { name: 'DATABASE_URL', required: true, hint: '.env.example' },
      { name: 'LOG_LEVEL', required: false, hint: '.env.example' },
      { name: 'SECRET_KEY', required: true, hint: '.env.example' },
      { name: 'OPENAI_API_KEY', required: true, hint: 'api/main.py' },
    ]);
  });
});

describe('what the rules hand to an agent or the user', () => {
  it('lists required variables, projects it did not understand, and a choice between front ends', () => {
    const files = [
      'apps/api/pyproject.toml',
      'apps/api/app/main.py',
      'apps/web/package.json',
      'apps/admin/package.json',
      'apps/mobile/pubspec.yaml',
      'apps/worker/Dockerfile',
    ];
    const result = classifyRepository({
      files,
      repositoryName: 'platform',
      fileSnippets: {
        'apps/api/pyproject.toml': FASTAPI_PYPROJECT,
        'apps/web/package.json': NEXT_PACKAGE,
        'apps/admin/package.json': NEXT_PACKAGE,
        '.env.example': ENV_EXAMPLE,
      },
    });
    const items = result.openItems ?? [];
    expect(items.filter((item) => item.kind === 'env-value').map((item) => item.name)).toContain('DATABASE_URL');
    expect(items.filter((item) => item.kind === 'unrecognized').map((item) => item.path)).toEqual([
      'source/apps/mobile',
      'source/apps/worker',
    ]);
    expect(items.find((item) => item.kind === 'choose')?.options).toEqual(['admin', 'web']);
  });

  it('keeps a connection whose host exists out of the waiting list, and prints the rest', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'platform');
      await writeTree(repo, {
        '.env.example': ENV_EXAMPLE,
        'apps/web/package.json': NEXT_PACKAGE,
        'apps/mobile/pubspec.yaml': 'name: app',
      });
      const result = await buildTomnyPackageFromRepo({
        source: '',
        workspaceRoot: repo,
        outputDirectory: path.join(parent, 'out'),
        signing: testSigning(),
      });
      const kinds = (result.adapter?.openItems ?? []).map((item) => item.kind);
      expect(kinds).not.toContain('needs-runtime');
      expect(kinds).toContain('unrecognized');
      const archive = await readArchive(result.artifactPath);
      const stored = JSON.parse(archive.get('adapter/adapter.json')?.toString('utf8') ?? 'null');
      expect(stored.openItems).toEqual(result.adapter?.openItems);
      const report = renderSuccess(result);
      expect(report).toContain('Việc còn mở');
      expect(report).toContain('source/apps/mobile');
    });
  });
});

describe('a repository with a front end, a back end and a mobile app', () => {
  const tree = {
    'README.md': '# platform',
    '.env.example': ENV_EXAMPLE,
    'docker-compose.yml': 'services: {}',
    'apps/backend/pyproject.toml': FASTAPI_PYPROJECT,
    'apps/backend/app/main.py': 'import os\nURL = os.environ["DATABASE_URL"]\nKEY = os.getenv("OPENAI_API_KEY")\n',
    'apps/web/package.json': NEXT_PACKAGE,
    'apps/web/app/page.tsx': 'export default () => process.env.NEXT_PUBLIC_API_URL;',
    'apps/mobile/pubspec.yaml': 'name: app',
    'apps/mobile/lib/main.dart': 'void main() {}',
    'apps/mobile/windows/runner/main.cpp': 'int main() {}',
    'apps/mobile/windows/runner/utils.h': '#pragma once',
  };

  it('is not mistaken for native code, and connects the page it can show', () => {
    const result = classifyRepository({
      files: Object.keys(tree),
      repositoryName: 'platform',
      fileSnippets: {
        '.env.example': ENV_EXAMPLE,
        'apps/backend/pyproject.toml': FASTAPI_PYPROJECT,
        'apps/web/package.json': NEXT_PACKAGE,
      },
    });
    expect(result.archetype).toBe('web-service-app');
    expect(result.runnable).toBe(true);
    const [connection] = result.connections ?? [];
    expect(connection?.kind).toBe('web-embed');
  });

  it('is still refused when C++ is all there is', () => {
    expect(classifyRepository({ files: ['driver.c', 'driver.h', 'Makefile'] }).archetype).toBe('unsupported-native');
  });

  it('is packaged with its commands, ports and variables, and reported as waiting for a runtime', async () => {
    await withTemp(async (parent) => {
      const repo = path.join(parent, 'platform');
      await writeTree(repo, tree);
      const result = await buildTomnyPackageFromRepo({
        source: '',
        workspaceRoot: repo,
        outputDirectory: path.join(parent, 'out'),
        signing: testSigning(),
      });
      expect(result.classification.archetype).toBe('web-service-app');
      expect(result.verified).toBe(true);

      const archive = await readArchive(result.artifactPath);
      expect(archive.has('source/apps/mobile/lib/main.dart')).toBe(true);
      const adapter = JSON.parse(archive.get('adapter/adapter.json')?.toString('utf8') ?? 'null');
      const embedded = adapter.connections.find((connection: { kind: string }) => connection.kind === 'web-embed');
      expect(embedded.kind).toBe('web-embed');
      expect(embedded.process.embed).toEqual({ service: 'web' });
      const [api, web] = embedded.process.services;
      expect(api).toMatchObject({ id: 'backend', cwd: 'source/apps/backend', ready: { port: 8000 } });
      expect(api.env.map((variable: { name: string }) => variable.name)).toEqual([
        'DATABASE_URL',
        'LOG_LEVEL',
        'SECRET_KEY',
        'OPENAI_API_KEY',
      ]);
      expect(web).toMatchObject({ id: 'web', start: ['npm', 'run', 'dev'], ready: { port: 3000 } });

      const report = renderSuccess(result);
      expect(report).toContain('npm install → npm run dev');
      expect(report).toContain('DATABASE_URL');
      expect(report).toContain('web-embed');
    });
  });
});
