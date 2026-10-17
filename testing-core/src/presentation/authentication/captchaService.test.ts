import assert from 'node:assert';
import { generateCaptcha, verifyCaptcha } from './captchaService.js';

// Mirror of the service's spelled-out operands so the test can solve its own prompt.
const WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];

// Solve "What is <a> plus|minus <b>?" the same way a human would.
function solve(prompt: string): number {
  const match = /What is (\w+) (plus|minus) (\w+)\?/.exec(prompt);
  assert.ok(match, `prompt is well-formed: ${prompt}`);
  const a = WORDS.indexOf(match![1]);
  const b = WORDS.indexOf(match![3]);
  assert.ok(a >= 0 && b >= 0, 'operands are known number words');
  return match![2] === 'minus' ? a - b : a + b;
}

// A freshly minted challenge carries a token, a readable prompt, and a positive TTL.
const challenge = generateCaptcha();
assert.strictEqual(typeof challenge.token, 'string');
assert.ok(challenge.token.length > 0, 'token is non-empty');
assert.match(challenge.prompt, /What is \w+ (plus|minus) \w+\?/, 'prompt is a readable arithmetic question');
assert.ok(challenge.expiresInSeconds > 0, 'TTL is positive');

// The correct answer passes; the answer never leaves the server in readable form.
assert.strictEqual(verifyCaptcha(challenge.token, String(solve(challenge.prompt))), true, 'correct answer verifies');

// Single use: the same (now consumed) token cannot be replayed for another signup.
assert.strictEqual(verifyCaptcha(challenge.token, String(solve(challenge.prompt))), false, 'consumed token is rejected');

// A wrong answer burns the token (single attempt) and fails.
const wrongChallenge = generateCaptcha();
const wrong = solve(wrongChallenge.prompt) + 1;
assert.strictEqual(verifyCaptcha(wrongChallenge.token, String(wrong)), false, 'wrong answer is rejected');

// A spelled-out number is accepted as readily as a digit (accessibility).
const wordChallenge = generateCaptcha();
const wordAnswer = solve(wordChallenge.prompt);
assert.ok(wordAnswer >= 0 && wordAnswer <= 9, 'single-digit answer maps to a word');
assert.strictEqual(verifyCaptcha(wordChallenge.token, WORDS[wordAnswer]), true, 'spelled answer verifies');

// A tampered or bogus token never verifies, regardless of answer.
assert.strictEqual(verifyCaptcha('not-a-jwt', '3'), false, 'garbage token is rejected');
assert.strictEqual(verifyCaptcha(`${generateCaptcha().token}x`, '3'), false, 'signature-tampered token is rejected');
assert.strictEqual(verifyCaptcha('', '3'), false, 'empty token is rejected');

console.log('captchaService: all assertions passed');
