import { CalendarEvent } from "../model";
import { localZeroDate, oneDayMs, timeToY, utcZeroDate } from "../time";

export interface EventLayout {
  id: string;
  width: number;
  height: number;
  x: number;
  y: number;
  startsToday: boolean;
  segment: number;
  cluster: number;
}

// class EventLayoutTransfer {
//   static pack(layout: EventLayout) {
//     return Object.keys(() => {

//     })
//   }
//   static unpack() {

//   }
// }

type DayLayoutMap = Map<string, EventLayout>;
export type Cluster = { minY: number; maxY: number; segments: number };

export interface DayLayout {
  map: DayLayoutMap;
  clusters: Cluster[];
}

/**
 * Gets layout for a whole day
 * Divides into clusters (of shared contiguous vertical space), and then horizontal segments
 * TODO: Check assumption that events have been sorted chronologically!
 */
export function calcDayLayout(
  events: any[],
  utcDate: number,
  hourHeight: number,
): DayLayout {
  const clip = localZeroDate(new Date(utcDate)).valueOf();
  const layoutMap = new Map<string, EventLayout>();
  const segPosMap = new Map<number, number>(); // segment, lastYPos
  function nextSegment(posY: number, height: number) {
    let i = 0; // segment number
    while (true) {
      const lastPos = segPosMap.get(i);
      // If segment is empty, or posY exists after last position in segment
      if (!lastPos || posY > lastPos) {
        segPosMap.set(i, posY + height);
        break;
      }
      i++; // go to next segment
    }
    return i;
  }

  let clusterIndex = 0;
  let clusterMinY: number | null = null; // maximum y position per cluster
  let clusterMaxY = 0; // maximum y position per cluster
  let maxSegments = 1;
  const clusters: Cluster[] = [];

  function nextCluster(posY: number, height: number, segment: number) {
    const maxY = posY + height; // maxY for this event
    maxSegments = Math.max(maxSegments, segment); // max segment count for this cluster
    if (clusterMinY === null) {
      clusterMinY = posY; // triggers for first cluster only
    }
    // condition checking next position is clear of previous, and we are passed the first cluster
    if (posY > clusterMaxY && clusterMaxY > 0) {
      // Reset & move
      maxSegments = 1;
      clusterMinY = posY;
      clusterIndex++;
    }
    clusterMaxY = Math.max(maxY, clusterMaxY); // maxY for cluster
    const newSegment = !clusters[clusterIndex];
    clusters[clusterIndex] = {
      minY: clusterMinY,
      maxY: clusterMaxY,
      segments: newSegment ? 1 : maxSegments + 1,
    };
    return clusterIndex;
  }

  const tomorrow = clip + 864e5;

  events.forEach((event) => {
    const startTime = event.start < clip ? clip : event.start;
    const endTime = event.end > tomorrow ? tomorrow : event.end;
    const height = Math.max((endTime - startTime) / 1000 / 60, 22);
    const y = timeToY(new Date(startTime), hourHeight);
    const startsToday = event.start > clip;
    const segment = nextSegment(y, height);
    const cluster = nextCluster(y, height, segment);
    layoutMap.set(event.id, {
      id: event.id,
      width: 0, // unset yet
      height,
      x: 0, // unset yet
      y,
      startsToday,
      segment,
      cluster,
    });
  });
  layoutMap.forEach((layout) => {
    const cluster = clusters[layout.cluster];
    const segmentSize = 1 / cluster.segments;
    const x = segmentSize * layout.segment;
    const width = cluster.segments == 1 ? 1 : 1 - x;
    Object.assign(layout, { width, x });
  });
  return {
    map: layoutMap,
    clusters,
  };
}

export function calcAllDayContracted(
  cache: Map<number, Set<CalendarEvent>>,
  dates: number[],
) {
  let trackedEvent: CalendarEvent | undefined; // Event we're looking at
  let trackedEventDates: number[] = []; // Each day that tracked event spans
  const events: (CalendarEvent & { dayLength: number })[] = []; // Each calendar event to render in full
  const labels = new Map<number, number>(); // date, event count to display (0 = no display)

  // Loop through dates
  dates.forEach((date) => {
    const dateVal = date.valueOf();
    const dateCache = cache.get(dateVal); // get date val
    const size = dateCache?.size || 0; // amount of events on each date
    labels.set(dateVal, size); // Assume that all dates have sizes, then removed when we replace with an event

    // Case 1: next date has no events, but there is an event tracked
    // No intersections, render this date & clear dates tracked so far
    if (size === 0 && trackedEvent) {
      events.push(
        Object.assign(trackedEvent, {
          dayLength: trackedEventDates.length,
        }),
      );
      trackedEvent = undefined;
      trackedEventDates.forEach((d) => {
        labels.set(d, 0);
      });
      trackedEventDates = [];
    }
    if (size === 1) {
      // no intersection possible
      const val = dateCache?.values().next().value as CalendarEvent;
      // Case 2: next date has 1 event, the tracked event, continue and store date
      if (trackedEvent && trackedEvent.id === val.id) {
        trackedEventDates.push(dateVal);
      }
      // Case 3: next date has 1 event, not the tracked event, render & start with swapped event
      // Note we can be sure that the event started today, as it would have intersected with an event previously
      if (trackedEvent && trackedEvent.id !== val.id) {
        events.push(
          Object.assign(trackedEvent, {
            dayLength: trackedEventDates.length,
          }),
        );
        trackedEventDates.forEach((d) => {
          labels.set(d, 0);
        });
        trackedEvent = val;
        trackedEventDates = [dateVal];
      }
      // Case 4: No tracked event
      // Case 4: One event; we start tracking it, if it started today
      if (
        !trackedEvent &&
        utcZeroDate(val.start).valueOf() === date.valueOf()
      ) {
        trackedEvent = val;
        trackedEventDates.forEach((d) => {
          labels.set(d, 0);
        });
        trackedEventDates = [dateVal];
      }
    }
    // Case 5: next date has multiple events - INTERSECTION
    if (size > 1) {
      // More than one date = reset
      trackedEvent = undefined;
      trackedEventDates = [];
    }
  });
  return {
    events,
    labels,
  };
}

interface ExpandedEventLayout extends CalendarEvent {
  id: string;
  startZero: number;
  endZero: number;
  durationDays: number;
}

export type ExpandedEventLayoutSet = ExpandedEventLayout[][];

// TODO: Reduce info passed to this
export function calcExpandedAllDayLayout(cache: Map<string, CalendarEvent>) {
  console.log("expandedcache", cache);
  // expanded view layout
  const arr = Array.from(cache.values())
    .map((event) => {
      const startZero = utcZeroDate(event.start).valueOf();
      const endZero = utcZeroDate(event.end).valueOf() + oneDayMs;
      const durationDays = (endZero - startZero) / oneDayMs;
      return Object.assign(event, {
        startZero,
        endZero,
        durationDays,
      });
    })
    .sort((a, b) => {
      return a.startZero - b.startZero;
    });
  console.log("arr", arr);
  // how many days
  const layoutMax: number[] = []; // max x per lane
  const layout: ExpandedEventLayoutSet = []; // lane, top to bottom
  arr.forEach((event) => {
    const laneIndex = layoutMax.findIndex(
      (max) => (event.startZero || 0) >= max,
    );
    const lane = laneIndex === -1 ? layoutMax.length : laneIndex;
    layoutMax[lane] = event.endZero;
    layout[lane] ? layout[lane].push(event) : (layout[lane] = [event]);
  });
  console.log("layout", layout);
  return layout;
}
