// flags.ts — helpers para SR/CCR del M68K.
//
// CCR (byte bajo del SR): X=bit4, N=bit3, Z=bit2, V=bit1, C=bit0.
// X solo se modifica por ops que lo tocan explícitamente (ADD/SUB/ROx/NEGX).
// La mayoría de las ops NO alteran X — solo N, Z (y V/C cuando aplica).

import type { CCR, SR } from '../types/cpu';

/** Tamaño de operando: 8, 16 o 32 bits. */
export type Size = 8 | 16 | 32;

function maskFor(size: Size): number {
  return size === 32 ? 0xffffffff : (1 << size) - 1;
}

function signBitFor(size: Size): number {
  return size === 32 ? 0x80000000 : 1 << (size - 1);
}

/** Actualiza N y Z (NO toca X, V, C). */
export function setNZ(ccr: CCR, value: number, size: Size): void {
  const m = maskFor(size);
  const sb = signBitFor(size);
  const v = value & m;
  ccr.N = (v & sb) ? 1 : 0;
  ccr.Z = v === 0 ? 1 : 0;
}

/** Pone X al valor de C. Algunos ops lo hacen explícitamente. */
export function copyCtoX(ccr: CCR): void {
  ccr.X = ccr.C;
}

/** Flags para ADD: N, Z, V (overflow signed), C, X. */
export function setAddFlags(ccr: CCR, a: number, b: number, result: number, size: Size): void {
  const m = maskFor(size);
  const sb = signBitFor(size);
  const ra = a & m, rb = b & m, rr = result & m;
  ccr.N = (rr & sb) ? 1 : 0;
  ccr.Z = rr === 0 ? 1 : 0;
  // V = signo de operandos iguales y resultado distinto.
  const signA = (ra & sb) !== 0;
  const signB = (rb & sb) !== 0;
  const signR = (rr & sb) !== 0;
  ccr.V = (signA === signB && signR !== signA) ? 1 : 0;
  // C / X = carry out (unsigned): el resultado sin enmascarar cabe en m+1 bits.
  ccr.C = (result > m || result < 0) ? 1 : 0;
  ccr.X = ccr.C;
}

/** Flags para SUB: N, Z, V (overflow signed), C, X. */
export function setSubFlags(ccr: CCR, a: number, b: number, result: number, size: Size): void {
  const m = maskFor(size);
  const sb = signBitFor(size);
  const ra = a & m, rb = b & m, rr = (result & m) - 0; // forzar lectura
  const signedR = (result | 0); // signed
  ccr.N = (rr & sb) ? 1 : 0;
  ccr.Z = rr === 0 ? 1 : 0;
  const signA = (ra & sb) !== 0;
  const signB = (rb & sb) !== 0;
  const signR = (rr & sb) !== 0;
  ccr.V = (signA !== signB && signR !== signA) ? 1 : 0;
  // C = borrow: 1 si a < b (signed result < 0).
  ccr.C = signedR < 0 ? 1 : 0;
  ccr.X = ccr.C;
  // `rr` calculado para satisfacer al compilador (referenced).
  void rr;
}

/** Flags para CMP (como SUB pero no escribe destino). */
export function setCmpFlags(ccr: CCR, a: number, b: number, size: Size): void {
  setSubFlags(ccr, a, b, a - b, size);
}

/** Empaqueta CCR en un byte: X<<4 | N<<3 | Z<<2 | V<<1 | C. */
export function ccrToByte(ccr: CCR): number {
  return ((ccr.X & 1) << 4) | ((ccr.N & 1) << 3) | ((ccr.Z & 1) << 2) |
         ((ccr.V & 1) << 1) |  (ccr.C & 1);
}

/** Desempaqueta un byte CCR en el struct. */
export function byteToCcr(byte: number): CCR {
  return {
    X: ((byte >> 4) & 1) as 0 | 1,
    N: ((byte >> 3) & 1) as 0 | 1,
    Z: ((byte >> 2) & 1) as 0 | 1,
    V: ((byte >> 1) & 1) as 0 | 1,
    C: ( byte        & 1) as 0 | 1,
  };
}

/** SR → número (16 bits, byte alto = system byte, byte bajo = CCR). */
export function srToWord(sr: SR): number {
  const sys = ((sr.T1 & 1) << 15) | ((sr.T0 & 1) << 14) | ((sr.S & 1) << 13) |
              ((sr.I & 0x7) << 8) | ((sr.M & 1) << 12);
  return (sys & 0xff00) | ccrToByte(sr.ccr);
}
