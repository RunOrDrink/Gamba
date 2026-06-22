export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        casino: {
          bg: "#0B0F14",
          surface: "#121821",
          card: "#171F2B",
          border: "#253041",
          muted: "#94A3B8"
        },
        neon: {
          green: "#22C55E",
          emerald: "#10B981",
          amber: "#F59E0B",
          orange: "#FB923C",
          red: "#EF4444",
          cyan: "#06B6D4",
          blue: "#3B82F6"
        }
      },
      boxShadow: {
        glowGreen: "0 0 34px rgba(34, 197, 94, 0.34)",
        glowAmber: "0 0 34px rgba(245, 158, 11, 0.34)",
        glowRed: "0 0 38px rgba(239, 68, 68, 0.38)",
        glass: "0 22px 80px rgba(0, 0, 0, 0.45)"
      },
      fontFamily: {
        display: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      }
    }
  },
  plugins: []
};
