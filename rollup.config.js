/* eslint-disable @typescript-eslint/no-var-requires */
const typescript = require("rollup-plugin-typescript2");
const commonjs = require("@rollup/plugin-commonjs");
const replace = require("@rollup/plugin-replace");
const pkg = require("./package.json");
const { dts } = require("rollup-plugin-dts");
const dotenv = require("dotenv");

dotenv.config({
    path: `../../.env`,
});

const dependencies = [...Object.keys(pkg.dependencies || {})];
const peerDependencies = [...Object.keys(pkg.peerDependencies || {})];

const tsOptions = {
    tsconfig: "tsconfig.build.json",
};

const plugins = [
    replace({
        preventAssignment: true,
        // jslib-media uses global.navigator for some gUM calls, replace these
        delimiters: [" ", "."],
        values: { "global.navigator.mediaDevices": " navigator.mediaDevices." },
    }),
    commonjs(),
    typescript({
        tsconfig: "tsconfig.build.json",
    }),
];

const external = [...dependencies, ...peerDependencies];

module.exports = [
    // Esm build of lib, to be used with bundlers
    {
        input: { webrtc: "src/webrtc/index.ts", utils: "src/utils/index.ts", model: "src/model/index.ts" },

        output: [
            {
                format: "esm", // set ES modules
                dir: "dist", // indicate not create a single-file
            },
        ],
        plugins,
        external,
    },
    {
        input: "src/webrtc/index.ts",
        output: [{ file: "dist/webrtc.d.ts", format: "es" }],
        external,
        plugins: [dts(tsOptions)],
    },
    {
        input: "src/utils/index.ts",
        output: [{ file: "dist/utils.d.ts", format: "es" }],
        external,
        plugins: [dts(tsOptions)],
    },
    {
        input: "src/model/index.ts",
        output: [{ file: "dist/model.d.ts", format: "es" }],
        external,
        plugins: [dts(tsOptions)],
    },
];
