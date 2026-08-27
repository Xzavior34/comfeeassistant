module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  setupFilesAfterEnv: ['<rootDir>/tests/setupPrismaMock.ts'],
  // Frontend tests run against jsdom via a per-file @jest-environment docblock. The Prisma
  // mock is skipped for them: it is server-side and has no meaning in a browser environment.
  testPathIgnorePatterns: ['/node_modules/', '/frontend/node_modules/']
};
