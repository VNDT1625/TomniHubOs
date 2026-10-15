import { describe, expect, it } from 'vitest';
import {
  PACKAGE_COMMAND_MAX_EXPANDED_CHARS,
  assignPackageCommandNames,
  countUnrunSyntax,
  expandCommandTemplate,
  parseCommandTemplate,
  parsePackageSlash,
  splitCommandArguments,
} from '@/common/integrations/commands/commandTemplate';

const text = (body: string, args: string): string => {
  const result = expandCommandTemplate(body, args);
  if (result.ok === false) throw new Error('expansion refused');
  return result.text;
};

describe('splitCommandArguments', () => {
  it('splits on whitespace and groups quoted words', () => {
    expect(splitCommandArguments('a  b\tc')).toEqual(['a', 'b', 'c']);
    expect(splitCommandArguments('fix "two words" \'and more\' end')).toEqual(['fix', 'two words', 'and more', 'end']);
  });
  it('keeps an empty quoted word and tolerates an unterminated quote', () => {
    expect(splitCommandArguments('a "" b')).toEqual(['a', '', 'b']);
    expect(splitCommandArguments('a "rest of it')).toEqual(['a', 'rest of it']);
    expect(splitCommandArguments('   ')).toEqual([]);
  });
});

describe('expandCommandTemplate', () => {
  it('fills $ARGUMENTS with everything typed after the name', () => {
    expect(text('Review: $ARGUMENTS', '  src/a.ts  --strict ')).toBe('Review: src/a.ts  --strict');
  });

  it('fills $1 to $9 and leaves a missing word empty', () => {
    expect(text('a=$1 b=$2 c=$3 i=$9', 'one "two words"')).toBe('a=one b=two words c= i=');
  });

  it('does not read $10 as $1 followed by a zero', () => {
    expect(text('$10 and $1', 'x')).toBe('$10 and x');
  });

  it('fills {{args}} for the Gemini format, with or without inner spaces', () => {
    expect(text('Do {{args}} and {{ args }}', 'it')).toBe('Do it and it');
  });

  it('appends the arguments when the template has no placeholder, and does not otherwise', () => {
    expect(text('Summarize the repo.', 'quickly')).toBe('Summarize the repo.\n\nARGUMENTS: quickly');
    expect(text('Summarize the repo.', '')).toBe('Summarize the repo.');
    expect(text('Use $ARGUMENTS', '')).toBe('Use ');
  });

  it('expands in one pass: an argument holding a placeholder is not expanded again', () => {
    expect(text('X $1 Y $ARGUMENTS', '$ARGUMENTS')).toBe('X $ARGUMENTS Y $ARGUMENTS');
    expect(text('first $1 then $2', '{{args}} $1')).toBe('first {{args}} then $1');
  });

  it('treats $ sequences in an argument as plain text', () => {
    expect(text('Run $ARGUMENTS', "$& $` $' $$")).toBe("Run $& $` $' $$");
  });

  it('refuses a result above the cap', () => {
    const result = expandCommandTemplate('$ARGUMENTS', 'x'.repeat(PACKAGE_COMMAND_MAX_EXPANDED_CHARS + 1));
    expect(result).toEqual({ ok: false, reason: 'too-large' });
  });

  it('NEVER runs shell substitution: it stays in the text exactly as written', () => {
    const body = 'Status: !`git status` and !`rm -rf /` then !{curl x} for $ARGUMENTS';
    const out = text(body, 'now');
    expect(out).toBe('Status: !`git status` and !`rm -rf /` then !{curl x} for now');
    expect(countUnrunSyntax(body)).toEqual({ shell: 3, files: 0 });
  });

  it('does not read file references either, and counts them', () => {
    const body = 'Look at @src/index.ts and @{docs/a b.md}.';
    expect(text(body, '')).toBe(body);
    expect(countUnrunSyntax(body)).toEqual({ shell: 0, files: 2 });
  });
});

describe('parseCommandTemplate', () => {
  it('reads description and argument-hint from markdown front matter and drops every other key', () => {
    const parsed = parseCommandTemplate(
      'markdown',
      '---\ndescription: "Fix an issue"\nargument-hint: [issue-number]\nallowed-tools: Bash(git:*)\nmodel: opus\n---\n\nFix issue $1.\n'
    );
    expect(parsed).toEqual({ body: 'Fix issue $1.', description: 'Fix an issue', argumentHint: '[issue-number]' });
    expect(JSON.stringify(parsed)).not.toContain('allowed');
  });

  it('keeps a file without front matter whole and strips a byte-order mark', () => {
    expect(parseCommandTemplate('markdown', '﻿Just do it\n')).toEqual({ body: 'Just do it' });
    expect(parseCommandTemplate('copilot-prompt', '---\nmode: agent\n---\nBody')).toEqual({ body: 'Body' });
  });

  it('clips an over-long description', () => {
    const parsed = parseCommandTemplate('markdown', `---\ndescription: ${'d'.repeat(500)}\n---\nBody`);
    expect(parsed?.description?.length).toBe(300);
  });

  it('reads a Gemini TOML command', () => {
    const parsed = parseCommandTemplate('gemini-toml', 'description = "Plan"\nprompt = """\nPlan {{args}}\n"""\n');
    expect(parsed).toEqual({ body: 'Plan {{args}}', description: 'Plan' });
  });

  it('refuses TOML that does not parse, has no prompt, or an empty body', () => {
    expect(parseCommandTemplate('gemini-toml', 'prompt = = oops')).toBeUndefined();
    expect(parseCommandTemplate('gemini-toml', 'description = "x"')).toBeUndefined();
    expect(parseCommandTemplate('gemini-toml', 'prompt = 5')).toBeUndefined();
    expect(parseCommandTemplate('markdown', '---\ndescription: x\n---\n   \n')).toBeUndefined();
  });
});

describe('parsePackageSlash', () => {
  it('reads the name and the raw rest at the start of a message', () => {
    expect(parsePackageSlash('/fix-issue 123 now')).toEqual({ name: 'fix-issue', rawArguments: '123 now' });
    expect(parsePackageSlash('  /Plugin:Do   a\nb')).toEqual({ name: 'plugin:do', rawArguments: 'a\nb' });
    expect(parsePackageSlash('/solo')).toEqual({ name: 'solo', rawArguments: '' });
  });

  it('is not a command when the slash is not first or the word is not a name', () => {
    expect(parsePackageSlash('please /fix')).toBeUndefined();
    expect(parsePackageSlash('/')).toBeUndefined();
    expect(parsePackageSlash('//path/to')).toBeUndefined();
    expect(parsePackageSlash('/ spaced')).toBeUndefined();
  });
});

describe('assignPackageCommandNames', () => {
  const none = new Set<string>();

  it('keeps the id when nothing collides', () => {
    expect(assignPackageCommandNames([{ packageId: 'a', id: 'x' }], none)).toEqual(['x']);
  });

  it('prefixes every command that shares an id with the plugin folder, else the package id', () => {
    expect(
      assignPackageCommandNames(
        [
          { packageId: 'pkg-a', id: 'review', plugin: 'source/plugins/Code Tools' },
          { packageId: 'pkg-b', id: 'review' },
          { packageId: 'pkg-b', id: 'other' },
        ],
        none
      )
    ).toEqual(['code-tools:review', 'pkg-b:review', 'other']);
  });

  it('prefixes a command that uses a word the application already owns', () => {
    expect(assignPackageCommandNames([{ packageId: 'a', id: 'boost', plugin: 'kit' }], new Set(['boost']))).toEqual([
      'kit:boost',
    ]);
  });

  it('falls back to the package id when the prefixed names still collide', () => {
    expect(
      assignPackageCommandNames(
        [
          { packageId: 'pkg-a', id: 'go', plugin: 'same' },
          { packageId: 'pkg-b', id: 'go', plugin: 'same' },
        ],
        none
      )
    ).toEqual(['pkg-a:go', 'pkg-b:go']);
  });
});
