import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { createWorker, PSM, type Worker } from 'tesseract.js';
import type { VisualArtifactBox, VisualArtifactTextAnalyzer, VisualArtifactTextBlock } from './types';

const OCR_LANGUAGES = ['eng', 'vie'] as const;
const OCR_SOURCE = `tesseract.js:${OCR_LANGUAGES.join('+')}`;

let workerPromise: Promise<Worker> | undefined;
let workQueue: Promise<void> = Promise.resolve();

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const resolveCachePath = (): string => {
  const configured = process.env.TOMNY_OCR_CACHE_DIR?.trim();
  if (configured) return path.resolve(configured);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA ?? homedir(), 'Tomny', 'ocr-cache');
  }
  if (process.platform === 'darwin') return path.join(homedir(), 'Library', 'Caches', 'Tomny', 'ocr');
  return path.join(process.env.XDG_CACHE_HOME ?? path.join(homedir(), '.cache'), 'tomny', 'ocr');
};

const resolvePackagedOcrPaths = (): { workerPath?: string; langPath?: string } => {
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) return {};
  const workerPath = path.join(
    resourcesPath,
    'app.asar.unpacked',
    'node_modules',
    'tesseract.js',
    'src',
    'worker-script',
    'node',
    'index.js'
  );
  const langPath = path.join(resourcesPath, 'ocr', 'lang');
  return {
    ...(existsSync(workerPath) ? { workerPath } : {}),
    ...(existsSync(path.join(langPath, 'eng.traineddata.gz')) && existsSync(path.join(langPath, 'vie.traineddata.gz'))
      ? { langPath }
      : {}),
  };
};

const createBox = (
  box: { x0: number; y0: number; x1: number; y1: number },
  imageWidth: number,
  imageHeight: number
): VisualArtifactBox => {
  const x = Math.max(0, Math.round(box.x0));
  const y = Math.max(0, Math.round(box.y0));
  const width = Math.max(0, Math.round(box.x1 - box.x0));
  const height = Math.max(0, Math.round(box.y1 - box.y0));
  return {
    x,
    y,
    width,
    height,
    normalized: {
      x: clamp01(imageWidth > 0 ? x / imageWidth : 0),
      y: clamp01(imageHeight > 0 ? y / imageHeight : 0),
      width: clamp01(imageWidth > 0 ? width / imageWidth : 0),
      height: clamp01(imageHeight > 0 ? height / imageHeight : 0),
    },
  };
};

const getWorker = async (): Promise<Worker> => {
  if (workerPromise) return workerPromise;
  const pending = (async (): Promise<Worker> => {
    const cachePath = resolveCachePath();
    await mkdir(cachePath, { recursive: true });
    const packagedPaths = resolvePackagedOcrPaths();
    const worker = await createWorker([...OCR_LANGUAGES], undefined, { cachePath, ...packagedPaths });
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
      preserve_interword_spaces: '1',
    });
    return worker;
  })();
  workerPromise = pending;
  void pending.catch(() => {
    if (workerPromise === pending) workerPromise = undefined;
  });
  return pending;
};

const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
  const run = workQueue.then(task, task);
  workQueue = run.then(
    (): undefined => undefined,
    (): undefined => undefined
  );
  return run;
};

const lineBlocks = (
  blocks: NonNullable<Awaited<ReturnType<Worker['recognize']>>['data']['blocks']>,
  width: number,
  height: number
): VisualArtifactTextBlock[] =>
  blocks.flatMap((block, blockIndex) =>
    block.paragraphs.flatMap((paragraph, paragraphIndex) =>
      paragraph.lines.flatMap((line, lineIndex) => {
        const text = line.text.trim();
        if (!text) return [];
        return [
          {
            id: `ocr-${blockIndex + 1}-${paragraphIndex + 1}-${lineIndex + 1}`,
            text,
            box: createBox(line.bbox, width, height),
            confidence: clamp01(line.confidence / 100),
            source: OCR_SOURCE,
          },
        ];
      })
    )
  );

/** Local-only OCR. Image bytes are processed in a WASM worker and never uploaded. */
export const analyzeTextWithLocalOcr: VisualArtifactTextAnalyzer = async ({ imagePath, width, height }) =>
  runExclusive(async () => {
    const worker = await getWorker();
    const result = await worker.recognize(imagePath, {}, { text: true, blocks: true });
    const blocks = result.data.blocks ? lineBlocks(result.data.blocks, width, height) : [];
    const text = result.data.text.trim();
    if (blocks.length > 0 || !text) return blocks;
    return [
      {
        id: 'ocr-1',
        text,
        box: createBox({ x0: 0, y0: 0, x1: width, y1: height }, width, height),
        confidence: clamp01(result.data.confidence / 100),
        source: OCR_SOURCE,
      },
    ];
  });

export const terminateLocalOcr = async (): Promise<void> => {
  const pending = workerPromise;
  workerPromise = undefined;
  if (!pending) return;
  const worker = await pending;
  await runExclusive(async () => {
    await worker.terminate();
  });
};
