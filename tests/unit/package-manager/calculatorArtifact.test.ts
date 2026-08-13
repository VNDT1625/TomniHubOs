/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { expect, it } from 'vitest';

type CalculatorBundle = {
  format: 'tomni-package-bundle-v1';
  manifest: { id: string; modules: Array<{ runtime?: string; entrypoint?: string }> };
  files: Record<string, string>;
};

const readCalculatorHtml = async (): Promise<{ bundle: CalculatorBundle; html: string }> => {
  const content = await readFile(
    path.resolve('store-artifacts', 'com.tomni.calculator-1.0.0.tomni-package.json'),
    'utf8'
  );
  const bundle = JSON.parse(content) as CalculatorBundle;
  const encoded = bundle.files['index.html'];
  if (!encoded) throw new Error('Calculator package is missing index.html.');
  return { bundle, html: Buffer.from(encoded, 'base64').toString('utf8') };
};

it('executes calculator behavior from the downloaded package payload', async () => {
  const { bundle, html } = await readCalculatorHtml();
  expect(bundle.manifest).toMatchObject({
    id: 'com.tomni.calculator',
    modules: [{ runtime: 'sandboxed-web', entrypoint: 'index.html' }],
  });

  const dom = new JSDOM(html, { runScripts: 'dangerously', url: 'https://package.invalid/' });
  const click = (label: string): void => {
    const button = [...dom.window.document.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.trim() === label
    );
    if (!button) throw new Error(`Calculator key ${label} was not rendered.`);
    (button as HTMLButtonElement).click();
  };

  click('7');
  click('+');
  click('5');
  click('=');
  expect(dom.window.document.querySelector('#display')?.textContent).toBe('12');
  dom.window.close();
});

it('ships a restrictive offline content security policy in the package itself', async () => {
  const { html } = await readCalculatorHtml();
  const dom = new JSDOM(html);
  const policy = dom.window.document
    .querySelector('meta[http-equiv="Content-Security-Policy"]')
    ?.getAttribute('content');
  expect(policy).toContain("default-src 'none'");
  expect(policy).toContain("connect-src 'none'");
  expect(policy).toContain("form-action 'none'");
  dom.window.close();
});
