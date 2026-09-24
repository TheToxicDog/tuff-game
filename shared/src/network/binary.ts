// Compact binary encoding for high-frequency network traffic (inputs and snapshots).

declare const TextEncoder: { new (): { encode(input: string): Uint8Array } };
declare const TextDecoder: { new (): { decode(input: Uint8Array): string } };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export class BinaryWriter {
  private buffer: ArrayBuffer;
  private view: DataView;
  private bytes: Uint8Array;
  private offset = 0;

  constructor(initialSize = 1024) {
    this.buffer = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buffer);
    this.bytes = new Uint8Array(this.buffer);
  }

  get length(): number {
    return this.offset;
  }

  reset(): this {
    this.offset = 0;
    return this;
  }

  private ensure(extra: number): void {
    const needed = this.offset + extra;
    if (needed <= this.buffer.byteLength) return;
    let size = this.buffer.byteLength * 2;
    while (size < needed) size *= 2;
    const next = new ArrayBuffer(size);
    new Uint8Array(next).set(this.bytes.subarray(0, this.offset));
    this.buffer = next;
    this.view = new DataView(next);
    this.bytes = new Uint8Array(next);
  }

  u8(value: number): this {
    this.ensure(1);
    this.view.setUint8(this.offset, value);
    this.offset += 1;
    return this;
  }

  i8(value: number): this {
    this.ensure(1);
    this.view.setInt8(this.offset, value);
    this.offset += 1;
    return this;
  }

  u16(value: number): this {
    this.ensure(2);
    this.view.setUint16(this.offset, value, true);
    this.offset += 2;
    return this;
  }

  i16(value: number): this {
    this.ensure(2);
    this.view.setInt16(this.offset, value, true);
    this.offset += 2;
    return this;
  }

  u32(value: number): this {
    this.ensure(4);
    this.view.setUint32(this.offset, value >>> 0, true);
    this.offset += 4;
    return this;
  }

  i32(value: number): this {
    this.ensure(4);
    this.view.setInt32(this.offset, value | 0, true);
    this.offset += 4;
    return this;
  }

  f32(value: number): this {
    this.ensure(4);
    this.view.setFloat32(this.offset, value, true);
    this.offset += 4;
    return this;
  }

  f64(value: number): this {
    this.ensure(8);
    this.view.setFloat64(this.offset, value, true);
    this.offset += 8;
    return this;
  }

  /** Unsigned LEB128 variable-length integer (values up to 2^32 - 1). */
  varuint(value: number): this {
    let v = value >>> 0;
    this.ensure(5);
    while (v >= 0x80) {
      this.bytes[this.offset++] = (v & 0x7f) | 0x80;
      v >>>= 7;
    }
    this.bytes[this.offset++] = v;
    return this;
  }

  bool(value: boolean): this {
    return this.u8(value ? 1 : 0);
  }

  /** Angle in radians quantised to 16 bits (about 0.0055 degrees of precision). */
  angle16(radians: number): this {
    const turns = radians / (Math.PI * 2);
    const normalized = turns - Math.floor(turns);
    return this.u16(Math.round(normalized * 65536) & 0xffff);
  }

  /** Value in [0, 1] quantised to one byte. */
  unit8(value: number): this {
    return this.u8(Math.round(Math.min(1, Math.max(0, value)) * 255));
  }

  string(value: string): this {
    const encoded = encoder.encode(value);
    this.varuint(encoded.length);
    this.ensure(encoded.length);
    this.bytes.set(encoded, this.offset);
    this.offset += encoded.length;
    return this;
  }

  /** Returns a copy of the written bytes. */
  finish(): Uint8Array {
    return this.bytes.slice(0, this.offset);
  }
}

export class BinaryReadError extends Error {}

export class BinaryReader {
  private readonly view: DataView;
  private readonly bytes: Uint8Array;
  private offset = 0;

  constructor(data: ArrayBuffer | Uint8Array) {
    this.bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
    this.view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength);
  }

  get remaining(): number {
    return this.bytes.byteLength - this.offset;
  }

  private need(size: number): void {
    if (this.offset + size > this.bytes.byteLength) {
      throw new BinaryReadError(`Read past end of buffer (${this.offset}+${size})`);
    }
  }

  u8(): number {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  i8(): number {
    this.need(1);
    return this.view.getInt8(this.offset++);
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.offset, true);
    this.offset += 2;
    return v;
  }

  i16(): number {
    this.need(2);
    const v = this.view.getInt16(this.offset, true);
    this.offset += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f32(): number {
    this.need(4);
    const v = this.view.getFloat32(this.offset, true);
    this.offset += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return v;
  }

  varuint(): number {
    let result = 0;
    let shift = 0;
    for (let i = 0; i < 5; i++) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return result >>> 0;
      shift += 7;
    }
    throw new BinaryReadError('varuint too long');
  }

  bool(): boolean {
    return this.u8() !== 0;
  }

  angle16(): number {
    const v = this.u16() / 65536;
    const a = v * Math.PI * 2;
    return a > Math.PI ? a - Math.PI * 2 : a;
  }

  unit8(): number {
    return this.u8() / 255;
  }

  string(maxLength = 4096): string {
    const len = this.varuint();
    if (len > maxLength) throw new BinaryReadError(`String too long (${len})`);
    this.need(len);
    const s = decoder.decode(this.bytes.subarray(this.offset, this.offset + len));
    this.offset += len;
    return s;
  }
}
