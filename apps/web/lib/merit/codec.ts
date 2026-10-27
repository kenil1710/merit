// Minimal bincode (Venus' wire format): little-endian integers, raw 32-byte
// pubkeys and nonces, u64 length prefixes for strings and vectors.

import { base58 } from "@scure/base";

export class Writer {
  private parts: Uint8Array[] = [];

  u32(value: number): this {
    const bytes = new Uint8Array(4);
    new DataView(bytes.buffer).setUint32(0, value, true);
    this.parts.push(bytes);
    return this;
  }

  u64(value: bigint): this {
    if (value < 0n || value > 0xffff_ffff_ffff_ffffn) throw new RangeError("u64 out of range");
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, value, true);
    this.parts.push(bytes);
    return this;
  }

  fixed(bytes: Uint8Array, length: number): this {
    if (bytes.length !== length) throw new RangeError(`expected ${length} bytes, got ${bytes.length}`);
    this.parts.push(bytes);
    return this;
  }

  pubkey(address: string): this {
    return this.fixed(base58.decode(address), 32);
  }

  string(value: string): this {
    const bytes = new TextEncoder().encode(value);
    this.u64(BigInt(bytes.length));
    this.parts.push(bytes);
    return this;
  }

  bytes(): Uint8Array {
    const total = this.parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(total);
    let at = 0;
    for (const part of this.parts) {
      out.set(part, at);
      at += part.length;
    }
    return out;
  }
}

export class Reader {
  private at = 0;
  private view: DataView;

  constructor(private data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  u64(): bigint {
    const value = this.view.getBigUint64(this.at, true);
    this.at += 8;
    return value;
  }

  bool(): boolean {
    const value = this.data[this.at];
    if (value === undefined || value > 1) throw new Error("invalid bool");
    this.at += 1;
    return value === 1;
  }

  pubkey(): string {
    if (this.at + 32 > this.data.length) throw new Error("truncated pubkey");
    const value = base58.encode(this.data.subarray(this.at, this.at + 32));
    this.at += 32;
    return value;
  }

  length(): number {
    const n = this.u64();
    if (n > BigInt(this.data.length)) throw new Error("vector length exceeds account data");
    return Number(n);
  }

  vecU64(): bigint[] {
    return Array.from({ length: this.length() }, () => this.u64());
  }

  vecPubkey(): string[] {
    return Array.from({ length: this.length() }, () => this.pubkey());
  }

  fixedBytes(n: number): Uint8Array {
    if (this.at + n > this.data.length) throw new Error("truncated bytes");
    const value = this.data.subarray(this.at, this.at + n);
    this.at += n;
    return value;
  }

  remaining(): number {
    return this.data.length - this.at;
  }

  rawBytes(): Uint8Array {
    const n = this.length();
    const value = this.data.subarray(this.at, this.at + n);
    this.at += n;
    return value;
  }
}

export function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function unhex(text: string): Uint8Array {
  if (!/^(?:[0-9a-fA-F]{2})*$/.test(text)) throw new Error("invalid hex");
  return Uint8Array.from(text.match(/../g) ?? [], (pair) => parseInt(pair, 16));
}
