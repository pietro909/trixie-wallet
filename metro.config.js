const { getDefaultConfig } = require("expo/metro-config");
const path = require("node:path");

const projectRoot = __dirname;
const sdkRoot = path.resolve(projectRoot, "../ts-sdk");

const config = getDefaultConfig(projectRoot);

// Watch the monorepo packages so Metro picks up live changes
config.watchFolders = [sdkRoot];

// Allow Metro to resolve modules from the project's own node_modules
// even when the resolved file lives inside the external monorepo
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
];

module.exports = config;
