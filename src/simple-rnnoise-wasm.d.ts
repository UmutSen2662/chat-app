declare module "simple-rnnoise-wasm" {
  export type RNNoiseAssetData = [string | URL, Promise<WebAssembly.Module>];

  export class RNNoiseNode extends AudioWorkletNode {
    constructor(audioContext: AudioContext, options?: AudioWorkletNodeOptions);
    static register(
      audioContext: AudioContext,
      assetData?: RNNoiseAssetData,
    ): Promise<void>;
    update(keepalive?: boolean | "stat"): unknown;
    onstatus: ((event: MessageEvent<unknown>) => void) | null;
  }

  export function rnnoise_loadAssets(options: {
    scriptSrc?: string | URL;
    moduleSrc?: string | BufferSource;
  }): RNNoiseAssetData | Promise<RNNoiseAssetData>;
}
