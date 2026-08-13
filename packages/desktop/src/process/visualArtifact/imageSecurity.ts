import { redactSecretText } from '@process/agentRuntime/agentMesh/security';
import type { SecretFinding } from '@process/agentRuntime/agentMesh/security/types';
import type { VisualArtifactTextAnalyzer } from './types';
import { analyzeVisualArtifact } from './visualArtifact';

export type ImageSecurityScanResult = {
  decision: 'allow' | 'block';
  safeText: string;
  findings: SecretFinding[];
  ocr: {
    blockCount: number;
    averageConfidence: number;
    minimumAcceptedConfidence: number;
  };
};

export type ImageSecurityScanOptions = {
  mimeType?: string;
  minimumConfidence?: number;
  textAnalyzer?: VisualArtifactTextAnalyzer;
};

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;

/** Fail-closed local OCR scan used before an image may cross an external model boundary. */
export const scanImageForSensitiveText = async (
  imagePath: string,
  options: ImageSecurityScanOptions = {}
): Promise<ImageSecurityScanResult> => {
  const minimumConfidence = Math.max(0, Math.min(1, options.minimumConfidence ?? 0.35));
  const artifact = await analyzeVisualArtifact(imagePath, {
    mimeType: options.mimeType,
    textAnalyzer: options.textAnalyzer,
    ocrMode: 'local',
    ocrRequired: true,
  });
  const readableBlocks = artifact.textBlocks.filter((block) => block.confidence >= minimumConfidence);
  const recognizedText = readableBlocks.map((block) => block.text).join('\n');
  const firewall = redactSecretText(recognizedText);
  return {
    decision: firewall.redacted ? 'block' : 'allow',
    safeText: firewall.text,
    findings: firewall.findings,
    ocr: {
      blockCount: readableBlocks.length,
      averageConfidence: Number(average(readableBlocks.map((block) => block.confidence)).toFixed(4)),
      minimumAcceptedConfidence: minimumConfidence,
    },
  };
};
