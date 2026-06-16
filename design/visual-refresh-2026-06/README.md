# Handoff: RM117 BMS — Visual Refresh (Desktop + Mobile)

## Overview
RM117 is the internal business-management system for **Room 117 Architecture & Design** (a NJ residential architecture firm). This handoff covers a **visual refresh** of the existing app plus a **companion mobile app**. It defines the look for:

- **Desktop · Dashboard** — home base: stat strip, calendar, priority inbox
- **Desktop · BMS (Job log)** — the spine of the app: jobs grouped by phase, plus the Job Editor drawer (Details + Payments tabs)
- **Desktop · Client Portal** (future / Phase 7) — a simpler client-facing surface
- **Mobile · Field use** — Home, Jobs, Job detail, Log-payment sheet
- **Mobile · Full parity** — Dashboard + Client Portal adapted to a phone

The chosen direction is **"Architectural"**: warm paper backgrounds, a structural title-block treatment for numbers, JetBrains Mono for all data/IDs/money, and restrained brass accents — rendered in the **system UI font** for all prose and headings.

## About the Design Files
The file in this bundle (`RM117 Mockup.dc.html`) is a **design reference created in HTML** — a prototype showing the intended look and layout, **not production code to copy directly**. It is built on an internal component runtime (`support.js`), so it is a visual spec, not a drop-in.

**The task is to recreate these designs in the RM117 codebase's existing environment** (React + your existing component patterns and data layer / Supabase API), following its established conventions. Read the HTML for exact structure, spacing, and color, but implement using your own components, routing, and state.

## Fidelity
**High-fidelity.** Colors, typography, spacing, and component treatments are final. Recreate the UI faithfully using your existing libraries. The sample data (job names, addresses, amounts) is realistic placeholder content — replace it with live Supabase data.

---

## Design Tokens

### Color
| Token | Hex | Use |
|---|---|---|
| `--ink` | `#1c1f23` | Primary text |
| `--ink-2` | `#5c6066` | Secondary text (cool) |
| `--paper-ink-2` | `#7a766c` | Secondary text on warm paper |
| `--muted` | `#9a968c` | Labels, meta, placeholders |
| `--app-bg` | `#f6f5f1` | App content background (warm paper) |
| `--surface` | `#ffffff` | Cards, inputs, drawer |
| `--border` | `#e6e3db` | Card/input borders, dividers (`#f3f1ea` for inner row dividers) |
| `--sidebar` | `#14202e` | Dark sidebar + mobile headers/notch |
| `--primary` | `#1f3a5f` | Primary actions, active nav, links, progress fill |
| `--brass` | `#c8a45c` | Accent: active-nav left border, calendar ticks, avatars, current timeline node |
| `--warn` | `#b06c0f` | Outstanding $ amounts |
| `--success` | `#1d7a4f` | "Active"/on-track; bg `#e5f0e9` |
| `--bill` | `#b3362b` | BILL flag; bg `#fce6e2` |
| `--ff` | `#8a6a25` | FF (Forefront) flag; bg `#f4ead2` |

**Phase header bars** (BMS groups), white text:
`Active #234d36` · `CD Phase #21364a` · `Design Phase #1f3a5f` · `Survey/Zoning #3a2f5e` · `Potential #3a3d42` · `On Hold #6b4a17`

### Typography
- **UI font (everything):** `-apple-system, system-ui, 'Segoe UI', Roboto, sans-serif`
- **Data font:** `'JetBrains Mono', monospace` — used for **all** job IDs, money, dates, stat values, and uppercase micro-labels. This mono/sans split is the core of the "architectural" feel; keep it consistent.
- Page H1: 25–38px / weight 800 / letter-spacing −0.5 to −1px
- Section H1 (in-app): 21–24px / 800
- Card title (h3): 14–14.5px / 700
- Body: 13–13.5px / 400
- Meta: 11–12px / 400, muted
- Micro-label (mono, uppercase): 9–10px / letter-spacing 1–1.5px / `--muted`
- Stat value (mono): 20–27px / weight 600 / letter-spacing −1px

### Spacing / Radius / Shadow
- Card padding: 14–22px; gaps between cards: 14–22px
- Radius: cards/panels **9–12px**, inputs/buttons **7–8px**, pills **999px**
- Card border: `1px solid #e6e3db`
- Drawer/panel shadow: `0 24px 50px -24px rgba(20,32,46,.3)`
- Phone screen radius **42px**, device body radius **54px** (13px bezel)

### Status pills / flags (mono, uppercase, ~10px)
- `ACTIVE` / on-track → text `#1d7a4f` on `#e5f0e9`
- `BILL` → text `#b3362b` on `#fce6e2`
- `FF` → text `#8a6a25` on `#f4ead2`
- `SUPABASE LIVE` → green pill, same as ACTIVE

---

## Screens / Views

### 1. Desktop · Dashboard
- **Purpose:** Daily home base for the admin (Angelena).
- **Layout:** Fixed dark sidebar **224px** + fluid main on `#f6f5f1`, padding 28–32px.
  - **Sidebar:** logo block (RM117 + mono subtitle) → grouped nav with mono section captions ("WORKSPACE", "UPCOMING") → active item has `rgba(200,164,92,.12)` bg + **3px brass left border** → user chip (brass rounded-square avatar) pinned to bottom.
  - **Header row:** mono eyebrow ("HOME BASE") + greeting H1 on the left; right-aligned mono date + green "● Supabase live".
  - **Stat strip:** 4 columns in a single rounded container, separated by 1px gridlines (`gap:1px` over a `#e6e3db` bg). Each cell = mono uppercase label, big mono value, sub-hint. Stats: Active pipeline (`13 jobs` / $439,300 contracted), Outstanding (`$229,550`), Ready to bill (`2`), Forefront (`4 active` / $11,600 unpaid).
  - **Two-column body (1.4fr / 1fr):** Calendar card + Priority Inbox card.
- **Calendar rows:** left date/time block (mono) with a **2px left tick** — brass `#c8a45c` for RM117/company events, neutral `#d9d5cb` otherwise — then title + location (truncated), optional "RM117" brass label.
- **Priority Inbox:** sender + mono job-ID/client chip, subject, snippet. **Non-client emails (newsletters, vendor quotes) render at 0.5 opacity** — the "Clients only" lens is the point.

### 2. Desktop · BMS — Job log  *(the spine)*
- **Purpose:** Browse/manage every job. **Always grouped by phase section — never a flat list.** A job moves sections when its phase changes.
- **Toolbar:** search field (grows) · "Pipeline ▾" view filter · Grouped/Table segmented toggle (Grouped active = `#1f3a5f`) · "+ New Job" primary button.
- **Phase group:** colored header bar (see phase colors) with mono uppercase label + count pill (`rgba(255,255,255,.12)` bg, brass text); white body with job rows.
- **Job row:** left = client name with inline `FF`/`BILL` flags (name truncates on one line, flags `flex:none`), mono job ID, address, optional italic brass correspondence note. Right = mono job total, and mono outstanding in `#b06c0f` (`white-space:nowrap`).
- Groups shown: Active(2), CD Phase(3), Design Phase(3), Survey/Zoning(2), Potential(3), On Hold(1).

### 3. Desktop · Job Editor drawer
- **Purpose:** Edit a job; log/review payments. Slides in from the right (~452–464px) over a `rgba(20,32,46,.3)` scrim.
- **Header:** mono job ID + "$X outstanding · created …". **Tabs:** Details | Payments (active = `#1f3a5f` text + 2px underline).
- **Details tab:** labeled fields (mono uppercase labels) — Client name, Address, Phase (select), Job total (mono) — plus two checkbox rows: **Ready to bill** (checked = filled `#1f3a5f` box) and **Forefront job (carries a commission)**; Last correspondence; Notes textarea.
- **Payments tab:** list of payments (mono amount + `TYPE · method` + date), a **Paid / left** summary row (left amount in `#b06c0f`), then a "Log a payment" form (Amount, Date, Type select, Method select) and a primary "Log payment" button. **Outstanding recomputes from payments automatically.**
- Footer: Cancel (outline) + Save (primary).

### 4. Desktop · Client Portal  *(Phase 7, client-facing)*
- **Purpose:** A separate, simpler surface. The client logs in with the email on file and sees **only their own jobs** — status, documents, messages. **No money, no staff tools.**
- **Top bar:** full-width `#14202e` — RM117 logo, "CLIENT PORTAL" mono tag, client name + brass avatar + "SIGN OUT".
- **Job switcher:** 3 project cards; selected card has `1.5px #1f3a5f` border + a status dot.
- **Project overview:** title + lead + last-update; **phase timeline** = 6 nodes on a track; completed nodes filled `#1f3a5f` with check, **current node brass with a `3px #f0e2c7` ring**, future node hollow. "ON TRACK" green pill.
- **Two columns (1.05fr / 1fr):** **Documents vault** (two sections — "Files sent — download" with PDF chips + down-arrow, and "Files received — your uploads" + a dashed drop zone) and **Messages** thread (firm bubbles left `#f1f4f8`, client bubbles right `#1f3a5f` white text; composer pinned at bottom).

### 5. Mobile (390-class device, 358px screen)
Shared chrome: dynamic-island notch, status bar, bottom tab bar (Home · Jobs · Forefront · Inbox; portal uses Projects · Files · Messages). Active tab `#1f3a5f`.
- **Home (field):** greeting + brass avatar; search; **2 mini stat tiles** (Pipeline 13, Outstanding $229.5k in `#b06c0f`); "Today" list (brass/neutral time ticks); "Needs a reply" card.
- **Jobs (field):** title + "+" button; search; filter chips (Pipeline/Forefront/Bill); **same phase-grouped cards** as desktop, compacted (name truncates, mono `ID · town`, mono totals).
- **Job detail (field):** back/title/Edit; status + BILL + type pills; client H1; **address card with a faux map tile + call & directions buttons** (44px hit targets); **billing card** with progress bar + big mono outstanding; full-width "Log a payment" primary; last correspondence.
- **Log payment (field):** dimmed backdrop + **bottom sheet** with grabber; big centered mono amount ($6,500.00, prefilled to clear balance); **Type** chip group (Retainer/DP2/Final) and **Method** chip group (Check/Zelle/Venmo/QB), selected = `#1f3a5f`; Date row; full-width "Log $6,500 payment" button.
- **Dashboard (parity):** Dashboard ported — 2×2 title-block stats, compact calendar, 2-item inbox.
- **Client Portal (parity):** dark header bleeds to the notch; selected project card with compact 6-node timeline; "Latest files" list; portal tab bar.

---

## Interactions & Behavior
- **Nav:** sidebar items route to Dashboard / BMS / Forefront (Templates P5, Client Portal P7 disabled-styled until shipped).
- **Job row click → Job Editor drawer** slides in from right over a scrim; Esc / Cancel / scrim closes.
- **Editor tabs** switch Details ↔ Payments without leaving the drawer.
- **Logging a payment** appends to the list and **recomputes outstanding** (`total − sum(payments)`); the BILL/outstanding indicators update live.
- **Phase change** in the editor **moves the job to the matching group** in the BMS list.
- **Inbox "Clients only"** is a toggle; non-client mail dims (0.5) or hides.
- **Portal messaging** is a two-way thread per job; document vault supports firm→client downloads and client→firm uploads (drop zone).
- **Mobile:** tab bar navigation; address card → native call (`tel:`) and maps directions; payment sheet is a modal bottom sheet.

## State Management
- `jobs` (id, client, address, phase, total, payments[], is_forefront, ready_to_bill, type, last_correspondence, notes) — from Supabase.
- Derived: `outstanding = total − sum(payments)`, `pipelineTotal`, `outstandingTotal`, `forefrontUnpaid`, per-phase groupings/counts.
- UI: `activeNav`, `selectedJobId` + `drawerOpen`, `editorTab` (details|payments), `inboxClientsOnly`, mobile `activeTab`, `paymentSheetOpen` + draft (amount/type/method/date).
- `calendar` events (day, time, title, location, is_company) and `inbox` messages (from, subject, snippet, job/client link, is_client).

## Assets
No raster assets. The notch/map/charts/icons are CSS — replace icons with your existing icon set (the glyphs `☲ ▢ ◈ ✉` are placeholders for nav). Brand colors above are the Room 117 palette; reuse your codebase's brand tokens if they already exist.

## Files
- `RM117 Mockup.dc.html` — the full reference: all desktop frames + 6 phones, with the sample data in its logic block. Sections are labeled 01–05 in source.
- `support.js` — internal runtime so the HTML renders for reference; **not** part of the app to build.
- `screenshots/` — rendered reference images of each screen:
  - `1-desktop-dashboard.png`
  - `2-desktop-bms-job-log.png`
  - `3-desktop-job-editor.png` (Details + Payments tabs)
  - `4-desktop-client-portal.png`
  - `5-mobile-field-home-jobs.png`
  - `6-mobile-field-detail-payment.png`
  - `7-mobile-parity-dashboard-portal.png`
