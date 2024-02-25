import { nanoid } from 'nanoid';
import { generateNKeysBetween } from 'fractional-indexing';

export const bordeItems = [
    'Borde',
    'Wrap handlebars with Cinelli wrap',
    'GET CAR SERVICED 02 xxxx xxxx',
    'https://openstax.org/details/books/precalculus-2e'
]

export const inboxItems = [
    'Munro (Get other car key from home)',
    'Research Stable Diffusion',
    'Seguir viendo la casa de papel temporada 3',
    'more regular incline press from 22kg',
]

export function genTestData(listId: string, tasks: string[]): BordeItem[] {
    const count = 1000;
    const sortKeys = generateNKeysBetween(null, null, count);
    const dummyItems: BordeItem[] = [];
    for (let i = 0; i < count; i++) {
        const index = (i + tasks.length) % tasks.length;
        let sticker;
        if (Math.random() < 0.1) {
          sticker = 'smiley';
        }
        dummyItems.push({
            id: nanoid(),
            text: tasks[index],
            sortKey: sortKeys[i],
            tsCreated: new Date(),
            tsCompleted: null,
            listId,
            ...(sticker && { sticker: 'smiley' }),
        })
    }
    return dummyItems;
}

// export function simulateNetwork(listId: string) {
//     const next = Math.random() * 10000;
//     const index = Math.round(bordeItems.length * Math.random());
//     setTimeout(() => store.insert({
//         id: nanoid(),
//         text: tasks[index],
//         sortKey: sortKeys[i],
//         tsCreated: (new Date()).toString(),
//         listId,
//     }))
// }
