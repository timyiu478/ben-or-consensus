import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";

type NodeState = {
  killed: boolean; // this is used to know if the node was stopped by the /stop route. It's important for the unit tests but not very relevant for the Ben-Or implementation
  x: 0 | 1 | "?" | null; // the current consensus value
  decided: boolean | null; // used to know if the node reached finality
  k: number | null; // current step/round of the node
  phrase: string;
};

async function broadcastMessage(message: {x: Value , k: number, phrase: string}, N: number) {
  const promises = [];
  for (let i = 0; i < N; i++) {
    promises.push(
      fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({message: message}),
      })
    );
  }
  await Promise.all(promises);
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
    k: 0,
    phrase: "propose",
  };

  const proposals = new Map<number, Map<Value, number>>();
  const votes = new Map<number, Map<Value, number>>();
  const proposers = new Map<number, number>();
  const voters = new Map<number, number>();

  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send('faulty');
    } else {
      res.status(200).send('live');
    }
  });

  node.post("/message", async (req, res) => {
    const body = req.body as { message: { k: number, x: Value, phrase: string } };
    const msg = body.message;
    const phrase = msg.phrase;
    const x = msg.x;
    const k = msg.k;

    if (phrase === "propose") {
        if (proposals.has(k)) {
          const map = proposals.get(k)!;
          if (map.has(x)) {
            map.set(x, map.get(x)! + 1);
          } else {
            map.set(x, 1);
          }
        } else {
          const map = new Map<Value, number>();
          map.set(x, 1);
          proposals.set(k, map);
        }
        if (proposers.has(k)) {
          proposers.set(k, proposers.get(k)! + 1);
        } else {
          proposers.set(k, 1);
        }
    }
    if (phrase === "vote") {
        if (votes.has(k)) {
          const map = votes.get(k)!;
          if (map.has(x)) {
            map.set(x, map.get(x)! + 1);
          } else {
            map.set(x, 1);
          }
        } else {
          const map = new Map<Value, number>();
          map.set(x, 1);
          votes.set(k, map);
        }
        if (voters.has(k)) {
          voters.set(k, voters.get(k)! + 1);
        } else {
          voters.set(k, 1);
        }
    }

    if (state.decided) {
      // do nothing
    }
    else if (state.phrase == "propose" && proposers.get(state.k!)! >= N - F) {
      let vote: Value = "?";
      for (const [key, count] of proposals.get(state.k!)!) {
          if (count > N / 2) { vote = key; }
      }
      // transit the vote phrase
      state.phrase = "vote"
      // broadcast vote
      await broadcastMessage({k: state.k!, x: vote, phrase: "vote"}, N);
    } else if (state.phrase == "vote" && voters.get(state.k!)! >= N - F) {
      let result: Value = "?";
      for (const [key, count] of votes.get(state.k!)!) {
        if (key == "?") { continue; }
        result = key;
        if (count > F) { 
          state.decided = true;
          result = key;
          break;
        } 
      }
      if (!state.decided && result == "?") {
        result = Math.round(Math.random()) == 1 ? 1 : 0;
      } 
      state.x = result;
      
      if (!state.decided) {
        // Go to next round
        state.k = state.k! + 1 
        // Transit the propose phrase
        state.phrase = "propose"

        // Broadcast message
        await broadcastMessage({k: state.k!, x: state.x!, phrase: state.phrase!}, N);
      }
    }

    res.status(200).send("success");
  });

  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) { await delay(100);}
    if (!isFaulty) {
      state.killed = false;
      state.decided = false;
      state.x = initialValue;
      state.k = 1;
      state.phrase = "propose";
      // Broadcast propose
      await broadcastMessage({k: state.k, x: state.x, phrase: "propose"}, N);
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
    const responseState: NodeState = isFaulty ? { killed: state.killed, x: null, decided: null, k: null, phrase: "" } : state;
    res.status(200).json(responseState);
  });


  // start the server
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(
      `Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`
    );

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
