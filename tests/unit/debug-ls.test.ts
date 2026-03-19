import { test, expect } from 'vitest';
test('debug localStorage', () => {
  console.log('localStorage is:', typeof window.localStorage);
  if (window.localStorage) {
    console.log('removeItem is:', typeof window.localStorage.removeItem);
  }
  expect(true).toBe(true);
});
