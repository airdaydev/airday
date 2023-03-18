/**
 *
 * @param coordPairA [x: number, y: number]
 * @param coordPairB [x: number, y: number]
 * @returns distance between two coords (pythagora's theorem)
 */
export function distance(coordPairA: [number, number], coordPairB: [number, number]) {
    return Math.sqrt(Math.pow(coordPairB[0] - coordPairA[0], 2) + Math.pow(coordPairB[1] - coordPairA[1], 2));
}
