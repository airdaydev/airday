# >24hr events plan

- second cache
- Loop through all found events in current block, remove from current day, any event >24hr in length -> add to AllDayEvents cache/id cache
- For contracted layout, loop through current events in AllDayEvents and make a date:id map
- Clean up is just looping through cache and deleting events outside
- Layout is trickier when expanded, but similar to vertical layout but horizontal, i.e. for all 24hr events, sort by earliest, then longest. Earliest at the top, then if the next event intersects, place below, creating a second lane, for next event start at the top and find first lane with no intersection
