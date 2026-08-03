import { registerRootComponent } from "expo";
import { Buffer } from "buffer";

import App from "./App";

(globalThis as unknown as { Buffer: typeof Buffer }).Buffer = Buffer;

registerRootComponent(App);
