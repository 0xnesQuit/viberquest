// Node globals some wallet libraries expect in the browser: esbuild --inject swaps bare uses for these,
// and Privy also looks them up on globalThis, so they are set there too.
import { Buffer } from "buffer";
import process from "process/browser.js";
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
if (!globalThis.process) globalThis.process = process;
export { Buffer, process };
