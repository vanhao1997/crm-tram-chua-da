/**
 * Read-only record detail behavior.
 *
 * The original module exposed add/update actions through
 * sheets-write.js. The V2 dashboard intentionally keeps those controls out
 * of the browser and provides inspection/copy actions instead.
 */

export function initLeadManager({ getData } = {}) {
    window.__getBsnData = getData || (() => null);
}
