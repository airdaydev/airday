// Merkle-tree-like checksum tree
// for verification of sync tree, time bucketed
// Limitations: Not currently verifying content
// only quasi-verifying last server timestamp + count
// Checksum collisions are possible

const dayLike = 100_000_000; // 24 * 3600 * 1000 (nearest {5,1}x10^x) (86_400_000)
const monthLike = 5_000_000_000; // 30 * 24 * 3600 * 1000, 1<x<2 months approx
const yearLike = 50_000_000_000; // 365 * 24 * 3600 * 1000 (nearest {5,1}x10^x) (31_536_000_000)

enum NodeType {
  Day,
  Month,
  Year,
}

class ChecksumNode {
  type?: NodeType;
  index: number;
  checksum?: number;
  constructor(index: number) {
    this.index = index;
  }
}

class YearNode extends ChecksumNode {
  type = NodeType.Year;
  children = new Map<number, MonthNode>();
}

class MonthNode extends ChecksumNode {
  type = NodeType.Month;
  children = new Map<number, DayNode>();
}

class DayNode extends ChecksumNode {
  type = NodeType.Day;
  checksum: number;
  constructor(index: number, checksum: number) {
    super(index);
    this.checksum = checksum;
  }
}

// TODO: days + daysTouched could potentially be combined (where the whole object is full of non-committed days)
export class ChecksumStore {
  // Pending changes
  daysTouched = new Map<number, DayNode>(); // quick access (TODO: is this necessary...? think about usage patterns when done)
  // Multi-level index - todo; maybe just make this a more traditional tree with this as the root node
  years = new Map<number, YearNode>();
  reset = () => {
    this.daysTouched = new Map<number, DayNode>();
    this.years = new Map<number, YearNode>();
  };
  clearDay(dayMs: number) {
    if (this.dirty) {
      throw new Error("can't clear days while there are pending changes");
    }
    const result = this.getDay(dayMs);
    if (result) {
      result.monthNode.children.delete(dayMs);
      if (!result.monthNode.children.size) {
        result.yearNode.children.delete(result.monthNode.index);
        if (!result.yearNode.children.size) {
          this.years.delete(result.yearNode.index);
        }
      }
    }
  }
  getDay(dayMs: number) {
    const month = Math.floor(dayMs / monthLike) * monthLike;
    const year = Math.floor(dayMs / yearLike) * yearLike;
    const yearNode = this.years.get(year);
    if (yearNode) {
      const monthNode = yearNode.children.get(month);
      if (monthNode) {
        const dayNode = monthNode.children.get(dayMs);
        if (dayNode) {
          return {
            dayNode,
            monthNode,
            yearNode,
          };
        }
      }
    }
    return false;
  }
  get dirty() {
    return this.daysTouched.size > 0;
  }
  // Expects every entry for that day, and validates that they are for that day!
  insertDay(dayMs: number, usecs: number[]) {
    if (!usecs.length) {
      console.warn("dayMs called without a value");
      return;
    }
    if (dayMs % dayLike !== 0) {
      throw new Error("unaligned day!");
    }
    const checksum = usecs.reduce((xor, usec) => {
      const ms = usec / 1000;
      const day = Math.floor(ms / dayLike) * dayLike;
      if (day !== dayMs) {
        throw new Error(
          `${usec} does not belong in day ${dayMs} in checksum index`,
        );
      }
      return xor ^ usec;
    }, 0);
    this.daysTouched.set(dayMs, new DayNode(dayMs, checksum));
  }
  commit() {
    let monthsTouched = new Set<MonthNode>();
    let yearsTouched = new Set<YearNode>();
    // Calculate checksum for each month
    this.daysTouched.forEach((node, dayMs) => {
      // Set or get year
      const year = Math.floor(dayMs / yearLike) * yearLike;
      const yearEntry = this.years.get(year);
      let yearNode = yearEntry || new YearNode(year);
      if (!yearEntry) {
        this.years.set(year, yearNode);
      }
      yearsTouched.add(yearNode);

      // Set or get month
      const month = Math.floor(dayMs / monthLike) * monthLike;
      const monthEntry = yearNode.children.get(month);
      const monthNode = monthEntry || new MonthNode(month);
      monthNode.children.set(dayMs, this.daysTouched.get(dayMs)!);
      if (!monthEntry) {
        yearNode.children.set(month, monthNode);
      }
      monthsTouched.add(monthNode);
    });

    monthsTouched.forEach((month) => {
      month.checksum = Array.from(month.children.values()).reduce(
        (xor, dayNode) => {
          if (typeof dayNode.checksum !== "number") {
            console.log(dayNode);
            throw new Error("Missing day checksum");
          }
          return xor ^ dayNode.checksum;
        },
        0,
      );
    });
    yearsTouched.forEach((year) => {
      year.checksum = Array.from(year.children.values()).reduce(
        (xor, monthNode) => {
          if (typeof monthNode.checksum !== "number")
            throw new Error("Missing month checksum");
          return xor ^ monthNode.checksum;
        },
        0,
      );
    });
    this.daysTouched.clear();
  }
  diffYears() {}
  diffMonths() {}
  diffDays() {}
}
