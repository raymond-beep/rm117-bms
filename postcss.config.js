// Enables Tailwind (utilities only) + autoprefixer for the Drawing QA feature.
// The BMS's existing styles.css has no @tailwind directives, so Tailwind leaves
// it untouched; autoprefixer just adds vendor prefixes (harmless).
export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
