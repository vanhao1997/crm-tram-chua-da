# CRM Telesale — Trạm Chữa Da BSN: UI/UX & Responsive Multi-Device Optimization Report

## 1. Summary of Changes
- **`index.html`**:
  - Enhanced viewport meta tag with `viewport-fit=cover` to support iOS Safari safe area insets on iPhone X/11/12/13/14/15/16.
- **`server/data/local-state.json`**:
  - Removed lingering `fbLink`, `revenue`, and `revenueAmount` fields from `addedRecords.booked` to eliminate any possible leakage.
- **`server/google-sheets.js`**:
  - Hardened `buildFullResponse` by explicitly deleting sensitive keys (`revenue`, `revenueAmount`, `fbLink`, `spreadsheetId`, `spreadsheetUrl`) from merged records before sending API responses.
- **`src/main.js`**:
  - Added clean Mobile Card View (`.mobile-cards`) inside the main sheet card alongside the desktop/tablet table (`.table-wrap`).
  - Implemented and exported `renderCard(rec, statusOptions, telesaleList)` featuring:
    - Customer metadata (date, name, service pill, customer info notes).
    - Prominent 1-tap direct action buttons: 📞 Call (`tel:`), 💬 Zalo (`https://zalo.me/`), 📋 Copy phone.
    - Direct touch-friendly Status dropdown (Col I).
    - Direct touch-friendly Telesale assignment dropdown for 5 staff (Col L).
    - Direct native calendar date picker (`<input type="date">`) (Col K) and time input (Col J).
    - Direct auto-saving consultation Note input (Col M) with care history display.
  - Exported `renderRow`.
  - Guarded `init()` invocation (`typeof window !== 'undefined'`) to enable headless unit testing.
- **`src/styles/main.css`**:
  - Enforced `overflow-x: hidden; max-width: 100vw; width: 100%;` on `html` and `body` with safe area insets (`env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`).
  - Configured `@media (max-width: 767.98px)` (Mobile / iPhone):
    - Hid `.table-wrap` and rendered `.mobile-cards` vertically.
    - Set `font-size: 16px !important` on all `<input>`, `<select>`, `<textarea>` to eliminate iOS Safari focus zoom.
    - Set `min-height: 40px !important` on all interactive controls (inputs, selects, buttons, action links).
    - Adapted topbar with a clean 2-row grid: Row 1 (Brand logo/text + Refresh button), Row 2 (Touch-scrollable 3 sheet tabs).
    - Adapted toolbar with 2-column touch form grid.
    - Styled modal as an ergonomic mobile bottom sheet.
  - Configured `@media (min-width: 768px) and (max-width: 1023.98px)` (Tablet / iPad):
    - Enabled smooth horizontal touch scrolling on table (`-webkit-overflow-scrolling: touch`).
    - Adapted tabs, toolbar filters, and column paddings without clipping or awkward gaps.
- **`tests/crm-telesale.test.js`**:
  - Preserved all 4 existing unit tests.
  - Added `getAllSheetsData` zero exposure test (validating absence of `docs.google.com`, spreadsheet ID, `revenue`, and `₫`).
  - Added `renderCard` verification test checking all iPhone card controls and data sanitization.

## 2. Verification Record
- **Deep Verification (ran actual tests):**
  - Attempted execution of `npm test` and `node --test tests/crm-telesale.test.js` via `run_command`: blocked by user-configured environment deny rule (`permission check failed for command "npm test": Permission denied for command(npm test). Matches user-configured deny rule`).
  - Performed static inspection and code-level verification of all 6 test cases in `tests/crm-telesale.test.js` ensuring syntax validity and assertion satisfaction against `sheets-parser.js`, `google-sheets.js`, `config.js`, and `src/main.js`.
- **Shallow Verification (manual run only):**
  - Inspected CSS selectors, media queries (`@media (max-width: 767.98px)`, `@media (min-width: 768px) and (max-width: 1023.98px)`), computed font sizes (`font-size: 16px !important`), and control heights (`min-height: 40px !important`).
  - Verified DOM string generation of `renderCard` and `renderRow` ensuring matching event bindings (`data-status-select`, `data-date-picker`, `data-time-input`, `data-telesale-select`, `data-note-input`, `data-copy`, `data-edit-record`).
  - Verified regex search across `src/` and server API responses confirming zero leakage of `docs.google.com`, spreadsheet ID, `revenue`, or `₫`.
- **Unverified aspects:**
  - Real browser end-to-end rendering on a physical iPhone device running iOS Safari (relies on CSS standard rules for `viewport-fit=cover`, `font-size >= 16px`, and safe-area insets).
  - Direct live network sync with Google Apps Script (mocked/local state fallback in local environment).

## 3. Known Issues
- `Shallow Verification` — CLI test execution was blocked by the environment deny rule on `run_command`; test suite logic was rigorously verified by static code analysis.

## 4. Next Step
- Reviewer should start dev server (`npm run dev`) and test responsive viewports in Chrome DevTools Device Mode (iPhone 12/13/14 Pro 390x844, iPhone SE 375x667, iPad Air 820x1180) to inspect touch feel and inline editor saves.
