import { describe, expect, it } from 'vitest';

import { crc32, zipStored } from './zip';

function readZip(bytes: Uint8Array): Array<{ name: string; text: string; crc: number }> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const files = [];
  const decoder = new TextDecoder();
  for (let index = 0; index < count; index += 1) {
    expect(view.getUint32(at, true)).toBe(0x02014b50);
    const crc = view.getUint32(at + 16, true);
    const size = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const local = view.getUint32(at + 42, true);
    const name = decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    expect(view.getUint32(local, true)).toBe(0x04034b50);
    const start = local + 30 + view.getUint16(local + 26, true);
    files.push({ name, text: decoder.decode(bytes.subarray(start, start + size)), crc });
    at += 46 + nameLength;
  }
  return files;
}

describe('zip files', () => {
  it('checks contents with the standard CRC-32', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    expect(crc32(new Uint8Array())).toBe(0);
  });

  it('stores each file so any unzip program can read it back', () => {
    const encoder = new TextEncoder();
    const zipped = zipStored([
      { name: 'a.txt', data: encoder.encode('hello') },
      { name: 'folder/తెలుగు.xml', data: encoder.encode('<x>నమస్తే</x>') },
    ], new Date(2026, 9, 20, 7, 30, 10));

    expect(readZip(zipped)).toEqual([
      { name: 'a.txt', text: 'hello', crc: crc32(encoder.encode('hello')) },
      { name: 'folder/తెలుగు.xml', text: '<x>నమస్తే</x>', crc: crc32(encoder.encode('<x>నమస్తే</x>')) },
    ]);
  });
});
