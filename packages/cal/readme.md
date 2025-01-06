## @airday/cal

Calendar front-end powering Airday's calendar - single canvas for main board with a native scroll container, DOM for overlays etc

## Roadmap
- [x] Idle render check to save battery etc
- [x] cal event y position
- [x] strip solidjs
- [x] single canvas element, laid out properly
- [x] use clip instead of backgrounds for covering sections not meant to be rendered!
- [x] scroll x position: start by getting week / day width
- [] Change time zone
- [] event text align top
- [] Events side-by-side
- [] custom scroller, snap to date or week when active scrolling stops
- [] Optimise performance (layering, retaining buffer etc)
- [] scroll beyond borders
- [] Render calendar events in correct position
- [] Distinct TODAY label style
- [] Hover over date to see full date
- [] Jump to date/today button
- [] Move between weeks/days
- [] Repeating events
- [] Overwriting repeated events (fuck)
- [] Events falling on DST borders... events disappearing in different zones?
- [] Quadtree collision detection
- [] Drag and drop calendar events
- [] Labels that register as objects with behaviour
- [] 1-day, 3-day, 7-day, 14-day view
- [] Change between 12/24hr time
- [] Click/drag to shorten/lengthen event each direction
- [] Add all day events
- [] Expand all day events

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

# Algorithm
1. group intersecting events.
2. within group, get first group of intersecting headers, sort by earliest start time, then longest event, place from left to right, equidistantly (creating segments)
3. get next group of intersecting headers, place at first horizontal segment from left without intersecting time, create new group if necessary*

# UX optimisation in xcal
* the first encounter will push the event a fixed length (3ish em (or 2px in week view)) away. But any further nesting will divide into segments.

# Observations
- Events with no intersects take up entire width
- Events with an intersect takes up 12em or whatever is available to the right
- Overall layout is deterministic (doesn't jump around with same data)
- earliest start time is first
- shortest last
- in cal x, the distribution is left-skewed

Segments
- NO time intersections on same segment

id or date created to resolve placement deterministically
