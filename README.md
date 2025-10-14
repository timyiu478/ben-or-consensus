## The Ben-Or decentralized consensus algorithm

The Ben-Or consensus algorithm is making use of randomness to create consensus among a decentralised network of nodes. This type of algorithm is at the core of blockchain networks and other decentralised technologies.

## Intuition of the algorithm

1. At first every process proposes their input value. 
1. After that, they propose random values.
1. **When enough processes propose the same value, the value is chosen.**
1. Eventually, that will happen!

## Setup

1. Protocol proceeds in **asynchronous rounds**, where each round has **two** phases.
1. For each phase, processes broadcast their input values and wait for *n - f* messages from the other processes.
1. Each message is tagged with the round and phase number. (And messages can be resent to deal with a lossy network. But once a message is sent, that value is **locked** in for that process for that phase/round.)

## Guarantees

1. Deterministic Safety by majority intersection
1. Termination with probability 1

## Pros and Cons 

Pros:

1. Processes without input values start by proposing *⊥*

Cons:

1. Performance is not predictable.
1. Convergence can still take multiple rounds.
1. Amount of communication needed is potentially high.
