import { useState, useEffect, useRef } from "react";
import ImageModal from "./ImageModal";

const MessageBox = ({ supabase, room, user, localUserId }: any) => {
    // Message and UI states
    const [messages, setMessages] = useState<any[]>([]);
    const [newMessage, setNewMessage] = useState("");
    const [imageFile, setImageFile] = useState<File | null>(null);
    const [imagePreview, setImagePreview] = useState<string | null>(null);
    const [isSending, setIsSending] = useState(false);
    const [imageLoading, setImageLoading] = useState<Record<string, boolean>>({});
    const [isDragging, setIsDragging] = useState(false);
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const dragCounter = useRef(0);
    const MAX_MESSAGE_LENGTH = 2000;

    // Function to fetch initial messages and set up real-time subscription
    useEffect(() => {
        const fetchMessages = async () => {
            if (!supabase) return;

            try {
                const { data, error } = await supabase
                    .from("messages")
                    .select("*")
                    .eq("room_id", room.id)
                    .order("created_at", { ascending: true })
                    .limit(50);
                if (error) throw error;
                setMessages(data || []);
            } catch (e: any) {
                console.error("Error fetching messages:", e.message);
            }
        };

        const subscribeToMessages = () => {
            const messageSubscription = supabase
                .channel(`room_${room.id}_messages`)
                .on(
                    "postgres_changes",
                    {
                        event: "INSERT",
                        schema: "public",
                        table: "messages",
                        filter: `room_id=eq.${room.id}`,
                    },
                    (payload: any) => {
                        setMessages((prevMessages) => [...prevMessages, payload.new]);
                    },
                )
                .subscribe();

            return () => {
                messageSubscription.unsubscribe();
            };
        };

        fetchMessages();
        const unsubscribe = subscribeToMessages();

        return () => {
            if (unsubscribe) unsubscribe();
        };
    }, [supabase, room.id]);

    // Update last_active_at when the component mounts and on a timer
    useEffect(() => {
        const updateLastActive = async () => {
            if (supabase) {
                try {
                    await supabase.from("rooms").update({ last_active_at: new Date().toISOString() }).eq("id", room.id);
                } catch (e: any) {
                    console.error("Error updating last_active_at:", e.message);
                }
            }
        };

        // Update on mount
        updateLastActive();

        // Also update every 5 minutes to keep the timestamp fresh
        const interval = setInterval(updateLastActive, 5 * 60 * 1000);

        // Cleanup the interval
        return () => clearInterval(interval);
    }, [supabase, room.id]);

    // Auto-scroll to the bottom when new messages arrive
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [messages]);

    // Auto-resize the textarea based on content
    useEffect(() => {
        if (textareaRef.current) {
            textareaRef.current.style.height = "auto"; // Reset height to recalculate
            textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
        }
    }, [newMessage]);

    // Function to process a file and set up the preview
    const processImageFile = (file: File) => {
        if (file) {
            // If the file is a GIF, bypass conversion and use the original file
            if (file.type === "image/gif") {
                setImageFile(file);
                setImagePreview(URL.createObjectURL(file));
            } else {
                // For other image types, convert and resize to WebP
                const reader = new FileReader();
                reader.onload = (event) => {
                    const img = new Image();
                    img.onload = () => {
                        // Resizing logic for resolution control
                        const MAX_SIZE = 1920; // pixels
                        let width = img.width;
                        let height = img.height;

                        if (width > height) {
                            if (width > MAX_SIZE) {
                                height *= MAX_SIZE / width;
                                width = MAX_SIZE;
                            }
                        } else {
                            if (height > MAX_SIZE) {
                                width *= MAX_SIZE / height;
                                height = MAX_SIZE;
                            }
                        }

                        // Use a canvas to resize and convert the image
                        const canvas = document.createElement("canvas");
                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext("2d");
                        ctx?.drawImage(img, 0, 0, width, height);

                        canvas.toBlob(
                            (blob) => {
                                if (blob) {
                                    const webpFileName = `${file.name.split(".")[0]}.webp`;
                                    const webpFile = new File([blob], webpFileName, { type: "image/webp" });
                                    setImageFile(webpFile);
                                    setImagePreview(URL.createObjectURL(webpFile));
                                }
                            },
                            "image/webp",
                            0.8,
                        ); // 0.8 is the quality
                    };
                    img.src = event.target?.result as string;
                };
                reader.readAsDataURL(file);
            }
        }
    };

    // Function to handle image selection from the file input
    const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            processImageFile(file);
        }
    };

    // Handle pasted images from the clipboard
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData?.items;
        if (items) {
            for (let i = 0; i < items.length; i++) {
                // Check if the item is a file and an image
                if (items[i].kind === "file" && items[i].type.startsWith("image/")) {
                    const file = items[i].getAsFile();
                    if (file) {
                        e.preventDefault(); // Prevent the image data from being pasted as text
                        processImageFile(file); // Process the file
                        break; // Stop after finding the first image
                    }
                }
            }
        }
    };

    // Handle drag-and-drop events
    const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const isImage = Array.from(e.dataTransfer.items || []).some(
            (item) => item.kind === "file" && item.type.startsWith("image/")
        );

        if (isImage) {
            dragCounter.current++;
            if (dragCounter.current === 1) {
                setIsDragging(true);
            }
        }
    };

    const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();

        const isImage = Array.from(e.dataTransfer.items || []).some(
            (item) => item.kind === "file" && item.type.startsWith("image/")
        );

        if (isImage) {
            dragCounter.current--;
            if (dragCounter.current === 0) {
                setIsDragging(false);
            }
        }
    };

    const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
        const isImage = Array.from(e.dataTransfer.items || []).some(
            (item) => item.kind === "file" && item.type.startsWith("image/")
        );

        if (isImage) {
            e.preventDefault();
            e.stopPropagation();
        }
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        dragCounter.current = 0; // Reset counter on drop
        setIsDragging(false);

        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith("image/")) {
            processImageFile(file);
        }
    };

    // Function to upload the image to Supabase Storage
    const uploadImage = async (file: File) => {
        const filePath = `${room.id}/${localUserId}/${Date.now()}-${file.name}`;
        const { error } = await supabase.storage.from("chat-images").upload(filePath, file, {
            cacheControl: "3600",
            upsert: false,
        });

        if (error) {
            throw error;
        }

        const { data: publicURLData } = supabase.storage.from("chat-images").getPublicUrl(filePath);

        return publicURLData.publicUrl;
    };

    // Function to send a new message
    const handleSendMessage = async (e: any) => {
        e.preventDefault();
        if (newMessage.trim() === "" && !imageFile) return;

        setIsSending(true);

        try {
            let imageUrl = null;
            if (imageFile) {
                imageUrl = await uploadImage(imageFile);
            }

            // Update the last_active_at timestamp before inserting the new message
            await supabase.from("rooms").update({ last_active_at: new Date().toISOString() }).eq("id", room.id);

            await supabase.from("messages").insert({
                room_id: room.id,
                user_id: localUserId,
                user_name: user.name,
                user_color: user.color,
                content: newMessage,
                image_url: imageUrl,
            });

            setNewMessage(""); // Clear the input field after successful send
            setImageFile(null); // Clear image file
            setImagePreview(null); // Clear image preview
        } catch (e: any) {
            console.error("Error sending message:", e.message);
        } finally {
            setIsSending(false);
        }
    };

    // Keyboard event handler for Enter and Shift+Enter
    const handleKeyDown = (e: any) => {
        if (isSending) {
            e.preventDefault();
            return;
        } else if (e.key === "Enter") {
            if (!e.shiftKey) {
                e.preventDefault();
                handleSendMessage(e);
            }
        }
    };

    // Function to handle image click and open the modal
    const handleImageClick = (imageUrl: string) => {
        setSelectedImage(imageUrl);
    };

    // Function to close the modal
    const handleCloseModal = () => {
        setSelectedImage(null);
    };

    // Helper function to render message content with clickable links
    const renderContent = (content: string) => {
        if (!content) return null;

        // Regex to match URLs
        const urlRegex = /(https?:\/\/[^\s]+)/g;
        const parts = content.split(urlRegex);

        return parts.map((part, index) => {
            if (part.match(urlRegex)) {
                return (
                    <a
                        key={index}
                        href={part}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:underline break-all"
                    >
                        {part}
                    </a>
                );
            }
            return part;
        });
    };

    return (
        <>
            {/* Message Container */}
            <div
                ref={chatContainerRef}
                className="flex-1 overflow-y-auto pr-4 flex flex-col"
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {/* Drag-and-drop overlay */}
                {isDragging && (
                    <div className="absolute inset-0 z-10 bg-n800/80 flex items-center justify-center rounded-lg border-2 border-dashed border-blue-500 text-blue-300 text-xl font-semibold">
                        Drop image here
                    </div>
                )}

                {messages.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center text-n300 text-lg">
                        <p>No messages yet. Say hello!</p>
                    </div>
                ) : (
                    messages.map((message, index) => {
                        const previousMessage = messages[index - 1];
                        const showName = !previousMessage || previousMessage.user_id !== message.user_id;

                        // Set loading state when the message is first rendered with an image
                        if (message.image_url && imageLoading[message.image_url] === undefined) {
                            setImageLoading((prev) => ({ ...prev, [message.image_url]: true }));
                        }

                        return (
                            <div
                                key={message.id}
                                className="flex flex-col max-w-[80%]"
                                style={{
                                    marginLeft: message.user_id === localUserId ? "auto" : "0",
                                    marginRight: message.user_id === localUserId ? "0" : "auto",
                                }}
                            >
                                {showName && (
                                    <span
                                        style={{
                                            color: message.user_color,
                                            marginLeft: message.user_id === localUserId ? "auto" : "0",
                                            marginRight: message.user_id === localUserId ? "0" : "auto",
                                        }}
                                        className="font-semibold mt-4"
                                    >
                                        {message.user_name}
                                    </span>
                                )}

                                <div className="w-full bg-n700 flex flex-col mt-2 gap-2 rounded-lg p-3 whitespace-pre-wrap">
                                    {message.image_url && imageLoading[message.image_url] && (
                                        <div className="w-64 h-48 bg-n600 rounded-lg animate-pulse flex items-center justify-center text-n300">
                                            Loading...
                                        </div>
                                    )}
                                    {message.image_url && (
                                        <img
                                            src={message.image_url}
                                            alt="Chat Image"
                                            className={`max-h-64 rounded-lg object-contain mx-auto ${
                                                imageLoading[message.image_url] ? "hidden" : "block"
                                            } cursor-pointer`}
                                            onClick={() => handleImageClick(message.image_url)}
                                            onLoad={() =>
                                                setImageLoading((prev) => ({ ...prev, [message.image_url]: false }))
                                            }
                                            onError={() => {
                                                console.error(`Error loading image from ${message.image_url}`);
                                                setImageLoading((prev) => ({
                                                    ...prev,
                                                    [message.image_url]: false,
                                                }));
                                            }}
                                        />
                                    )}
                                    <div className="flex gap-2">
                                        <p className="text-n100 mr-auto">{renderContent(message.content)}</p>
                                        <span className="text-n400 text-xs h-fit text-nowrap mt-auto">
                                            {new Date(message.created_at).toLocaleTimeString("en-GB", {
                                                hour: "2-digit",
                                                minute: "2-digit",
                                            })}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        );
                    })
                )}
            </div>

            {/* Message Input Form */}
            <form onSubmit={handleSendMessage} className="flex gap-4 pt-4 border-t border-n700 items-end relative">
                <input
                    type="file"
                    accept="image/*"
                    onChange={handleImageSelect}
                    ref={imageInputRef}
                    className="hidden"
                />
                {imagePreview && (
                    <div className="absolute -top-16 left-0 pl-2 bg-n700 rounded-lg flex items-center">
                        <img src={imagePreview} alt="Image Preview" className="h-16 w-20 object-cover rounded-md" />
                        <button
                            onClick={() => {
                                setImageFile(null);
                                setImagePreview(null);
                            }}
                            className="text-n300 hover:text-red-500 w-12 h-16 font-bold text-xl"
                        >
                            X
                        </button>
                    </div>
                )}
                <textarea
                    ref={textareaRef}
                    value={newMessage}
                    onKeyDown={handleKeyDown}
                    onPaste={handlePaste}
                    onChange={(e) => setNewMessage(e.target.value)}
                    placeholder="Type a message..."
                    className={"flex-1 p-3 bg-n700 text-n100 rounded-lg focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none overflow-hidden".concat(
                        MAX_MESSAGE_LENGTH - newMessage.length < 100 ? " pr-16" : "",
                    )}
                    maxLength={MAX_MESSAGE_LENGTH}
                    rows={1}
                    style={{ minHeight: "3rem", maxHeight: "6rem" }}
                />
                {newMessage.trim().length === 0 && !imageFile ? (
                    <button
                        type="button"
                        onClick={() => imageInputRef.current?.click()}
                        className="w-12 h-12 bg-n700 hover:bg-n600 text-n100 rounded-lg transition-colors duration-200"
                    >
                        <svg
                            className="w-6 h-6 mx-auto"
                            fill="currentColor"
                            viewBox="0 0 20 20"
                            xmlns="http://www.w3.org/2000/svg"
                        >
                            <path
                                fillRule="evenodd"
                                d="M4 3a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V5a2 2 0 00-2-2H4zm12 12H4l4-8 3 6 2-4 3 6z"
                                clipRule="evenodd"
                            ></path>
                        </svg>
                    </button>
                ) : (
                    <button
                        type="submit"
                        disabled={isSending}
                        className="w-12 h-12 bg-blue-600 hover:bg-blue-700 text-white font-bold p-2 rounded-lg transition-colors duration-200 disabled:bg-n700 disabled:pointer-events-none"
                    >
                        {isSending ? (
                            <span className="w-8 h-8 ellipsis"></span>
                        ) : (
                            <img className="w-8 h-8" src="send.svg" alt="Send Icon" />
                        )}
                    </button>
                )}
                {MAX_MESSAGE_LENGTH - newMessage.length < 100 && (
                    <div className="absolute right-18 bottom-2 text-xs text-n400">
                        <span>
                            {newMessage.length}/{MAX_MESSAGE_LENGTH}
                        </span>
                    </div>
                )}
            </form>

            {/* Render the ImageModal component if an image is selected */}
            {selectedImage && <ImageModal imageUrl={selectedImage} onClose={handleCloseModal} />}
        </>
    );
};

export default MessageBox;
