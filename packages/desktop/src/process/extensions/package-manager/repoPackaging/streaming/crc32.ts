/**
 * @license
 * Copyright 2025 Tomny (github.com/VNDT1625/OmniAgent)
 * SPDX-License-Identifier: Apache-2.0
 */

/** CRC-32 (IEEE 802.3) as the ZIP format defines it. Implemented locally so no Node version is assumed. */

const TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) === 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

/** Continues a running CRC-32 with `chunk`. Start from `0` and feed chunks in order. */
export const crc32Update = (previous: number, chunk: Uint8Array): number => {
  let value = (previous ^ 0xff_ff_ff_ff) >>> 0;
  for (let index = 0; index < chunk.length; index += 1) {
    value = (TABLE[(value ^ (chunk[index] as number)) & 0xff] as number) ^ (value >>> 8);
  }
  return (value ^ 0xff_ff_ff_ff) >>> 0;
};
