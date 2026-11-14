# DA 7916 TDH Card Builder

Turns a ForeFlight NavLog PDF into a filled **DA Form 7916, Army Aviation Time Distance and Heading Card**.

Live site: enable GitHub Pages for this repo (Settings > Pages > Deploy from branch > `main` / root).

## How to use
1. Upload the NavLog PDF from ForeFlight.
2. Enter Operation, Aircraft Fuel, Burn (lbs/hr), Fuel to Alternate, and confirm VFR/IFR (auto-detected from the NavLog).
3. For each waypoint, enter WP, DTD ID, IAS (use "IAS for all" to fill quickly), optional TCA and remarks. Check every MGRS grid.
4. Build, preview, and download the filled card. Clock is left blank for in-flight use.

Everything runs in the browser. No file is uploaded anywhere.

## Where each value comes from
| 7916 box | Source |
|---|---|
| Operation | User |
| Route | ForeFlight Route line, each point converted to MGRS (editable) |
| Aircraft Fuel | User |
| Req | ForeFlight Flight Fuel |
| Burn | User (lbs/hr) |
| Bingo | Req + Fuel to Alternate + Reserve (Burn x 20 min VFR / 30 min IFR) |
| From / To | First / last waypoint MGRS |
| Time Enroute / Total Distance | ForeFlight Summary & Times ETE / Distance |
| WP, DTD ID, IAS, TCA, Remarks | User |
| MC | ForeFlight MAG CRS |
| ALT | ForeFlight ALT |
| Tank Fuel | Row 1 = Aircraft Fuel, then previous Tank Fuel minus that leg's Min Fuel |
| Min Fuel | Burn x leg time |
| ETE | ForeFlight TIME LEG (time for that leg) |
| Elapsed | ForeFlight ETE (running total) |
| Leg Dist / Rem | ForeFlight DIST NM LEG / REM |
| GS | ForeFlight GS |
| MGRS Grid | Converted from the waypoint coordinate name (editable) |
| Lat Long | Converted back from the MGRS grid (center of the grid square) |
| Clock | Left blank |

Each waypoint row carries the leg flown into that waypoint, matching ForeFlight's layout.

## Limits
- ForeFlight names coordinate waypoints to the nearest minute (e.g. `3940N10437W`), so auto MGRS can be off by up to about 0.5 NM. Verify against your map.
- Named fixes (airports, VORs, named user waypoints) have no coordinates in the NavLog PDF; the site asks you to type their MGRS.
- 22 waypoints fit on the two-page form and stay editable. Longer routes add continuation pages and the fields are locked.

Not an official Army product. Verify every value before flight.

## Libraries (vendored in `lib/`)
pdf.js (Apache-2.0), pdf-lib (MIT), mgrs (MIT). The blank DA 7916 in `assets/` is the official form with its open-permission encryption removed so it can be filled.
