import { generateNKeysBetween } from "fractional-indexing";
import { GenericItem } from "./item";
import { createUniqueId } from "solid-js";

export const airItems = [
  "Airday",
  "Wrap handlebars with Cinelli wrap",
  "GET CAR SERVICED 02 xxxx xxxx",
  "https://openstax.org/details/books/precalculus-2e",
];

export const taskItems = ["Cosmos", "Zinnia", "Scabiosa", "Poppy"];

export function genTestData(listId: string, tasks: string[]): GenericItem[] {
  const count = 30000;
  const sortKeys = generateNKeysBetween(null, null, count);
  const dummyItems: GenericItem[] = [];
  for (let i = 0; i < count; i++) {
    const index = (i + tasks.length) % tasks.length;
    let sticker;
    dummyItems.push({
      id: createUniqueId(),
      content: tasks[index],
      sortKey: sortKeys[i],
      tsCreated: new Date(),
      tsDone: null,
      listId,
    });
  }
  return dummyItems;
}

// export function simulateNetwork(listId: string) {
//     const next = Math.random() * 10000;
//     const index = Math.round(airItems.length * Math.random());
//     setTimeout(() => store.insert({
//         id: nanoid(),
//         text: tasks[index],
//         sortKey: sortKeys[i],
//         tsCreated: (new Date()).toString(),
//         listId,
//     }))
// }
