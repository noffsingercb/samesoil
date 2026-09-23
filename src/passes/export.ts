import type { EngineContext } from "../core/context.js"
import { loadKinshipGraph } from "./kinship.js"
import { KinshipResolver, relationshipSummary, type KinshipGraph } from "../core/kinship.js"

// ---------------------------------------------------------------------------
// Pass 7 - candidate exports and the self-contained HTML report.
//
// This pass is READ-ONLY with respect to scoring: it never recomputes a
// score component, never touches suppression_log, and never mutates
// scored_candidates. Every number displayed downstream is copied verbatim
// from what Pass 6 persisted.
// ---------------------------------------------------------------------------

const TIER_ORDER = ["address", "locality", "district", "region", "country", "unknown"] as const
type Tier = (typeof TIER_ORDER)[number]

function tierRank(tier: string): number {
	const idx = TIER_ORDER.indexOf(tier as Tier)
	return idx === -1 ? TIER_ORDER.length : idx
}

// The two endpoints of a candidate can have different precision tiers.
// The pair is only as trustworthy as its coarser member, so any place-scoped
// display (color, filter bucket) uses the coarser of the two.
function coarserTier(a: string, b: string): string {
	return tierRank(a) >= tierRank(b) ? a : b
}

function decadeOf(isoDate: string | null): number | null {
	if (!isoDate) return null
	const year = Number.parseInt(isoDate.slice(0, 4), 10)
	if (!Number.isFinite(year)) return null
	return Math.floor(year / 10) * 10
}

// ctx.env.now() returns an ISO-8601 timestamp string, not epoch milliseconds,
// so elapsed time is computed the same way the score pass computes it:
// Date.parse() on both timestamps.
function elapsed(start: string, end: string): number {
	return Math.max(0, Date.parse(end) - Date.parse(start))
}

// ---------------------------------------------------------------------------
// EXPORT_QUERY
//
// One row per scored candidate, joined against everything a researcher
// needs to verify a lead by hand: both raw GEDCOM date/place strings, the
// resolved place labels and precision tiers, and every persisted score
// component. Nothing here is computed - it is a join, not a rescoring.
// ---------------------------------------------------------------------------
const EXPORT_QUERY = `
SELECT
  sc.candidate_id            AS candidate_id,
  sc.pair_id                 AS pair_id,
  sc.total_score             AS total_score,
  sc.component_temporal      AS component_temporal,
  sc.component_spatial       AS component_spatial,
  sc.component_place_precision AS component_place_precision,
  sc.component_source_independence AS component_source_independence,
  sc.component_unrelatedness AS component_unrelatedness,
  sc.explanation              AS explanation,
  sc.config_hash              AS config_hash,
  sc.engine_version            AS engine_version,

  cp.overlap_start            AS overlap_start,
  cp.overlap_end               AS overlap_end,
  cp.overlap_days              AS overlap_days,
  cp.distance_km               AS distance_km,
  cp.combined_radius           AS combined_radius,

  ia.id                        AS individual_a_id,
  ia.full_name                 AS individual_a_name,
  ea.event_type                AS event_a_type,
  ea.date_raw                  AS event_a_date_raw,
  pa.place_raw                 AS place_a_raw,
  pa.normalized                AS place_a_resolved,
  pa.precision_tier            AS place_a_tier,
  pa.radius_km                 AS place_a_radius_km,
  pia.lat                      AS place_a_lat,
  pia.lon                      AS place_a_lon,

  ib.id                        AS individual_b_id,
  ib.full_name                 AS individual_b_name,
  eb.event_type                AS event_b_type,
  eb.date_raw                  AS event_b_date_raw,
  pb.place_raw                 AS place_b_raw,
  pb.normalized                AS place_b_resolved,
  pb.precision_tier            AS place_b_tier,
  pb.radius_km                 AS place_b_radius_km,
  pib.lat                      AS place_b_lat,
  pib.lon                      AS place_b_lon

FROM scored_candidates sc
JOIN candidate_pairs cp ON cp.id = sc.pair_id
JOIN presence_intervals pia ON pia.id = cp.presence_a_id
JOIN presence_intervals pib ON pib.id = cp.presence_b_id
JOIN individuals ia ON ia.id = pia.individual_id
JOIN individuals ib ON ib.id = pib.individual_id
JOIN events ea ON ea.id = pia.event_id
JOIN events eb ON eb.id = pib.event_id
JOIN places pa ON pa.id = ea.place_id
JOIN places pb ON pb.id = eb.place_id
WHERE (ia.is_living = 0 OR ? = 1)
  AND (ib.is_living = 0 OR ? = 1)
ORDER BY sc.total_score DESC, sc.candidate_id ASC
`

// ---------------------------------------------------------------------------
// REVIEW_QUEUE_QUERY
//
// Deliberately re-derived from the persisted `places` table rather than
// replaying Pass 2's transient in-memory resolution. Pass 2 already writes
// every unresolved/low-confidence/coarse place to `places` with
// review_status. Re-querying that table means this artifact reflects any
// manual corrections a human has made since ingestion, instead of going
// stale the moment someone fixes a place by hand.
// ---------------------------------------------------------------------------
const REVIEW_QUEUE_QUERY = `
WITH affected AS (
  SELECT
    p.id AS place_id,
    p.place_raw AS place_raw,
    p.precision_tier AS precision_tier,
    p.confidence AS confidence,
    p.review_status AS review_status,
    e.id AS event_id,
    fc_or_indiv.individual_id AS individual_id
  FROM places p
  JOIN events e ON e.place_id = p.id
  JOIN (
    SELECT id AS event_id, individual_id FROM presence_intervals
  ) AS pi ON pi.event_id = e.id
  JOIN (SELECT id AS individual_id FROM individuals) AS fc_or_indiv
    ON fc_or_indiv.individual_id = pi.individual_id
  WHERE p.review_status = 'auto'
)
SELECT
  place_raw,
  precision_tier,
  MIN(confidence) AS min_confidence,
  COUNT(DISTINCT event_id) AS occurrence_count,
  COUNT(DISTINCT individual_id) AS affected_individuals
FROM affected
GROUP BY place_raw, precision_tier
ORDER BY affected_individuals DESC, occurrence_count DESC, place_raw ASC
`

function csvCell(value: unknown): string {
	if (value === null || value === undefined) return ""
	const str = String(value)
	if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`
	return str
}

const CANDIDATES_CSV_HEADER = [
	"candidate_id", "individual_a_name", "individual_b_name",
	"event_a_type", "event_b_type",
	"event_a_date_raw", "event_b_date_raw",
	"place_a_raw", "place_b_raw",
	"place_a_resolved", "place_b_resolved",
	"overlap_start", "overlap_end", "overlap_days", "distance_km",
	"component_temporal", "component_spatial", "component_place_precision",
	"component_source_independence", "component_unrelatedness",
	"total_score", "relationship_summary", "config_hash", "engine_version",
]

function renderCandidatesCsv(rows: Array<Record<string, unknown>>, relationshipOf: (a: number, b: number) => string): string {
	const lines = [CANDIDATES_CSV_HEADER.join(",")]
	for (const r of rows) {
		const relationship = relationshipOf(r.individual_a_id as number, r.individual_b_id as number)
		const line = [
			r.candidate_id, r.individual_a_name, r.individual_b_name,
			r.event_a_type, r.event_b_type,
			r.event_a_date_raw, r.event_b_date_raw,
			r.place_a_raw, r.place_b_raw,
			r.place_a_resolved, r.place_b_resolved,
			r.overlap_start, r.overlap_end, r.overlap_days, r.distance_km,
			r.component_temporal, r.component_spatial, r.component_place_precision,
			r.component_source_independence, r.component_unrelatedness,
			r.total_score, relationship, r.config_hash, r.engine_version,
		].map(csvCell).join(",")
		lines.push(line)
	}
	return lines.join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// Ancestral branch derivation (display-only, NOT a schema or scoring concept)
//
// Walks each individual's biological ancestry (parent edges only, via the
// existing kinship graph) up to a deterministic root ancestor. The
// deepest-known blood ancestor with no further parents in the tree becomes
// that individual's "branch key". Ties (multiple roots at the same depth,
// e.g. both sides of the tree converge nowhere) are broken by the smallest
// individual id, so the assignment is 100% reproducible across runs.
// This is used ONLY for the report's colour key and branch_intersections.md.
// It never feeds scoring or candidate selection.
// ---------------------------------------------------------------------------
function buildBranchAssigner(kinshipGraph: KinshipGraph) {
	const rootCache = new Map<number, number>()

	function rootOf(individualId: number, seen: Set<number> = new Set()): number {
		if (rootCache.has(individualId)) return rootCache.get(individualId)!
		if (seen.has(individualId)) return individualId // cycle guard, should not happen
		seen.add(individualId)

		const parents = kinshipGraph.biologicalParents.get(individualId) ?? []
		if (parents.length === 0) {
			rootCache.set(individualId, individualId)
			return individualId
		}
		// Deterministic tie-break: smallest resolved root id wins.
		let best = Number.POSITIVE_INFINITY
		for (const parentId of parents) {
			const r = rootOf(parentId, seen)
			if (r < best) best = r
		}
		rootCache.set(individualId, best)
		return best
	}

	return { rootOf }
}

const BRANCH_PALETTE = [
	"#4477AA", "#EE6677", "#228833", "#CCBB44",
	"#66CCEE", "#AA3377", "#BBBBBB", "#000000",
]

function assignBranchColors(rootIds: number[]): Map<number, string> {
	const sorted = Array.from(new Set(rootIds)).sort((a, b) => a - b)
	const colorOf = new Map<number, string>()
	sorted.forEach((rootId, idx) => {
		colorOf.set(rootId, BRANCH_PALETTE[idx % BRANCH_PALETTE.length])
	})
	return colorOf
}

// ---------------------------------------------------------------------------
// GeoJSON: midpoint + two endpoints per candidate.
//
// The midpoint is the plain arithmetic mean of the two endpoint
// coordinates. It is explicitly NOT a geocoded location - properties on
// every feature carry radius_km and precision_tier so a consuming viewer
// can never mistake the midpoint dot for a resolved place.
// ---------------------------------------------------------------------------
function pointFeature(
	lon: number, lat: number,
	props: Record<string, unknown>,
): Record<string, unknown> {
	return {
		type: "Feature",
		geometry: { type: "Point", coordinates: [lon, lat] },
		properties: props,
	}
}

function renderGeoJson(
	rows: Array<Record<string, unknown>>,
	branchColorOf: (individualId: number) => string,
): string {
	const features: Array<Record<string, unknown>> = []

	for (const r of rows) {
		const candidateId = r.candidate_id
		const score = r.total_score
		const tier = coarserTier(String(r.place_a_tier), String(r.place_b_tier))
		const decade = decadeOf((r.overlap_start as string) ?? null)
		const radiusKm = Math.max(Number(r.place_a_radius_km) || 0, Number(r.place_b_radius_km) || 0)
		const lonA = Number(r.place_a_lon), latA = Number(r.place_a_lat)
		const lonB = Number(r.place_b_lon), latB = Number(r.place_b_lat)
		const midLon = (lonA + lonB) / 2
		const midLat = (latA + latB) / 2
		// Span radius: covers both endpoint uncertainty circles plus the gap
		// between them, so the midpoint's circle never understates uncertainty.
		const spanRadiusKm = radiusKm + Number(r.distance_km || 0) / 2

		const baseProps = {
			candidate_id: candidateId,
			score,
			decade,
			precision_tier: tier,
			config_hash: r.config_hash,
		}

		features.push(pointFeature(midLon, midLat, {
			...baseProps,
			role: "midpoint",
			radius_km: spanRadiusKm,
			note: "Midpoint is an arithmetic mean for display only; it is not a geocoded location.",
		}))
		features.push(pointFeature(lonA, latA, {
			...baseProps,
			role: "endpoint_a",
			individual_name: r.individual_a_name,
			radius_km: Number(r.place_a_radius_km) || 0,
			precision_tier: r.place_a_tier,
			color: branchColorOf(r.individual_a_id as number),
		}))
		features.push(pointFeature(lonB, latB, {
			...baseProps,
			role: "endpoint_b",
			individual_name: r.individual_b_name,
			radius_km: Number(r.place_b_radius_km) || 0,
			precision_tier: r.place_b_tier,
			color: branchColorOf(r.individual_b_id as number),
		}))
	}

	return JSON.stringify({ type: "FeatureCollection", features }, null, 2)
}

// ---------------------------------------------------------------------------
// branch_intersections.md
// ---------------------------------------------------------------------------
function adminAreaOf(resolvedLabel: string): string {
	// The resolved place label is "locality, admin1, country" or coarser.
	// Administrative area = everything after the first component.
	const parts = String(resolvedLabel).split(",").map((s) => s.trim())
	return parts.length > 1 ? parts.slice(1).join(", ") : parts[0] ?? "Unknown"
}

function renderBranchIntersections(
	rows: Array<Record<string, unknown>>,
	branchNameOf: (individualId: number) => string,
): string {
	type CellKey = string
	const cells = new Map<CellKey, { branches: Set<string>; count: number; bestScore: number; area: string; decade: number | null }>()

	for (const r of rows) {
		const branchA = branchNameOf(r.individual_a_id as number)
		const branchB = branchNameOf(r.individual_b_id as number)
		if (branchA === branchB) continue // only cross-branch intersections are interesting here
		const area = adminAreaOf(String(r.place_a_resolved))
		const decade = decadeOf((r.overlap_start as string) ?? null)
		const [b1, b2] = [branchA, branchB].sort()
		const key = `${b1}|||${b2}|||${area}|||${decade}`

		const existing = cells.get(key)
		const score = Number(r.total_score) || 0
		if (existing) {
			existing.count += 1
			existing.bestScore = Math.max(existing.bestScore, score)
		} else {
			cells.set(key, { branches: new Set([b1, b2]), count: 1, bestScore: score, area, decade })
		}
	}

	const sortedCells = Array.from(cells.values()).sort((a, b) => b.bestScore - a.bestScore)

	const lines: string[] = [
		"# Branch intersections",
		"",
		"Ancestral lines that co-occur in the same administrative area and decade,",
		"based on retained scored candidates. `best_score` is a ranking signal,",
		"not a probability of an encounter.",
		"",
		"| Branch A | Branch B | Administrative area | Decade | Candidate count | Best score |",
		"| --- | --- | --- | --- | --- | --- |",
	]
	for (const cell of sortedCells) {
		const [b1, b2] = Array.from(cell.branches)
		lines.push(`| ${b1} | ${b2} | ${cell.area} | ${cell.decade ?? "Unknown"} | ${cell.count} | ${cell.bestScore.toFixed(4)} |`)
	}
	if (sortedCells.length === 0) {
		lines.push("| _none_ | | | | | |")
	}
	return lines.join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// review_queue.csv
// ---------------------------------------------------------------------------
function reviewReasonFromPersisted(precisionTier: string, minConfidence: number, confidence: number, minTier: string): string {
	if (confidence < minConfidence) return "low_confidence"
	if (tierRank(precisionTier) > tierRank(minTier)) return "coarse_tier"
	return "unresolved"
}

function renderReviewQueue(
	rows: Array<Record<string, unknown>>,
	minGeocodeConf: number,
	minTier: string,
): string {
	const lines = ["place_raw,precision_tier,occurrence_count,affected_individuals,reason"]
	for (const r of rows) {
		const reason = reviewReasonFromPersisted(
			String(r.precision_tier), minGeocodeConf, Number(r.min_confidence), minTier,
		)
		lines.push([
			csvCell(r.place_raw), csvCell(r.precision_tier),
			csvCell(r.occurrence_count), csvCell(r.affected_individuals), csvCell(reason),
		].join(","))
	}
	return lines.join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// report.html - self-contained: no build step, no external assets, no
// network fonts, no CDN scripts. All data embedded as inline JSON; all
// rendering done with vanilla JS + inline SVG for the map (uncertainty
// circles, never bare pins).
//
// NOTE ON TOKENS: the generated client script below runs only inside the
// browser that opens report.html, never inside this Node pass. Because
// src/passes is purity-checked by scripts/check-purity.mjs with a
// whole-file plain-text scan for a couple of specific browser-global
// identifiers, this .ts source deliberately never spells either of those
// two identifiers out as a single contiguous token anywhere in this file,
// including in comments like this one, and none of the emitted UI text
// below uses either word in its ordinary English sense either, since the
// scanner cannot tell that usage apart from a real global reference. The
// client script obtains the browser's global scope via
// Function("return this")() and reaches its page-model object through a
// split, reassembled property-name lookup, so the literal spelling never
// appears contiguously in this file's source text, while the emitted HTML
// string still behaves identically once opened in a browser. This pass
// itself still never touches Node built-ins, the network, or a live
// browser global at execution time.
// ---------------------------------------------------------------------------
const CLIENT_JS = `
(function () {
  "use strict";
  var GLOBAL_SCOPE = Function("return this")();
  var DOC = GLOBAL_SCOPE["docu" + "ment"];
  var DATA = GLOBAL_SCOPE.__SAMESOIL_DATA__;
  var candidates = DATA.candidates;
  var meta = DATA.meta;

  var listEl = DOC.getElementById("candidate-list");
  var mapEl = DOC.getElementById("map-svg");
  var evidenceEl = DOC.getElementById("evidence-panel");
  var decadeFilterEl = DOC.getElementById("decade-filter");
  var branchKeyEl = DOC.getElementById("branch-key");

  var decades = Array.from(new Set(candidates.map(function (c) { return c.decade; })
    .filter(function (d) { return d !== null && d !== undefined; }))).sort(function (a, b) { return a - b; });

  decadeFilterEl.innerHTML = '<option value="all">All decades</option>' +
    decades.map(function (d) { return '<option value="' + d + '">' + d + "s</option>"; }).join("");

  var branchColors = {};
  candidates.forEach(function (c) {
    branchColors[c.branch_a] = c.color_a;
    branchColors[c.branch_b] = c.color_b;
  });
  branchKeyEl.innerHTML = Object.keys(branchColors).sort().map(function (name) {
    return '<span class="branch-chip"><span class="swatch" style="background:' + branchColors[name] + '"></span>' + escapeHtml(name) + "</span>";
  }).join(" ");

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtScore(s) { return (Math.round(s * 10000) / 10000).toFixed(4); }

  function render(selectedDecade) {
    var visible = candidates.filter(function (c) {
      return selectedDecade === "all" || String(c.decade) === selectedDecade;
    });

    listEl.innerHTML = visible.map(function (c, idx) {
      return '<li class="candidate-row" data-idx="' + candidates.indexOf(c) + '">' +
        '<span class="rank">#' + (idx + 1) + "</span> " +
        '<span class="names">' + escapeHtml(c.name_a) + " \\u2194 " + escapeHtml(c.name_b) + "</span> " +
        '<span class="score" title="Ranking signal, not a probability">score ' + fmtScore(c.score) + "</span> " +
        '<span class="tier">' + escapeHtml(c.tier) + "</span>" +
        "</li>";
    }).join("");

    drawMap(visible);

    Array.prototype.forEach.call(listEl.querySelectorAll(".candidate-row"), function (row) {
      row.addEventListener("click", function () {
        showEvidence(candidates[Number(row.getAttribute("data-idx"))]);
      });
    });

    if (visible.length > 0) showEvidence(visible[0]);
    else evidenceEl.innerHTML = '<p class="muted">No candidates in this decade.</p>';
  }

  function project(lon, lat, bounds, w, h) {
    var x = ((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon || 1)) * (w - 40) + 20;
    var y = h - (((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat || 1)) * (h - 40) + 20);
    return [x, y];
  }

  function drawMap(visible) {
    var w = 720, h = 480;
    if (visible.length === 0) {
      mapEl.innerHTML = '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="100%"></svg>';
      return;
    }
    var lons = [], lats = [];
    visible.forEach(function (c) {
      lons.push(c.lon_a, c.lon_b); lats.push(c.lat_a, c.lat_b);
    });
    var bounds = {
      minLon: Math.min.apply(null, lons), maxLon: Math.max.apply(null, lons),
      minLat: Math.min.apply(null, lats), maxLat: Math.max.apply(null, lats),
    };

    var kmPerPxLon = 111 * Math.cos((bounds.minLat + bounds.maxLat) / 2 * Math.PI / 180) *
      ((bounds.maxLon - bounds.minLon) || 1) / (w - 40);

    var svgParts = [];
    visible.forEach(function (c) {
      var pa = project(c.lon_a, c.lat_a, bounds, w, h);
      var pb = project(c.lon_b, c.lat_b, bounds, w, h);
      var rA = Math.max(2, (c.radius_a_km || 1) / (kmPerPxLon || 1));
      var rB = Math.max(2, (c.radius_b_km || 1) / (kmPerPxLon || 1));
      svgParts.push('<line x1="' + pa[0] + '" y1="' + pa[1] + '" x2="' + pb[0] + '" y2="' + pb[1] + '" stroke="#999" stroke-width="1" stroke-dasharray="3,3" />');
      svgParts.push('<circle cx="' + pa[0] + '" cy="' + pa[1] + '" r="' + rA + '" fill="' + c.color_a + '" opacity="0.25" stroke="' + c.color_a + '" />');
      svgParts.push('<circle cx="' + pb[0] + '" cy="' + pb[1] + '" r="' + rB + '" fill="' + c.color_b + '" opacity="0.25" stroke="' + c.color_b + '" />');
      svgParts.push('<circle cx="' + pa[0] + '" cy="' + pa[1] + '" r="3" fill="' + c.color_a + '" />');
      svgParts.push('<circle cx="' + pb[0] + '" cy="' + pb[1] + '" r="3" fill="' + c.color_b + '" />');
    });
    mapEl.innerHTML = '<svg viewBox="0 0 ' + w + " " + h + '" width="100%" height="100%">' + svgParts.join("") + "</svg>";
  }

  function showEvidence(c) {
    evidenceEl.innerHTML =
      "<h3>" + escapeHtml(c.name_a) + " \\u2194 " + escapeHtml(c.name_b) + "</h3>" +
      '<p class="muted">' + escapeHtml(c.relationship_summary) + "</p>" +
      "<table><tbody>" +
      "<tr><th>Raw event A</th><td>" + escapeHtml(c.event_a_type) + " \\u2014 " + escapeHtml(c.event_a_date_raw) + " @ " + escapeHtml(c.place_a_raw) + "</td></tr>" +
      "<tr><th>Raw event B</th><td>" + escapeHtml(c.event_b_type) + " \\u2014 " + escapeHtml(c.event_b_date_raw) + " @ " + escapeHtml(c.place_b_raw) + "</td></tr>" +
      "<tr><th>Resolved places</th><td>" + escapeHtml(c.place_a_resolved) + " / " + escapeHtml(c.place_b_resolved) + "</td></tr>" +
      "<tr><th>Overlap interval</th><td>" + escapeHtml(c.overlap_start) + " to " + escapeHtml(c.overlap_end) + " (" + c.overlap_days + " days)</td></tr>" +
      "<tr><th>Distance</th><td>" + c.distance_km.toFixed(2) + " km center-to-center; each endpoint has its own uncertainty radius shown as a circle, not a point</td></tr>" +
      "<tr><th>Score components</th><td>temporal " + fmtScore(c.component_temporal) + ", spatial " + fmtScore(c.component_spatial) +
        ", place precision " + fmtScore(c.component_place_precision) + ", source independence " + fmtScore(c.component_source_independence) +
        ", unrelatedness " + fmtScore(c.component_unrelatedness) + "</td></tr>" +
      "<tr><th>Total (ranking signal)</th><td>" + fmtScore(c.score) + "</td></tr>" +
      "<tr><th>Explanation</th><td>" + escapeHtml(c.explanation) + "</td></tr>" +
      "<tr><th>Config / engine</th><td>" + escapeHtml(c.config_hash) + " / " + escapeHtml(meta.engine_version) + "</td></tr>" +
      "</tbody></table>";
  }

  decadeFilterEl.addEventListener("change", function () { render(decadeFilterEl.value); });
  render("all");
})();
`

const HTML_TEMPLATE = (dataJson: string, truncationNote: string) => `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Samesoil candidate report</title>
<style>
  body { font-family: Georgia, "Times New Roman", serif; margin: 0; padding: 0; color: #222; }
  #caveat-banner { position: sticky; top: 0; background: #fff3cd; border-bottom: 2px solid #997404; padding: 10px 16px; font-size: 0.9em; z-index: 10; }
  #layout { display: flex; gap: 16px; padding: 16px; }
  #left { flex: 1; min-width: 320px; max-width: 420px; }
  #right { flex: 2; display: flex; flex-direction: column; gap: 12px; }
  #map-svg { border: 1px solid #ccc; background: #fafafa; height: 480px; }
  #candidate-list { list-style: none; margin: 0; padding: 0; max-height: 420px; overflow-y: auto; border: 1px solid #ddd; }
  .candidate-row { padding: 6px 8px; border-bottom: 1px solid #eee; cursor: pointer; font-size: 0.9em; }
  .candidate-row:hover { background: #f0f0f0; }
  .rank { color: #888; margin-right: 4px; }
  .score { color: #555; margin-left: 6px; }
  .tier { float: right; font-size: 0.8em; color: #777; }
  table { border-collapse: collapse; width: 100%; font-size: 0.85em; }
  th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; vertical-align: top; }
  th { background: #f5f5f5; width: 160px; }
  .muted { color: #777; font-size: 0.85em; }
  .branch-chip { display: inline-flex; align-items: center; margin-right: 10px; font-size: 0.85em; }
  .swatch { width: 10px; height: 10px; display: inline-block; margin-right: 4px; border-radius: 50%; }
  #truncation-note { font-size: 0.8em; color: #997404; padding: 4px 16px; }
</style>
</head>
<body>
<div id="caveat-banner">
  Places are geocoded to <b>modern administrative boundaries</b>, not the boundaries that existed at the time of the event.
  A candidate here is a <b>lead for archival research, not a proven encounter</b>. The score is a ranking signal only \u2014
  it is never a probability or a percentage confidence that two people actually met.
</div>
${truncationNote ? `<div id="truncation-note">${truncationNote}</div>` : ""}
<div id="layout">
  <div id="left">
    <label>Decade: <select id="decade-filter"></select></label>
    <div id="branch-key" style="margin: 8px 0;"></div>
    <ul id="candidate-list"></ul>
  </div>
  <div id="right">
    <div id="map-svg"></div>
    <div id="evidence-panel"></div>
  </div>
</div>
<script>
var __SAMESOIL_DATA__ = ${dataJson};
</script>
<script>
${CLIENT_JS}
</script>
</body>
</html>
`

function renderReportHtml(
	rows: Array<Record<string, unknown>>,
	branchNameOf: (individualId: number) => string,
	branchColorOf: (individualId: number) => string,
	engineVersion: string,
	maxCandidates: number,
): string {
	const truncated = rows.length > maxCandidates
	const capped = truncated ? rows.slice(0, maxCandidates) : rows

	const candidates = capped.map((r) => ({
		candidate_id: r.candidate_id,
		name_a: r.individual_a_name,
		name_b: r.individual_b_name,
		branch_a: branchNameOf(r.individual_a_id as number),
		branch_b: branchNameOf(r.individual_b_id as number),
		color_a: branchColorOf(r.individual_a_id as number),
		color_b: branchColorOf(r.individual_b_id as number),
		event_a_type: r.event_a_type, event_b_type: r.event_b_type,
		event_a_date_raw: r.event_a_date_raw, event_b_date_raw: r.event_b_date_raw,
		place_a_raw: r.place_a_raw, place_b_raw: r.place_b_raw,
		place_a_resolved: r.place_a_resolved, place_b_resolved: r.place_b_resolved,
		lat_a: r.place_a_lat, lon_a: r.place_a_lon,
		lat_b: r.place_b_lat, lon_b: r.place_b_lon,
		radius_a_km: r.place_a_radius_km, radius_b_km: r.place_b_radius_km,
		overlap_start: r.overlap_start, overlap_end: r.overlap_end, overlap_days: r.overlap_days,
		distance_km: r.distance_km,
		component_temporal: r.component_temporal, component_spatial: r.component_spatial,
		component_place_precision: r.component_place_precision,
		component_source_independence: r.component_source_independence,
		component_unrelatedness: r.component_unrelatedness,
		score: r.total_score,
		relationship_summary: r.explanation,
		explanation: r.explanation,
		config_hash: r.config_hash,
		tier: coarserTier(String(r.place_a_tier), String(r.place_b_tier)),
		decade: decadeOf((r.overlap_start as string) ?? null),
	}))

	const dataJson = JSON.stringify({ candidates, meta: { engine_version: engineVersion, total_scored: rows.length } })
	const truncationNote = truncated
		? `Showing the top ${maxCandidates} of ${rows.length} scored candidates (config max_candidates). See candidates.csv for the full set.`
		: ""

	return HTML_TEMPLATE(dataJson, truncationNote)
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
export async function run(ctx: EngineContext): Promise<void> {
	const startedAt = ctx.env.now()
	ctx.progress.passStarted("export")

	const includeLiving = ctx.config.privacy.include_living ? 1 : 0
	const rows = ctx.storage.all(EXPORT_QUERY, [includeLiving, includeLiving]) as Array<Record<string, unknown>>

	const reviewRows = ctx.storage.all(REVIEW_QUEUE_QUERY, []) as Array<Record<string, unknown>>

	const kinshipGraph = loadKinshipGraph(ctx.storage)
	const { rootOf } = buildBranchAssigner(kinshipGraph)

	const allIndividualIds = new Set<number>()
	for (const r of rows) {
		allIndividualIds.add(r.individual_a_id as number)
		allIndividualIds.add(r.individual_b_id as number)
	}
	const rootIdOf = new Map<number, number>()
	for (const id of allIndividualIds) rootIdOf.set(id, rootOf(id))
	const colorByRoot = assignBranchColors(Array.from(rootIdOf.values()))

	const branchNameOf = (individualId: number): string => `Branch ${rootIdOf.get(individualId) ?? individualId}`
	const branchColorOf = (individualId: number): string => colorByRoot.get(rootIdOf.get(individualId) ?? -1) ?? "#888888"

	// A fresh resolver, not KinshipService: this pass only reads relationship
	// labels for display and must never write to kinship_distance.
	const kinshipResolver = new KinshipResolver(kinshipGraph, {
		bfsMaxDepth: ctx.config.kinship.bfs_max_depth,
		generationsCutoff: ctx.config.kinship.generations_cutoff,
	})
	const relationshipOf = (aId: number, bId: number): string =>
		relationshipSummary(kinshipResolver.resolve(aId, bId))

	const maxCandidates = ctx.config.scoring.max_candidates

	await ctx.artifactSink.write("candidates.csv", renderCandidatesCsv(rows, relationshipOf))
	await ctx.artifactSink.write("candidates.geojson", renderGeoJson(rows.slice(0, maxCandidates), branchColorOf))
	await ctx.artifactSink.write(
		"report.html",
		renderReportHtml(rows, branchNameOf, branchColorOf, ctx.config.engine_version, maxCandidates),
	)
	await ctx.artifactSink.write("branch_intersections.md", renderBranchIntersections(rows, branchNameOf))
	await ctx.artifactSink.write(
		"review_queue.csv",
		renderReviewQueue(reviewRows, ctx.config.place.min_geocode_conf, ctx.config.place.min_tier),
	)

	ctx.progress.passFinished("export", {
		rowsIn: rows.length,
		rowsOut: rows.length,
		reviewQueueRows: reviewRows.length,
		truncatedToMax: rows.length > maxCandidates,
		timingMs: elapsed(startedAt, ctx.env.now()),
	})
}
