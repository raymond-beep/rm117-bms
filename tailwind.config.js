/** @type {import('tailwindcss').Config} */
// Tailwind is used ONLY by the Drawing QA feature (the review engine ported from
// the standalone Checksets app, which is built with Tailwind utility classes).
// The rest of the BMS uses semantic CSS in src/styles.css. We emit only
// `@tailwind utilities` (see src/components/drawing-qa/tailwind.css) — never
// `@tailwind base` — so Tailwind's preflight/reset never touches the BMS's own
// styles. `content` is scoped to the feature so only the utilities it uses ship.
export default {
  content: ['./src/components/drawing-qa/**/*.{js,jsx}'],
  corePlugins: { preflight: false },
  theme: { extend: {} },
  plugins: [],
};
