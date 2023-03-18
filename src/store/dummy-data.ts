import { nanoid } from 'nanoid';
import { generateNKeysBetween } from 'fractional-indexing';
import { store } from './store.js';;

export const acmeItems = [
    'AcmeList',
    'Wrap handlebars with Cinelli wrap',
    'GET CAR SERVICED 02 xxxx xxxx',
    'https://openstax.org/details/books/precalculus-2e'
]

export const inboxItems = [
    'Eat a cantaloupe',
    'Eat watermelon',
    'Eat a fig',
    'Drink prune juice',
]

export function genTestData(listId: string, tasks: string[]): AcmeItem[] {
    const count = 1000;
    const sortKeys = generateNKeysBetween(null, null, count);
    const dummyItems: AcmeItem[] = [];
    for (let i = 0; i < count; i++) {
        const index = (i + tasks.length) % tasks.length;
        dummyItems.push({
            id: nanoid(),
            text: tasks[index],
            sortKey: sortKeys[i],
            dateCreated: (new Date()).toString(),
            listId,
        })
    }
    return dummyItems;
}

// export function simulateNetwork(listId: string) {
//     const next = Math.random() * 10000;
//     const index = Math.round(acmeItems.length * Math.random());
//     setTimeout(() => store.insert({
//         id: nanoid(),
//         text: tasks[index],
//         sortKey: sortKeys[i],
//         dateCreated: (new Date()).toString(),
//         listId,
//     }))
// }