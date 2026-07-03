# CHECKS.md — Room 117 Drawing Set QA/QC Checklist

## How this file is used
This is the authoritative checklist. The analyze API parses this file into checklist items
and asks the vision model to evaluate each sheet against them. Each item has:

- a **stable id** — do NOT renumber or reuse existing ids; results are keyed to them. Add
  new items with new ids at the end of their group.
- a **label** — short human-readable name shown in the sidebar.
- **criteria** — what "pass" means, stated concretely enough for a vision model to judge.
- **applies_to** (optional) — which sheet types the item is relevant to, so the model
  doesn't flag a structural item on an elevation sheet.

The model returns one result per item with status `pass`, `fail`, or `needs_review`, plus a
short note.

> **STATUS: LIVE — populated from Tom's checklist** (`Tom-checklist.pdf`, transcribed
> 2026-07-02). Groups mirror the PDF's sections. Mapping notes:
>
> - Tom's "Run through checklist for EXISTING PLANS/ELEVATIONS" rows are implemented via
>   `applies_to` — Design-phase plan items (EXP) apply to both existing and proposed plans,
>   and elevation items (ELV) to both existing and proposed elevations — rather than as
>   duplicate items.
> - Rows duplicated in the source table ("Roof pitches" ×2 in Proposed Elevations and in
>   Building Sections; "Labels for all existing framing members w/ V.I.F." ×2 in Framing
>   Plans) are transcribed once.
> - CAD-layer requirements (e.g. "on appropriate layers", layer `117_GRID`) cannot be read
>   from a flattened PDF; those criteria are judged by the visible result (consistent
>   lineweights / linetypes / symbol styles). When in doubt the model should return
>   `needs_review`, not `pass`.

**Sheet types** used in `applies_to`: `site`, `existing_plan`, `proposed_plan`,
`existing_elevation`, `proposed_elevation`, `section`, `electrical`, `framing`.
Groups marked *(Design phase)* apply to design-phase sets; *(CD phase)* groups apply to
construction-documents sets (which are ALSO checked against the design-phase items for the
same sheet types).

---

## SITE — Site plans *(Design phase)*

### SITE-01 — Existing & proposed structures
- **Criteria:** Both existing and proposed structures are shown and visually distinguishable
  (different lineweights / linetypes / hatching for existing vs. proposed).
- **Applies to:** site

### SITE-02 — Existing & proposed sitework
- **Criteria:** Sitework (drives, walks, decks, patios, etc.) is shown, existing vs. proposed
  visually distinguishable.
- **Applies to:** site

### SITE-03 — Metes and bounds
- **Criteria:** Property lines carry metes-and-bounds callouts (bearing + distance on each leg).
- **Applies to:** site

### SITE-04 — Setbacks
- **Criteria:** Required setback lines are drawn and dimensioned from the property lines.
- **Applies to:** site

### SITE-05 — Street name
- **Criteria:** The adjacent street(s) are drawn and labeled with the street name.
- **Applies to:** site

### SITE-06 — Zoning analysis
- **Criteria:** A zoning analysis table is present (required vs. existing/proposed values).
- **Applies to:** site

### SITE-07 — Drawing title w/ number & scale
- **Criteria:** Drawing title block present with an accurate drawing number and stated scale.
- **Applies to:** site

### SITE-08 — North arrow
- **Criteria:** A north arrow is present on the plan.
- **Applies to:** site

### SITE-09 — Scale
- **Criteria:** The drawing scale is stated (graphic or text) and consistent with the title.
- **Applies to:** site

---

## EXP — Floor plans, existing & proposed *(Design phase)*

> Per Tom's checklist, proposed plans "run through the checklist for EXISTING PLANS" — so
> every EXP item applies to both `existing_plan` and `proposed_plan` sheets.

### EXP-01 — Room labels in all spaces
- **Criteria:** Every room/space carries a room name label; no unlabeled enclosed spaces.
- **Applies to:** existing_plan, proposed_plan

### EXP-02 — Ceiling height labels
- **Criteria:** Ceiling height labels are present for the spaces shown.
- **Applies to:** existing_plan, proposed_plan

### EXP-03 — Stair label w/ number of risers
- **Criteria:** Each stair is labeled and includes the number of risers.
- **Applies to:** existing_plan, proposed_plan

### EXP-04 — Door thresholds
- **Criteria:** Door thresholds are shown at bathrooms and exterior doors.
- **Applies to:** existing_plan, proposed_plan

### EXP-05 — Line of above elements
- **Criteria:** Elements above are shown dashed/screened (ceiling lines, upper-floor
  overhangs, roof overhangs, etc.) where they occur.
- **Applies to:** existing_plan, proposed_plan

### EXP-06 — Wall hatches
- **Criteria:** Walls carry the appropriate hatch/poché.
- **Applies to:** existing_plan, proposed_plan

### EXP-07 — Basement structure w/ labeling
- **Criteria:** On the basement plan, structure (beams, posts, bearing elements) is shown
  and labeled.
- **Applies to:** existing_plan, proposed_plan

### EXP-08 — Crawl spaces & decks/porches above on basement plan
- **Criteria:** Basement plan shows crawl spaces and the outline of decks and/or porches
  above.
- **Applies to:** existing_plan, proposed_plan

### EXP-09 — Roof plan
- **Criteria:** A roof plan is included (drawn during design phase) showing gutters, accurate
  overhangs, and the line of the floor below.
- **Applies to:** existing_plan, proposed_plan

### EXP-10 — Drawing title w/ number & scale
- **Criteria:** Drawing title present with an accurate drawing number and stated scale.
- **Applies to:** existing_plan, proposed_plan

### EXP-11 — North arrow
- **Criteria:** A north arrow is present on the plan.
- **Applies to:** existing_plan, proposed_plan

### EXP-12 — Scale
- **Criteria:** The drawing scale is stated and consistent with the title.
- **Applies to:** existing_plan, proposed_plan

### EXP-13 — Wall legend with appropriate types
- **Criteria:** A wall legend is present and the wall types shown on plan match it.
- **Applies to:** existing_plan, proposed_plan

### EXP-14 — All items on accurate layers
- **Criteria:** Plan elements (walls, doors, windows, stairs, above-lines, roof, etc.) read
  with consistent, correct line styles for their category. (True layer assignment is not
  visible in a flattened PDF — judge the visible result; use `needs_review` if uncertain.)
- **Applies to:** existing_plan, proposed_plan

---

## ELV — Elevations, existing & proposed *(Design phase)*

> Per Tom's checklist, proposed elevations "run through the checklist for EXISTING
> ELEVATIONS" — so every ELV item applies to both elevation sheet types.

### ELV-01 — Elevation markers
- **Criteria:** Elevation markers are present and consistent block-style symbols. (They
  belong on layer `117_GRID`, which can't be verified from a flattened PDF — judge presence
  and consistency.)
- **Applies to:** existing_elevation, proposed_elevation

### ELV-02 — Bold grade line beyond structure
- **Criteria:** A bold grade line is drawn and extends beyond the walls of the structure on
  both sides.
- **Applies to:** existing_elevation, proposed_elevation

### ELV-03 — Building material hatches
- **Criteria:** Building materials carry hatches (siding, concrete, shingles, etc.).
- **Applies to:** existing_elevation, proposed_elevation

### ELV-04 — Line of foundations beyond (labeled)
- **Criteria:** Foundations beyond are shown (dashed below grade) and labeled.
- **Applies to:** existing_elevation, proposed_elevation

### ELV-05 — Approx. grade label
- **Criteria:** The grade line is labeled "Approx. Grade" (or equivalent).
- **Applies to:** existing_elevation, proposed_elevation

### ELV-06 — Shadow/shading for deep overhangs
- **Criteria:** Deep recesses/overhangs (porch openings, empty space, etc.) carry
  shadow/shading. Not required on every element — judge whether the major deep conditions
  are shaded.
- **Applies to:** existing_elevation, proposed_elevation

### ELV-07 — Drawing title w/ number & scale
- **Criteria:** Drawing title present with an accurate drawing number and stated scale.
- **Applies to:** existing_elevation, proposed_elevation

### ELV-08 — Scale
- **Criteria:** The drawing scale is stated and consistent with the title.
- **Applies to:** existing_elevation, proposed_elevation

### ELV-09 — All items on accurate layers
- **Criteria:** Elevation elements (ELEV 1–4, ELEV WIN, etc.) read with consistent, correct
  line styles for their category. (Judge the visible result; `needs_review` if uncertain.)
- **Applies to:** existing_elevation, proposed_elevation

---

## PRE — Proposed elevations, additional *(Design phase)*

### PRE-01 — Dimension & label new additions
- **Criteria:** New additions are dimensioned and labeled on the proposed elevations.
- **Applies to:** proposed_elevation

---

## CDP — Proposed plans *(CD phase)*

> Per Tom's checklist, CD proposed plans also run through the Design-phase plan checklist —
> the EXP items above already apply to `proposed_plan` sheets.

### CDP-01 — Window tags
- **Criteria:** All windows carry window tags on plan.
- **Applies to:** proposed_plan

### CDP-02 — Window schedule
- **Criteria:** A window schedule is present and plan tags match schedule entries.
- **Applies to:** proposed_plan

### CDP-03 — Window notes table
- **Criteria:** A window notes table is present.
- **Applies to:** proposed_plan

### CDP-04 — Door sizes labeled
- **Criteria:** Door sizes are labeled on the doors on plan.
- **Applies to:** proposed_plan

### CDP-05 — Door schedule (exterior & garage)
- **Criteria:** A door schedule is present covering exterior doors and garage doors.
  Interior doors are NOT required in the schedule.
- **Applies to:** proposed_plan

### CDP-06 — Door notes table
- **Criteria:** A door notes table is present.
- **Applies to:** proposed_plan

### CDP-07 — Construction notes tags
- **Criteria:** Construction-note tags are placed on plan referencing the notes table.
- **Applies to:** proposed_plan

### CDP-08 — Construction notes table
- **Criteria:** A construction notes table is present; items not in the project are crossed
  out (not deleted).
- **Applies to:** proposed_plan

### CDP-09 — Dimension strings
- **Criteria:** Dimension strings are present, including overall dimensions of new additions
  with labels.
- **Applies to:** proposed_plan

### CDP-10 — Section indicators
- **Criteria:** Section cut indicators are placed on plan and reference section sheets.
- **Applies to:** proposed_plan

### CDP-11 — Elevation indicators
- **Criteria:** Elevation indicators are placed on plan and reference elevation sheets.
- **Applies to:** proposed_plan

### CDP-12 — Drawing title w/ number & scale
- **Criteria:** Drawing title present with an accurate drawing number and stated scale.
- **Applies to:** proposed_plan

### CDP-13 — North arrow
- **Criteria:** A north arrow is present on the plan.
- **Applies to:** proposed_plan

### CDP-14 — Scale
- **Criteria:** The drawing scale is stated and consistent with the title.
- **Applies to:** proposed_plan

### CDP-15 — General notes table referencing other pages
- **Criteria:** A general notes table is present referring to the other pages (construction
  notes, door schedule, window schedule, etc.).
- **Applies to:** proposed_plan

---

## CDE — Proposed elevations *(CD phase)*

> CD proposed elevations also run through the Design-phase elevation checklist — the ELV and
> PRE items above already apply to `proposed_elevation` sheets.

### CDE-01 — Window tags
- **Criteria:** All windows carry window tags on the elevations.
- **Applies to:** proposed_elevation

### CDE-02 — Construction notes tags
- **Criteria:** Construction-note tags are placed on the elevations.
- **Applies to:** proposed_elevation

### CDE-03 — Roof overhang dimensions
- **Criteria:** Roof overhangs are dimensioned.
- **Applies to:** proposed_elevation

### CDE-04 — Roof pitches
- **Criteria:** Roof pitches are labeled (pitch symbols/values on each roof plane shown).
- **Applies to:** proposed_elevation

### CDE-05 — Floor-to-deck/porch dimension
- **Criteria:** Where a deck/porch occurs, the dimension from floor elevation to deck/porch
  is given. Pass as N/A note if no deck/porch in project.
- **Applies to:** proposed_elevation

### CDE-06 — Drawing title w/ number & scale
- **Criteria:** Drawing title present with an accurate drawing number and stated scale.
- **Applies to:** proposed_elevation

### CDE-07 — Scale
- **Criteria:** The drawing scale is stated and consistent with the title.
- **Applies to:** proposed_elevation

### CDE-08 — General notes table referencing other pages
- **Criteria:** A general notes table is present referring to the other pages (construction
  notes, door schedule, window schedule, etc.).
- **Applies to:** proposed_elevation

---

## SEC — Building sections *(CD phase)*

### SEC-01 — Window tags
- **Criteria:** Windows cut/shown in section carry window tags.
- **Applies to:** section

### SEC-02 — Construction notes tags
- **Criteria:** Construction-note tags are placed on the sections.
- **Applies to:** section

### SEC-03 — Roof overhang dimensions
- **Criteria:** Roof overhangs are dimensioned.
- **Applies to:** section

### SEC-04 — Roof pitches
- **Criteria:** Roof pitches are labeled on the sections.
- **Applies to:** section

### SEC-05 — Floor-to-deck/porch dimension
- **Criteria:** Where a deck/porch occurs, the dimension from floor elevation to deck/porch
  is given. Pass as N/A note if no deck/porch in project.
- **Applies to:** section

### SEC-06 — Label all new structural members
- **Criteria:** Every new structural member shown is labeled with size/type.
- **Applies to:** section

### SEC-07 — Tag all new beams
- **Criteria:** All new beams are tagged.
- **Applies to:** section

### SEC-08 — Insulation table
- **Criteria:** An insulation table is present.
- **Applies to:** section

### SEC-09 — Insulation values labeled
- **Criteria:** Insulation R-values are labeled in the section assemblies.
- **Applies to:** section

### SEC-10 — Drawing title w/ number & scale
- **Criteria:** Drawing title present with an accurate drawing number and stated scale.
- **Applies to:** section

### SEC-11 — Scale
- **Criteria:** The drawing scale is stated and consistent with the title.
- **Applies to:** section

### SEC-12 — General notes table referencing other pages
- **Criteria:** A general notes table is present referring to the other pages (construction
  notes, door schedule, window schedule, etc.).
- **Applies to:** section

---

## ELE — Electric/lighting plans *(CD phase)*

### ELE-01 — Elec/lighting legend
- **Criteria:** An electrical/lighting symbol legend is present.
- **Applies to:** electrical

### ELE-02 — Outlets in appropriate locations
- **Criteria:** Outlets are shown in appropriate locations throughout the plan (code-typical
  spacing along walls; no obviously outlet-less habitable rooms).
- **Applies to:** electrical

### ELE-03 — GFI outlets in kitchens & bathrooms
- **Criteria:** GFI outlets are shown in kitchens and bathrooms with appropriate mounting
  heights noted.
- **Applies to:** electrical

### ELE-04 — GFI at new exterior doors, garages, basements
- **Criteria:** GFI outlets are shown at all new exterior doors, new garages, and new
  basements.
- **Applies to:** electrical

### ELE-05 — Crawl space electrical
- **Criteria:** Crawl spaces show a GFI outlet, a switch, and utility light(s).
- **Applies to:** electrical

### ELE-06 — Smoke detectors
- **Criteria:** Smoke detectors shown: (1) per level and (1) per basement.
- **Applies to:** electrical

### ELE-07 — Carbon monoxide detectors
- **Criteria:** CO detector shown: (1) on each level that has a bedroom.
- **Applies to:** electrical

### ELE-08 — Lighting in each room
- **Criteria:** Every room shows a lighting fixture (recessed, pendant, sconce, surface,
  etc.).
- **Applies to:** electrical

### ELE-09 — Dedicated appliance outlets
- **Criteria:** Dedicated outlets are shown for kitchen appliances and washer/dryer.
- **Applies to:** electrical

### ELE-10 — Exterior lighting
- **Criteria:** Exterior lighting is shown at portico, deck, porch, stoop, etc. as applicable.
- **Applies to:** electrical

### ELE-11 — Drawing title w/ number & scale
- **Criteria:** Drawing title present with an accurate drawing number and stated scale.
- **Applies to:** electrical

### ELE-12 — North arrow
- **Criteria:** A north arrow is present on the plan.
- **Applies to:** electrical

### ELE-13 — Scale
- **Criteria:** The drawing scale is stated and consistent with the title.
- **Applies to:** electrical

---

## FRM — Framing plans *(CD phase)*

### FRM-01 — Existing framing member labels w/ V.I.F.
- **Criteria:** All existing framing members are labeled and carry a V.I.F. note.
- **Applies to:** framing

### FRM-02 — New framing member labels
- **Criteria:** All new framing members are labeled, in bold font with a thick arrow (per
  the firm's example projects).
- **Applies to:** framing

### FRM-03 — New structural posts labeled
- **Criteria:** All new structural posts are shown with appropriate up/dn labeling.
  (Correct layer can't be verified from a flattened PDF — judge visible labeling.)
- **Applies to:** framing

### FRM-04 — Structural notes on this page
- **Criteria:** Structural notes are present ON the framing sheet (they may also repeat on
  section sheets, but must appear here).
- **Applies to:** framing

### FRM-05 — Section indicators
- **Criteria:** Section cut indicators are placed and reference section sheets.
- **Applies to:** framing

### FRM-06 — Elevation indicators
- **Criteria:** Elevation indicators are placed and reference elevation sheets.
- **Applies to:** framing

### FRM-07 — Drawing title w/ number & scale
- **Criteria:** Drawing title present with an accurate drawing number and stated scale.
- **Applies to:** framing

### FRM-08 — North arrow
- **Criteria:** A north arrow is present on the plan.
- **Applies to:** framing

### FRM-09 — Scale
- **Criteria:** The drawing scale is stated and consistent with the title.
- **Applies to:** framing

---

<!--
To add an item, copy this block, give it a new stable id within the right group, and fill in:

### GRP-NN — Short label
- **Criteria:** Concrete description of what a passing sheet shows.
- **Applies to:** sheet_type(s)
-->
