import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { prompt } from './prompt.js';

function answer(line: string, hidden: boolean): Promise<string> {
  const input = new PassThrough();
  const output = new PassThrough();
  output.resume();
  const result = prompt('Question: ', hidden, { input, output });
  input.write(`${line}\n`);
  return result;
}

describe('prompt', () => {
  it('returns a hidden answer (a password) exactly as typed, including boundary whitespace', async () => {
    expect(await answer('  pass word  ', true)).toBe('  pass word  ');
  });

  it('trims a visible answer', async () => {
    expect(await answer('  user@example.test  ', false)).toBe('user@example.test');
  });
});
