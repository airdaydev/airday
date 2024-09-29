import { generateNKeysBetween } from "fractional-indexing";
import { GenericItem } from "./loader";
import { createUniqueId } from "solid-js";

export const sunlistItems = [
  "Sunlist",
  "Wrap handlebars with Cinelli wrap",
  "GET CAR SERVICED 02 xxxx xxxx",
  "https://openstax.org/details/books/precalculus-2e",
];

export const inboxItems = [
  "Banana",
  "FastAI Course",
  "Seguir viendo la casa de papel desde temporada 4",
  "Bug",
];

export function genTestData(listId: string, tasks: string[]): GenericItem[] {
  const count = 30000;
  const sortKeys = generateNKeysBetween(null, null, count);
  const dummyItems: GenericItem[] = [];
  for (let i = 0; i < count; i++) {
    const index = (i + tasks.length) % tasks.length;
    let sticker;
    if (Math.random() < 0.1) {
      sticker = "smiley";
    }
    dummyItems.push({
      id: createUniqueId(),
      content: tasks[index],
      sortKey: sortKeys[i],
      tsCreated: new Date(),
      tsCompleted: null,
      listId,
      ...(sticker && { sticker: "smiley" }),
    });
  }
  return dummyItems;
}

// export function simulateNetwork(listId: string) {
//     const next = Math.random() * 10000;
//     const index = Math.round(sunlistItems.length * Math.random());
//     setTimeout(() => store.insert({
//         id: nanoid(),
//         text: tasks[index],
//         sortKey: sortKeys[i],
//         tsCreated: (new Date()).toString(),
//         listId,
//     }))
// }
