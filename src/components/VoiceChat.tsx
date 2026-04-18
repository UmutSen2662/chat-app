// components/VoiceChat.tsx
import {
  useState,
  useEffect,
  useRef,
  useImperativeHandle,
  forwardRef,
  useCallback,
  type Dispatch,
  type SetStateAction,
} from "react";
import {
  createMicrophonePipeline,
  createSpeakingDetector,
  type MicrophonePipeline,
} from "../lib/voiceAudio";

type Participant = {
  id: string;
  user_name: string;
  user_color: string;
};

type SignalType = "offer" | "answer" | "ice-candidate";

type SignalData = RTCSessionDescriptionInit | RTCIceCandidateInit | null;

type SignalRecord = {
  sender_id: string;
  receiver_id: string;
  type: SignalType;
  data: SignalData;
};

type SignalPayload = {
  new: SignalRecord;
};

type SignalsTable = {
  insert: (payload: {
    room_id: string;
    sender_id: string;
    receiver_id: string;
    type: SignalType;
    data: SignalData;
  }) => PromiseLike<{ error: unknown }>;
};

type RealtimeChannel = {
  on: (
    event: "postgres_changes",
    filter: {
      event: "INSERT";
      schema: "public";
      table: "signals";
      filter: string;
    },
    callback: (payload: SignalPayload) => void | Promise<void>,
  ) => RealtimeChannel;
  subscribe: () => RealtimeChannel;
  unsubscribe: () => void;
};

export type VoiceChatSupabaseLike = {
  from: (table: "signals") => SignalsTable;
  channel: (name: string) => RealtimeChannel;
};

type RemoteStreamState = {
  userId: string;
  stream: MediaStream;
};

type VoiceChatProps = {
  supabase: VoiceChatSupabaseLike;
  room: { id: string };
  participants: Participant[];
  isMuted: boolean;
  setIsMuted: Dispatch<SetStateAction<boolean>>;
  isSilenced: boolean;
  setIsSilenced: Dispatch<SetStateAction<boolean>>;
  onSpeakingStateChange: (userId: string, isSpeaking: boolean) => void;
};

export type VoiceChatHandle = {
  endCall: () => Promise<void>;
};

// A dedicated component to handle remote audio playback
const RemoteAudio = ({
  stream,
  isSilenced,
}: {
  stream: MediaStream;
  isSilenced: boolean;
}) => {
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.srcObject = stream;
      audioRef.current.muted = isSilenced;
    }
  }, [stream, isSilenced]);

  return <audio ref={audioRef} autoPlay playsInline />;
};

const iceServersConfig = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const VoiceChat = forwardRef<VoiceChatHandle, VoiceChatProps>(
  (
    {
      supabase,
      room,
      participants,
      isMuted,
      setIsMuted,
      isSilenced,
      setIsSilenced,
      onSpeakingStateChange,
    },
    ref,
  ) => {
    const [remoteStreams, setRemoteStreams] = useState<RemoteStreamState[]>([]);
    const [isCalling, setIsCalling] = useState(false);
    const peerConnections = useRef<Record<string, RTCPeerConnection>>({});
    const candidatesQueue = useRef<Record<string, RTCIceCandidateInit[]>>({});
    const localUserId = useRef(localStorage.getItem("userId") ?? "");
    const microphonePipelineRef = useRef<MicrophonePipeline | null>(null);
    const localDetectorCleanupRef = useRef<(() => void) | null>(null);
    const remoteDetectorCleanupRef = useRef<Record<string, () => void>>({});
    const isMutedRef = useRef(isMuted);
    const endCallRef = useRef<() => Promise<void>>(async () => undefined);

    const clearRemoteDetector = useCallback((userId: string) => {
      const cleanup = remoteDetectorCleanupRef.current[userId];
      if (cleanup) {
        cleanup();
        delete remoteDetectorCleanupRef.current[userId];
      }
    }, []);

    const clearLocalDetector = useCallback(() => {
      if (localDetectorCleanupRef.current) {
        localDetectorCleanupRef.current();
        localDetectorCleanupRef.current = null;
      }

      if (localUserId.current) {
        onSpeakingStateChange(localUserId.current, false);
      }
    }, [onSpeakingStateChange]);

    const updateRemoteStream = useCallback(
      (userId: string, stream: MediaStream) => {
        setRemoteStreams((previousStreams) => {
          const existingStream = previousStreams.find(
            (entry) => entry.userId === userId,
          );
          if (existingStream?.stream.id === stream.id) {
            return previousStreams;
          }

          if (existingStream) {
            return previousStreams.map((entry) =>
              entry.userId === userId ? { userId, stream } : entry,
            );
          }

          return [...previousStreams, { userId, stream }];
        });

        const pipeline = microphonePipelineRef.current;
        if (!pipeline) {
          return;
        }

        clearRemoteDetector(userId);
        remoteDetectorCleanupRef.current[userId] = createSpeakingDetector(
          pipeline.audioContext,
          stream,
          (isSpeaking) => {
            onSpeakingStateChange(userId, isSpeaking);
          },
        );
      },
      [clearRemoteDetector, onSpeakingStateChange],
    );

    const removePeerConnection = useCallback(
      (userId: string) => {
        const peerConnection = peerConnections.current[userId];
        if (peerConnection) {
          peerConnection.onicecandidate = null;
          peerConnection.ontrack = null;
          peerConnection.onconnectionstatechange = null;
          peerConnection.close();
          delete peerConnections.current[userId];
        }

        delete candidatesQueue.current[userId];
        clearRemoteDetector(userId);
        setRemoteStreams((previousStreams) =>
          previousStreams.filter((entry) => entry.userId !== userId),
        );
        onSpeakingStateChange(userId, false);
      },
      [clearRemoteDetector, onSpeakingStateChange],
    );

    const sendSignal = useCallback(
      async (receiverId: string, type: SignalType, data: SignalData) => {
        const { error } = await supabase.from("signals").insert({
          room_id: room.id,
          sender_id: localUserId.current,
          receiver_id: receiverId,
          type,
          data,
        });

        if (error) {
          console.error(`Error sending ${type}:`, error);
        }
      },
      [room.id, supabase],
    );

    const getOrCreatePeerConnection = useCallback(
      (remoteUserId: string) => {
        const existingPeerConnection = peerConnections.current[remoteUserId];
        if (existingPeerConnection) {
          return existingPeerConnection;
        }

        const peerConnection = new RTCPeerConnection(iceServersConfig);
        const pipeline = microphonePipelineRef.current;

        if (pipeline) {
          pipeline.outgoingStream.getTracks().forEach((track) => {
            peerConnection.addTrack(track, pipeline.outgoingStream);
          });
        }

        peerConnection.onicecandidate = (event: RTCPeerConnectionIceEvent) => {
          if (event.candidate) {
            void sendSignal(
              remoteUserId,
              "ice-candidate",
              event.candidate.toJSON(),
            );
          }
        };

        peerConnection.ontrack = (event: RTCTrackEvent) => {
          const [stream] = event.streams;
          if (stream) {
            updateRemoteStream(remoteUserId, stream);
          }
        };

        peerConnection.onconnectionstatechange = () => {
          if (
            peerConnection.connectionState === "failed" ||
            peerConnection.connectionState === "closed"
          ) {
            removePeerConnection(remoteUserId);
          }
        };

        peerConnections.current[remoteUserId] = peerConnection;
        return peerConnection;
      },
      [removePeerConnection, sendSignal, updateRemoteStream],
    );

    const processCandidatesQueue = useCallback(
      async (peerConnection: RTCPeerConnection, senderId: string) => {
        const queuedCandidates = candidatesQueue.current[senderId];
        if (!queuedCandidates?.length) {
          return;
        }

        for (const candidate of queuedCandidates) {
          try {
            await peerConnection.addIceCandidate(
              new RTCIceCandidate(candidate),
            );
          } catch (error) {
            console.error("Error adding queued ICE candidate:", error);
          }
        }

        candidatesQueue.current[senderId] = [];
      },
      [],
    );

    // Function to initialize WebRTC call
    const startCall = useCallback(async () => {
      if (isCalling) {
        return;
      }

      try {
        const pipeline = await createMicrophonePipeline();
        if (!pipeline.outgoingStream.getAudioTracks()[0]) {
          await pipeline.dispose();
          throw new Error("No outgoing audio track available.");
        }

        microphonePipelineRef.current = pipeline;

        if (localUserId.current) {
          clearLocalDetector();
          localDetectorCleanupRef.current = createSpeakingDetector(
            pipeline.audioContext,
            pipeline.microphoneStream,
            (isSpeaking) => {
              onSpeakingStateChange(localUserId.current, isSpeaking);
            },
            () => isMutedRef.current,
          );
        }

        setIsCalling(true);

        await Promise.allSettled(
          participants
            .filter(({ id }) => id && id !== localUserId.current)
            .map(async ({ id }) => {
              const peerConnection = getOrCreatePeerConnection(id);
              const offer = await peerConnection.createOffer();
              await peerConnection.setLocalDescription(offer);
              await sendSignal(
                id,
                "offer",
                peerConnection.localDescription?.toJSON?.() ??
                  peerConnection.localDescription,
              );
            }),
        );
      } catch (error) {
        console.error("Error starting call:", error);
        clearLocalDetector();

        const pipeline = microphonePipelineRef.current;
        microphonePipelineRef.current = null;
        if (pipeline) {
          await pipeline.dispose();
        }

        setIsCalling(false);
      }
    }, [
      clearLocalDetector,
      getOrCreatePeerConnection,
      isCalling,
      onSpeakingStateChange,
      participants,
      sendSignal,
    ]);

    const endCall = useCallback(async () => {
      Object.keys(peerConnections.current).forEach((userId) => {
        removePeerConnection(userId);
      });

      clearLocalDetector();
      setRemoteStreams([]);
      candidatesQueue.current = {};

      const pipeline = microphonePipelineRef.current;
      microphonePipelineRef.current = null;
      if (pipeline) {
        await pipeline.dispose();
      }

      setIsCalling(false);
      setIsMuted(false);
      setIsSilenced(false);
    }, [clearLocalDetector, removePeerConnection, setIsMuted, setIsSilenced]);

    useEffect(() => {
      endCallRef.current = endCall;
    }, [endCall]);

    // Use useImperativeHandle to expose the endCall function to the parent
    useImperativeHandle(
      ref,
      () => ({
        endCall,
      }),
      [endCall],
    );

    const toggleMute = () => {
      const pipeline = microphonePipelineRef.current;
      if (!pipeline) {
        return;
      }

      const nextMutedState = !isMutedRef.current;
      pipeline.microphoneStream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMutedState;
      });
      pipeline.outgoingStream.getAudioTracks().forEach((track) => {
        track.enabled = !nextMutedState;
      });
      setIsMuted(nextMutedState);

      if (nextMutedState && localUserId.current) {
        onSpeakingStateChange(localUserId.current, false);
      }
    };

    const toggleSilence = () => {
      setIsSilenced((previousState) => !previousState);
    };

    // useEffect hooks for cleanup and signaling
    useEffect(() => {
      isMutedRef.current = isMuted;

      if (isMuted && localUserId.current) {
        onSpeakingStateChange(localUserId.current, false);
      }
    }, [isMuted, onSpeakingStateChange]);

    useEffect(() => {
      return () => {
        void endCallRef.current();
      };
    }, []);

    useEffect(() => {
      if (!isCalling) {
        return;
      }

      const activeParticipantIds = new Set(participants.map(({ id }) => id));
      Object.keys(peerConnections.current).forEach((userId) => {
        if (!activeParticipantIds.has(userId)) {
          removePeerConnection(userId);
        }
      });
    }, [isCalling, participants, removePeerConnection]);

    useEffect(() => {
      // Only start listening for signals if a call is in progress
      if (!supabase || !isCalling) {
        return;
      }

      const signalSubscription = supabase
        .channel(`room_${room.id}_signals`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "signals",
            filter: `room_id=eq.${room.id}`,
          },
          async (payload: SignalPayload) => {
            const signal = payload.new;

            if (signal.receiver_id !== localUserId.current) {
              return;
            }

            try {
              const peerConnection = getOrCreatePeerConnection(
                signal.sender_id,
              );

              if (signal.type === "offer") {
                if (!signal.data || signal.type !== "offer") {
                  return;
                }

                await peerConnection.setRemoteDescription(
                  new RTCSessionDescription(
                    signal.data as RTCSessionDescriptionInit,
                  ),
                );
                await processCandidatesQueue(peerConnection, signal.sender_id);

                const answer = await peerConnection.createAnswer();
                await peerConnection.setLocalDescription(answer);
                await sendSignal(
                  signal.sender_id,
                  "answer",
                  peerConnection.localDescription?.toJSON?.() ??
                    peerConnection.localDescription,
                );
                return;
              }

              if (signal.type === "answer") {
                if (!signal.data || signal.type !== "answer") {
                  return;
                }

                await peerConnection.setRemoteDescription(
                  new RTCSessionDescription(
                    signal.data as RTCSessionDescriptionInit,
                  ),
                );
                await processCandidatesQueue(peerConnection, signal.sender_id);
                return;
              }

              if (signal.type === "ice-candidate") {
                const candidate = signal.data as RTCIceCandidateInit;
                if (peerConnection.remoteDescription) {
                  await peerConnection.addIceCandidate(
                    new RTCIceCandidate(candidate),
                  );
                } else {
                  if (!candidatesQueue.current[signal.sender_id]) {
                    candidatesQueue.current[signal.sender_id] = [];
                  }
                  candidatesQueue.current[signal.sender_id].push(candidate);
                }
              }
            } catch (error) {
              console.error("Error handling signal:", error);
            }
          },
        )
        .subscribe();

      return () => {
        signalSubscription.unsubscribe();
      };
    }, [
      getOrCreatePeerConnection,
      isCalling,
      processCandidatesQueue,
      room.id,
      sendSignal,
      supabase,
    ]);

    return (
      <div className="min-w-40 ml-auto flex items-start justify-end gap-2">
        {isCalling && (
          <>
            <button
              onClick={toggleMute}
              className="font-bold p-2 rounded-lg transition-colors duration-200 bg-n600 hover:bg-n500"
            >
              {isMuted ? (
                <img className="w-8 h-8" src="mute.svg" alt="Mute Icon" />
              ) : (
                <img className="w-8 h-8" src="unmute.svg" alt="Unmute Icon" />
              )}
            </button>
            <button
              onClick={toggleSilence}
              className="font-bold p-2 rounded-lg transition-colors duration-200 bg-n600 hover:bg-n500"
            >
              {isSilenced ? (
                <img className="w-8 h-8" src="deafen.svg" alt="Deafen Icon" />
              ) : (
                <img
                  className="w-8 h-8"
                  src="undeafen.svg"
                  alt="Undeafen Icon"
                />
              )}
            </button>
          </>
        )}
        <button
          onClick={isCalling ? () => void endCall() : () => void startCall()}
          className={`font-bold p-2 rounded-lg transition-colors duration-400 ${
            isCalling
              ? "bg-red-600 hover:bg-red-700 text-white"
              : "bg-green-600 hover:bg-green-700 text-white"
          }`}
        >
          {isCalling ? (
            <img
              className="w-8 h-8 rotate-out"
              src="end-call.svg"
              alt="End Call Icon"
            />
          ) : (
            <img
              className="w-8 h-8 rotate-in"
              src="start-call.svg"
              alt="Start Call Icon"
            />
          )}
        </button>
        {/* Render remote audio streams here */}
        {remoteStreams.map(({ userId, stream }) => (
          <RemoteAudio key={userId} stream={stream} isSilenced={isSilenced} />
        ))}
      </div>
    );
  },
);

export default VoiceChat;
