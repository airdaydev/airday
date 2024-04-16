# Maintaining sort order of a list of elements in a fully decentralized collaborative environment

Problem: In a fully decentralized collaborative application, multiple replicas are performing independent move, insert, and delete operations on the same sequence, many times (potentially thousands), and synchronised at arbirary points. We need to merge this state in acceptable manner.

## Options
- CRDTs (Lseq, Logoot, Treedoc, and RGA)
- Operational Transform
- Lamport Timestamps or Vector Clocks

## Lseq (Linear Sequence)
- https://hal.science/file/index/docid/921633/filename/fp025-nedelec.pdf

## Logoot
## Treedoc
## RGA

## Resources
- https://github.com/Horusiath/crdt-examples/tree/master
- https://www.bartoszsypytkowski.com/operation-based-crdts-arrays-1/
