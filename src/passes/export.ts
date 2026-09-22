import type { EngineContext } from "../core/context.js";
import type { PrecisionTier } from "../core/adapters.js";
import type { KinshipGraph } from "../core/kinship.js";
import { tierIsCoarser } from "../core/place-resolution.js";
import { createKinshipService, loadKinshipGraph } from "./kinship.js";

// Pass 7 reads only already-persisted, already-scored state. It never writes
// to candidate_pairs, scored_candidates, places, or any table the scoring
// path depends on, and it never recomputes a score component. The one write
// side effect it inherits is KinshipService.resolve()'s memoized upsert into
// kinship_distance, the same call score.ts already makes to build its
// explanation text; recomputing it here is idempotent and does not change any
// stored score.

interface ExportRow extends Readonly<Record<string, unknown>> {
  readonly candidate_id: number;
  readonly score: number;
  readonly s_proximity: number;
  readonly s_temporal: number;
  readonly s_temporal_proximity: number;
  readonly s_date_precision: number;
  readonly s_precision: number;
  readonly s_confidence: number;
  readonly s_unrelatedness: number;
  readonly s_independence: number;
  readonly explanation: string;
  readonly config_hash: string;
  readonly engine_version: string;
  readonly a_id: number;
  readonly b_id: number;
  readonly overlap_start: string;
  readonly overlap_end: string;
  readonly overlap_days: number;
  readonly temporal_relation: string;
  readonly temporal_gap_days: number;
  readonly distance_km: number;
  readonly combined_radius: number;
  readonly a_precision_tier: string;
  readonly b_precision_tier: string;
  readonly a_radius_km: number;
  readonly b_radius_km: number;
  readonly a_event_type: string;
  readonly b_event_type: string;
  readonly a_date_raw: string | null;
  readonly b_date_raw: string | null;
  readonly a_place_raw: string | null;
  readonly b_place_raw: string | null;
  readonly a_place_label: string | null;
  readonly b_place_label: string | null;
  readonly a_lat: number | null;
  readonly a_lon: number | null;
  readonly b_lat: number | null;
  readonly b_lon: number | null;
  readonly a_admin1: string | null;
  readonly b_admin1: string | null;
  readonly a_country: string | null;
  readonly b_country: string | null;
  readonly a_name: string | null;
  readonly b_name: string | null;
  readonly a_xref: string;
  readonly b_xref: string;
}

interface IndividualNameRow extends Readonly<Record<string, unknown>> {
  readonly id: number;
  readonly name_full: string | null;
  readonly name_surname: string | null;
  readonly gedcom_xref: string;
}

interface PlaceReviewRow extends Readonly<Record<string, unknown>> {
  readonly place_raw: string;
  readonly occurrence_count: number;
  readonly affected_individuals: number;
  readonly precision_tier: string;
  readonly geocode_conf: number | null;
  readonly lat: number | null;
  readonly lon: number | null;
}

const EXPORT_QUERY = `SELECT
  s.candidate_id AS candidate_id, s.score AS score,
  s.s_proximity AS s_proximity, s.s_temporal AS s_temporal, s.s_temporal_proximity AS s_temporal_proximity,
  s.s_date_precision AS s_date_precision, s.s_precision AS s_precision, s.s_confidence AS s_confidence,
  s.s_unrelatedness AS s_unrelatedness, s.s_independence AS s_independence,
  s.explanation AS explanation, s.config_hash AS config_hash, s.engine_version AS engine_version,
  c.a_id AS a_id, c.b_id AS b_id, c.overlap_start AS overlap_start, c.overlap_end AS overlap_end,
  c.overlap_days AS overlap_days, c.temporal_relation AS temporal_relation, c.temporal_gap_days AS temporal_gap_days,
  c.distance_km AS distance_km, c.combined_radius AS combined_radius,
  pa.precision_tier AS a_precision_tier, pb.precision_tier AS b_precision_tier,
  pa.radius_km AS a_radius_km, pb.radius_km AS b_radius_km,
  ea.event_type AS a_event_type, eb.event_type AS b_event_type,
  ea.date_raw AS a_date_raw, eb.date_raw AS b_date_raw,
  ea.place_raw AS a_place_raw, eb.place_raw AS b_place_raw,
  pla.place_normalized AS a_place_label, plb.place_normalized AS b_place_label,
  pla.lat AS a_lat, pla.lon AS a_lon, plb.lat AS b_lat, plb.lon AS b_lon,
  pla.admin1 AS a_admin1, plb.admin1 AS b_admin1, pla.country AS a_country, plb.country AS b_country,
  ia.name_full AS a_name, ib.name_full AS b_name, ia.gedcom_xref AS a_xref, ib.gedcom_xref AS b_xref
FROM scored_candidates s
JOIN candidate_pairs c ON c.id = s.candidate_id
JOIN presence_intervals pa ON pa.id = c.a_interval_id
JOIN presence_intervals pb ON pb.id = c.b_interval_id
JOIN events ea ON ea.id = pa.event_id
JOIN events eb ON eb.id = pb.event_id
JOIN places pla ON pla.id = pa.place_id
JOIN places plb ON plb.id = pb.place_id
JOIN individuals ia ON ia.id = c.a_id
JOIN individuals ib ON ib.id = c.b_id
ORDER BY s.score DESC, s.candidate_id ASC`;

const REVIEW_QUEUE_QUERY = `WITH event_stats AS (
  SELECT place_raw, COUNT(*) AS occurrence_count FROM events WHERE place_raw IS NOT NULL GROUP BY place_raw
), affected AS (
  SELECT e.place_raw AS place_raw, e.subject_id AS individual_id FROM events e
  WHERE e.place_raw IS NOT NULL AND e.subject_type = 'individual'
  UNION ALL
  SELECT e.place_raw AS place_raw, f.husband_id AS individual_id FROM events e
  JOIN families f ON e.subject_type = 'family' AND e.subject_id = f.id
  WHERE e.place_raw IS NOT NULL AND f.husband_id IS NOT NULL
  UNION ALL
  SELECT e.place_raw AS place_raw, f.wife_id AS individual_id FROM events e
  JOIN families f ON e.subject_type = 'family' AND e.subject_id = f.id
  WHERE e.place_raw IS NOT NULL AND f.wife_id IS NOT NULL
), affected_stats AS (
  SELECT place_raw, COUNT(DISTINCT individual_id) AS affected_individuals FROM affected GROUP BY place_raw
)
SELECT p.place_raw AS place_raw, COALESCE(es.occurrence_count, 0) AS occurrence_count,
  COALESCE(a.affected_individuals, 0) AS affected_individuals,
  p.precision_tier AS precision_tier, p.geocode_conf AS geocode_conf, p.lat AS lat, p.lon AS lon
FROM places p
LEFT JOIN event_stats es ON es.place_raw = p.place_raw
LEFT JOIN affected_stats a ON a.place_raw = p.place_raw
WHERE p.review_status = 'auto'
ORDER BY p.place_raw COLLATE BINARY`;

const TIER_ORDER: readonly string[] = ["address", "locality", "district", "region", "country", "unknown"];
const BRANCH_PALETTE: readonly string[] = ["#4477aa", "#ee6677", "#228833", "#ccbb44", "#66ccee", "#aa3377", "#bbbbbb", "#e69f00", "#009e73", "#cc79a7", "#0072b2", "#d55e00"];

function elapsed(start: string, end: string): number { return Math.max(0, Date.parse(end) - Date.parse(start)); }
function tierRank(value: string): number { const rank = TIER_ORDER.indexOf(value); return rank < 0 ? TIER_ORDER.length : rank; }
function coarserTier(a: string, b: string): string { return tierRank(a) >= tierRank(b) ? a : b; }
function decadeOf(dateIso: string): number { return Math.floor(Number(dateIso.slice(0, 4)) / 10) * 10; }
function csvCell(value: string | number): string { const text = String(value); return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text; }

function buildBranchAssigner(graph: KinshipGraph, people: ReadonlyMap<number, IndividualNameRow>, maxDepth: number): (id: number) => { readonly rootId: number; readonly label: string } {
  const cache = new Map<number, { rootId: number; label: string }>();
  return (id: number): { readonly rootId: number; readonly label: string } => {
    const cached = cache.get(id);
    if (cached !== undefined) return cached;
    let current = id;
    for (let depth = 0; depth < maxDepth; depth += 1) {
      const parents = graph.biologicalParents.get(current);
      if (parents === undefined || parents.length === 0) break;
      current = Math.min(...parents);
    }
    const person = people.get(current), surname = person?.name_surname?.trim(), xref = person?.gedcom_xref ?? `I${current}`;
    const label = surname !== undefined && surname.length > 0 ? `${surname} branch (root ${xref})` : `Unlabeled branch (root ${xref})`;
    const result = { rootId: current, label };
    cache.set(id, result);
    return result;
  };
}

function assignBranchColors(labels: ReadonlySet<string>): ReadonlyMap<string, string> {
  const result = new Map<string, string>();
  [...labels].sort().forEach((label, index) => result.set(label, BRANCH_PALETTE[index % BRANCH_PALETTE.length] ?? "#888888"));
  return result;
}

const CANDIDATES_CSV_HEADER = [
  "candidate_id", "score", "relationship_summary",
  "a_name", "a_xref", "a_event_type", "a_date_raw", "a_place_raw", "a_place_label", "a_precision_tier", "a_radius_km",
  "b_name", "b_xref", "b_event_type", "b_date_raw", "b_place_raw", "b_place_label", "b_precision_tier", "b_radius_km",
  "overlap_start", "overlap_end", "overlap_days", "temporal_relation", "temporal_gap_days", "distance_km", "combined_radius_km",
  "s_proximity", "s_temporal", "s_temporal_proximity", "s_date_precision", "s_precision", "s_confidence", "s_unrelatedness", "s_independence",
  "config_hash", "engine_version", "explanation",
];

function renderCandidatesCsv(rows: ReadonlyArray<ExportRow>, relationshipOf: (a: number, b: number) => string): string {
  const lines = [CANDIDATES_CSV_HEADER.join(",")];
  for (const row of rows) {
    const values: ReadonlyArray<string | number> = [
      row.candidate_id, row.score.toFixed(6), relationshipOf(row.a_id, row.b_id),
      row.a_name ?? `Individual ${row.a_id}`, row.a_xref, row.a_event_type, row.a_date_raw ?? "", row.a_place_raw ?? "", row.a_place_label ?? "", row.a_precision_tier, row.a_radius_km,
      row.b_name ?? `Individual ${row.b_id}`, row.b_xref, row.b_event_type, row.b_date_raw ?? "", row.b_place_raw ?? "", row.b_place_label ?? "", row.b_precision_tier, row.b_radius_km,
      row.overlap_start, row.overlap_end, row.overlap_days, row.temporal_relation, row.temporal_gap_days, row.distance_km.toFixed(3), row.combined_radius.toFixed(3),
      row.s_proximity.toFixed(6), row.s_temporal.toFixed(6), row.s_temporal_proximity.toFixed(6), row.s_date_precision.toFixed(6), row.s_precision.toFixed(6), row.s_confidence.toFixed(6), row.s_unrelatedness.toFixed(6), row.s_independence.toFixed(6),
      row.config_hash, row.engine_version, row.explanation,
    ];
    lines.push(values.map(csvCell).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function pointFeature(lat: number, lon: number, properties: Record<string, unknown>): Record<string, unknown> {
  return { type: "Feature", geometry: { type: "Point", coordinates: [lon, lat] }, properties };
}

function renderGeoJson(rows: ReadonlyArray<ExportRow>, branchOf: (id: number) => { readonly label: string }, truncated: boolean, cap: number): string {
  const features: Record<string, unknown>[] = [];
  for (const row of rows) {
    if (row.a_lat === null || row.a_lon === null || row.b_lat === null || row.b_lon === null) continue;
    const decade = decadeOf(row.overlap_start), midLat = (row.a_lat + row.b_lat) / 2, midLon = (row.a_lon + row.b_lon) / 2;
    const spanRadiusKm = row.distance_km / 2 + Math.max(row.a_radius_km, row.b_radius_km), midTier = coarserTier(row.a_precision_tier, row.b_precision_tier);
    features.push(pointFeature(midLat, midLon, {
      candidate_id: row.candidate_id, role: "midpoint", score: Number(row.score.toFixed(6)), decade,
      precision_tier: midTier, radius_km: Number(spanRadiusKm.toFixed(3)),
      note: "midpoint is the arithmetic mean of the two endpoint coordinates, not a geocoded location; radius_km is a display span sized to cover both endpoint uncertainty circles",
    }));
    features.push(pointFeature(row.a_lat, row.a_lon, {
      candidate_id: row.candidate_id, role: "a", score: Number(row.score.toFixed(6)), decade,
      precision_tier: row.a_precision_tier, radius_km: row.a_radius_km,
      name: row.a_name ?? `Individual ${row.a_id}`, event_type: row.a_event_type, branch: branchOf(row.a_id).label,
    }));
    features.push(pointFeature(row.b_lat, row.b_lon, {
      candidate_id: row.candidate_id, role: "b", score: Number(row.score.toFixed(6)), decade,
      precision_tier: row.b_precision_tier, radius_km: row.b_radius_km,
      name: row.b_name ?? `Individual ${row.b_id}`, event_type: row.b_event_type, branch: branchOf(row.b_id).label,
    }));
  }
  return `${JSON.stringify({ type: "FeatureCollection", features, properties: { candidate_count: rows.length, truncated, cap } }, null, 1)}\n`;
}

function adminAreaOf(row: ExportRow): string {
  const useA = tierRank(row.a_precision_tier) <= tierRank(row.b_precision_tier);
  const admin1 = useA ? row.a_admin1 : row.b_admin1, country = useA ? row.a_country : row.b_country;
  return `${admin1 ?? "Unresolved region"}, ${country ?? "Unresolved country"}`;
}

interface IntersectionCell { readonly branchA: string; readonly branchB: string; readonly area: string; readonly decade: number; count: number; bestScore: number; bestCandidateId: number }

function renderBranchIntersections(rows: ReadonlyArray<ExportRow>, branchOf: (id: number) => { readonly label: string }): string {
  const cells = new Map<string, IntersectionCell>();
  for (const row of rows) {
    const labelA = branchOf(row.a_id).label, labelB = branchOf(row.b_id).label;
    const [first, second] = labelA <= labelB ? [labelA, labelB] : [labelB, labelA];
    const area = adminAreaOf(row), decade = decadeOf(row.overlap_start), key = `${first}||${second}||${area}||${decade}`;
    const existing = cells.get(key);
    if (existing === undefined) cells.set(key, { branchA: first, branchB: second, area, decade, count: 1, bestScore: row.score, bestCandidateId: row.candidate_id });
    else { existing.count += 1; if (row.score > existing.bestScore) { existing.bestScore = row.score; existing.bestCandidateId = row.candidate_id; } }
  }
  const sorted = [...cells.values()].sort((a, b) => b.bestScore - a.bestScore || b.count - a.count || a.branchA.localeCompare(b.branchA));
  const lines = [
    "# Branch intersections",
    "",
    "Ancestral branches are a display-only grouping derived by following each candidate's biological ancestry to a deterministic root ancestor (always the numerically smallest parent id at each generation); they are not part of the scoring schema or the scoring logic. Administrative area and place labels are geocoded to modern boundaries, not historical ones. The best score in each cell is a ranking signal, not a probability of an encounter.",
    "",
    "| Branch A | Branch B | Administrative area | Decade | Candidate count | Best score | Best candidate id |",
    "| --- | --- | --- | --- | --- | --- | --- |",
  ];
  if (sorted.length === 0) lines.push("| _(no scored candidates)_ | | | | | | |");
  for (const cell of sorted) lines.push(`| ${cell.branchA} | ${cell.branchB} | ${cell.area} | ${cell.decade}s | ${cell.count} | ${cell.bestScore.toFixed(3)} | ${cell.bestCandidateId} |`);
  return `${lines.join("\n")}\n`;
}

function reviewReasonFromPersisted(row: PlaceReviewRow, minConf: number, minTier: Exclude<PrecisionTier, "unknown">): string | null {
  if (row.lat === null || row.lon === null || row.precision_tier === "unknown") return "unresolved";
  if ((row.geocode_conf ?? 0) < minConf) return "low_conf";
  if (tierIsCoarser(row.precision_tier as PrecisionTier, minTier)) return "coarse_place";
  return null;
}

function renderReviewQueue(ctx: EngineContext): string {
  const rows = ctx.storage.all<PlaceReviewRow>(REVIEW_QUEUE_QUERY);
  const withReason = rows
    .map((row) => ({ row, reason: reviewReasonFromPersisted(row, ctx.config.place.min_geocode_conf, ctx.config.place.min_tier) }))
    .filter((item): item is { row: PlaceReviewRow; reason: string } => item.reason !== null)
    .sort((a, b) => b.row.occurrence_count - a.row.occurrence_count || b.row.affected_individuals - a.row.affected_individuals || (a.row.place_raw < b.row.place_raw ? -1 : a.row.place_raw > b.row.place_raw ? 1 : 0));
  const lines = ["place_raw,occurrence_count,affected_individuals,reason"];
  for (const item of withReason) lines.push([item.row.place_raw, item.row.occurrence_count, item.row.affected_individuals, item.reason].map(csvCell).join(","));
  return `${lines.join("\n")}\n`;
}

const CLIENT_JS = `(function () {
  var payload = JSON.parse(document.getElementById('samesoil-data').textContent);
  var candidates = payload.candidates, branchColors = payload.branchColors, meta = payload.meta;
  var decades = Array.from(new Set(candidates.map(function (c) { return c.decade; }))).sort(function (a, b) { return a - b; });
  var selectedDecades = new Set(decades);
  var selectedId = candidates.length > 0 ? candidates[0].candidate_id : null;
  var SVG_NS = 'http://www.w3.org/2000/svg';

  function fmtScore(s) { return s.toFixed(3); }
  function fmtKm(k) { return k.toFixed(1) + ' km'; }
  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function visibleCandidates() { return candidates.filter(function (c) { return selectedDecades.has(c.decade); }); }

  function renderMeta() {
    document.getElementById('report-meta').textContent = 'Engine ' + meta.engineVersion + ' \u2014 config ' + meta.configHash.slice(0, 12) + '\u2026 \u2014 generated ' + meta.generatedAt;
    document.getElementById('truncation-note').textContent = meta.truncated
      ? ('Showing the top ' + meta.embeddedCandidates + ' of ' + meta.totalCandidates + ' scored candidates on this map and report; the remainder are truncated to keep this file a reasonable size. See candidates.csv for the complete list.')
      : ('All ' + meta.totalCandidates + ' scored candidates are embedded in this report.');
  }

  function renderDecadeFilter() {
    var container = document.getElementById('decade-filter');
    container.innerHTML = '';
    decades.forEach(function (d) {
      var label = document.createElement('label');
      label.className = 'decade-toggle';
      var input = document.createElement('input');
      input.type = 'checkbox';
      input.checked = selectedDecades.has(d);
      input.addEventListener('change', function () {
        if (input.checked) selectedDecades.add(d); else selectedDecades.delete(d);
        renderAll();
      });
      label.appendChild(input);
      label.appendChild(document.createTextNode(' ' + d + 's'));
      container.appendChild(label);
    });
  }

  function renderBranchKey() {
    var container = document.getElementById('branch-key');
    container.innerHTML = '';
    Object.keys(branchColors).sort().forEach(function (label) {
      var row = document.createElement('div');
      row.className = 'branch-row';
      var swatch = document.createElement('span');
      swatch.className = 'swatch';
      swatch.style.background = branchColors[label];
      row.appendChild(swatch);
      row.appendChild(document.createTextNode(' ' + label));
      container.appendChild(row);
    });
  }

  function selectCandidate(id) { selectedId = id; renderAll(); }

  function renderList() {
    var list = document.getElementById('candidate-list');
    list.innerHTML = '';
    var visible = visibleCandidates();
    visible.forEach(function (c, index) {
      var item = document.createElement('div');
      item.className = 'candidate-row' + (c.candidate_id === selectedId ? ' selected' : '');
      item.addEventListener('click', function () { selectCandidate(c.candidate_id); });
      var rank = document.createElement('span'); rank.className = 'rank'; rank.textContent = '#' + (index + 1);
      var names = document.createElement('span'); names.className = 'names'; names.textContent = c.a_name + ' & ' + c.b_name;
      var score = document.createElement('span'); score.className = 'score'; score.textContent = fmtScore(c.score);
      item.appendChild(rank); item.appendChild(names); item.appendChild(score);
      list.appendChild(item);
    });
    document.getElementById('list-count').textContent = visible.length + ' of ' + meta.embeddedCandidates + ' embedded candidates shown';
  }

  function evidenceRow(label, a, b) {
    return '<tr><th>' + escapeHtml(label) + '</th><td>' + escapeHtml(String(a)) + '</td><td>' + escapeHtml(String(b)) + '</td></tr>';
  }

  function renderEvidence() {
    var panel = document.getElementById('evidence-panel');
    var matches = candidates.filter(function (c) { return c.candidate_id === selectedId; });
    if (matches.length === 0) { panel.innerHTML = '<h3>Evidence</h3><p>Select a candidate to view its evidence.</p>'; return; }
    var c = matches[0];
    var html = '';
    html += '<h3>Candidate #' + c.candidate_id + ' \u2014 ranking score ' + fmtScore(c.score) + '</h3>';
    html += '<p class="relationship">Relationship: ' + escapeHtml(c.relationship_summary) + '</p>';
    html += '<table class="evidence-table"><tr><th></th><th>' + escapeHtml(c.a_name) + '</th><th>' + escapeHtml(c.b_name) + '</th></tr>';
    html += evidenceRow('Event', c.a_event_type, c.b_event_type);
    html += evidenceRow('Raw date (GEDCOM)', c.a_date_raw || '(none recorded)', c.b_date_raw || '(none recorded)');
    html += evidenceRow('Raw place (GEDCOM)', c.a_place_raw || '(none recorded)', c.b_place_raw || '(none recorded)');
    html += evidenceRow('Resolved place label', c.a_place_label || '(unresolved)', c.b_place_label || '(unresolved)');
    html += evidenceRow('Place precision tier', c.a_precision_tier, c.b_precision_tier);
    html += evidenceRow('Place uncertainty radius', fmtKm(c.a_radius_km), fmtKm(c.b_radius_km));
    html += evidenceRow('Ancestral branch', c.a_branch, c.b_branch);
    html += '</table>';
    html += '<table class="evidence-table">';
    html += '<tr><th>Overlap window</th><td colspan="2">' + c.overlap_start + ' to ' + c.overlap_end + ' (' + c.overlap_days + '-day interval \u2014 not a single date)</td></tr>';
    html += '<tr><th>Temporal relation</th><td colspan="2">' + c.temporal_relation + (c.temporal_gap_days > 0 ? (' (' + c.temporal_gap_days + '-day gap)') : '') + '</td></tr>';
    html += '<tr><th>Distance between place centroids</th><td colspan="2">' + fmtKm(c.distance_km) + '</td></tr>';
    html += '<tr><th>Score components (0\u20131 each; a ranking signal, not a probability)</th><td colspan="2">proximity ' + fmtScore(c.s_proximity) + ', temporal ' + fmtScore(c.s_temporal) + ', precision ' + fmtScore(c.s_precision) + ', confidence ' + fmtScore(c.s_confidence) + ', unrelatedness ' + fmtScore(c.s_unrelatedness) + ', independence ' + fmtScore(c.s_independence) + '</td></tr>';
    html += '<tr><th>Config hash / engine version</th><td colspan="2">' + escapeHtml(c.config_hash) + ' / ' + escapeHtml(c.engine_version) + '</td></tr>';
    html += '</table>';
    html += '<p class="explanation">Engine-generated explanation: ' + escapeHtml(c.explanation) + '</p>';
    html += '<p class="caveat-inline">This is a lead for archival research, not a record of a proven encounter. The place shown is geocoded to modern boundaries.</p>';
    panel.innerHTML = html;
  }

  function renderMap() {
    var svg = document.getElementById('map-svg');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var visible = visibleCandidates();
    var points = [];
    visible.forEach(function (c) {
      points.push({ lat: c.a_lat, lon: c.a_lon, radius: c.a_radius_km, color: branchColors[c.a_branch] || '#888', candidateId: c.candidate_id });
      points.push({ lat: c.b_lat, lon: c.b_lon, radius: c.b_radius_km, color: branchColors[c.b_branch] || '#888', candidateId: c.candidate_id });
    });
    if (points.length === 0) return;
    var lats = points.map(function (p) { return p.lat; }), lons = points.map(function (p) { return p.lon; });
    var minLat = Math.min.apply(null, lats), maxLat = Math.max.apply(null, lats);
    var minLon = Math.min.apply(null, lons), maxLon = Math.max.apply(null, lons);
    var padLat = Math.max((maxLat - minLat) * 0.15, 0.05), padLon = Math.max((maxLon - minLon) * 0.15, 0.05);
    minLat -= padLat; maxLat += padLat; minLon -= padLon; maxLon += padLon;
    var width = 760, height = 520;
    var midLatRad = ((minLat + maxLat) / 2) * Math.PI / 180, kmPerDegLon = 111.32 * Math.cos(midLatRad);

    function projectX(lon) { return (lon - minLon) / (maxLon - minLon) * width; }
    function projectY(lat) { return height - (lat - minLat) / (maxLat - minLat) * height; }
    function radiusPx(km) { var degLon = km / (kmPerDegLon || 1); return Math.max(2, degLon / (maxLon - minLon) * width); }

    visible.forEach(function (c) {
      var line = document.createElementNS(SVG_NS, 'line');
      line.setAttribute('x1', projectX(c.a_lon)); line.setAttribute('y1', projectY(c.a_lat));
      line.setAttribute('x2', projectX(c.b_lon)); line.setAttribute('y2', projectY(c.b_lat));
      line.setAttribute('class', 'link' + (c.candidate_id === selectedId ? ' link-selected' : ''));
      line.addEventListener('click', function () { selectCandidate(c.candidate_id); });
      svg.appendChild(line);
    });
    points.forEach(function (p) {
      var cx = projectX(p.lon), cy = projectY(p.lat);
      var uncertainty = document.createElementNS(SVG_NS, 'circle');
      uncertainty.setAttribute('cx', cx); uncertainty.setAttribute('cy', cy); uncertainty.setAttribute('r', radiusPx(p.radius));
      uncertainty.setAttribute('class', 'uncertainty-circle'); uncertainty.style.stroke = p.color;
      uncertainty.addEventListener('click', function () { selectCandidate(p.candidateId); });
      svg.appendChild(uncertainty);
      var dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.setAttribute('r', 3.5);
      dot.setAttribute('class', 'centroid-dot' + (p.candidateId === selectedId ? ' centroid-selected' : ''));
      dot.style.fill = p.color;
      dot.addEventListener('click', function () { selectCandidate(p.candidateId); });
      svg.appendChild(dot);
    });
  }

  function renderAll() { renderList(); renderEvidence(); renderMap(); }

  renderMeta(); renderDecadeFilter(); renderBranchKey(); renderAll();
})();`;

const HTML_TEMPLATE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>Samesoil candidate report</title>
<style>
  :root { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 0; background: #f7f5f0; color: #1a1a1a; }
  .caveat-banner { position: sticky; top: 0; z-index: 10; background: #7a1f1f; color: #fff; padding: 10px 16px; font-size: 13px; line-height: 1.4; }
  .layout { display: flex; gap: 16px; padding: 16px; align-items: flex-start; flex-wrap: wrap; }
  .sidebar { width: 300px; flex-shrink: 0; }
  .main { flex: 1; min-width: 360px; }
  .panel { background: #fff; border: 1px solid #ddd; border-radius: 6px; padding: 12px; margin-bottom: 16px; }
  .candidate-row { display: flex; justify-content: space-between; gap: 8px; padding: 6px 8px; cursor: pointer; border-radius: 4px; font-size: 13px; }
  .candidate-row:hover { background: #f0eee6; }
  .candidate-row.selected { background: #dfe7ff; font-weight: 600; }
  .rank { color: #888; width: 36px; }
  .names { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .score { font-variant-numeric: tabular-nums; }
  .decade-toggle { display: inline-block; margin: 2px 8px 2px 0; font-size: 13px; }
  .branch-row { display: flex; align-items: center; gap: 6px; font-size: 13px; margin-bottom: 4px; }
  .swatch { width: 12px; height: 12px; border-radius: 2px; display: inline-block; }
  svg#map-svg { width: 100%; height: auto; background: #eef2f5; border: 1px solid #ccc; border-radius: 4px; }
  .uncertainty-circle { fill: none; stroke-width: 1.5; opacity: 0.55; }
  .centroid-dot { stroke: #222; stroke-width: 0.5; cursor: pointer; }
  .centroid-selected { stroke: #000; stroke-width: 2; }
  .link { stroke: #999; stroke-width: 1; stroke-dasharray: 3 2; cursor: pointer; }
  .link-selected { stroke: #333; stroke-width: 2; stroke-dasharray: none; }
  table.evidence-table { width: 100%; border-collapse: collapse; margin-bottom: 12px; font-size: 13px; }
  table.evidence-table th, table.evidence-table td { border: 1px solid #ddd; padding: 4px 6px; text-align: left; vertical-align: top; }
  .caveat-inline, .explanation { font-size: 12px; color: #7a1f1f; }
  .truncation-note { font-size: 12px; color: #7a1f1f; margin-top: 6px; }
  h1, h2, h3 { margin-top: 0; }
  #list-count, #report-meta { font-size: 12px; color: #666; }
</style>
</head>
<body>
<div class="caveat-banner">
  Places shown are geocoded to modern administrative boundaries, not the boundaries that existed at the time of the recorded event. Every candidate below is a research lead worth checking against primary sources \u2014 none of them is a proven encounter. The score is a ranking signal only, never a probability or percentage confidence that two people actually met.
</div>
<div class="layout">
  <div class="sidebar">
    <div class="panel">
      <h2>Samesoil candidates</h2>
      <p id="report-meta"></p>
    </div>
    <div class="panel">
      <h3>Decade filter</h3>
      <div id="decade-filter"></div>
    </div>
    <div class="panel">
      <h3>Ancestral branch key</h3>
      <div id="branch-key"></div>
    </div>
    <div class="panel">
      <h3>Ranked candidates</h3>
      <div id="list-count"></div>
      <div id="candidate-list"></div>
    </div>
  </div>
  <div class="main">
    <div class="panel">
      <h3>Approximate locations (coordinate-plotted; no basemap imagery, no network)</h3>
      <svg id="map-svg" viewBox="0 0 760 520" xmlns="http://www.w3.org/2000/svg"></svg>
      <p class="truncation-note" id="truncation-note"></p>
    </div>
    <div class="panel" id="evidence-panel"></div>
  </div>
</div>
<script id="samesoil-data" type="application/json">__DATA_JSON__</script>
<script>__CLIENT_JS__</script>
</body>
</html>
`;

function renderReportHtml(
  rows: ReadonlyArray<ExportRow>,
  totalCount: number,
  cap: number,
  truncated: boolean,
  branchOf: (id: number) => { readonly label: string },
  branchColors: ReadonlyMap<string, string>,
  relationshipOf: (a: number, b: number) => string,
  generatedAt: string,
  configHash: string,
  engineVersion: string,
): string {
  const candidates = rows
    .filter((row) => row.a_lat !== null && row.a_lon !== null && row.b_lat !== null && row.b_lon !== null)
    .map((row) => ({
      candidate_id: row.candidate_id, score: Number(row.score.toFixed(6)), decade: decadeOf(row.overlap_start),
      a_name: row.a_name ?? `Individual ${row.a_id}`, a_event_type: row.a_event_type, a_date_raw: row.a_date_raw, a_place_raw: row.a_place_raw,
      a_place_label: row.a_place_label, a_lat: row.a_lat, a_lon: row.a_lon, a_radius_km: row.a_radius_km, a_precision_tier: row.a_precision_tier, a_branch: branchOf(row.a_id).label,
      b_name: row.b_name ?? `Individual ${row.b_id}`, b_event_type: row.b_event_type, b_date_raw: row.b_date_raw, b_place_raw: row.b_place_raw,
      b_place_label: row.b_place_label, b_lat: row.b_lat, b_lon: row.b_lon, b_radius_km: row.b_radius_km, b_precision_tier: row.b_precision_tier, b_branch: branchOf(row.b_id).label,
      overlap_start: row.overlap_start, overlap_end: row.overlap_end, overlap_days: row.overlap_days, temporal_relation: row.temporal_relation, temporal_gap_days: row.temporal_gap_days,
      distance_km: Number(row.distance_km.toFixed(3)), combined_radius: Number(row.combined_radius.toFixed(3)),
      s_proximity: Number(row.s_proximity.toFixed(6)), s_temporal: Number(row.s_temporal.toFixed(6)), s_temporal_proximity: Number(row.s_temporal_proximity.toFixed(6)),
      s_date_precision: Number(row.s_date_precision.toFixed(6)), s_precision: Number(row.s_precision.toFixed(6)), s_confidence: Number(row.s_confidence.toFixed(6)),
      s_unrelatedness: Number(row.s_unrelatedness.toFixed(6)), s_independence: Number(row.s_independence.toFixed(6)),
      relationship_summary: relationshipOf(row.a_id, row.b_id), config_hash: row.config_hash, engine_version: row.engine_version, explanation: row.explanation,
    }));
  const payload = {
    meta: { generatedAt, totalCandidates: totalCount, embeddedCandidates: candidates.length, truncated, cap, configHash, engineVersion },
    branchColors: Object.fromEntries(branchColors),
    candidates,
  };
  const dataJson = JSON.stringify(payload).replace(/</g, "\\u003c");
  return HTML_TEMPLATE.replace("__DATA_JSON__", dataJson).replace("__CLIENT_JS__", CLIENT_JS);
}

export async function run(ctx: EngineContext): Promise<void> {
  const pass = "export", started = ctx.env.now();
  ctx.progress.passStarted(pass);

  const rows = ctx.storage.all<ExportRow>(EXPORT_QUERY);
  const people = new Map(ctx.storage.all<IndividualNameRow>("SELECT id,name_full,name_surname,gedcom_xref FROM individuals ORDER BY id").map((row) => [row.id, row]));
  const graph = loadKinshipGraph(ctx.storage);
  const branchOf = buildBranchAssigner(graph, people, ctx.config.kinship.bfs_max_depth);
  const kinship = createKinshipService(ctx);
  const relationshipOf = (aId: number, bId: number): string => kinship.summary(aId, bId);

  const cap = ctx.config.scoring.max_candidates, truncated = rows.length > cap, embedded = truncated ? rows.slice(0, cap) : rows;

  const branchLabels = new Set<string>();
  for (const row of embedded) { branchLabels.add(branchOf(row.a_id).label); branchLabels.add(branchOf(row.b_id).label); }
  const branchColors = assignBranchColors(branchLabels);

  const candidatesCsv = renderCandidatesCsv(rows, relationshipOf);
  const geojson = renderGeoJson(embedded, branchOf, truncated, cap);
  const branchIntersections = renderBranchIntersections(embedded, branchOf);
  const reviewQueue = renderReviewQueue(ctx);
  const reportHtml = renderReportHtml(embedded, rows.length, cap, truncated, branchOf, branchColors, relationshipOf, ctx.env.now(), ctx.configHash, ctx.config.engine_version);

  await ctx.artifactSink.write("candidates.csv", candidatesCsv);
  await ctx.artifactSink.write("candidates.geojson", geojson);
  await ctx.artifactSink.write("report.html", reportHtml);
  await ctx.artifactSink.write("branch_intersections.md", branchIntersections);
  await ctx.artifactSink.write("review_queue.csv", reviewQueue);

  ctx.progress.passFinished(pass, {
    rows_in: rows.length,
    rows_embedded_in_report: embedded.length,
    truncated,
    cap,
    distinct_branches: branchLabels.size,
    review_queue_rows: reviewQueue.split("\n").length - 2,
    elapsed_ms: elapsed(started, ctx.env.now()),
  });
}
