/** @type {import('jest').Config} */
module.exports = {
  preset: "jest-expo",
  testMatch: ["**/__tests__/**/*.test.ts?(x)"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transformIgnorePatterns: [
    "node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@expo-google-fonts/.*|react-clone-referenced-element|@react-navigation/.*|@unimodules/.*|sentry-expo|native-base|react-native-svg|@arkade-os/.*|@scure/.*|@noble/.*|micro-packed|uint8array-tools|varuint-bitcoin|@bitcoinerlab|@marcbachmann/cel-js))",
  ],
  collectCoverageFrom: [
    "app/services/arkade/activity-history.ts",
    "app/services/arkade/swap-mappers.ts",
  ],
};
