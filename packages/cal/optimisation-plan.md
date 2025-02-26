## Weekly calendar rendering:
1. Create worker pool
2. Start main loop
3. Respond to events (e.g. click events, foreign state updates) and apply updates to data model (e.g. item has been selected)
4. If day affected by event is in visible clipspace, mark it as dirty
5. When worker is ready (via promise with trx id), send next batch (been collecting while workers are busy)
5a. Optionally, or indepedently! recalculate layout - required if no layout exists obviously!
6. Rerender areas of day affected, pass back tiles (512x512) to main thread for rendering in next loop
6a. Can we prioritise onscreen tiles?
6b. prevent tile rerendering if tile content hasn't changed nor viewport has moved

- Consider a two-level cache: memory for recent tiles, IndexedDB for persistence
- Measure first then consider tracking & reduce serialisation overhead between workers

Further notes
- canvas layers @4k are no bueno - instant hit on fps - hmm second guess this with hardware accel (z:0)
- consider progressive rendering! (measure & get a feel)
- consider rendering all rectangles first, then text, ability to discard clipped regions - possibly too hard

- will consider webgl after release, even if i cannot implement sound 60fps rendering for certain actions

## Measurement & profiling
- add performance markers throughout
create a debug visualisation of tile states
