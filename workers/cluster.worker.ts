import { ClusterRequest, ClusterResponse } from "../lib/types";
import { clusterByHamming } from "../lib/hammingCluster";
import { getWorkerSelf } from "../lib/workerGlobal";

const workerSelf = getWorkerSelf();

workerSelf.onmessage = (ev: MessageEvent<ClusterRequest>) => {
  const { entries, thresholdBits } = ev.data;
  const clusters = clusterByHamming(entries, thresholdBits);
  const response: ClusterResponse = { clusters };
  workerSelf.postMessage(response);
};
