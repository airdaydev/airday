## @airday/cal

Calendar front-end powering Airday's calendar - single canvas for main board with a native scroll container, DOM for overlays etc

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

## Interactions
- [x] Solidify clipspace api
- [x] Quadtree collision detection (wip)
- [x] Try to massively optimise by rendering on main thread cluster at a time, using native cal transform to move (not worth it, draw calls too exxy - webgpu/gl the path)
- [] hover style for events
- [] hover style optimisation - we can discard z vals above current and/or clip render
- [] drag to highlight neat area (15min factor) (to create new event)
- [] tap to highlight neat 15min interval (to create new event)
- [] "Day" view highlights today, must have minimum size
- [] Drag and drop calendar events
- [] Click/drag to shorten/lengthen event each direction
- [] Labels that register as objects with behaviour

## Polish
- [] Items over 24hrs long get put in day area
- [] Tap to highlight day area
- [] Change time zone
- [] Add time zone
- [] custom scroller, snap to date or week when active scrolling stops
- [] Hover over date to see full date
- [] Jump to date/today button
- [] Move between weeks/days
- [] Month/Year that shows up on pan
- [] Change between 12/24hr time
- [] word wrap event
- [] buffer events to the left too
- [] Transform cleanup

## Data
- [] Repeating events
- [] Overwriting repeated events (fuck)
- [] Events falling on DST borders... events disappearing in different zones?
- [] Add all day events
- [] Expand all day events

## final optimisations / quality udpates
- [] event/worker tests
- [] Tile vertically, even horizontally if needed
- [] only re-render interaction day that changes (as opposed to spitting bmps again)

## Future plans
- [] True monthly view

## Handling concurring events UI
- Simplest is side by side (create groups of overlapping events & split side-by-side)
- X calendar's is graceful but complex (focuses on ensuring left bar - i.e. event length & top line i.e. first part of)
- Y's is less graceful, still complex (uses transparency to do the same thing)

Rules:
- 1 event = entire width
- 2 same events = split 50/50
- 3 same events = split 1/3
- 4 same events = split 1/4
- etc
- z-index = left is lowest, right is highest
- left-most precedence = earlier start time, longer event

# Algorithm for predictable, fast positioning
1. optimisation (maybe) ~~group any intersecting events.~~
2. within group, sort by, in precedence, earliest start time, then longest event, then id
3. if no segment, place as width 100%
4. if intersects by time, but not header, place at first available segment from left, creating new if needed
5. if header intersects, place from left to right, equidistantly (creating new horizontal segment)

# After assimilating information
1. Preparation. Sort earliest start time, then longest event, then id.
2. From segment 1, check if there is an intersecting event, if not place event in segment, if yes, go to next segment

## Optimisations
- If event does intersect but not with header (above or below), and all segment parents have not already had this, it may sit closely to previous segment
- If events intersects at header, events should reduce width

## Cache strategy noting timezones
UTC interval tree
Origin date: UTC
Offset +- add/subtract date, not hours!

GetTZOffset for UTC time and subtract to get relevant range and also display dates
e.g. UTC = 00:00 = 11:00 - tzOffset = 00:00 local TZ

for cache, index in localTZ day start, because this aligns with our day display




# UX optimisation in xcal
* the first encounter will push the event a fixed length (3ish em (or 2px in week view)) away. But any further nesting will divide into segments.

# Observations
- Events with no intersects take up entire width
- Events with an intersect takes up 12em or whatever is available to the right
- Overall layout is deterministic (doesn't jump around with same data)
- earliest start time is first
- shortest last
- in cal x, the distribution is left-skewed
- NO time intersections on same segment
