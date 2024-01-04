# CRDT playground

Conflict-free replicated data types are data types designed to support immediate mutations within replicated state, shared asynchronously.

Two people keep a ledger aka distributed state. If one person removes, updates or adds an item, and hasn't communicated that to the other person, we end up in a state of inconsistency. If one person removes an item, then adds an item, but only shares that they added an item, then both people receive a directive to alter the second latest item, they end up in a bit of a situation.

We can imagine how this problem can come up in single CPU i.e. multi-threaded programming & in distributed systems.

CRDTs are about creating a protocol these two people can follow to keep this ledger consistent, even as the two people work immediately in total isolation & only occasionally share state.

## Revisit: CAP Theorem
Describes a tradeoff in data access within distributed systems:
- Consistency: Is the same value or error returned across the system?
- Availability: Is the system able to be written and read from?
- Partition Tolerance: Operational despite dead or intranode comms faults.

## General characteristics of CRDTs:
- Strong eventual consistency - eventually, all keepers or observers of a mutable shared object see the same thing.
- Liveness: Doesn't stall, as the consensus model is built into the data & can be evaluated deterministically by one actor.
- Safety: Doesn't break, as the consensus model is perfectly predictable.

## Notes on consistency:
A replica node may execute an operation on a data structure without synchronising ahead with any other replicas. The operation will eventually and asynchronously be shared with other replicas where it will be applied. When all network communication is complete, all replicas should share the same result, by means of a consensus algorithm.

CRDTs provide a theoretically sound means of consensus.

## Consistency conditions or models
A set of instructions may not be called in its exact order in a multi-threaded/distributed environment. It is more or less impossible to guarantee strict consistency in a multi-threaded environment.

See
- http://coldattic.info/post/88/
- http://coldattic.info/post/72/

### Stricy consistency
Fairytale

### Sequential consistency
The result of any execution is the same as if the operations of all the processors were executed in some sequential order, and the operations of each individual processor appear in this sequence in the order specified by its program. In practice this may be adding instruction set to ensure mutual exclusivity of particular read/writes across threads.
- https://www.microsoft.com/en-us/research/uploads/prod/2016/12/How-to-Make-a-Multiprocessor-Computer-That-Correctly-Executes-Multiprocess-Programs.pdf
- https://www.cs.utexas.edu/~bornholt/post/memory-models.html (Good/easy read on sequential consistency)

### Linearisability (Strongly consistent):
Retains the order of calls that do not overlap in time across all threads.

- Quiescent consistency: Where the method calls can be correctly arranged retaining the mutual order of calls separated by quiescence; a period of time where no method is being called on any thread.

### Notes: A comprehensive study of Convergent and Commutative Replicated Data Types
- https://inria.hal.science/file/index/docid/555588/filename/techreport.pdf

CRDTs are challenged to minimise “anomalies,” i.e., states that would not be observed in a sequential execution

> We consider a distributed system consisting of processes interconnected by an asynchronous network. The network can partition and recover, and nodes can operate in disconnected mode for some time. A process may crash and recover; its memory survives crashes. We assume non-byzantine behaviour (aka non-hostile behaviour).

Goal distributed system includes:
- Low knowledge, trusted stores who delegate access via encrypted keys
- Fullly trusted clients

## Data types
atoms: immutable, identified by its literal content
objects: mutable, replicable, composed of atoms, have methods called operations (may be multiple replicas)

## Operations
clients: something that queries & modifies object state by calling operations in its interface, against a specific replica
operation: first transforms a replica, then transmits update to all other replicas i.e. on other clients

## CRD Types:
- CmRDTs - commutative replicated data types (Operation-based)
- CvRDTs - convergent replicated data types (State-based)

## CvRDT (convergent/state-based):
Updates occur entirely at the source, propagates entire now modified object. Pre-conditions are necessary in many circumstances to offer safety. I.e. an update cannot occur if pre-condition has not been met e.g.  an element can be removed from a Set only if it is in the Set at the source. A merge operation occurs on the destination replica taking the old & new state to produce the new replica's state.

Continue PDF from 2.2.2 Operation-based (op-based) objects
