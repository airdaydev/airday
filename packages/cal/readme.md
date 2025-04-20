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
- [] All-day events section spacing, additional gridlines
- [] Button to randomly create +24hr event in tweakpane starting at middle day
- [] All-day events +24hr events system!
- [] Items over 24hrs long get moved into all-day event
- [] Change number of days to render via tweakpane
- [] Expand all day events
- [] Scroll snap type
- [] Jump to date/today button
- [] Dragging 24hr events start/finish
- [] Dragging 24hr events left/right
- [] Limit height of event containers - while allowing shading of weekend to extend to very bottom of cal

## Cal Interactions
- [] hover style event extends to next day as needed
- [] Click event to select / bring to front
- [] Drag and drop calendar events
- [] tap to highlight neat 15min interval (to create new event)
- [] drag to highlight new area (15min factor) (to create new event)
- [] Click/drag to shorten/lengthen event each direction
- [] Click/Context click consumer events
- [] Drag (+ shift) on blank area to multiselect

## All-day events
- [] Tap to highlight day area (?)
- [] Hover over date to see full date
- [] Move between weeks/days
- [] Month/Year that shows up on pan
- [] word wrap event for longer events

## Times & time zones
- [] Change between 12/24hr time
- [] Change time zone
- [] Add time zone
- [] Events falling on DST borders... events disappearing in different zones?

## Repeating events
- [] Repeating events
- [] Overwriting repeated events (fuck)

## final optimisations / quality udpates / future plans
- [] buffer events to the left too
- [] event/worker tests
- [] True monthly view
- [] Multi-select events with single click
- [] custom scroller, snap to date or week when active scrolling stops

## Future: Port to webgpu
