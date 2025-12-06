import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";
import FindRoom from "./components/findRoom";
import ChatRoom from "./components/chatRoom";

// Supabase configuration placeholders - you will need to replace these
const supabaseUrl = "https://jpsnxxouhuhrifoztpmc.supabase.co";
const supabaseKey =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Impwc254eG91aHVocmlmb3p0cG1jIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NTQ5MDM2NzUsImV4cCI6MjA3MDQ3OTY3NX0.YwqvN-0780xtx5KZcE7CgtqsAtWqE7H9SsqI8j9-iXI";

const supabase = createClient(supabaseUrl, supabaseKey);

const App = () => {
    const [selectedRoom, setSelectedRoom] = useState(null);
    const [view, setView] = useState("findRoom");

    // Centralized user data state, initialized from local storage
    const [userData, setUserData] = useState(() => {
        const name = localStorage.getItem("username") || "Guest";
        const color = localStorage.getItem("userColor") || "#a0a0a0";
        return { name, color };
    });

    // Save user data to local storage whenever it changes
    useEffect(() => {
        localStorage.setItem("username", userData.name);
        localStorage.setItem("userColor", userData.color);
    }, [userData]);

    const handleRoomSelect = (room: any) => {
        setSelectedRoom(room);
        setView("chatRoom");
    };

    const handleLeaveRoom = () => {
        setSelectedRoom(null);
        setView("findRoom");
    };

    const renderView = () => {
        if (view === "findRoom") {
            return (
                <FindRoom supabase={supabase} user={userData} setUser={setUserData} onRoomSelect={handleRoomSelect} />
            );
        }
        if (view === "chatRoom" && selectedRoom) {
            return <ChatRoom supabase={supabase} room={selectedRoom} user={userData} onLeaveRoom={handleLeaveRoom} />;
        }
        return null;
    };

    return renderView();
};

export default App;
