export const COLORS = {
  dark: {
    bg: "rgba(30, 30, 46, 0.8)",
    card: "rgba(30, 30, 46, 0.5)",
    cardHover: "rgba(30, 30, 46, 0.6)",
    surface: "rgba(20, 20, 35, 0.8)",
    surface2: "rgba(25, 25, 40, 0.9)",
    text: "#F0F4F8",
    muted: "#8892B0",
    border: "rgba(139, 92, 246, 0.15)",
    accent: "from-violet-600 to-indigo-600",
    accentHover: "from-violet-500 to-indigo-500",
    success: "from-emerald-500 to-emerald-400",
    warning: "from-amber-500 to-orange-500",
    error: "from-rose-500 to-rose-400",
    primary: "violet-600",
    primaryHover: "violet-500",
    rose: "rose-500",
    emerald: "emerald-500",
  },
  light: {
    bg: "rgba(248, 250, 252, 0.9)",
    card: "rgba(255, 255, 255, 0.8)",
    cardHover: "rgba(248, 250, 252, 0.9)",
    surface: "rgba(255, 255, 255, 0.9)",
    surface2: "rgba(240, 244, 248, 0.9)",
    text: "#1E293B",
    muted: "#64748B",
    border: "rgba(139, 92, 246, 0.15)",
    accent: "from-violet-500 to-indigo-400",
    accentHover: "from-violet-400 to-indigo-300",
    success: "from-emerald-600 to-emerald-500",
    warning: "from-amber-500 to-orange-400",
    error: "from-rose-500 to-rose-400",
    primary: "violet-500",
    primaryHover: "violet-400",
    rose: "rose-500",
    emerald: "emerald-500",
  },
} as const

export const TYPOGRAPHY = {
  fontFamily: "'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, monospace",
  h1: "text-3xl font-extrabold tracking-tight",
  h2: "text-xl font-bold",
  h3: "text-lg font-medium",
  body: "text-sm",
  small: "text-xs",
  caption: "text-[10px]",
} as const

export const SHADOWS = {
  soft: "0 4px 20px rgba(0, 0, 0, 0.3)",
  card: "0 2px 12px rgba(0, 0, 0, 0.2)",
  button: "0 4px 16px rgba(139, 92, 246, 0.3)",
} as const

export const BORDER_RADIUS = {
  sm: "8px",
  md: "12px",
  lg: "16px",
  xl: "24px",
} as const