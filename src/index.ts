// TODO: Enable full eslint lints.

import { Bridge } from "./bridge";
import { relativeRouterUrl, routerName, routerW, routerH } from "./consts";

const bridgeMetadata = {
  relativeRouterUrl,
  routerName,
  routerW,
  routerH,
};

// ===============
// START EXECUTION
// ===============

// Launch the bridge.
Bridge.initialize(bridgeMetadata);
