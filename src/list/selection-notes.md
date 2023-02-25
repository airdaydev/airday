## List navigation interaction design
- on key down, select next down from last selected, set last selected, origin
- on key up, select next down from last selected, set last selected, origin
- on key down + shift, when moving towards selection origin i.e. above origin, deselect
- on key down + shift, when moving away from selection origin i.e. below origin, find next unselected below and select
- on key up + shift, when moving towards selection origin i.e. below origin, deselect
- on key up + shift, when moving away from selection origin i.e. above origin, find next unselected above and select
- on click, deselect all, add one to selection & set selection origin
- on cmd + click, if selected, deselect item, if multiple selected, set selection origin to nearest (LOADED term)
- on cmd + click, if unselected, select item and make selection origin
- on shift+click, if nothing else selected, select one and set selection origin
- on shift+click, if something else selected, make single contiguous region from top most selected to item selected (See shift+click notes)
- on cmd + a, select all, select origin at index 0
- on escape, deselect all
- on option + up, jump to top of list
- on option + down, jump to bottom of list
- on cmd + up, move selected range up, if none selected do nothing
- on cmd + up, move selected range down, if none selected do nothing

TODO: Mention extents behaviour

## Shift+click notes:
- MacOS finder, Postico in list mode retains movement from origin, when combining with other regions, retains the origin
- Things 3 continues to expand the region from its extents - filling in gaps to create a single contiguous area, when shift clicking INSIDE the list when there is one region, it makes one region from the highest most selected region to the selection clicked. I think Things feels better, even though you get more control with MacOS - I have to think more to understand. afaik no one is really going that hard on careful selection with shift - it's a blunt hammer. you line up your actions, commit them then move on. Things is still weird because it's down-skewed i.e. asymmetric - but it is pretty complex to make it symmetric (basically shift+click doesnt respect origin in things, but shift+up/down does)
- Tidal tracks list ignores other selected items

TODO: Test what happens when list contents changes during selection, consider both perf and ux

## List actions (TODO)
- Delete, move etc