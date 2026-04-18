import { useState, useEffect, useRef, useCallback } from "react";
import MessageBox from "./MessageBox";
import VoiceChat, {
  type VoiceChatHandle,
  type VoiceChatSupabaseLike,
} from "./VoiceChat";

type User = {
  name: string;
  color: string;
};

type Room = {
  id: string;
  name: string;
};

type Participant = {
  id: string;
  user_name: string;
  user_color: string;
};

type PresenceEntry = {
  user_id: string;
  user_name: string;
  user_color: string;
};

type PresenceChannel = {
  on: (
    event: "presence",
    filter: { event: "sync" },
    callback: () => void,
  ) => PresenceChannel;
  presenceState: () => Record<string, PresenceEntry[]>;
  subscribe: (callback: (status: string) => void | Promise<void>) => void;
  track: (payload: {
    user_id: string | null;
    user_name: string;
    user_color: string;
  }) => PromiseLike<unknown>;
  unsubscribe: () => void;
};

type ChatRoomProps = {
  supabase: VoiceChatSupabaseLike & {
    channel: (
      name: string,
      options?: { config: { presence: { key: string } } },
    ) => PresenceChannel;
  };
  room: Room;
  user: User;
  onLeaveRoom: () => void;
};

const ChatRoom = ({ supabase, room, user, onLeaveRoom }: ChatRoomProps) => {
  // Only keep states and refs that are shared or truly belong to the main container
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [isMuted, setIsMuted] = useState(false);
  const [isSilenced, setIsSilenced] = useState(false);
  const [speakingByUserId, setSpeakingByUserId] = useState<
    Record<string, boolean>
  >({});
  const localUserId = useRef(localStorage.getItem("userId"));
  const voiceChatRef = useRef<VoiceChatHandle | null>(null);

  const handleLeaveRoom = useCallback(() => {
    if (voiceChatRef.current && voiceChatRef.current.endCall) {
      void voiceChatRef.current.endCall();
    }
    onLeaveRoom();
  }, [onLeaveRoom]);

  // This useEffect handles the browser's back button
  useEffect(() => {
    // We only add a history entry if a room is active and we haven't already.
    if (room) {
      // Push a new state to the history stack. This doesn't change the URL
      // but creates a new entry for the back button to "land" on.
      history.pushState(null, "", window.location.href);

      // Add a listener for the popstate event, which is fired when the user
      // navigates history (e.g., clicks the back button).
      const handlePopState = () => {
        handleLeaveRoom();
      };
      window.addEventListener("popstate", handlePopState);

      // Clean-up function to remove the event listener and navigate forward
      // in the history to prevent unintended behavior.
      return () => {
        window.removeEventListener("popstate", handlePopState);
        history.go(1);
      };
    }
  }, [handleLeaveRoom, room]); // Depend on 'room' to run this effect only when a room is selected.

  // Supabase Presence channel to track users
  useEffect(() => {
    if (!supabase) return;
    const presenceChannel = supabase.channel("presence-tracker", {
      config: { presence: { key: room.id } },
    });

    presenceChannel.on("presence", { event: "sync" }, () => {
      const presenceState = presenceChannel.presenceState();
      const currentParticipants = (presenceState[room.id] ?? []).flatMap(
        (p: PresenceEntry) =>
          p.user_id !== localUserId.current
            ? [
                {
                  id: p.user_id,
                  user_name: p.user_name,
                  user_color: p.user_color,
                },
              ]
            : [],
      );
      setParticipants(currentParticipants);
    });

    presenceChannel.subscribe(async (status: string) => {
      if (status === "SUBSCRIBED") {
        await presenceChannel.track({
          user_id: localUserId.current,
          user_name: user.name,
          user_color: user.color,
        });
      }
    });

    return () => {
      presenceChannel.unsubscribe();
    };
  }, [supabase, room.id, user.name, user.color]);

  useEffect(() => {
    setSpeakingByUserId({});
  }, [room.id]);

  const handleSpeakingStateChange = useCallback(
    (userId: string, isSpeaking: boolean) => {
      setSpeakingByUserId((previousState) => {
        if (previousState[userId] === isSpeaking) {
          return previousState;
        }

        return {
          ...previousState,
          [userId]: isSpeaking,
        };
      });
    },
    [],
  );

  const getParticipantClassName = (isSpeaking: boolean) =>
    `bg-n700 px-3 py-1 text-nowrap rounded-full text-sm transition-all duration-200 ${
      isSpeaking
        ? "bg-n600 ring-2 ring-green-400 shadow-[0_0_0_1px_rgba(74,222,128,0.3)]"
        : ""
    }`;

  return (
    <div className="w-full h-[100dvh] bg-n900 text-n100 md:p-4 flex items-center justify-center font-inter">
      <div className="w-full max-w-6xl h-full p-4 md:p-8 md:rounded-2xl bg-n800 flex flex-col gap-4 relative">
        {/* Header */}
        <div className="flex justify-between items-center pb-4 border-b border-n700">
          <h2 className="text-3xl font-bold text-n100 truncate">
            Room: {room.name}
          </h2>
          <button
            onClick={handleLeaveRoom}
            className="text-white font-bold text-2xl py-2 px-4 rounded-md hover:bg-red-700 transition-all duration-200"
          >
            X
          </button>
        </div>

        {/* Participants and WebRTC Controls */}
        <div className="flex flex-wrap md:flex-nowrap gap-4 pb-4">
          <div className="flex flex-col gap-2">
            <ul className="h-fit flex flex-nowrap md:flex-wrap overflow-visible gap-2 text-n300">
              {/* ... participant list rendering ... */}
              <li
                className={getParticipantClassName(
                  Boolean(
                    localUserId.current &&
                    speakingByUserId[localUserId.current],
                  ),
                )}
              >
                <span style={{ color: user.color }}>{user.name} (You)</span>
              </li>
              {participants.map((p) => (
                <li
                  key={p.id}
                  className={getParticipantClassName(
                    Boolean(speakingByUserId[p.id]),
                  )}
                >
                  <span style={{ color: p.user_color }}>{p.user_name}</span>
                </li>
              ))}
            </ul>
            {participants.length === 0 ? (
              <p className="text-n500">No other users in this room.</p>
            ) : null}
          </div>
          <VoiceChat
            ref={voiceChatRef}
            supabase={supabase}
            room={room}
            participants={participants}
            isMuted={isMuted}
            setIsMuted={setIsMuted}
            isSilenced={isSilenced}
            setIsSilenced={setIsSilenced}
            onSpeakingStateChange={handleSpeakingStateChange}
          />
        </div>

        <MessageBox
          supabase={supabase}
          room={room}
          user={user}
          localUserId={localUserId.current}
        />
      </div>
    </div>
  );
};

export default ChatRoom;
