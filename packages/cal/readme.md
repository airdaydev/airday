## @airday/cal

Calendar front-end powering Airday's calendar - DOM backed vanilla JS. Currently monthly view only. Plans to port to WGPU/GL for desktop/mobile view.

## Roadmap
- [x] Idle render check to save battery etc
- [x] cal event y position
- [x] strip solidjs
- [x] single canvas element, laid out properly
- [x] use clip instead of backgrounds for covering sections not meant to be rendered!
- [x] scroll x position: start by getting week / day width
- [x] Use off screen canvas + transform for events
- [x] Optimise performance (layering, retaining buffer etc)
- [x] Show current time
- [x] scroll beyond borders
- [x] 1-day, 3-day, 7-day, 14-day view
- [x] Correctly placing items in cache based on tz (note dst)
- [x] Event position incl. intersecting events
- [x] Event colour schemes (light/dark)
- [x] Event colours (blue, yellow, red etc)
- [x] Event intersection / clustering fixes
- [x] Distinct TODAY label style
- [x] Confirm event dates are correct
- [x] Rollover event bug (not starting at x = 0)
- [x] Last simultaneous event bug (starting at x = 0)
- [x] Resizing calendar retains same middle via offset change
- [x] Bug: Layout edge case - final events in each cluster can still start at x = dayWidth
- [x] Run through rendering optimisation plan
- [x] Solidify clipspace api
- [x] Quadtree collision detection (wip)
- [x] Try to massively optimise by rendering on main thread cluster at a time, using native cal transform to move (not worth it, draw calls too exxy - webgpu/gl the path)
- [x] hover style for events
- [x] Remove canvas events layer
- [x] Establish DOM events layer
- [x] Kill canvas layer & simplify mathematics
- [x] Fix DOM resize issues (translate/change width for each day)
- [x] Correct theme colours
- [x] Render empty days immediately, then events
- [x] Use UTC date + day integer offset for all fundamental calculations, in general, clean up date calcs
- [x] Sat/Sunday shading, have to move gridlines to each date
- [x] All-day events section spacing, additional gridlines
- [x] Change number of days to render via tweakpane
- [x] Horizontal sizing and positioning correct (adjust due to time col)
- [x] Bug when changing day count to 1 causes scroll offset to move to far left, then future positions to be incorrect
- [x] Bug is due to lack of cleanup! - need to remove day els not in view or they will extend way beyond view
- [x] Mock some 24hr events too
- [x] Limit height of event containers - while allowing shading of weekend to extend to very bottom of cal
- [x] Today date label style
- [x] Correct now line (move to time container)
- [x] Make layout calcs faster, calculate multiple at a time (fuck yes)
- [x] All-day events +24hr events system!
- [x] Items over 24hrs long get moved into all-day event
- [x] All-day events shouldn't rerender every animation frame, only when window (or data) has changed
- [x] All-day event layout calcs offloaded to worker
- [x] word wrap event for longer events
- [x] buffer events to the left too
- [x] Move now marker line back into events container as in the mornings it rises above the cal header
- [x] All-day view expands & contracts to arbitrary height px
- [x] Consider placing event count in pre-existing space to avoid having to give each event count dayPx width (haven't done this but have added a TODO)
- [x] All-day expanded rendering
- [x] All-day expanded rendering: select events in view only
- [] Expanded layout bug disappears events
- [] Expanded layout bug does not fill space efficiently (places contiguous events on next lane)
- [] Move corrected expanded all-day layout to worker
- [] Click button or event count label to expand & contract all-day view
- [] All-day: Update not if dates change, but if data changes
- [] Expand all day events if there are multiple
- [] Worker fix in built version
- [] Jump to date/today button in tweakpane
- [] Filter by multiple calendars, colour

## Cal Interactions
- [] hover style event extends to next day as needed
- [] Dragging 24hr events left/right
- [] Dragging 24hr events start/finish
- [] Click event to select / bring to front
- [] Drag and drop calendar events
- [] tap to highlight neat 15min interval (to create new event)
- [] drag to highlight new area (15min factor) (to create new event)
- [] Click/drag to shorten/lengthen event each direction
- [] Click/Context click consumer events
- [] Drag (+ shift) on blank area to multiselect

## All-day events
- [] Move between weeks/days with a button
- [] Month/Year that shows up on pan

## Times & time zones
- [] Change between 12/24hr time
- [] Change time zone
- [] Add time zone
- [] Events falling on DST borders... events disappearing in different zones?

## Repeating events
- [] Repeating events
- [] Overwriting repeated events (fuck)

## Orientation
- [] Consider: Hover over date to see full date ?
- [] Maybe show month (3 day version) for every monday, and every 1st, so context is extremely obvious

## final optimisations / quality udpates / future plans
- [] Bug: Sometimes the overflow events first thing in the morning sit above succeeding events
- [] UX: Reconsider ALL events extending entire grid; consider opposite.
- [] event/worker tests
- [] True monthly, annual view
- [] Multi-select events with single click
- [] custom scroller, snap to date or week when active scrolling stops
- [] Scroll snap type (?)

## Future: Port to webgpu
