// Configuration for web-ext (lint, build, run, sign). Picked up automatically
// when the commands run from the repository root, e.g. via `npm run build`.
export default {
  sourceDir: "extension",
  artifactsDir: "web-ext-artifacts",
  build: {
    overwriteDest: true,
  },
  sign: {
    // listed = public on addons.mozilla.org; listing data comes from:
    channel: "listed",
    amoMetadata: "amo-metadata.json",
  },
};
