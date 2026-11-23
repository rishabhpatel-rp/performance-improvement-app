// @ts-check -- retained as JS: embedded verbatim in the storefront bundle.
import { parentPort, workerData } from "node:worker_threads";
import JavaScriptObfuscator from "javascript-obfuscator";

const { rawScript, options } = workerData;
const result = JavaScriptObfuscator.obfuscate(rawScript, options);
parentPort.postMessage(result.getObfuscatedCode());
