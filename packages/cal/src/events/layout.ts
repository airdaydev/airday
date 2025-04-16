import { getTime, localZeroDate, timeToY } from "../time";

export interface EventLayout {
  id: string;
  startTime: number;
  endTime: number;
  width: number;
  height: number;
  x: number;
  y: number;
  startsToday: boolean;
  segment: number;
  cluster: number;
  displayText: string;
  displayTime: string;
  color: string;
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
      startTime,
      endTime,
      width: 0, // unset yet
      height,
      x: 0, // unset yet
      y,
      startsToday,
      segment,
      cluster,
      displayText: `${event.title};c${cluster};s${segment}`,
      displayTime: getTime(event.start),
      color: event.color,
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
