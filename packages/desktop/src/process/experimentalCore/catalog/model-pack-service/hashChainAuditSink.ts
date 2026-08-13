/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

import { createHash } from 'node:crypto';
import { mkdir, open, readFile } from 'node:fs/promises';
import path from 'node:path';
import { ModelPackServiceError, type ModelPackAuditReceipt, type ModelPackAuditSink } from './types';

const GENESIS_HASH = '0'.repeat(64);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const MAX_AUDIT_BYTES = 64 * 1024 * 1024;

type AuditChainEntry = {
  schemaVersion: 1;
  sequence: number;
  previousHash: string;
  receipt: ModelPackAuditReceipt;
  hash: string;
};

export type AuditChainState = {
  entries: number;
  headHash: string;
};

export type HashChainModelPackAuditSinkOptions = {
  auditPath: string;
  maxBytes?: number;
};

const chainPayload = (entry: Omit<AuditChainEntry, 'hash'>): Buffer =>
  Buffer.from(
    JSON.stringify({
      schemaVersion: entry.schemaVersion,
      sequence: entry.sequence,
      previousHash: entry.previousHash,
      receipt: entry.receipt,
    }),
    'utf8'
  );

const entryHash = (entry: Omit<AuditChainEntry, 'hash'>): string =>
  createHash('sha256').update(chainPayload(entry)).digest('hex');

export class HashChainModelPackAuditSink implements ModelPackAuditSink {
  private readonly maxBytes: number;
  private operation = Promise.resolve();

  public constructor(private readonly options: HashChainModelPackAuditSinkOptions) {
    if (!path.isAbsolute(options.auditPath)) {
      throw new ModelPackServiceError('configuration-invalid', 'Audit path must be absolute.');
    }
    this.maxBytes = options.maxBytes ?? MAX_AUDIT_BYTES;
    if (!Number.isSafeInteger(this.maxBytes) || this.maxBytes <= 0 || this.maxBytes > MAX_AUDIT_BYTES) {
      throw new ModelPackServiceError('configuration-invalid', 'Audit file size limit is invalid.');
    }
  }

  public append(receipt: Readonly<ModelPackAuditReceipt>): Promise<void> {
    return this.serialized(async () => {
      const state = await this.verifyInternal();
      const unsigned: Omit<AuditChainEntry, 'hash'> = {
        schemaVersion: 1,
        sequence: state.entries + 1,
        previousHash: state.headHash,
        receipt: structuredClone(receipt),
      };
      const entry: AuditChainEntry = { ...unsigned, hash: entryHash(unsigned) };
      const bytes = Buffer.from(`${JSON.stringify(entry)}\n`, 'utf8');
      const currentBytes = await this.currentBytes();
      if (currentBytes + bytes.byteLength > this.maxBytes) {
        throw new ModelPackServiceError('filesystem-error', 'Audit chain reached its configured append-only limit.');
      }
      await mkdir(path.dirname(this.options.auditPath), { recursive: true, mode: 0o700 });
      const file = await open(this.options.auditPath, 'a', 0o600);
      try {
        await file.write(bytes, 0, bytes.byteLength);
        await file.sync();
      } finally {
        await file.close();
      }
    });
  }

  public verify(): Promise<AuditChainState> {
    return this.serialized(() => this.verifyInternal());
  }

  private serialized<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.operation.then(operation, operation);
    this.operation = result.then(
      (): void => undefined,
      (): void => undefined
    );
    return result;
  }

  private async currentBytes(): Promise<number> {
    try {
      return (await readFile(this.options.auditPath)).byteLength;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
      throw error;
    }
  }

  private async verifyInternal(): Promise<AuditChainState> {
    let text: string;
    try {
      text = await readFile(this.options.auditPath, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { entries: 0, headHash: GENESIS_HASH };
      throw error;
    }
    if (Buffer.byteLength(text, 'utf8') > this.maxBytes || (text.length > 0 && !text.endsWith('\n'))) {
      throw new ModelPackServiceError('audit-tampered', 'Audit chain is oversized or has a partial tail.');
    }
    let previousHash = GENESIS_HASH;
    let sequence = 0;
    for (const line of text.split('\n')) {
      if (!line) continue;
      let value: unknown;
      try {
        value = JSON.parse(line) as unknown;
      } catch (error) {
        throw new ModelPackServiceError('audit-tampered', 'Audit chain contains malformed JSON.', { cause: error });
      }
      if (typeof value !== 'object' || value === null || Array.isArray(value)) {
        throw new ModelPackServiceError('audit-tampered', 'Audit chain entry is malformed.');
      }
      const entry = value as Partial<AuditChainEntry>;
      const keys = Object.keys(entry);
      if (
        keys.length !== 5 ||
        !['schemaVersion', 'sequence', 'previousHash', 'receipt', 'hash'].every((key) => Object.hasOwn(entry, key)) ||
        entry.schemaVersion !== 1 ||
        entry.sequence !== sequence + 1 ||
        entry.previousHash !== previousHash ||
        !SHA256_PATTERN.test(entry.hash ?? '') ||
        typeof entry.receipt !== 'object' ||
        entry.receipt === null
      ) {
        throw new ModelPackServiceError('audit-tampered', 'Audit chain sequence or linkage is invalid.');
      }
      const unsigned: Omit<AuditChainEntry, 'hash'> = {
        schemaVersion: 1,
        sequence: entry.sequence,
        previousHash: entry.previousHash,
        receipt: entry.receipt,
      };
      if (entryHash(unsigned) !== entry.hash) {
        throw new ModelPackServiceError('audit-tampered', 'Audit chain hash verification failed.');
      }
      sequence = entry.sequence;
      previousHash = entry.hash;
    }
    return { entries: sequence, headHash: previousHash };
  }
}
