import { createInterface } from 'node:readline';

/**
 * Read a line from the terminal, optionally without echo (passwords, codes). A hidden answer is
 * returned exactly as typed: a password may begin or end with spaces. A visible one is trimmed.
 */
export function prompt(question: string, hidden = false, io: { input: NodeJS.ReadableStream; output: NodeJS.WritableStream } = { input: process.stdin, output: process.stderr }): Promise<string> {
  return new Promise((resolve, reject) => {
    const { input, output } = io;
    const rl = createInterface({ input, output, terminal: true });
    if (hidden) {
      // Suppress echo by overriding the writer used while the question is pending.
      const anyRl = rl as unknown as { _writeToOutput: (s: string) => void };
      const original = anyRl._writeToOutput.bind(rl);
      let asked = false;
      anyRl._writeToOutput = (s: string) => {
        if (!asked) {
          original(s);
          asked = true;
        }
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) output.write('\n');
      resolve(hidden ? answer : answer.trim());
    });
    rl.once('error', reject);
  });
}

export function confirm(question: string): Promise<boolean> {
  return prompt(`${question} [y/N] `).then((a) => /^y(es)?$/i.test(a));
}
