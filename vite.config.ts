import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import { VitePWA } from "vite-plugin-pwa";

// https://vite.dev/config/
export default defineConfig({
    plugins: [
        react(),
        tailwindcss(),
        VitePWA({
            registerType: "autoUpdate",
            injectRegister: "auto",
            manifest: {
                name: "Chat App",
                short_name: "Chat App",
                description: "A real-time text and voice chat application.",
                theme_color: "#121212",
                background_color: "#121212",
                display_override: ["standalone", "minimal-ui", "browser", "window-controls-overlay"],
                orientation: "natural",
                lang: "en",
                icons: [
                    {
                        src: "pwa-192x192.png",
                        sizes: "192x192",
                        type: "image/png",
                    },
                    {
                        src: "pwa-512x512.png",
                        sizes: "512x512",
                        type: "image/png",
                    },
                ],
                categories: ["chat", "social", "communication"],
            },
            workbox: {
                // You can add more caching strategies here for specific assets
                globPatterns: ["**/*.{js,css,html,ico,png,svg}"],
            },
        }),
    ],
});
