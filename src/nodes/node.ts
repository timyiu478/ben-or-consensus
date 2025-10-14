import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";

type NodeState = {
  killed: boolean; // this is used to know if the node was stopped by the /stop route. It's important for the unit tests but not very relevant for the Ben-Or implementation
  x: 0 | 1 | "?" | null; // the current consensus value
  decided: boolean | null; // used to know if the node reached finality
  k: number | null; // current step of the node
};

// TODO implement this
// this route allows the node to receive messages from other nodes
async function sendMessage(nodePort: number, message: any) {
  try {
    await fetch(`http://localhost:${nodePort}/message`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
  } catch (error) {
    console.error("Error sending message:", error);
  }
}

async function broadcastMessage(message: { k: number, x: any, type: string }) {
  const promises = [];
  for (let i = 0; i < N; i++) {
    promises.push(
      fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(message),
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
  };

  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();
  
  // this route allows retrieving the current status of the node
  node.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send('faulty');
    } else {
      res.status(200).send('live');
    }
  });


  // TODO
  node.post("/message", async (req, res) => {
    res.status(200).send("success");
  });

  // this route is used to start the consensus algorithm
  node.get("/start", async (req, res) => {
    while (!nodesAreReady()) { await delay(100);}
    if (!isFaulty) {
      state.k = 1;
      state.x = initialValue;
      state.decided = false;
      await broadcastMessage({ k: state.k, x: state.x, type: "propose" });
    } else {
      state.decided = null;
      state.x = null;
      state.k = null;
    }
    res.status(200).send("success");
  });


  // this route is used to stop the consensus algorithm
  node.get("/stop", async (req, res) => {
    state.killed = true;
    state.x = null;
    state.decided = null;
    state.k = 0;
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

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;
}
