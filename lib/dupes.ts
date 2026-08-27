/**
 * Perceptual-hash (dHash) helpers — pure, no I/O.
 *
 * Callers produce the raw pixel buffer with:
 *   sharp(img).grayscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer()
 * which yields 72 bytes (9 wide × 8 tall, 1 byte/pixel).
 */

const WIDTH = 9
const HEIGHT = 8

/**
 * Computes a 64-bit difference hash from a 9×8 grayscale raw buffer.
 * For each of the 8 rows, compares each of 8 adjacent pixel pairs
 * (9 columns → 8 comparisons): bit = 1 when the left pixel is brighter
 * than the pixel to its right. Bits are packed row-major into a
 * 16-character hex string (MSB-first per row).
 */
export function dHash(raw72: Buffer): string {
  if (raw72.length !== WIDTH * HEIGHT) {
    throw new Error(`dHash expects a ${WIDTH * HEIGHT}-byte buffer (9x8 grayscale), got ${raw72.length}`)
  }
  let hex = ''
  for (let y = 0; y < HEIGHT; y++) {
    let nibbleBits = 0
    let bitsInNibble = 0
    for (let x = 0; x < WIDTH - 1; x++) {
      const bit = raw72[y * WIDTH + x] > raw72[y * WIDTH + x + 1] ? 1 : 0
      nibbleBits = (nibbleBits << 1) | bit
      bitsInNibble++
      if (bitsInNibble === 4) {
        hex += nibbleBits.toString(16)
        nibbleBits = 0
        bitsInNibble = 0
      }
    }
  }
  return hex
}

const NIBBLE_POPCOUNT = [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4]

/**
 * Hamming distance between two equal-length hex strings, computed
 * nibble-wise (XOR each nibble, popcount the result).
 */
export function hammingHex(a: string, b: string): number {
  if (a.length !== b.length) {
    throw new Error(`hammingHex expects equal-length hex strings, got ${a.length} and ${b.length}`)
  }
  let distance = 0
  for (let i = 0; i < a.length; i++) {
    const xor = parseInt(a[i], 16) ^ parseInt(b[i], 16)
    distance += NIBBLE_POPCOUNT[xor]
  }
  return distance
}
