import { describe, expect, it } from 'vitest';
import {
  actionQueryText,
  emptyActionEvidence,
  recordActionEvidence,
  renderActionEvidence,
} from '@/process/services/database/nativeConversation/actionContext';

describe('action evidence ledger', () => {
  it('keeps research query, files, symbols and only marked evidence', () => {
    const ledger = emptyActionEvidence();
    recordActionEvidence(
      ledger,
      'ide_research',
      { intent: 'trace message flow', targetFile: 'packages/desktop/src/service.ts', symbols: ['send'] },
      [
        '# MTUI research pack',
        '### [E1] packages/desktop/src/service.ts',
        'Symbol: NativeConversationService.send',
        'Status: current source verified.',
        'RAW TRANSCRIPT SHOULD NOT BE STORED',
      ].join('\n')
    );

    expect(actionQueryText('ide_research', { intent: 'trace message flow', target: 'src/service.ts' })).toBe(
      'trace message flow | target=src/service.ts'
    );
    expect(ledger.queries).toEqual(['trace message flow | target=packages/desktop/src/service.ts']);
    expect(ledger.files).toContain('packages/desktop/src/service.ts');
    expect(ledger.symbols).toContain('NativeConversationService.send');
    expect(ledger.evidence.some((line) => line.includes('current source verified'))).toBe(true);
    expect(ledger.evidence.join('\n')).not.toContain('RAW TRANSCRIPT');
    expect(renderActionEvidence(ledger).join('\n')).toContain('Files:');
  });
});
