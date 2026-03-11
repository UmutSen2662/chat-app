import { useState, useEffect, useRef } from "react";

const FindRoom = ({ supabase, user, setUser, onRoomSelect }: any) => {
    // --- Generate a unique user ID on first load and store in localStorage
    // This part is crucial for identifying the user across sessions
    useEffect(() => {
        let userId = localStorage.getItem("userId");
        if (!userId) {
            userId = crypto.randomUUID();
            localStorage.setItem("userId", userId);
        }
    }, []);

    // State for local UI logic
    const [rooms, setRooms] = useState<any[]>([]);
    const [selectedRoom, setSelectedRoom] = useState<any>(null);
    const [passwordInput, setPasswordInput] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState("");
    const [newRoomName, setNewRoomName] = useState("");
    const [newRoomPassword, setNewRoomPassword] = useState("");
    const [createRoomLoading, setCreateRoomLoading] = useState(false);
    const [createRoomMessage, setCreateRoomMessage] = useState("");
    const [maxHeight, setMaxHeight] = useState<Number | null>(null);
    const settingsContainer = useRef<HTMLDivElement | null>(null);
    const roomsContainer = useRef<HTMLDivElement | null>(null);

    // --- Helper function to fetch initial rooms from Supabase
    const fetchRooms = async () => {
        if (!supabase) return;

        try {
            // Fetching the room ID, name, and password_hash
            const { data, error } = await supabase.from("rooms").select("id, name, password_hash");
            if (error) {
                throw error;
            }
            setRooms(data);
            console.log("Rooms fetched:", data);
        } catch (e: any) {
            console.error("Error fetching rooms:", e.message);
            setError("Failed to load rooms. Please check your Supabase connection.");
        } finally {
            setLoading(false);
        }
    };

    // --- Handle joining a room with secure password validation
    const handleJoinRoom = async (room: any, passwordAttempt: string) => {
        setError(""); // Clear previous errors

        // Check if the room has no password_hash, it's public.
        if (!room.password_hash) {
            console.log(`Joined public room: ${room.name}`);
            onRoomSelect(room);
            return;
        }

        try {
            // Call the secure Edge Function for password validation
            const response = await fetch(
                "https://jpsnxxouhuhrifoztpmc.supabase.co/functions/v1/validate-room-password",
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({ roomId: room.id, password: passwordAttempt }),
                }
            );

            const result = await response.json();

            if (result.isValid) {
                console.log(`Joined room: ${room.name}`);
                onRoomSelect(room);
            } else {
                setError("Incorrect password. Please try again.");
            }
        } catch (e) {
            console.error("Error validating password:", e);
            setError("An error occurred during validation. Please try again.");
        }
    };

    // --- Handle creating a new room securely
    const handleCreateRoom = async () => {
        if (!supabase) {
            setCreateRoomMessage("Supabase not ready.");
            return;
        }
        if (!newRoomName) {
            setCreateRoomMessage("Room name is required.");
            return;
        }
        const existingRoom = rooms.find((r: any) => r.name === newRoomName);
        if (existingRoom) {
            setCreateRoomMessage("Room name is already in use.");
            return;
        }

        setCreateRoomLoading(true);
        setCreateRoomMessage("");

        try {
            // This function will hash the password on the server.
            const response = await fetch("https://jpsnxxouhuhrifoztpmc.supabase.co/functions/v1/create-room-secure", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ roomName: newRoomName, password: newRoomPassword }),
            });

            const result = await response.json();

            if (response.ok) {
                const newRoom = result.room;
                setCreateRoomMessage(`Room "${newRoom.name}" created successfully!`);

                // Automatically join the newly created room (password is already known)
                onRoomSelect(newRoom);

                setNewRoomName("");
                setNewRoomPassword("");
            } else {
                throw new Error(result.error || "Failed to create room.");
            }
        } catch (e: any) {
            console.error("Error creating room:", e.message);
            setCreateRoomMessage("Failed to create room. Please try again.");
        } finally {
            setCreateRoomLoading(false);
        }
    };

    // Use a single useEffect for fetching rooms and setting up the real-time subscription
    useEffect(() => {
        if (supabase) {
            fetchRooms();

            const roomSubscription = supabase
                .channel("rooms")
                .on(
                    "postgres_changes",
                    {
                        event: "*",
                        schema: "public",
                        table: "rooms",
                    },
                    () => {
                        fetchRooms();
                    }
                )
                .subscribe();

            return () => {
                roomSubscription.unsubscribe();
            };
        }
    }, [supabase]);

    useEffect(() => {
        function updateHeight() {
            if (settingsContainer.current) {
                setMaxHeight(settingsContainer.current.offsetHeight);
            }
        }

        updateHeight(); // run on mount
        window.addEventListener("resize", updateHeight);

        return () => window.removeEventListener("resize", updateHeight);
    }, []);

    return (
        <div className="w-full max-w-6xl p-4 md:p-8 md:bg-n800 md:rounded-2xl flex flex-col md:flex-row gap-8">
            {/* Left Panel: Room Finder */}
            <div
                ref={roomsContainer}
                style={{ maxHeight: maxHeight ? `${maxHeight}px` : "auto" }}
                className="w-full md:w-2/3 p-4 bg-n700 rounded-xl flex flex-col gap-4"
            >
                <h2 className="text-2xl font-bold text-n100">Room Finder</h2>
                <input
                    type="text"
                    placeholder="Search for a room..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
                <div className="flex-1 overflow-y-auto flex flex-col gap-2">
                    {loading ? (
                        <p className="text-n300">Loading rooms...</p>
                    ) : rooms.length === 0 ? (
                        <p className="text-n300">No rooms available. Create one!</p>
                    ) : (
                        rooms
                            .filter((room: any) => room.name.toLowerCase().includes(searchQuery.toLowerCase()))
                            .map((room: any) => (
                                <div
                                    key={room.id}
                                    className="bg-n600 rounded-lg p-4 transition-all select-none duration-200 ease-in-out cursor-pointer"
                                >
                                    <div
                                        onClick={() => setSelectedRoom(selectedRoom?.id === room.id ? null : room)}
                                        className="flex justify-between items-center"
                                    >
                                        <span className="text-lg font-semibold">{room.name}</span>
                                        {selectedRoom?.id === room.id ? (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                className="h-6 w-6 transform rotate-180 transition-transform"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M19 9l-7 7-7-7"
                                                />
                                            </svg>
                                        ) : (
                                            <svg
                                                xmlns="http://www.w3.org/2000/svg"
                                                className="h-6 w-6 transition-transform"
                                                fill="none"
                                                viewBox="0 0 24 24"
                                                stroke="currentColor"
                                            >
                                                <path
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                    strokeWidth={2}
                                                    d="M19 9l-7 7-7-7"
                                                />
                                            </svg>
                                        )}
                                    </div>

                                    {/* Password entry field (only shows when room is selected) */}
                                    {selectedRoom?.id === room.id && (
                                        <div className="mt-4 flex flex-col gap-2">
                                            {room.password_hash ? (
                                                <form
                                                    onSubmit={(e) => {
                                                        e.preventDefault();
                                                        handleJoinRoom(room, passwordInput);
                                                    }}
                                                    className="flex flex gap-2"
                                                >
                                                    <input
                                                        type="password"
                                                        placeholder="Enter password"
                                                        value={passwordInput}
                                                        onChange={(e) => setPasswordInput(e.target.value)}
                                                        className="w-full p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                                                    />
                                                    <button
                                                        onClick={() => handleJoinRoom(room, passwordInput)}
                                                        className="w-fit text-nowrap bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-md transition-colors duration-200"
                                                    >
                                                        Join Room
                                                    </button>
                                                </form>
                                            ) : (
                                                <button
                                                    onClick={() => handleJoinRoom(room, "")}
                                                    className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-md transition-colors duration-200"
                                                >
                                                    Join Room
                                                </button>
                                            )}
                                            {error && <p className="text-red-400 text-sm mt-2">{error}</p>}
                                        </div>
                                    )}
                                </div>
                            ))
                    )}
                </div>
            </div>

            {/* Right Panel: User Settings and Create Room */}
            <div ref={settingsContainer} className="w-full md:w-1/3 flex flex-col gap-8">
                {/* User Settings */}
                <div className="p-4 bg-n700 rounded-xl flex flex-col gap-4">
                    <div className="flex flex-col gap-2">
                        <h2 className="text-2xl font-bold text-n100">Your Identity</h2>
                        <label className="block text-n300">Username</label>
                        <input
                            type="text"
                            placeholder="Choose a username"
                            value={user.name}
                            onChange={(e) => setUser({ ...user, name: e.target.value })}
                            className="w-full p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                    </div>
                    <div className="flex flex-col gap-2">
                        <p className="block text-n300 pointer-events-none">Color</p>
                        <div className="flex space-x-2">
                            {["#ff6666", "#66ff66", "#6666ff", "#ffff66", "#ff66ff", "#66ffff"].map((color) => (
                                <div
                                    key={color}
                                    onClick={() => setUser({ ...user, color: color })}
                                    className={`w-8 h-8 rounded-full border-2 cursor-pointer transition-all duration-200 ${
                                        user.color === color ? "border-black ring-2 ring-white" : "border-transparent"
                                    }`}
                                    style={{ backgroundColor: color }}
                                />
                            ))}
                        </div>
                    </div>
                    <div className="flex-1 flex items-end">
                        <p className="text-sm text-n300">
                            Your username will be <span style={{ color: user.color }}>{user.name}</span> in the chat.
                        </p>
                    </div>
                </div>

                {/* Create Room Panel */}
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        handleCreateRoom();
                    }}
                    className="p-4 bg-n700 rounded-xl flex flex-col gap-4"
                >
                    <div className="flex flex-col gap-2">
                        <h2 className="text-2xl font-bold text-n100">Create a Room</h2>
                        <label className="block text-n300">Room Name</label>
                        <input
                            type="text"
                            placeholder="Enter room name"
                            value={newRoomName}
                            onChange={(e) => setNewRoomName(e.target.value)}
                            className="w-full min-w-16 p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                        <label className="block text-n300">Password (optional)</label>
                        <input
                            type="password"
                            placeholder="Enter password"
                            value={newRoomPassword}
                            onChange={(e) => setNewRoomPassword(e.target.value)}
                            className="w-full min-w-16 p-2 bg-n800 text-n100 rounded-md focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        />
                    </div>
                    <button
                        onClick={handleCreateRoom}
                        disabled={createRoomLoading || !supabase}
                        className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-2 px-4 rounded-md transition-colors duration-200 disabled:bg-n500 disabled:pointer-events-none"
                    >
                        {createRoomLoading ? "Creating..." : "Create Room"}
                    </button>
                    <p
                        className={`text-sm ${
                            createRoomMessage.includes("successfully") ? "text-green-400" : "text-red-400"
                        }`}
                    >
                        {createRoomMessage}
                    </p>
                </form>
            </div>
            <a
                className="ml-auto md:absolute md:bottom-4 md:right-4"
                href="https://github.com/UmutSen2662/chat-app"
                target="_blank"
            >
                Github Page
            </a>
        </div>
    );
};

export default FindRoom;
