// Naive, operation based additive CRDT number type
// Commutative?
const updateA = 1;
const updateB = 1;
const updateC = -4;

function assert(expected, actual) {
    if (expected !== actual) {
        throw new Error(`${expected} !== ${actual}`);
    }
    console.log(`Passed (${expected} === ${actual})`);
}

function assemble(...args) {
    return args.reduce((acc, crdt) => acc + crdt, 0)
}
assert(assemble(updateA, updateB, updateC), -2);
assert(assemble(updateA, updateC, updateB), -2);
assert(assemble(updateB, updateC, updateA), -2);
assert(assemble(updateB, updateA, updateC), -2);
assert(assemble(updateC, updateA, updateB), -2);
assert(assemble(updateC, updateB, updateA), -2);

assert(assemble(updateA, updateB), 2);
assert(assemble(updateB, updateA), 2);

assert(assemble(updateC, updateB), -3);
assert(assemble(updateB, updateC), -3);