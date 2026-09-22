import assert from"node:assert/strict";import test from"node:test";import{haversineKm,longitudeCellCount,longitudeNeighborSpan,temporalBucketNeighborSpan,wrapCell,wrappedLongitudeCell}from"../src/core/candidates.js";
test("ten-year temporal windows inspect two decade neighbors",()=>{assert.equal(temporalBucketNeighborSpan(3653),2)});
test("longitude cells wrap across the antimeridian",()=>{const step=1,count=longitudeCellCount(step),east=wrappedLongitudeCell(179.95,step),west=wrappedLongitudeCell(-179.95,step);assert.equal(wrapCell(east+1,count),west);assert.ok(haversineKm(0,179.95,0,-179.95)<12)});
test("high-latitude search expands rather than using a cosine floor",()=>{const count=longitudeCellCount(0.25);assert.ok(longitudeNeighborSpan(89,count)>10)});
