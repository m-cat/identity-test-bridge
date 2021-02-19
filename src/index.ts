// TODO: Enable full eslint lints.

import { Bridge } from "./bridge";
import { relativeRouterUrl, routerName, routerW, routerH } from "./consts";

class IdentityBridge extends Bridge {
  // TODO: Make interfaces accept parameters?
  static bridgeMetadata = {
    minimumInterface: {
      identity: ["string"],
      isLoggedIn: ["bool"],
      login: [],
      logout: [],
    },
    relativeRouterUrl,
    routerName,
    routerW,
    routerH
  };

  constructor() {
    super(IdentityBridge.bridgeMetadata);
  }
}

// ===============
// START EXECUTION
// ===============

// Launch the bridge.
new IdentityBridge();
