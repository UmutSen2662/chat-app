import { RNNoiseNode, rnnoise_loadAssets } from "simple-rnnoise-wasm";
import rnnoiseWasmUrl from "simple-rnnoise-wasm/rnnoise.wasm?url";
import rnnoiseWorkletUrl from "simple-rnnoise-wasm/rnnoise.worklet.js?url";

const SPEAKING_THRESHOLD = 0.035;
const SILENCE_THRESHOLD = 0.02;
const ACTIVE_SAMPLE_COUNT = 2;
const SILENCE_SAMPLE_COUNT = 4;
const SAMPLE_INTERVAL_MS = 100;

export type MicrophonePipeline = {
    audioContext: AudioContext;
    microphoneStream: MediaStream;
    outgoingStream: MediaStream;
    dispose: () => Promise<void>;
};

export const createMicrophonePipeline = async (): Promise<MicrophonePipeline> => {
    const microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: {
            noiseSuppression: true,
            echoCancellation: true,
        },
        video: false,
    });

    const audioContext = new AudioContext();
    await audioContext.resume();

    const source = audioContext.createMediaStreamSource(microphoneStream);
    const destination = audioContext.createMediaStreamDestination();
    let rnnoiseNode: AudioNode | null = null;

    try {
        const assetData = await Promise.resolve(
            rnnoise_loadAssets({
                scriptSrc: rnnoiseWorkletUrl,
                moduleSrc: rnnoiseWasmUrl,
            })
        );
        await RNNoiseNode.register(audioContext, assetData);
        rnnoiseNode = new RNNoiseNode(audioContext);
        source.connect(rnnoiseNode);
        rnnoiseNode.connect(destination);
    } catch (error) {
        console.error("Error initializing RNNoise, falling back to raw microphone audio:", error);
        source.connect(destination);
    }

    const outgoingStream = destination.stream;

    return {
        audioContext,
        microphoneStream,
        outgoingStream,
        dispose: async () => {
            try {
                source.disconnect();
            } catch {
                void 0;
            }

            try {
                rnnoiseNode?.disconnect();
            } catch {
                void 0;
            }

            try {
                destination.disconnect();
            } catch {
                void 0;
            }

            microphoneStream.getTracks().forEach((track) => track.stop());
            outgoingStream.getTracks().forEach((track) => track.stop());

            if (audioContext.state !== "closed") {
                await audioContext.close();
            }
        },
    };
};

export const createSpeakingDetector = (
    audioContext: AudioContext,
    stream: MediaStream,
    onSpeakingChange: (isSpeaking: boolean) => void,
    getIsSuppressed?: () => boolean
): (() => void) => {
    const source = audioContext.createMediaStreamSource(stream);
    const analyser = audioContext.createAnalyser();
    const samples = new Uint8Array(analyser.fftSize);
    let activeSampleCount = 0;
    let silenceSampleCount = 0;
    let isSpeaking = false;

    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.2;
    source.connect(analyser);

    const intervalId = window.setInterval(() => {
        if (audioContext.state === "closed") {
            return;
        }

        if (getIsSuppressed?.()) {
            activeSampleCount = 0;
            silenceSampleCount = SILENCE_SAMPLE_COUNT;
            if (isSpeaking) {
                isSpeaking = false;
                onSpeakingChange(false);
            }
            return;
        }

        analyser.getByteTimeDomainData(samples);

        let squareSum = 0;
        for (let index = 0; index < samples.length; index += 1) {
            const sample = (samples[index] - 128) / 128;
            squareSum += sample * sample;
        }

        const rms = Math.sqrt(squareSum / samples.length);

        if (rms >= SPEAKING_THRESHOLD) {
            activeSampleCount += 1;
            silenceSampleCount = 0;
            if (!isSpeaking && activeSampleCount >= ACTIVE_SAMPLE_COUNT) {
                isSpeaking = true;
                onSpeakingChange(true);
            }
            return;
        }

        if (rms <= SILENCE_THRESHOLD) {
            silenceSampleCount += 1;
            activeSampleCount = 0;
            if (isSpeaking && silenceSampleCount >= SILENCE_SAMPLE_COUNT) {
                isSpeaking = false;
                onSpeakingChange(false);
            }
        }
    }, SAMPLE_INTERVAL_MS);

    return () => {
        window.clearInterval(intervalId);
        if (isSpeaking) {
            onSpeakingChange(false);
        }
        try {
            source.disconnect();
        } catch {
            void 0;
        }
        try {
            analyser.disconnect();
        } catch {
            void 0;
        }
    };
};
