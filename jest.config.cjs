/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  clearMocks: true,
  restoreMocks: true,
  resetMocks: true,
  collectCoverageFrom: ['src/**/*.js'],
  coverageReporters: ['json', 'json-summary', 'lcov', 'text'],
};
