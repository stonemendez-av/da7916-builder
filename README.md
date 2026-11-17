# DA 7916 TDH Card Builder

Turns a ForeFlight NavLog PDF into a filled **DA Form 7916, Army Aviation Time Distance and Heading Card**.

Live site: enable GitHub Pages for this repo (Settings > Pages > Deploy from branch > `main` / root).

## How to use
1. Upload the ForeFlight NavLog PDF, and the ForeFlight Mobile NavLog PDF if you have it (either order, or both at once).
2. Enter Operation, Aircraft Fuel, Burn (lbs/hr), Fuel to Alternate, and confirm VFR/IFR (auto-detected from the NavLog).
3. For each point, pick the WP type and number/name, enter DTD ID, IAS (use "IAS for all" to fill quickly) and remarks, and type the MGRS grid. The card can't be built until every grid is valid.
4. Build, preview, and download the filled card. Clock is left blank for in-flight use.

Everything runs in the browser. No file is uploaded anywhere.

## Where each value comes from
| 7916 box | Source |
|---|---|
| Operation | User |
| Route | Every point between departure and destination, using the MGRS you entered (editable) |
| Aircraft Fuel | User |
| Req | ForeFlight Flight Fuel |
| Burn | User (lbs/hr) |
| Bingo | Req + Fuel to Alternate + Reserve (Burn x 20 min VFR / 30 min IFR) |
| From / To | First / last waypoint MGRS |
| Time Enroute / Total Distance | ForeFlight Summary & Times ETE / Distance |
| WP | Airports fill in as their identifier (KCOS). Otherwise user: SP, ACP, CP, RP + number; LZ + bird name; PZ + tree name. Each number/name used once per type |
| DTD ID, IAS, Remarks | User |
| TCA | Terrain clearance altitude: optional user entry, blank by default |
| MC | ForeFlight MAG CRS, printed with °M |
| ALT | ForeFlight ALT |
| Tank Fuel | Row 1 = Aircraft Fuel, then previous Tank Fuel minus that leg's Min Fuel |
| Min Fuel | Burn x leg time (to the second when the Mobile NavLog is loaded) |
| ETE | Leg time as min+sec (4+01). From the Mobile NavLog when loaded, else NavLog TIME LEG |
| Elapsed | Running total as min+sec (8+06; 1+02+30 past an hour). Mobile NavLog TOTALS when they show seconds, else the sum of leg times; NavLog ETE column without the Mobile NavLog |
| Leg Dist / Rem | ForeFlight DIST NM LEG / REM |
| GS | ForeFlight GS |
| MGRS Grid | Mobile NavLog grid when loaded, else user. Required for every point (airports always need one typed in) |
| Lat Long | Converted back from the MGRS grid (center of the grid square) |
| Clock | Left blank |

Each waypoint row carries the leg flown into that waypoint, matching ForeFlight's layout.

ForeFlight's -TOC- and -TOD- rows are dropped. Their segment is folded into the next real point's leg: LEG DIST and ETE span the whole leg (from REM and the running ETE), GS is averaged over the leg, and MC/TCA come from the longer segment.

## Mobile NavLog
The Mobile NavLog lists each point's exact MGRS and leg times with seconds, and has no TOC/TOD rows. The site pairs it leg by leg with the NavLog (after folding TOC/TOD) and checks that every point is within 2.5 km of the NavLog's rounded coordinate and that airport names match. If the files don't line up, it says so and uses the NavLog alone.

## Limits
- MGRS is always typed in by hand. ForeFlight rounds coordinate waypoint names to the nearest minute (up to about 0.5 NM off), which is too coarse for the card.
- LZ bird names and PZ tree names start from a default list you can edit under Card options.
- 22 waypoints fit on the two-page form and stay editable. Longer routes add continuation pages and the fields are locked.

Not an official Army product. Verify every value before flight.

## Libraries (vendored in `lib/`)
pdf.js (Apache-2.0), pdf-lib (MIT), mgrs (MIT). The blank DA 7916 in `assets/` is the official form with its open-permission encryption removed so it can be filled.
