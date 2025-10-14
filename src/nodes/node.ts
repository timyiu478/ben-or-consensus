import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";
import { Mutex } from 'async-mutex';

type NodeState = {
  killed: boolean;
  x: 0 | 1 | "?" | null;
  decided: boolean | null;
  k: number | null;
};

async function broadcastMessage(message: {x: Value, k: number, phrase: string, senderId: number}, N: number) {
  // Fire-and-forget, no need to wait for all HTTP requests to complete before proceeding
  for (let i = 0; i < N; i++) {
    fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({message: message}),
    });
  }
}

export async function node(
  nodeId: number,
  N: number,
  F: number,
  initialValue: Value,
  isFaulty: boolean,
  nodesAreReady: () => boolean,
  setNodeIsReady: (index: number) => void
) {
  const node = express();
  node.use(express.json());
  node.use(bodyParser.json());


  const state: NodeState = {
    killed: false,
    x: initialValue,
    decided: false,
    k: 0, // always start from 0
  };

  const mutex = new Mutex(); // Create mutex instance

  // For each round/phase, track which nodeIds have sent messages
  const proposalSenders = new Map<number, Set<number>>();
  const voteSenders = new Map<number, Set<number>>();

  // Count values per round
  const proposals = new Map<number, Map<Value, number>>();
  const votes = new Map<number, Map<Value, number>>();

  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send('faulty');
    } else {
      res.status(200).send('live');
    }
  });

  // **This function processes both remote and self-messages**
  async function handleMessage(msg: { k: number, x: Value, phrase: string, senderId: number }) {
    const {k, x, phrase, senderId} = msg;
    console.log(`${nodeId} received k:${k}, x:${x}, phrase:${phrase}, senderId:${senderId}`)

    if (state.killed || state.decided || k < state.k!) return;

    if (phrase == "propose") {
      if (!proposalSenders.has(k)) proposalSenders.set(k, new Set());
      const senders = proposalSenders.get(k)!;
      if (senders.has(senderId)) { return; }
      senders.add(senderId);

      if (!proposals.has(k)) proposals.set(k, new Map());
      const map = proposals.get(k)!;
      map.set(x, (map.get(x) ?? 0) + 1);
    } else if (phrase == "vote") {
      if (!voteSenders.has(k)) voteSenders.set(k, new Set());
      const senders = voteSenders.get(k)!;
      if (senders.has(senderId)) { return; }
      senders.add(senderId);

      if (!votes.has(k)) votes.set(k, new Map());
      const map = votes.get(k)!;
      map.set(x, (map.get(x) ?? 0) + 1);
    }

    // Proposal phase: Once N-F proposals received, move to vote phase
    if (phrase == "propose" && (proposalSenders.get(k)!.size) >= N - F) {
      // Choose value with >N/2 support, or "?" if none
      let vote: Value = "?";
      for (const [key, count] of proposals.get(k)!) {
        if (count > N / 2) { vote = key; break; }
      }
      // Broadcast vote INCLUDING SELF
      console.log(`Node ${nodeId} is broadcasting vote ${vote}`);
      await broadcastMessage({k: k, x: vote, phrase: "vote", senderId: nodeId}, N);
    }
    // Vote phase: Once N-F votes received, decide or go to next round
    else if (phrase == "vote" && (voteSenders.get(k)!.size) >= N - F) {
      let result: Value = "?";
      for (const [key, count] of votes.get(k)!) {
        if (key == "?") continue;
        if (count > F) {
          state.decided = true;
          state.x = key;
          state.k = k;
          console.log(`Node ${nodeId} decided x = ${key}`);
          break;
        }
      }
      if (!state.decided && result == "?") {
        result = Math.round(Math.random()) === 1 ? 1 : 0;
      }
      // Prepare for next round if not decided
      if (!state.decided) {
        console.log(`next round x = ${result}`)
        state.k = k + 1;
        // Garbage collection
        proposalSenders.get(k)?.clear();
        voteSenders.get(k)?.clear();
        proposals.get(k)?.clear();
        votes.get(k)?.clear();

        // Broadcast new round proposal INCLUDING SELF
        await broadcastMessage({k: k + 1, x: result, phrase: "propose", senderId: nodeId}, N);
      }
    }

  }

  node.post("/message", async (req, res) => {
    const body = req.body as { message: { k: number, x: Value, phrase: string, senderId: number } };
    await handleMessage(body.message);
    res.status(200).send("success");
  });

  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) { await delay(100);}
    if (!isFaulty) {
      state.killed = false;
      state.decided = false;
      state.x = initialValue;
      state.k = 0;
      // Broadcast and process your own proposal
      await broadcastMessage({k: state.k, x: state.x, phrase: "propose", senderId: nodeId}, N);
    } else {
      state.killed = true;
      state.decided = null;
      state.x = null;
      state.k = null;
    }
    res.status(200).send("success");
  });

  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    state.killed = true;
    res.send("Node stopped");
  });

  // get the current state of a node
  node.get("/getState", (req, res) => {
    const responseState: NodeState = isFaulty ? { killed: state.killed, x: null, decided: null, k: null } : state;
    res.status(200).json(responseState);
  });

  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );
    setNodeIsReady(nodeId);
  });

  return server;
}
