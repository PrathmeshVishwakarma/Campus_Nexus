/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        border: "rgba(139, 92, 246, 0.15)",
        input: "rgba(17, 24, 39, 0.2)",
        ring: "rgba(139, 92, 246, 0.3)",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "from-violet-600 to-indigo-600",
          foreground: "#F0F4F8",
        },
        card: {
          DEFAULT: "rgba(30, 30, 46, 0.8)",
          foreground: "#F0F4F8",
        },
        popover: {
          DEFAULT: "rgba(30, 30, 46, 0.8)",
          foreground: "#F0F4F8",
        },
        cardHover: "rgba(30, 30, 46, 0.6)",
        secondaryCard: "rgba(20, 20, 35, 0.8)",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "Roboto", "Oxygen", "Ubuntu", "Cantarell", "Open Sans", "Helvetica Neue", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-height)" },
          to: { height: "0" },
        },
        "caret-blink": {
          "0%,70%,100%": { opacity: "1" },
          "20%,50%": { opacity: "0" },
        },
        "fade-in-up": {
          "0%": { opacity: 0, transform: "translateY(10px)" },
          "100%": { opacity: 1, transform: "translateY(0)" },
        },
        "fade-in": {
          "0%": { opacity: 0 },
          "100%": { opacity: 1 },
        },
        "pulse-slow": {
          "0%, 100%": { opacity: 1 },
          "50%": { opacity: 0.5 },
        },
        "gradient-x": {
          "0%, 100%": {
            "background-size": "200% 200%",
            "background-position": "left center",
          },
          "50%": {
            "background-size": "200% 200%",
            "background-position": "right center",
          },
        },
        "blob": {
          "0%": {
            transform: "translate(0, 0) scale(1)",
          },
          "33%": {
            transform: "translate(30px, -50px) scale(1.1)",
          },
          "66%": {
            transform: "translate(-20px, 20px) scale(0.9)",
          },
          "100%": {
            transform: "translate(0, 0) scale(1)",
          },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "caret-blink": "caret-blink 1.25s ease-out infinite",
        "fade-in-up": "fade-in-up 0.3s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "pulse-slow": "pulse-slow 2s cubic-bezier(0.4, 0, 0.2, 1) infinite",
        "gradient-x": "gradient-x 15s ease infinite",
        "blob": "blob 7s cubic-bezier(0, 0, 0.2, 1) infinite",
      },
      boxShadow: {
        soft: "0 4px 20px rgba(0, 0, 0, 0.3)",
        card: "0 2px 12px rgba(0, 0, 0, 0.2)",
        button: "0 4px 16px rgba(139, 92, 246, 0.3)",
        input: "0 1px 3px rgba(0, 0, 0, 0.1)",
      },
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "24px",
      },
      screens: {
        xs: "475px",
        sm: "640px",
        md: "768px",
        lg: "1024px",
        xl: "1280px",
        "2xl": "1536px",
      },
    },
  },
  plugins: [
    require("tailwindcss-animate"),
  ],
}