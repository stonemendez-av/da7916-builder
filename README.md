# DA 7916 TDH Card Builder

Turns a ForeFlight NavLog PDF into a filled **DA Form 7916, Army Aviation Time Distance and Heading Card**.

Live site: enable GitHub Pages for this repo (Settings > Pages > Deploy from branch > `main` / root).

## How to use
1. Upload the NavLog PDF from ForeFlight.
2. Enter Operation, Aircraft Fuel, Burn (lbs/hr), Fuel to Alternate, and confirm VFR/IFR (auto-detected from the NavLog).
3. For each point, pick the WP type and number/name, enter DTD ID, IAS (use "IAS for all" to fill quickly) and remarks, and type the MGRS grid. The card can't be built until every grid is valid.
4. Build, preview, and download the filled card. Clock is left blank for in-flight use.

Everything runs in the browser. No file is uploaded anywhere.

## Where each value comes from
| 7916 box | Source |
|---|---|
| Operation | User |
| Route | ForeFlight Route line points, using the MGRS you entered (editable) |
| Aircraft Fuel | User |
| Req | ForeFlight Flight Fuel |
| Burn | User (lbs/hr) |
| Bingo | Req + Fuel to Alternate + Reserve (Burn x 20 min VFR / 30 min IFR) |
| From / To | First / last waypoint MGRS |
| Time Enroute / Total Distance | ForeFlight Summary & Times ETE / Distance |
| WP | User: SP, ACP, CP, RP + number; LZ + bird name; PZ + tree name. Each number/name used once per type |
| DTD ID, IAS, Remarks | User |
| TCA | ForeFlight MAG HDG |
| MC | ForeFlight MAG CRS |
| ALT | ForeFlight ALT |
| Tank Fuel | Row 1 = Aircraft Fuel, then previous Tank Fuel minus that leg's Min Fuel |
| Min Fuel | Burn x leg time |
| ETE | ForeFlight TIME LEG (time for that leg) |
| Elapsed | ForeFlight ETE (running total) |
| Leg Dist / Rem | ForeFlight DIST NM LEG / REM |
| GS | ForeFlight GS |
| MGRS Grid | User (required). The ForeFlight coordinate is shown only as a reference |
| Lat Long | Converted back from the MGRS grid (center of the grid square) |
| Clock | Left blank |

Each waypoint row carries the leg flown into that waypoint, matching ForeFlight's layout.

## Limits
- MGRS is always typed in by hand. ForeFlight rounds coordinate waypoint names to the nearest minute (up to about 0.5 NM off), which is too coarse for the card.
- LZ bird names and PZ tree names start from a default list you can edit under Card options.
- 22 waypoints fit on the two-page form and stay editable. Longer routes add continuation pages and the fields are locked.

Not an official Army product. Verify every value before flight.

## Libraries (vendored in `lib/`)
pdf.js (Apache-2.0), pdf-lib (MIT), mgrs (MIT). The blank DA 7916 in `assets/` is the official form with its open-permission encryption removed so it can be filled.
