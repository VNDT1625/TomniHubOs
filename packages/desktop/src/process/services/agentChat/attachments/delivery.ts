import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { scanImageForSensitiveText, type ImageSecurityScanResult } from '@process/visualArtifact';
import { planAttachmentDelivery, type AttachmentModelCapabilities } from './routing';
import type {
  AttachmentArtifact,
  AttachmentMessageEnvelope,
  PersistentAttachmentArtifactStore,
  RedactedAttachmentArtifact,
} from './types';
import { redactAttachmentArtifact, validateAttachmentEnvelope } from './validation';

export type ResolvedNativeAttachment = {
  route: 'native';
  artifact: RedactedAttachmentArtifact;
  bytes: Uint8Array;
};

export type ResolvedAgentToolAttachment = {
  route: 'agent-tool';
  artifact: RedactedAttachmentArtifact;
  toolName: 'tomny_analyze_image';
  requiresAgentInvocation: true;
};

export type ResolvedAttachmentDelivery = {
  envelopeId: string;
  text: string;
  native: ResolvedNativeAttachment[];
  agentTools: ResolvedAgentToolAttachment[];
};

export type AttachmentImageSecurityScanner = (
  artifact: AttachmentArtifact,
  bytes: Uint8Array
) => Promise<Pick<ImageSecurityScanResult, 'decision' | 'findings'>>;

export type ResolveAttachmentDeliveryOptions = {
  imageSecurityScanner?: AttachmentImageSecurityScanner;
};

const defaultImageSecurityScanner: AttachmentImageSecurityScanner = async (artifact, bytes) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'tomny-image-security-'));
  const imagePath = path.join(directory, 'attachment.image');
  try {
    await writeFile(imagePath, bytes, { flag: 'wx', mode: 0o600 });
    return await scanImageForSensitiveText(imagePath, { mimeType: artifact.mimeType });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
};

const sameArtifact = (left: AttachmentArtifact, right: AttachmentArtifact): boolean =>
  left.id === right.id &&
  left.kind === right.kind &&
  left.name === right.name &&
  left.mimeType === right.mimeType &&
  left.sizeBytes === right.sizeBytes &&
  left.sha256 === right.sha256 &&
  left.createdAt === right.createdAt &&
  left.source.type === 'opaque' &&
  right.source.type === 'opaque' &&
  left.source.provider === right.source.provider &&
  left.source.ref === right.source.ref;

/** Resolve only canonical, integrity-checked store references for a single adapter run. */
export const resolveAttachmentDelivery = async (
  envelope: AttachmentMessageEnvelope,
  capabilities: AttachmentModelCapabilities,
  store: PersistentAttachmentArtifactStore,
  options: ResolveAttachmentDeliveryOptions = {}
): Promise<ResolvedAttachmentDelivery> => {
  const validation = validateAttachmentEnvelope(envelope);
  if ('issues' in validation) {
    throw new Error(`Attachment envelope is invalid: ${validation.issues[0]?.message ?? 'unknown error'}`);
  }
  const plan = planAttachmentDelivery(validation.value, capabilities);
  const unsupported = plan.artifacts.find((entry) => entry.route === 'unsupported');
  if (unsupported?.route === 'unsupported') throw new Error(unsupported.reason);
  const imageSecurityScanner = options.imageSecurityScanner ?? defaultImageSecurityScanner;

  const resolved = await Promise.all(
    plan.artifacts.map(async (decision): Promise<ResolvedNativeAttachment | ResolvedAgentToolAttachment> => {
      const canonical = await store.get(decision.artifact.id);
      if (!canonical || !sameArtifact(canonical, decision.artifact)) {
        throw new Error(`Attachment ${decision.artifact.id} does not match its canonical artifact record.`);
      }
      const integrity = await store.verify(canonical.id);
      if (integrity.ok === false) {
        throw new Error(`Attachment ${canonical.id} failed integrity verification: ${integrity.reason}.`);
      }
      if (decision.route === 'native') {
        const bytes = await store.readBytes(canonical.id);
        if (canonical.kind === 'image') {
          const security = await imageSecurityScanner(canonical, bytes);
          if (security.decision === 'block') {
            const findingTypes = security.findings.map((finding) => finding.type).join(', ') || 'sensitive text';
            throw new Error(`Attachment ${canonical.id} was blocked by local image security: ${findingTypes}.`);
          }
        }
        return {
          route: 'native',
          artifact: redactAttachmentArtifact(canonical),
          bytes,
        };
      }
      if (decision.route === 'agent-tool') {
        return {
          route: 'agent-tool',
          artifact: redactAttachmentArtifact(canonical),
          toolName: decision.toolName,
          requiresAgentInvocation: true,
        };
      }
      throw new Error('Unsupported attachment delivery cannot be resolved.');
    })
  );
  return {
    envelopeId: plan.envelopeId,
    text: plan.text,
    native: resolved.filter((item): item is ResolvedNativeAttachment => item.route === 'native'),
    agentTools: resolved.filter((item): item is ResolvedAgentToolAttachment => item.route === 'agent-tool'),
  };
};
