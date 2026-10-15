import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const scripts = path.resolve('scripts');
const python = spawnSync('python', ['--version']).status === 0;

/** Runs a snippet of Python that imports the benchmark module and prints one JSON value. */
const py = (code: string): unknown => {
  const result = spawnSync(
    'python',
    ['-c', `import sys, json; sys.path.insert(0, ${JSON.stringify(scripts)}); import whisper_benchmark as b; ${code}`],
    { encoding: 'utf8', env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }
  );
  if (result.status !== 0) throw new Error(result.stderr);
  return JSON.parse(result.stdout);
};

describe.skipIf(!python)('whisper benchmark metrics', () => {
  it('scores identical text as 0 and a fully different text as 1', () => {
    expect(
      py("print(json.dumps([b.wer('mở trình duyệt', 'mở trình duyệt'), b.wer('mở trình duyệt', 'đóng cửa sổ')]))")
    ).toEqual([0, 1]);
  });

  it('ignores case and punctuation but not Vietnamese tone marks', () => {
    expect(py("print(json.dumps([b.wer('Mở Chrome!', 'mở chrome'), b.wer('mở', 'mờ')]))")).toEqual([0, 1]);
  });

  it('counts substitutions, deletions and insertions over the reference length', () => {
    expect(
      py("print(json.dumps([b.wer('a b c d', 'a x c d'), b.wer('a b c d', 'a c d'), b.wer('a b', 'a b c d')]))")
    ).toEqual([0.25, 0.25, 1]);
  });

  it('handles an empty reference', () => {
    expect(py("print(json.dumps([b.wer('', ''), b.wer('', 'x')]))")).toEqual([0, 1]);
  });

  it('keeps the intent when every keyword is present, drops it otherwise, and skips lines without keywords', () => {
    expect(
      py(
        "print(json.dumps([b.intent_kept(['chrome'], 'Hãy mở Chrome giúp tôi'), b.intent_kept(['chrome', 'mở'], 'đóng Chrome'), b.intent_kept([], 'x')]))"
      )
    ).toEqual([true, false, null]);
  });

  it('summarises error, intent and timing', () => {
    expect(
      py(
        "r=[{'wer':0.0,'ms':100,'intent':True},{'wer':0.5,'ms':300,'intent':False},{'wer':0.1,'ms':200,'intent':None}]; s=b.summarize(r); print(json.dumps([s['samples'], round(s['wer'],3), s['intent'], s['ms_mean'], s['ms_p95']]))"
      )
    ).toEqual([3, 0.2, 0.5, 200, 300]);
  });

  it('reads the reference file with optional keywords and ignores comments', () => {
    const out = py(
      "import tempfile, os; f=os.path.join(tempfile.mkdtemp(),'r.tsv'); T=chr(9); N=chr(10); open(f,'w',encoding='utf-8').write(N.join(['# note','','a.ogg'+T+'mở chrome'+T+'chrome;mở','b.ogg'+T+'chụp màn hình',''])); print(json.dumps(b.read_refs(f)))"
    );
    expect(out).toEqual([
      ['a.ogg', 'mở chrome', ['chrome', 'mở']],
      ['b.ogg', 'chụp màn hình', []],
    ]);
  });
});
