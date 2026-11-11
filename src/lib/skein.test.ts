import { describe, expect, it } from 'vitest';
import { skeinIv } from './skein';

//precomputed chaining values in the core (src/LLC/hash/SK/skein_iv.h)
describe('Skein of the core', () => {
  it('config block gives the core IVs', () => {
    expect(skeinIv(256, 256)).toEqual([0x388512680e660046n, 0x4b72d5dec5a8ff01n, 0x281a9298ca5eb3a5n, 0x54ca5249f46070c4n]);
    expect(skeinIv(512, 512)).toEqual([
      0xa8d47980544a6e32n,
      0x847511533e9b1a8an,
      0x6faee870d8e81a00n,
      0x58b0d9d6cb557f92n,
      0x9bbc0051dac1d4e9n,
      0xb744e2b1d189e7can,
      0x979350fa709c5ef3n,
      0x0350125a92067bcdn,
    ]);
  });
});
